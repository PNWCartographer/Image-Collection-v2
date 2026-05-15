import { useState, useEffect } from 'react'
import TitleBar from './components/layout/TitleBar'
import StatusBar from './components/layout/StatusBar'
import SourcePanel from './components/source/SourcePanel'
import AuditPanel from './components/audit/AuditPanel'
import SettingsPanel from './components/settings/SettingsPanel'
import ResultsPanel from './components/results/ResultsPanel'
import ProgressBar from './components/common/ProgressBar'
import ActionButtons from './components/common/ActionButtons'
import styles from './App.module.css'

function App(): JSX.Element {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [lang, setLang] = useState<'en' | 'zh'>('en')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = (): void => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  const toggleLang = (): void => {
    setLang((prev) => (prev === 'en' ? 'zh' : 'en'))
  }

  return (
    <div className={styles.app}>
      <TitleBar theme={theme} onToggleTheme={toggleTheme} />

      <div className={styles.content}>
        <div className={styles.panels}>
          <SourcePanel lang={lang} onToggleLang={toggleLang} />
          <AuditPanel lang={lang} />
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
            onClear={() => {}}
            canSearch={false}
            canExport={false}
            lang={lang}
          />
        </div>
      </div>

      <StatusBar message={lang === 'en' ? 'Ready' : '就绪'} />
    </div>
  )
}

export default App
