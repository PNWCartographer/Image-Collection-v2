import { useState, useEffect } from 'react'

function App(): JSX.Element {
  const [ipcStatus, setIpcStatus] = useState<string>('Checking...')

  useEffect(() => {
    window.electronAPI
      .ping()
      .then((response) => setIpcStatus(`IPC Bridge: ${response}`))
      .catch(() => setIpcStatus('IPC Bridge: failed'))
  }, [])

  return (
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-title">Image Collection v2</span>
      </div>
      <div className="content">
        <div className="glass-card">
          <h2>Milestone 0 — Scaffold Complete</h2>
          <p>Electron + React + Vite + TypeScript</p>
          <p className="status">{ipcStatus}</p>
        </div>
      </div>
    </div>
  )
}

export default App
