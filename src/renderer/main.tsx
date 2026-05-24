import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './monaco'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
