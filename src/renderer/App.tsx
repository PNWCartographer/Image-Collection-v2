import { useState, useEffect, useRef, useCallback } from 'react'
import TitleBar from './components/layout/TitleBar'
import StatusBar from './components/layout/StatusBar'
import SourcePanel from './components/source/SourcePanel'
import type { DateRange } from './components/source/SourcePanel'
import AuditPanel from './components/audit/AuditPanel'
import SettingsPanel from './components/settings/SettingsPanel'
import type { SettingsState } from './components/settings/SettingsPanel'
import ResultsPanel from './components/results/ResultsPanel'
import ProgressBar from './components/common/ProgressBar'
import ActionButtons from './components/common/ActionButtons'
import type { AuditParseResult, SearchProgress, SearchResult, SearchMatch, ExportProgress, ExportResult, ExportRequest, SearchHistoryEntry } from '../shared/types'
import { formatElapsed, generateId } from '../shared/utils'
import styles from './App.module.css'

// ── Pure helpers for status bar and progress display ──

interface StatusInputs {
  lang: 'en' | 'zh'
  exporting: boolean
  exportProgress: ExportProgress | null
  exportResult: ExportResult | null
  searching: boolean
  progress: SearchProgress | null
  searchResult: SearchResult | null
  auditResult: AuditParseResult | null
  selectedFolders: string[]
}

function buildStatusMessage(s: StatusInputs): string {
  if (s.exporting && s.exportProgress) {
    const ep = s.exportProgress
    return s.lang === 'en'
      ? `Exporting ${ep.currentIMEI} · ${ep.exported} exported · ${ep.skipped} skipped`
      : `正在导出 ${ep.currentIMEI} · ${ep.exported} 已导出 · ${ep.skipped} 已跳过`
  }
  if (s.exporting) return s.lang === 'en' ? 'Preparing export...' : '正在准备导出...'
  if (s.exportResult) {
    return s.lang === 'en'
      ? `Export complete · ${s.exportResult.exported} exported · ${s.exportResult.skipped} skipped · ${s.exportResult.failed} failed · ${formatElapsed(s.exportResult.elapsedMs)}`
      : `导出完成 · ${s.exportResult.exported} 已导出 · ${s.exportResult.skipped} 已跳过 · ${s.exportResult.failed} 失败 · ${formatElapsed(s.exportResult.elapsedMs)}`
  }
  if (s.searching && s.progress) {
    return s.lang === 'en'
      ? `Searching ${s.progress.currentMachine}/${s.progress.currentDate} · ${s.progress.matchesSoFar} matches`
      : `正在搜索 ${s.progress.currentMachine}/${s.progress.currentDate} · ${s.progress.matchesSoFar} 个匹配`
  }
  if (s.searching) return s.lang === 'en' ? 'Preparing search...' : '正在准备搜索...'
  if (s.searchResult) {
    const unique = new Set(s.searchResult.matches.map((m) => m.imei)).size
    return s.lang === 'en'
      ? `Search complete · ${unique.toLocaleString()} IMEIs found · ${s.searchResult.matches.length.toLocaleString()} matches · ${formatElapsed(s.searchResult.elapsedMs)}`
      : `搜索完成 · 找到 ${unique.toLocaleString()} 个IMEI · ${s.searchResult.matches.length.toLocaleString()} 个匹配 · ${formatElapsed(s.searchResult.elapsedMs)}`
  }
  if (s.auditResult) {
    return `${s.auditResult.validIMEIs.length.toLocaleString()} IMEIs · ${s.selectedFolders.length} ${s.lang === 'en' ? 'folders selected' : '个文件夹已选择'}`
  }
  return s.lang === 'en' ? 'Ready' : '就绪'
}

