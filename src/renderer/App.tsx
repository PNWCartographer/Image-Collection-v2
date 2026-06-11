import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
import { formatElapsed, generateId, addDaysToYMD } from '../shared/utils'
import { t } from '../shared/i18n'
import type { Lang } from '../shared/i18n'
import styles from './App.module.css'

// ── Pure helpers for status bar and progress display ──

interface StatusInputs {
  lang: Lang
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
      : s.lang === 'zh-TW'
        ? `正在匯出 ${ep.currentIMEI} · ${ep.exported} 已匯出 · ${ep.skipped} 已略過`
        : `正在导出 ${ep.currentIMEI} · ${ep.exported} 已导出 · ${ep.skipped} 已跳过`
  }
  if (s.exporting) return s.lang === 'en' ? 'Preparing export...' : s.lang === 'zh-TW' ? '正在準備匯出...' : '正在准备导出...'
  if (s.exportResult) {
    const dest = s.exportResult.destinationPath
    return s.lang === 'en'
      ? `Export complete · ${s.exportResult.exported} exported · ${s.exportResult.skipped} skipped · ${s.exportResult.failed} failed · ${formatElapsed(s.exportResult.elapsedMs)} · ${dest}`
      : s.lang === 'zh-TW'
        ? `匯出完成 · ${s.exportResult.exported} 已匯出 · ${s.exportResult.skipped} 已略過 · ${s.exportResult.failed} 失敗 · ${formatElapsed(s.exportResult.elapsedMs)} · ${dest}`
        : `导出完成 · ${s.exportResult.exported} 已导出 · ${s.exportResult.skipped} 已跳过 · ${s.exportResult.failed} 失败 · ${formatElapsed(s.exportResult.elapsedMs)} · ${dest}`
  }
  if (s.searching && s.progress) {
    return s.lang === 'en'
      ? `Searching ${s.progress.currentMachine}/${s.progress.currentDate} · ${s.progress.matchesSoFar} matches`
      : s.lang === 'zh-TW'
        ? `正在搜尋 ${s.progress.currentMachine}/${s.progress.currentDate} · ${s.progress.matchesSoFar} 個匹配`
        : `正在搜索 ${s.progress.currentMachine}/${s.progress.currentDate} · ${s.progress.matchesSoFar} 个匹配`
  }
  if (s.searching) return s.lang === 'en' ? 'Preparing search...' : s.lang === 'zh-TW' ? '正在準備搜尋...' : '正在准备搜索...'
  if (s.searchResult) {
    const unique = new Set(s.searchResult.matches.map((m) => m.imei)).size
    const errs = s.searchResult.scanErrors
    const errTag = errs > 0
      ? (s.lang === 'en' ? ` · ${errs} access errors` : s.lang === 'zh-TW' ? ` · ${errs} 個存取錯誤` : ` · ${errs} 个访问错误`)
      : ''
    return s.lang === 'en'
      ? `Search complete · ${unique.toLocaleString()} IMEIs found · ${s.searchResult.matches.length.toLocaleString()} matches · ${formatElapsed(s.searchResult.elapsedMs)}${errTag}`
      : s.lang === 'zh-TW'
        ? `搜尋完成 · 找到 ${unique.toLocaleString()} 個IMEI · ${s.searchResult.matches.length.toLocaleString()} 個匹配 · ${formatElapsed(s.searchResult.elapsedMs)}${errTag}`
        : `搜索完成 · 找到 ${unique.toLocaleString()} 个IMEI · ${s.searchResult.matches.length.toLocaleString()} 个匹配 · ${formatElapsed(s.searchResult.elapsedMs)}${errTag}`
  }
  if (s.auditResult) {
    return s.lang === 'en'
      ? `${s.auditResult.validIMEIs.length.toLocaleString()} IMEIs · ${s.selectedFolders.length} folders selected`
      : s.lang === 'zh-TW'
        ? `${s.auditResult.validIMEIs.length.toLocaleString()} IMEIs · ${s.selectedFolders.length} 個資料夾已選擇`
        : `${s.auditResult.validIMEIs.length.toLocaleString()} IMEIs · ${s.selectedFolders.length} 个文件夹已选择`
  }
  return s.lang === 'en'
    ? '1. Select source → 2. Load audit file → 3. Search → 4. Export'
    : s.lang === 'zh-TW'
      ? '1. 選擇來源 → 2. 載入稽核檔案 → 3. 搜尋 → 4. 匯出'
      : '1. 选择来源 → 2. 加载审计文件 → 3. 搜索 → 4. 导出'
}

