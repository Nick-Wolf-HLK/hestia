import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './App'
import { appStore } from './lib/store'
import { fernBruecke } from './lib/fern'

// Im Browser (Fernzugang) gibt es kein preload — dann baut die Seite ihre
// Brücke selbst. In Electron tut das nichts.
fernBruecke()
if (window.desk.fern) document.documentElement.dataset.fern = 'ja'
void appStore.boot(window.desk)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
