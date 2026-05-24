import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render-phase errors so a single bad component shows a readable
 * message instead of a black window. Uses inline styles so the fallback paints
 * even if stylesheet loading is the problem.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[multitasker] renderer error:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          padding: 24,
          background: '#0b0d12',
          color: '#d7dbe3',
          fontFamily: 'ui-monospace, monospace'
        }}
      >
        <h2 style={{ color: '#f06d6d', margin: '0 0 8px' }}>Multitasker hit a render error</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#c7cdd8' }}>
          {`${error.message}\n\n${error.stack ?? ''}`}
        </pre>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 12,
            padding: '6px 12px',
            background: '#6ea8fe',
            color: '#0b0d12',
            border: 'none',
            borderRadius: 4,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