function buildProgressState(
  lang: Lang,
  exporting: boolean,
  exportProgress: ExportProgress | null,
  progress: SearchProgress | null
): { percent: number; label: string; sublabel: string | undefined } {
  if (exporting) {
    return {
      percent: exportProgress?.percent ?? 0,
      label: exportProgress
        ? (lang === 'en' ? `Exporting ${exportProgress.currentFolder}` : lang === 'zh-TW' ? `正在匯出 ${exportProgress.currentFolder}` : `正在导出 ${exportProgress.currentFolder}`)
        : (lang === 'en' ? 'Preparing export...' : lang === 'zh-TW' ? '準備匯出中...' : '准备导出中...'),
      sublabel: exportProgress
        ? (lang === 'en'
            ? `${exportProgress.exported + exportProgress.skipped + exportProgress.failed}/${exportProgress.totalItems} items · ${exportProgress.exported} exported`
            : lang === 'zh-TW'
              ? `${exportProgress.exported + exportProgress.skipped + exportProgress.failed}/${exportProgress.totalItems} 項 · ${exportProgress.exported} 已匯出`
              : `${exportProgress.exported + exportProgress.skipped + exportProgress.failed}/${exportProgress.totalItems} 项 · ${exportProgress.exported} 已导出`)
        : undefined
    }
  }
  return {
    percent: progress?.percent ?? 0,
    label: progress
      ? (lang === 'en' ? `Scanning ${progress.currentMachine}/${progress.currentDate}` : lang === 'zh-TW' ? `正在掃描 ${progress.currentMachine}/${progress.currentDate}` : `正在扫描 ${progress.currentMachine}/${progress.currentDate}`)
      : (lang === 'en' ? 'Preparing...' : lang === 'zh-TW' ? '準備中...' : '准备中...'),
    sublabel: progress
      ? (lang === 'en'
          ? `${progress.foldersScanned}/${progress.totalFolders} folders · ${progress.matchesSoFar} matches`
          : lang === 'zh-TW'
            ? `${progress.foldersScanned}/${progress.totalFolders} 個資料夾 · ${progress.matchesSoFar} 個匹配`
            : `${progress.foldersScanned}/${progress.totalFolders} 个文件夹 · ${progress.matchesSoFar} 个匹配`)
      : undefined
  }
}

function friendlyError(msg: string, lang: Lang): string {
  if (msg.includes('AUDIT_FILE_DOWNLOADING')) return lang === 'en' ? 'The audit file is still downloading from OneDrive. In File Explorer, right-click it → "Always keep on this device", wait for the green check, then try again.' : lang === 'zh-TW' ? '稽核檔案仍在從 OneDrive 下載。請在檔案總管中右鍵點擊該檔案 →「永遠保留在此裝置上」，待出現綠色勾號後再試一次。' : '审计文件仍在从 OneDrive 下载。请在文件资源管理器中右键点击该文件 →"始终保留在此设备上"，待出现绿色对勾后再试一次。'
  if (msg.includes('ENOENT')) return lang === 'en' ? 'Path not found — check that the network drive is connected and the folder exists.' : lang === 'zh-TW' ? '找不到路徑 — 請確認網路磁碟已連線且資料夾存在。' : '找不到路径 — 请确认网络驱动器已连接且文件夹存在。'
  if (msg.includes('EPERM') || msg.includes('EACCES')) return lang === 'en' ? 'Permission denied — you may not have access to this folder.' : lang === 'zh-TW' ? '權限不足 — 您可能無法存取此資料夾。' : '权限不足 — 您可能无法访问此文件夹。'
  if (msg.includes('EBUSY')) return lang === 'en' ? 'File is in use by another program — try again in a moment.' : lang === 'zh-TW' ? '檔案正被其他程式使用 — 請稍後再試。' : '文件正被其他程序使用 — 请稍后再试。'
  if (msg.includes('ENOSPC')) return lang === 'en' ? 'Destination disk is full — free up space and try again.' : lang === 'zh-TW' ? '目標磁碟已滿 — 請釋放空間後再試。' : '目标磁盘已满 — 请释放空间后再试。'
  if (msg.includes('ETIMEDOUT') || msg.includes('ENETUNREACH')) return lang === 'en' ? 'Network connection timed out — check your network connection.' : lang === 'zh-TW' ? '網路連線逾時 — 請檢查您的網路連線。' : '网络连接超时 — 请检查您的网络连接。'
  return msg
}

