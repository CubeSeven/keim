import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { seedDatabase } from './lib/seed'

// @ts-expect-error - global variable for testing/debugging
window.seedDatabase = seedDatabase

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
