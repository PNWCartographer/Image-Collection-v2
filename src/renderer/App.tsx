import { useState, useEffect } from 'react'
import TitleBar from './components/layout/TitleBar'
import StatusBar from './components/layout/StatusBar'
import SourcePanel from './components/source/SourcePanel'
import AuditPanel from './components/audit/AuditPanel'
import SettingsPanel from './components/settings/SettingsPanel'
import ResultsPanel from './components/results/ResultsPanel'
import ProgressBar from './components/common/ProgressBar'
import ActionButtons from './components/common/ActionButtons'
import type { AuditParseResult } from '../shared/types'
import styles from './App.module.css'

function App(): JSX.Element {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [lang, setLang] = useState<'en' | 'zh'>('en')
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [rootPath, setRootPath] = useState('')
  const [auditResult, setAuditResult] = useState<AuditParseResult | null>(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    window.electronAPI.settingsGet('theme').then((saved) => {
      if (saved === 'dark' || saved === 'light') {
        setTheme(saved)
      }
    })
    window.electronAPI.settingsGet('lang').then((saved) => {
      if (saved === 'en' || saved === 'zh') {
        setLang(saved)
      }
    })
  }, [])

  const toggleTheme = (): void => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    window.electronAPI.settingsSet('theme', next)
  }

  const toggleLang = (): void => {
    const next = lang === 'en' ? 'zh' : 'en'
    setLang(next)
    window.electronAPI.settingsSet('lang', next)
  }

  const handleFoldersChange = (folders: string[], path: string): void => {
    setSelectedFolders(folders)
    setRootPath(path)
  }

  const handleAuditLoaded = (result: AuditParseResult | null): void => {
    setAuditResult(result)
  }

  const canSearch = selectedFolders.length > 0 && (auditResult?.validIMEIs.length ?? 0) > 0

  const statusMsg = auditResult
    ? `${auditResult.validIMEIs.length.toLocaleString()} IMEIs · ${selectedFolders.length} ${lang === 'en' ? 'folders selected' : '个文件夹已选择'}`
    : (lang === 'en' ? 'Ready' : '就绪')

  return (
    <div className={styles.app}>
      <TitleBar theme={theme} onToggleTheme={toggleTheme} />

      <div className={styles.content}>
        <div className={styles.panels}>
          <SourcePanel
            lang={lang}
            onToggleLang={toggleLang}
            onFoldersChange={handleFoldersChange}
          />
          <AuditPanel lang={lang} onAuditLoaded={handleAuditLoaded} />
          <SettingsPanel lang={lang} />
          <ResultsPanel lang={lang} />
          <ProgressBar
            percent={0}
            label={lang === 'en' ? 'Ready' : '就绪'}
            visible={false}
          />
          <ActionButtons
            onSearch={() => {}}
            onExport={() => {}}
            onClear={() => {
              setAuditResult(null)
            }}
            canSearch={canSearch}
            canExport={false}
            lang={lang}
          />
        </div>
      </div>

      <StatusBar message={statusMsg} />
    </div>
  )
}

export default App
