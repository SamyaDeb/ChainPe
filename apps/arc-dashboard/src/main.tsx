/*
 *  Built with Arc Studio
 *  https://studio.arc.io
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installShareSync } from './lib/share'
import { applyTheme } from './lib/theme'
import './index.css'

// Network and console capture for the Arc Studio panels: development only.
if (import.meta.env.DEV) {
  void import('./tracing')
  void import('./console-capture')
}

applyTheme()
installShareSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
