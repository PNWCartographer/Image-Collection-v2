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
import type { AuditParseResult, SearchProgress, SearchResult, SearchMatch, ExportProgress, ExportResult, ExportRequest } from '../shared/types'
import styles from './App.module.css'

function App(): JSX.Element {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [lang, setLang] = useState<'en' | 'zh'>('en')
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [rootPath, setRootPath] = useState('')
  const [auditResult, setAuditResult] = useState<AuditParseResult | null>(null)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [streamingMatches, setStreamingMatches] = useState<SearchMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [progress, setProgress] = useState<SearchProgress | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)

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

  // Subscribe to search progress events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSearchProgress((prog) => {
      setProgress(prog)
    })
    return unsubscribe
  }, [])

  // Subscribe to streaming match events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSearchMatches((matches) => {
      setStreamingMatches((prev) => [...prev, ...matches])
    })
    return unsubscribe
  }, [])

  // Subscribe to export progress events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onExportProgress((prog) => {
      setExportProgress(prog)
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
    setStreamingMatches([])
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
        scanIndexFilter: settings.scanIndex as 'all' | 'first_only',
        mrPass: settings.mrPass || undefined,
        mrFail: settings.mrFail || undefined
      })
      setSearchResult(result)
      setStreamingMatches([]) // Clear streaming state — final result replaces it
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setSearching(false)
    }
  }

  const handleCancel = (): void => {
    window.electronAPI.cancelSearch()
  }

  const handleExport = async (): Promise<void> => {
    if (!searchResult || searchResult.matches.length === 0) return

    const settings = settingsRef.current
    if (!settings.destination) return

    setExporting(true)
    setExportResult(null)
    setExportProgress(null)

    try {
      const request: ExportRequest = {
        matches: searchResult.matches,
        destination: settings.destination,
        action: settings.action as 'copy' | 'move',
        imageType: settings.imageType as 'both' | 'bmp' | 'jpeg',
        organize: settings.organize as ExportRequest['organize'],
        duplicates: settings.duplicates as 'skip' | 'overwrite',
        aiImages: settings.aiImages
      }
      const result = await window.electronAPI.exportResults(request)
      setExportResult(result)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  const handleCancelExport = (): void => {
    window.electronAPI.cancelExport()
  }

  const handleClear = (): void => {
    setAuditResult(null)
    setSearchResult(null)
    setStreamingMatches([])
    setProgress(null)
    setExportResult(null)
    setExportProgress(null)
  }

  const canSearch = selectedFolders.length > 0 && (auditResult?.validIMEIs.length ?? 0) > 0 && !searching && !exporting

  // Use streaming matches while searching, final result after complete
  const displayResult: SearchResult | null = searchResult
    ? searchResult
    : streamingMatches.length > 0
      ? {
          matches: streamingMatches,
          missingIMEIs: [],
          totalSearched: 0,
          elapsedMs: 0,
          folderCount: 0
        }
      : null

  const formatElapsed = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (minutes === 0) return `${secs}s`
    return `${minutes}m ${secs}s`
  }

  let statusMsg: string
  if (exporting && exportProgress) {
    const ep = exportProgress
    statusMsg = lang === 'en'
      ? `Exporting ${ep.currentIMEI} · ${ep.exported} exported · ${ep.skipped} skipped`
      : `正在导出 ${ep.currentIMEI} · ${ep.exported} 已导出 · ${ep.skipped} 已跳过`
  } else if (exporting) {
    statusMsg = lang === 'en' ? 'Preparing export...' : '正在准备导出...'
  } else if (exportResult) {
    statusMsg = lang === 'en'
      ? `Export complete · ${exportResult.exported} exported · ${exportResult.skipped} skipped · ${exportResult.failed} failed · ${formatElapsed(exportResult.elapsedMs)}`
      : `导出完成 · ${exportResult.exported} 已导出 · ${exportResult.skipped} 已跳过 · ${exportResult.failed} 失败 · ${formatElapsed(exportResult.elapsedMs)}`
  } else if (searching && progress) {
    statusMsg = lang === 'en'
      ? `Searching ${progress.currentMachine}/${progress.currentDate} · ${progress.matchesSoFar} matches`
      : `正在搜索 ${progress.currentMachine}/${progress.currentDate} · ${progress.matchesSoFar} 个匹配`
  } else if (searching) {
    statusMsg = lang === 'en' ? 'Preparing search...' : '正在准备搜索...'
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

  const progressVisible = searching || exporting
  let progressPercent: number
  let progressLabel: string
  let progressSublabel: string | undefined

  if (exporting) {
    progressPercent = exportProgress?.percent ?? 0
    progressLabel = exportProgress
      ? (lang === 'en'
          ? `Exporting ${exportProgress.currentFolder}`
          : `正在导出 ${exportProgress.currentFolder}`)
      : (lang === 'en' ? 'Preparing export...' : '准备导出中...')
    progressSublabel = exportProgress
      ? (lang === 'en'
          ? `${exportProgress.exported + exportProgress.skipped + exportProgress.failed}/${exportProgress.totalItems} items · ${exportProgress.exported} exported`
          : `${exportProgress.exported + exportProgress.skipped + exportProgress.failed}/${exportProgress.totalItems} 项 · ${exportProgress.exported} 已导出`)
      : undefined
  } else {
    progressPercent = progress?.percent ?? 0
    progressLabel = progress
      ? (lang === 'en'
          ? `Scanning ${progress.currentMachine}/${progress.currentDate}`
          : `正在扫描 ${progress.currentMachine}/${progress.currentDate}`)
      : (lang === 'en' ? 'Preparing...' : '准备中...')
    progressSublabel = progress
      ? (lang === 'en'
          ? `${progress.foldersScanned}/${progress.totalFolders} folders · ${progress.matchesSoFar} matches`
          : `${progress.foldersScanned}/${progress.totalFolders} 个文件夹 · ${progress.matchesSoFar} 个匹配`)
      : undefined
  }

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
          <ResultsPanel lang={lang} result={displayResult} searching={searching} />
          <ProgressBar
            percent={progressPercent}
            label={progressLabel}
            sublabel={progressSublabel}
            visible={progressVisible}
          />
          <ActionButtons
            onSearch={handleSearch}
            onExport={handleExport}
            onClear={handleClear}
            onCancel={handleCancel}
            onCancelExport={handleCancelExport}
            canSearch={canSearch}
            canExport={searchResult !== null && searchResult.matches.length > 0 && !exporting && !!settingsRef.current.destination}
            searching={searching}
            exporting={exporting}
            lang={lang}
          />
        </div>
      </div>

      <StatusBar
        message={statusMsg}
        showLogLink={exportResult !== null}
        onOpenLogs={() => window.electronAPI.openLogsFolder()}
        lang={lang}
      />
    </div>
  )
}

export default App
