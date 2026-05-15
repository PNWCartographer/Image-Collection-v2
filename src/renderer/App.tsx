import { useState, useEffect, useRef, useCallback } from 'react'
import TitleBar from './components/layout/TitleBar'
import StatusBar from './components/layout/StatusBar'
import SourcePanel from './components/source/SourcePanel'
import type { DateTimeRange } from './components/source/SourcePanel'
import AuditPanel from './components/audit/AuditPanel'
import SettingsPanel from './components/settings/SettingsPanel'
import type { SettingsState } from './components/settings/SettingsPanel'
import ResultsPanel from './components/results/ResultsPanel'
import ProgressBar from './components/common/ProgressBar'
import ActionButtons from './components/common/ActionButtons'
import type { AuditParseResult, SearchProgress, SearchResult } from '../shared/types'
import styles from './App.module.css'

function App(): JSX.Element {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [lang, setLang] = useState<'en' | 'zh'>('en')
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [rootPath, setRootPath] = useState('')
  const [auditResult, setAuditResult] = useState<AuditParseResult | null>(null)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [progress, setProgress] = useState<SearchProgress | null>(null)

  const settingsRef = useRef<SettingsState>({
    action: 'copy', imageType: 'both', organize: 'flat',
    duplicates: 'skip', scanIndex: 'all',
    mrPass: false, mrFail: false, aiImages: false, destination: ''
  })
  const dateRangeRef = useRef<DateTimeRange>({
    dateStart: '', dateEnd: '', timeStart: '', timeEnd: ''
  })

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

  // Subscribe to search progress events from main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSearchProgress((prog) => {
      setProgress(prog)
    })
    return unsubscribe
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

  const handleSettingsChange = useCallback((settings: SettingsState): void => {
    settingsRef.current = settings
  }, [])

  const handleDateRangeChange = useCallback((range: DateTimeRange): void => {
    dateRangeRef.current = range
  }, [])

  const handleSearch = async (): Promise<void> => {
    if (!auditResult || selectedFolders.length === 0) return

    setSearching(true)
    setSearchResult(null)
    setProgress(null)

    const dr = dateRangeRef.current
    const settings = settingsRef.current

    try {
      const result = await window.electronAPI.searchIMEIs({
        rootPath,
        selectedFolders,
        imeis: auditResult.validIMEIs,
        dateStart: dr.dateStart || undefined,
        dateEnd: dr.dateEnd || undefined,
        timeStart: dr.timeStart || undefined,
        timeEnd: dr.timeEnd || undefined,
        scanIndexFilter: settings.scanIndex as 'all' | 'first_only'
      })
      setSearchResult(result)
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setSearching(false)
    }
  }

  const handleCancel = (): void => {
    window.electronAPI.cancelSearch()
  }

  const handleClear = (): void => {
    setAuditResult(null)
    setSearchResult(null)
    setProgress(null)
  }

  const canSearch = selectedFolders.length > 0 && (auditResult?.validIMEIs.length ?? 0) > 0 && !searching

  const formatElapsed = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (minutes === 0) return `${secs}s`
    return `${minutes}m ${secs}s`
  }

  let statusMsg: string
  if (searching && progress) {
    statusMsg = lang === 'en'
      ? `Searching ${progress.currentMachine}/${progress.currentDate} · ${progress.matchesSoFar} matches`
      : `正在搜索 ${progress.currentMachine}/${progress.currentDate} · ${progress.matchesSoFar} 个匹配`
  } else if (searchResult) {
    const unique = new Set(searchResult.matches.map((m) => m.imei)).size
    statusMsg = lang === 'en'
      ? `Search complete · ${unique.toLocaleString()} IMEIs found · ${searchResult.matches.length.toLocaleString()} matches · ${formatElapsed(searchResult.elapsedMs)}`
      : `搜索完成 · 找到 ${unique.toLocaleString()} 个IMEI · ${searchResult.matches.length.toLocaleString()} 个匹配 · ${formatElapsed(searchResult.elapsedMs)}`
  } else if (auditResult) {
    statusMsg = `${auditResult.validIMEIs.length.toLocaleString()} IMEIs · ${selectedFolders.length} ${lang === 'en' ? 'folders selected' : '个文件夹已选择'}`
  } else {
    statusMsg = lang === 'en' ? 'Ready' : '就绪'
  }

  const progressVisible = searching && progress !== null
  const progressPercent = progress?.percent ?? 0
  const progressLabel = progress
    ? (lang === 'en'
        ? `Scanning ${progress.currentMachine}/${progress.currentDate}`
        : `正在扫描 ${progress.currentMachine}/${progress.currentDate}`)
    : (lang === 'en' ? 'Preparing...' : '准备中...')
  const progressSublabel = progress
    ? (lang === 'en'
        ? `${progress.foldersScanned}/${progress.totalFolders} folders · ${progress.matchesSoFar} matches`
        : `${progress.foldersScanned}/${progress.totalFolders} 个文件夹 · ${progress.matchesSoFar} 个匹配`)
    : undefined

  return (
    <div className={styles.app}>
      <TitleBar theme={theme} onToggleTheme={toggleTheme} />

      <div className={styles.content}>
        <div className={styles.panels}>
          <SourcePanel
            lang={lang}
            onToggleLang={toggleLang}
            onFoldersChange={handleFoldersChange}
            onDateRangeChange={handleDateRangeChange}
          />
          <AuditPanel lang={lang} onAuditLoaded={handleAuditLoaded} />
          <SettingsPanel lang={lang} onSettingsChange={handleSettingsChange} />
          <ResultsPanel lang={lang} result={searchResult} />
          <ProgressBar
            percent={progressPercent}
            label={progressLabel}
            sublabel={progressSublabel}
            visible={progressVisible}
          />
          <ActionButtons
            onSearch={handleSearch}
            onExport={() => {}}
            onClear={handleClear}
            onCancel={handleCancel}
            canSearch={canSearch}
            canExport={searchResult !== null && searchResult.matches.length > 0}
            searching={searching}
            lang={lang}
          />
        </div>
      </div>

      <StatusBar message={statusMsg} />
    </div>
  )
}

export default App