function buildProgressState(
  lang: 'en' | 'zh',
  exporting: boolean,
  exportProgress: ExportProgress | null,
  progress: SearchProgress | null
): { percent: number; label: string; sublabel: string | undefined } {
  if (exporting) {
    return {
      percent: exportProgress?.percent ?? 0,
      label: exportProgress
        ? (lang === 'en' ? `Exporting ${exportProgress.currentFolder}` : `正在导出 ${exportProgress.currentFolder}`)
        : (lang === 'en' ? 'Preparing export...' : '准备导出中...'),
      sublabel: exportProgress
        ? (lang === 'en'
            ? `${exportProgress.exported + exportProgress.skipped + exportProgress.failed}/${exportProgress.totalItems} items · ${exportProgress.exported} exported`
            : `${exportProgress.exported + exportProgress.skipped + exportProgress.failed}/${exportProgress.totalItems} 项 · ${exportProgress.exported} 已导出`)
        : undefined
    }
  }
  return {
    percent: progress?.percent ?? 0,
    label: progress
      ? (lang === 'en' ? `Scanning ${progress.currentMachine}/${progress.currentDate}` : `正在扫描 ${progress.currentMachine}/${progress.currentDate}`)
      : (lang === 'en' ? 'Preparing...' : '准备中...'),
    sublabel: progress
      ? (lang === 'en'
          ? `${progress.foldersScanned}/${progress.totalFolders} folders · ${progress.matchesSoFar} matches`
          : `${progress.foldersScanned}/${progress.totalFolders} 个文件夹 · ${progress.matchesSoFar} 个匹配`)
      : undefined
  }
}

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
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([])
  const [hasDestination, setHasDestination] = useState(false)
  const [smartSearch, setSmartSearch] = useState(true)

  const sourceNameRef = useRef('')
  const abortedRef = useRef(false)
  const searchIdRef = useRef(0)
  const exportIdRef = useRef(0)

  const settingsRef = useRef<SettingsState>({
    action: 'copy', imageType: 'both', organize: 'flat',
    duplicates: 'skip', scanIndex: 'all',
    mrPass: false, mrFail: false, aiImages: false, destination: ''
  })
  const dateRangeRef = useRef<DateRange>({
    dateStart: '', dateEnd: ''
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
        try { localStorage.setItem('appLang', saved) } catch { /* noop */ }
      }
    })
    window.electronAPI.settingsGet('searchHistory').then((saved) => {
      if (Array.isArray(saved)) {
        const valid = saved.filter(
          (e): e is SearchHistoryEntry =>
            e != null && typeof e === 'object' && typeof e.id === 'string' && typeof e.timestamp === 'number'
        )
        setSearchHistory(valid)
      }
    })
  }, [])

  // Subscribe to search progress events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSearchProgress((prog) => {
      if (abortedRef.current) return
      setProgress(prog)
    })
    return unsubscribe
  }, [])

  // Subscribe to streaming match events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onSearchMatches((matches) => {
      if (abortedRef.current) return
      setStreamingMatches((prev) => [...prev, ...matches])
    })
    return unsubscribe
  }, [])

  // Subscribe to export progress events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onExportProgress((prog) => {
      if (abortedRef.current) return
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
    try { localStorage.setItem('appLang', next) } catch { /* noop */ }
  }

  const handleFoldersChange = useCallback((folders: string[], path: string, sourceName: string): void => {
    setSelectedFolders(folders)
    setRootPath(path)
    sourceNameRef.current = sourceName
  }, [])

  const handleAuditLoaded = (result: AuditParseResult | null): void => {
    setAuditResult(result)
  }

  const handleSettingsChange = useCallback((settings: SettingsState): void => {
    settingsRef.current = settings
    setHasDestination(!!settings.destination)
  }, [])

  const handleDateRangeChange = useCallback((range: DateRange): void => {
    dateRangeRef.current = range
  }, [])

  const handleSearch = async (): Promise<void> => {
    if (!auditResult || selectedFolders.length === 0) return

    const id = ++searchIdRef.current
    abortedRef.current = false
    setSearching(true)
    setSearchResult(null)
    setStreamingMatches([])
    setProgress(null)

    const dr = dateRangeRef.current
    const settings = settingsRef.current

    try {
      const useSmartSearch = smartSearch && !!auditResult.hints && Object.keys(auditResult.hints).length > 0
      const result = await window.electronAPI.searchIMEIs({
        rootPath,
        selectedFolders,
        imeis: auditResult.validIMEIs,
        dateStart: dr.dateStart || undefined,
        dateEnd: dr.dateEnd || undefined,
        scanIndexFilter: settings.scanIndex,
        mrPass: settings.mrPass || undefined,
        mrFail: settings.mrFail || undefined,
        hints: useSmartSearch ? auditResult.hints : undefined,
        smartSearch: useSmartSearch
      })

      // Discard result if cancelled or a newer operation started
      if (abortedRef.current || searchIdRef.current !== id) return

      setSearchResult(result)
      setStreamingMatches([]) // Clear streaming state — final result replaces it

      // Save to search history (keep last 5)
      const entry: SearchHistoryEntry = {
        id: generateId(),
        timestamp: Date.now(),
        auditFileName: auditResult.fileName,
        imeiCount: auditResult.validIMEIs.length,
        rootPath,
        sourceName: sourceNameRef.current,
        selectedFolders: [...selectedFolders],
        dateStart: dr.dateStart || undefined,
        dateEnd: dr.dateEnd || undefined,
        scanIndexFilter: settings.scanIndex,
        mrPass: settings.mrPass,
        mrFail: settings.mrFail,
        matchCount: result.matches.length,
        missingCount: result.missingIMEIs.length,
        elapsedMs: result.elapsedMs
      }
      setSearchHistory((prev) => {
        const updated = [entry, ...prev].slice(0, 5)
        window.electronAPI.settingsSet('searchHistory', updated)
        return updated
      })
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      // Only reset if this is still the active search
      if (searchIdRef.current === id) {
        setSearching(false)
      }
    }
  }

  const handleCancel = (): void => {
    abortedRef.current = true
    window.electronAPI.cancelSearch()
    setSearching(false)
    setProgress(null)
    setStreamingMatches([])
  }

  const handleExport = async (): Promise<void> => {
    if (!searchResult || searchResult.matches.length === 0) return

    const settings = settingsRef.current
    if (!settings.destination) return

    const id = ++exportIdRef.current
    abortedRef.current = false
    setExporting(true)
    setExportResult(null)
    setExportProgress(null)

    try {
      const request: ExportRequest = {
        matches: searchResult.matches,
        destination: settings.destination,
        action: settings.action,
        imageType: settings.imageType,
        organize: settings.organize,
        duplicates: settings.duplicates,
        aiImages: settings.aiImages
      }
      const result = await window.electronAPI.exportResults(request)

      // Discard result if cancelled or a newer operation started
      if (abortedRef.current || exportIdRef.current !== id) return

      setExportResult(result)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      // Only reset if this is still the active export
      if (exportIdRef.current === id) {
        setExporting(false)
      }
    }
  }

  const handleCancelExport = (): void => {
    abortedRef.current = true
    window.electronAPI.cancelExport()
    setExporting(false)
    setExportProgress(null)
  }

  const handleClear = (): void => {
    // Signal active operations to discard their results when they resolve
    abortedRef.current = true
    if (searching) window.electronAPI.cancelSearch()
    if (exporting) window.electronAPI.cancelExport()
    setSearching(false)
    setExporting(false)
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

  const statusMsg = buildStatusMessage({
    lang, exporting, exportProgress, exportResult, searching, progress,
    searchResult, auditResult, selectedFolders
  })

  const progressVisible = searching || exporting
  const { percent: progressPercent, label: progressLabel, sublabel: progressSublabel } =
    buildProgressState(lang, exporting, exportProgress, progress)

  return (
    <div className={styles.app}>
      <TitleBar theme={theme} lang={lang} onToggleTheme={toggleTheme} />

      <div className={styles.content}>
        <div className={styles.panels}>
          <SourcePanel
            lang={lang}
            onToggleLang={toggleLang}
            onFoldersChange={handleFoldersChange}
            onDateRangeChange={handleDateRangeChange}
          />
          <AuditPanel
            lang={lang}
            onAuditLoaded={handleAuditLoaded}
            smartSearch={smartSearch}
            onSmartSearchChange={setSmartSearch}
          />
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
            canExport={searchResult !== null && searchResult.matches.length > 0 && !exporting && hasDestination}
            searching={searching}
            exporting={exporting}
            searchHistory={searchHistory}
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
