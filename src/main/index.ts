import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { app, BrowserWindow, session, shell } from 'electron'
import { EVENT_CHANNEL } from '@shared/ipc'
import { openDatabase } from './db/database'
import { createRepositories } from './db/repositories'
import { EventBus } from './events'
import { WorktreeManager } from './git/Worktrees'
import { ActionService, seedDefaultPolicies } from './integrations/ActionService'
import { SdkConnectorGateway } from './integrations/ConnectorGateway'
import { SimpleGitHubGateway } from './integrations/GitHubGateway'
import { LinearService, SdkLinearReader } from './integrations/LinearService'
import { LifecycleAutomation } from './orchestrator/LifecycleAutomation'
import { SessionManager } from './orchestrator/SessionManager'
import { registerIpcHandlers, type AppContext } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0d12',
    title: 'Multitasker',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false
    }
  })

  // External links open in the system browser — but only http(s), so a crafted
  // link can't hand an arbitrary URI scheme (file:, custom handlers) to the OS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Pin the renderer to local content; block any top-level navigation away from it.
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed = (devUrl && url.startsWith(devUrl)) || url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  // Surface renderer failures in the terminal (a blank/black window is almost
  // always an uncaught error during renderer module load).
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[renderer] ${message}  (${sourceId}:${line})`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[did-fail-load] ${code} ${desc} ${url}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[render-process-gone] reason=${details.reason} exitCode=${details.exitCode}`)
  })
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[preload-error] ${preloadPath}: ${error.message}`)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Content-Security-Policy applied as a response header. Strict in production
// (local bundled content only); dev loosens script/connect for Vite HMR + Monaco.
function isSafeExternal(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

function applyCsp(): void {
  // Loosen CSP only in genuine dev (Vite HMR); a packaged build is always strict
  // even if the dev env var leaks in.
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']) && !app.isPackaged
  const csp = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' ws: http: https:"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
}

// A GUI-launched app (Finder/Dock/`open`) inherits launchd's minimal PATH, not
// your login shell's — so spawned subprocesses (the claude CLI, git, MCP servers)
// wouldn't be found. Resolve the login-shell PATH once and adopt it.
function fixPathForPackagedApp(): void {
  if (!app.isPackaged) return
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execSync(`${shell} -ilc 'printf "%s" "$PATH"'`, { encoding: 'utf8', timeout: 5000 }).trim()
    if (out) process.env.PATH = out
  } catch {
    const home = process.env.HOME ?? ''
    const extra = ['/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`, `${home}/.npm-global/bin`]
    process.env.PATH = [...extra, process.env.PATH ?? ''].filter(Boolean).join(':')
  }
}

function bootstrap(): void {
  fixPathForPackagedApp()
  applyCsp()
  const db = openDatabase(join(app.getPath('userData'), 'multitasker.db'))
  const repos = createRepositories(db)
  seedDefaultPolicies(repos)

  const bus = new EventBus()
  const worktrees = new WorktreeManager(join(app.getPath('userData'), 'worktrees'))
  const actions = new ActionService(repos, bus, new SdkConnectorGateway(), new SimpleGitHubGateway())
  const automation = new LifecycleAutomation(bus, actions)
  const sessions = new SessionManager(repos, bus, actions, worktrees, automation)
  sessions.reconcileOnStartup()
  const linear = new LinearService(new SdkLinearReader())

  const ctx: AppContext = { repos, bus, sessions, actions, worktrees, linear }
  registerIpcHandlers(ctx)

  mainWindow = createWindow()

  // Forward every orchestrator event to the focused window.
  bus.onEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(EVENT_CHANNEL, event)
    }
  })
}

app.whenReady().then(() => {
  bootstrap()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