function App(): JSX.Element {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [lang, setLang] = useState<Lang>('en')
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const [rootPath, setRootPath] = useState('')
  const [auditResult, setAuditResult] = useState<AuditParseResult | null>(null)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const streamingMatchesRef = useRef<SearchMatch[]>([])
  const [streamingMatchCount, setStreamingMatchCount] = useState(0)
  const [searching, setSearching] = useState(false)
  const [progress, setProgress] = useState<SearchProgress | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([])
  const [hasDestination, setHasDestination] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [smartSearch, setSmartSearch] = useState(true)
  // Committed date range — read directly by handleSearch so an auto-populated
  // range is never missed due to ref-vs-render timing (the old dateRangeRef bug).
  const [dateRange, setDateRange] = useState<DateRange>({ dateStart: '', dateEnd: '' })

  const sourceNameRef = useRef('')
  const abortedRef = useRef(false)
  const searchIdRef = useRef(0)
  const exportIdRef = useRef(0)

  const settingsRef = useRef<SettingsState>({
    action: 'copy', imageType: 'both', organize: 'flat',
    duplicates: 'skip', scanIndex: 'all',
    mrPass: false, mrFail: false, aiImages: false, destination: ''
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
      // Migrate legacy 'zh' → 'zh-TW'
      const resolved = saved === 'zh' ? 'zh-TW' : saved
      if (resolved === 'en' || resolved === 'zh-TW' || resolved === 'zh-CN') {
        setLang(resolved)
        try { localStorage.setItem('appLang', resolved) } catch { /* noop */ }
        // Persist migration if needed
        if (saved === 'zh') window.electronAPI.settingsSet('lang', 'zh-TW')
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

  // Subscribe to streaming match events (ref-based to avoid quadratic array copies)
  useEffect(() => {
    let rafId: number | null = null
    const unsubscribe = window.electronAPI.onSearchMatches((newMatches) => {
      if (abortedRef.current) return
      for (const m of newMatches) streamingMatchesRef.current.push(m)
      // Debounce re-renders to animation frame rate (~60fps max)
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          setStreamingMatchCount(streamingMatchesRef.current.length)
          rafId = null
        })
      }
    })
    return () => {
      unsubscribe()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
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
    const next: Lang = lang === 'en' ? 'zh-TW' : lang === 'zh-TW' ? 'zh-CN' : 'en'
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
    setSearchResult(null)
    setExportResult(null)
    streamingMatchesRef.current = []
    setStreamingMatchCount(0)
    setProgress(null)
    setError(null)
  }

  const handleSettingsChange = useCallback((settings: SettingsState): void => {
    settingsRef.current = settings
    setHasDestination(!!settings.destination)
  }, [])

  const handleDateRangeChange = useCallback((range: DateRange): void => {
    setDateRange(range)
  }, [])

  const handleSearch = async (): Promise<void> => {
    if (searching) return  // Guard against double-click before React re-renders
    if (!auditResult || selectedFolders.length === 0) return

    const id = ++searchIdRef.current
    abortedRef.current = false
    setSearching(true)
    setSearchResult(null)
    streamingMatchesRef.current = []
    setStreamingMatchCount(0)
    setProgress(null)
    setError(null)

    const dr = dateRange
    const settings = settingsRef.current

    try {
      const useSmartSearch = smartSearch && !!auditResult.hints && Object.keys(auditResult.hints).length > 0
      // Idiot-proofing: an MR/fail list (grade column detected) auto-enables MR
      // collection regardless of the toggles, so the operator always gets their images.
      const forceMR = !!auditResult.isMRAudit
      const result = await window.electronAPI.searchIMEIs({
        rootPath,
        selectedFolders,
        imeis: auditResult.validIMEIs,
        dateStart: dr.dateStart || undefined,
        dateEnd: dr.dateEnd || undefined,
        scanIndexFilter: settings.scanIndex,
        mrPass: settings.mrPass || forceMR || undefined,
        mrFail: settings.mrFail || forceMR || undefined,
        // Send hints for an MR audit even if Smart Search is toggled off — MR
        // collection needs Machine + Date to open each device folder by exact path.
        hints: (useSmartSearch || forceMR) ? auditResult.hints : undefined,
        smartSearch: useSmartSearch
      })

      // Discard result if cancelled or a newer operation started
      if (abortedRef.current || searchIdRef.current !== id) return

      setSearchResult(result)
      streamingMatchesRef.current = [] // Clear streaming state — final result replaces it
      setStreamingMatchCount(0)

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
        aiImages: settings.aiImages,
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
      if (searchIdRef.current === id) {
        const msg = err instanceof Error ? err.message : String(err)
        const friendly = friendlyError(msg, lang)
        setError(lang === 'en' ? `Search failed: ${friendly}` : lang === 'zh-TW' ? `搜尋失敗: ${friendly}` : `搜索失败: ${friendly}`)
      }
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
    streamingMatchesRef.current = []
    setStreamingMatchCount(0)
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
    setError(null)

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
      if (exportIdRef.current === id) {
        const msg = err instanceof Error ? err.message : String(err)
        const friendly = friendlyError(msg, lang)
        setError(lang === 'en' ? `Export failed: ${friendly}` : lang === 'zh-TW' ? `匯出失敗: ${friendly}` : `导出失败: ${friendly}`)
      }
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
    streamingMatchesRef.current = []
    setStreamingMatchCount(0)
    setProgress(null)
    setError(null)
    setExportResult(null)
    setExportProgress(null)
  }

  const canSearch = selectedFolders.length > 0 && (auditResult?.validIMEIs.length ?? 0) > 0 && !searching && !exporting

  // Use streaming matches while searching, final result after complete.
  // streamingMatchCount drives re-renders; the ref holds the actual array (avoids quadratic copies).
  const displayResult: SearchResult | null = searchResult
    ? searchResult
    : streamingMatchCount > 0
      ? {
          matches: streamingMatchesRef.current,
          missingIMEIs: [],
          totalSearched: 0,
          scanErrors: 0,
          elapsedMs: 0,
          logPath: ''
        }
      : null

  const statusMsg = buildStatusMessage({
    lang, exporting, exportProgress, exportResult, searching, progress,
    searchResult, auditResult, selectedFolders
  })

  const progressVisible = searching || exporting
  const { percent: progressPercent, label: progressLabel, sublabel: progressSublabel } =
    buildProgressState(lang, exporting, exportProgress, progress)

  // Compute suggested date range from Smart Search hints
  const suggestedDateRange = useMemo(() => {
    if (!smartSearch || !auditResult?.hints) return null
    const dates = Object.values(auditResult.hints)
      .map((h) => h.date)
      .filter((d): d is string => !!d)
      .sort()
    if (dates.length === 0) return null
    const min = dates[0]
    // End one day past the latest test date so a device tested near midnight —
    // whose image folder rolls to the next day — is still inside the range.
    const max = addDaysToYMD(dates[dates.length - 1], 1)
    return {
      start: `${min.substring(0, 4)}-${min.substring(4, 6)}-${min.substring(6, 8)}`,
      end: `${max.substring(0, 4)}-${max.substring(4, 6)}-${max.substring(6, 8)}`
    }
  }, [smartSearch, auditResult])

  // Compute unique machines from Smart Search hints for auto-selecting folders
  const suggestedMachines = useMemo(() => {
    if (!smartSearch || !auditResult?.hints) return null
    const machines = new Set<string>()
    for (const hint of Object.values(auditResult.hints)) {
      if (hint.machine) machines.add(hint.machine)
    }
    return machines.size > 0 ? Array.from(machines) : null
  }, [smartSearch, auditResult])

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
            suggestedDateRange={suggestedDateRange}
            suggestedMachines={suggestedMachines}
          />
          <AuditPanel
            lang={lang}
            onAuditLoaded={handleAuditLoaded}
            smartSearch={smartSearch}
            onSmartSearchChange={setSmartSearch}
          />
          <SettingsPanel lang={lang} onSettingsChange={handleSettingsChange} />
          {auditResult?.isMRAudit && (
            <div className={styles.mrBanner}>
              {t(lang,
                '✓ MR collection list detected — every listed device’s MR image will be collected automatically. You don’t need to set MR PASS / MR FAIL.',
                '✓ 偵測到 MR 收集清單 — 將自動收集清單中每部裝置的 MR 影像。您不需要設定 MR PASS / MR FAIL。',
                '✓ 检测到 MR 收集列表 — 将自动收集列表中每台设备的 MR 图像。您不需要设置 MR PASS / MR FAIL。')}
            </div>
          )}
          {searchResult?.notice === 'mr-no-hints' && (
            <div className={styles.mrBanner}>
              {t(lang,
                '⚠ MR collection needs an audit with Machine and Date columns to locate each device’s image. This list has neither, so no MR images could be collected.',
                '⚠ MR 收集需要含有「機器」與「日期」欄位的稽核清單才能定位每部裝置的影像。此清單兩者皆無，因此無法收集任何 MR 影像。',
                '⚠ MR 收集需要含有"机器"与"日期"列的审计列表才能定位每台设备的图像。此列表两者皆无，因此无法收集任何 MR 图像。')}
            </div>
          )}
          <ResultsPanel lang={lang} result={displayResult} searching={searching} />
          <ProgressBar
            percent={progressPercent}
            label={progressLabel}
            sublabel={progressSublabel}
            visible={progressVisible}
          />
          {error && (
            <div className={styles.errorBanner}>
              <span className={styles.errorText}>{error}</span>
              <button className={styles.errorDismiss} onClick={() => setError(null)}>✕</button>
            </div>
          )}
          {exportResult && (
            <div className={styles.exportDone}>
              <button className={styles.openFolderBtn} onClick={() => window.electronAPI.openPath(exportResult.destinationPath)}>
                {t(lang, 'Open Folder', '開啟資料夾', '打开文件夹')}
              </button>
            </div>
          )}
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
        showLogLink
        onOpenLogs={() => window.electronAPI.openLogsFolder()}
        lang={lang}
      />
    </div>
  )
}

export default App
