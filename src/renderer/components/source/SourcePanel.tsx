import { useState, useEffect, useCallback, useRef } from 'react'
import GlassCard from '../layout/GlassCard'
import Tooltip from '../common/Tooltip'
import type { FolderInfo, SourceConfig } from '../../../shared/types'
import { generateId } from '../../../shared/utils'
import { t, type Lang } from '../../../shared/i18n'
import styles from './SourcePanel.module.css'

function inferSourceName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || 'Default'
}

const FOLDER_TW: Record<string, string> = {
  audits: '稽核',
  crackimages: '裂紋圖像',
  'GRR Images': 'GRR 圖像',
  version_control: '版本控制',
  ModelRecogImages: '模型辨識圖像',
  Bin: '回收站',
}
const FOLDER_CN: Record<string, string> = {
  audits: '审计',
  crackimages: '裂纹图像',
  'GRR Images': 'GRR 图像',
  version_control: '版本控制',
  ModelRecogImages: '模型识别图像',
  Bin: '回收站',
}

export interface DateRange {
  dateStart: string
  dateEnd: string
}

interface SourcePanelProps {
  lang: Lang
  onToggleLang: () => void
  onFoldersChange: (selected: string[], rootPath: string, sourceName: string) => void
  onDateRangeChange?: (range: DateRange) => void
  suggestedDateRange?: { start: string; end: string } | null
  suggestedMachines?: string[] | null
}

export default function SourcePanel({ lang, onToggleLang, onFoldersChange, onDateRangeChange, suggestedDateRange, suggestedMachines }: SourcePanelProps): JSX.Element {
  // ── Source management ──
  const [sources, setSources] = useState<SourceConfig[]>([])
  const [activeSourceId, setActiveSourceId] = useState('')
  const [addingSource, setAddingSource] = useState(false)
  const [newSourceName, setNewSourceName] = useState('')
  const newNameRef = useRef<HTMLInputElement>(null)

  // ── Folder / path state ──
  const [folderPath, setFolderPath] = useState('')
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [scanning, setScanning] = useState(false)

  // ── Date state ──
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')

  const activeSource = sources.find((s) => s.id === activeSourceId)

  // ── Scan folder and apply saved toggles ──
  const scanIdRef = useRef(0)

  const scanFolder = useCallback(async (path: string, savedToggles?: Record<string, boolean>) => {
    if (!path) return
    const thisId = ++scanIdRef.current
    setScanning(true)
    try {
      const result = await window.electronAPI.scanRoot(path)
      // Discard stale results from earlier scans (rapid source switching)
      if (scanIdRef.current !== thisId) return

      setFolders(result.folders)

      const newToggles: Record<string, boolean> = {}
      for (const folder of result.folders) {
        if (savedToggles && folder.name in savedToggles) {
          newToggles[folder.name] = savedToggles[folder.name]
        } else {
          newToggles[folder.name] = folder.isMachineFolder
        }
      }
      setToggles(newToggles)
    } catch (err) {
      if (scanIdRef.current !== thisId) return
      console.error('Scan failed:', err)
      setFolders([])
      setToggles({})
    } finally {
      if (scanIdRef.current === thisId) {
        setScanning(false)
      }
    }
  }, [])

  // ── Load sources on mount (with migration from old single-path format) ──
  useEffect(() => {
    (async () => {
      const saved = (await window.electronAPI.settingsGet('sources')) as SourceConfig[] | null

      if (saved && saved.length > 0) {
        setSources(saved)
        const activeId = (await window.electronAPI.settingsGet('activeSourceId')) as string | null
        const active = saved.find((s) => s.id === activeId) || saved[0]
        setActiveSourceId(active.id)
        setFolderPath(active.rootPath)
        scanFolder(active.rootPath, active.folderToggles)
        if (activeId !== active.id) {
          window.electronAPI.settingsSet('activeSourceId', active.id)
        }
      } else {
        // Migrate from old single-path format
        const lastPath = (await window.electronAPI.settingsGet('lastRootPath')) as string | null
        if (lastPath) {
          const savedToggles = (await window.electronAPI.settingsGet(`toggles:${lastPath}`)) as Record<string, boolean> | null
          const newSource: SourceConfig = {
            id: generateId(),
            name: inferSourceName(lastPath),
            rootPath: lastPath,
            folderToggles: savedToggles || {}
          }
          setSources([newSource])
          setActiveSourceId(newSource.id)
          setFolderPath(lastPath)
          scanFolder(lastPath, newSource.folderToggles)
          window.electronAPI.settingsSet('sources', [newSource])
          window.electronAPI.settingsSet('activeSourceId', newSource.id)
        }
      }
    })()
  }, [scanFolder])

  // ── Notify parent when folders / path / source change (skip until first scan completes) ──
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!initializedRef.current && Object.keys(toggles).length === 0) return
    initializedRef.current = true
    const selected = Object.entries(toggles)
      .filter(([, v]) => v)
      .map(([k]) => k)
    onFoldersChange(selected, folderPath, activeSource?.name || '')
  }, [toggles, folderPath, activeSource?.name, onFoldersChange])

  // ── Notify parent when date range changes ──
  useEffect(() => {
    onDateRangeChange?.({ dateStart, dateEnd })
  }, [dateStart, dateEnd, onDateRangeChange])

  // ── Auto-populate date range from Smart Search hints ──
  useEffect(() => {
    if (suggestedDateRange) {
      setDateStart(suggestedDateRange.start)
      setDateEnd(suggestedDateRange.end)
    }
  }, [suggestedDateRange])

  // ── Auto-select machine folders from Smart Search hints ──
  const appliedMachinesRef = useRef<string[] | null>(null)

  useEffect(() => {
    if (!suggestedMachines || suggestedMachines.length === 0 || folders.length === 0) return
    // Only apply once per new set of hints (don't re-apply on folder refresh)
    if (appliedMachinesRef.current === suggestedMachines) return
    appliedMachinesRef.current = suggestedMachines

    const machineSet = new Set(suggestedMachines)
    const newToggles: Record<string, boolean> = {}
    for (const folder of folders) {
      newToggles[folder.name] = machineSet.has(folder.name)
    }
    setToggles(newToggles)
  }, [suggestedMachines, folders])

  // ── Persist toggles to active source ──
  const persistToggles = useCallback((newToggles: Record<string, boolean>) => {
    if (!activeSourceId) return
    setSources((prev) => {
      const updated = prev.map((s) =>
        s.id === activeSourceId ? { ...s, folderToggles: newToggles } : s
      )
      window.electronAPI.settingsSet('sources', updated)
      return updated
    })
  }, [activeSourceId])

  // ── Persist active source's rootPath ──
  const persistSourcePath = useCallback((path: string) => {
    if (!activeSourceId) return
    setSources((prev) => {
      const updated = prev.map((s) =>
        s.id === activeSourceId ? { ...s, rootPath: path } : s
      )
      window.electronAPI.settingsSet('sources', updated)
      return updated
    })
  }, [activeSourceId])

  // ── Source selection ──
  const handleSourceChange = (sourceId: string): void => {
    const source = sources.find((s) => s.id === sourceId)
    if (!source) return
    setActiveSourceId(sourceId)
    setFolderPath(source.rootPath)
    window.electronAPI.settingsSet('activeSourceId', sourceId)
    scanFolder(source.rootPath, source.folderToggles)
  }

  // ── Add new source ──
  const handleSaveNewSource = (): void => {
    const name = newSourceName.trim()
    if (!name || !folderPath) return

    // Prevent duplicate paths
    const normalizedPath = folderPath.replace(/[\\/]+$/, '').toLowerCase()
    const duplicate = sources.find((s) => s.rootPath.replace(/[\\/]+$/, '').toLowerCase() === normalizedPath)
    if (duplicate) {
      const msg = lang === 'en'
        ? `A source already exists for this path ("${duplicate.name}"). Add anyway?`
        : lang === 'zh-TW'
          ? `此路徑已有資料來源（「${duplicate.name}」）。仍要新增嗎？`
          : `此路径已有数据源（"${duplicate.name}"）。仍要添加吗？`
      if (!window.confirm(msg)) return
    }

    const newSource: SourceConfig = {
      id: generateId(),
      name,
      rootPath: folderPath,
      folderToggles: { ...toggles }
    }
    const updated = [...sources, newSource]
    setSources(updated)
    setActiveSourceId(newSource.id)
    setAddingSource(false)
    setNewSourceName('')
    window.electronAPI.settingsSet('sources', updated)
    window.electronAPI.settingsSet('activeSourceId', newSource.id)
  }

  // ── Delete active source ──
  const handleDeleteSource = (): void => {
    if (!activeSourceId || sources.length === 0) return
    const name = activeSource?.name || ''
    const msg = lang === 'en'
      ? `Remove source "${name}"? Its saved folder toggles will be lost.`
      : lang === 'zh-TW'
        ? `刪除資料來源「${name}」？其儲存的資料夾選擇狀態將遺失。`
        : `删除数据源"${name}"？其保存的文件夹选择状态将丢失。`
    if (!window.confirm(msg)) return
    const updated = sources.filter((s) => s.id !== activeSourceId)
    setSources(updated)
    if (updated.length > 0) {
      const next = updated[0]
      setActiveSourceId(next.id)
      setFolderPath(next.rootPath)
      scanFolder(next.rootPath, next.folderToggles)
      window.electronAPI.settingsSet('sources', updated)
      window.electronAPI.settingsSet('activeSourceId', next.id)
    } else {
      setActiveSourceId('')
      setFolderPath('')
      setFolders([])
      setToggles({})
      window.electronAPI.settingsSet('sources', [])
      window.electronAPI.settingsSet('activeSourceId', '')
    }
  }

  /** Ensure a source exists for the given path, creating one if needed. */
  const ensureSource = (path: string): void => {
    if (activeSourceId) {
      persistSourcePath(path)
    } else {
      const newSource: SourceConfig = {
        id: generateId(),
        name: inferSourceName(path),
        rootPath: path,
        folderToggles: {}
      }
      const updated = [...sources, newSource]
      setSources(updated)
      setActiveSourceId(newSource.id)
      window.electronAPI.settingsSet('sources', updated)
      window.electronAPI.settingsSet('activeSourceId', newSource.id)
    }
  }

  // ── Browse / manual path ──
  const handleBrowse = async (): Promise<void> => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) {
      setFolderPath(path)
      ensureSource(path)
      scanFolder(path)
    }
  }

  const handleRefresh = (): void => {
    if (folderPath) {
      scanFolder(folderPath, activeSource?.folderToggles)
    }
  }

  const handlePathSubmit = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && folderPath) {
      ensureSource(folderPath)
      scanFolder(folderPath)
    }
  }

  const allChecked = folders.length > 0 && Object.values(toggles).every(Boolean)

  const handleSelectAll = (): void => {
    const next: Record<string, boolean> = {}
    folders.forEach((f) => {
      next[f.name] = !allChecked
    })
    setToggles(next)
    persistToggles(next)
  }

  const handleToggle = (folderName: string): void => {
    setToggles((prev) => {
      const next = { ...prev, [folderName]: !prev[folderName] }
      persistToggles(next)
      return next
    })
  }

  // ── Auto-focus name input when adding source ──
  useEffect(() => {
    if (addingSource && newNameRef.current) {
      newNameRef.current.focus()
    }
  }, [addingSource])

  return (
    <GlassCard title={t(lang, 'Source', '來源', '来源')} delay={0}>
      {/* ── Source selector row ── */}
      <div className={styles.sourceRow}>
        <span className={styles.label}>
          {t(lang, 'Source', '資料來源', '数据源')}
        </span>
        {addingSource ? (
          <div className={styles.sourceNameWrap}>
            <input
              ref={newNameRef}
              type="text"
              className={styles.sourceNameInput}
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNewSource()
                if (e.key === 'Escape') { setAddingSource(false); setNewSourceName('') }
              }}
              placeholder={t(lang, 'Source name...', '資料來源名稱...', '数据源名称...')}
            />
            <button
              className={styles.sourceBtn}
              onClick={handleSaveNewSource}
              disabled={!newSourceName.trim()}
              title={t(lang, 'Save', '儲存', '保存')}
            >
              ✓
            </button>
            <button
              className={styles.sourceBtn}
              onClick={() => { setAddingSource(false); setNewSourceName('') }}
              title={t(lang, 'Cancel', '取消', '取消')}
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            <select
              className={styles.sourceSelect}
              value={activeSourceId}
              onChange={(e) => handleSourceChange(e.target.value)}
            >
              {sources.length === 0 && (
                <option value="">{t(lang, 'No saved sources', '無已儲存資料來源', '无保存数据源')}</option>
              )}
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              className={styles.sourceBtn}
              onClick={() => setAddingSource(true)}
              disabled={!folderPath}
              title={t(lang, 'Save current path as new source', '將目前路徑儲存為新資料來源', '将当前路径保存为新数据源')}
            >
              +
            </button>
            <button
              className={styles.sourceBtn}
              onClick={handleDeleteSource}
              disabled={sources.length === 0}
              title={t(lang, 'Remove this source', '刪除此資料來源', '删除此数据源')}
            >
              −
            </button>
            <Tooltip text={t(lang,
              'Save and switch between multiple NAS or shared folder roots. Each source remembers its own folder toggle states.',
              '儲存並切換多個 NAS 或共享資料夾根目錄。每個資料來源獨立記住其資料夾選擇狀態。',
              '保存并切换多个 NAS 或共享文件夹根目录。每个数据源独立记住其文件夹选择状态。')}
            />
          </>
        )}
      </div>

      {/* ── Path row ── */}
      <div className={styles.topRow}>
        <div className={styles.pathRow}>
          <span className={styles.label}>
            {t(lang, 'Shared Folder', '共享資料夾', '共享文件夹')}
          </span>
          <div className={styles.pathInput}>
            <input
              type="text"
              className={styles.input}
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              onKeyDown={handlePathSubmit}
              placeholder={t(lang, 'Select shared folder root...', '選擇共享資料夾根目錄...', '选择共享文件夹根目录...')}
            />
            <button className={styles.browseBtn} onClick={handleBrowse}>
              {t(lang, 'Browse', '瀏覽', '浏览')}
            </button>
          </div>
        </div>
        <button className={styles.langBtn} onClick={onToggleLang}>
          {t(lang, 'Lang - 繁中', 'Lang - 简中', 'Lang - EN')}
        </button>
      </div>

      {/* ── Folder grid ── */}
      <div className={styles.gridHeader}>
        <span className={styles.label}>
          {t(lang, 'Search Folders', '搜尋資料夾', '搜索文件夹')}
          {folders.length > 0 && (
            <span className={styles.folderCount}> ({folders.length})</span>
          )}
        </span>
        <div className={styles.gridActions}>
          <button className={styles.textBtn} onClick={handleSelectAll} disabled={folders.length === 0}>
            {allChecked
              ? t(lang, 'Deselect All', '取消全選', '取消全选')
              : t(lang, 'Select All', '全選', '全选')}
          </button>
          <Tooltip text={t(lang,
            'Toggle all detected folders on or off for searching.',
            '切換所有偵測到的資料夾的搜尋狀態。',
            '切换所有检测到的文件夹的搜索状态。')}
          />
          <button className={styles.textBtn} onClick={handleRefresh} disabled={!folderPath || scanning}>
            {scanning
              ? t(lang, '⟳ Scanning...', '⟳ 掃描中...', '⟳ 扫描中...')
              : t(lang, '⟳ Refresh', '⟳ 重新整理', '⟳ 刷新')}
          </button>
          <Tooltip text={t(lang,
            'Re-scan the shared folder to detect any new or removed subfolders since last check.',
            '重新掃描共享資料夾以偵測自上次檢查以來新增或刪除的子資料夾。',
            '重新扫描共享文件夹以检测自上次检查以来新增或删除的子文件夹。')}
          />
        </div>
      </div>

      {folders.length > 0 ? (
        <div className={styles.grid}>
          {folders.map((folder) => (
            <label key={folder.name} className={styles.checkItem}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={toggles[folder.name] ?? false}
                onChange={() => handleToggle(folder.name)}
              />
              <span className={styles.checkLabel}>
                {lang !== 'en' && (lang === 'zh-TW' ? FOLDER_TW : FOLDER_CN)[folder.name]
                  ? `${(lang === 'zh-TW' ? FOLDER_TW : FOLDER_CN)[folder.name]} (${folder.name})`
                  : folder.name}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div className={styles.emptyGrid}>
          {folderPath
            ? t(lang, 'No subfolders found', '未找到子資料夾', '未找到子文件夹')
            : t(lang, 'Select a shared folder to scan', '選擇共享資料夾以掃描', '选择共享文件夹以扫描')}
        </div>
      )}

      {/* ── Date range filter ── */}
      <div className={styles.dateSection}>
        <div className={styles.dateRow}>
          <span className={styles.label}>
            {t(lang, 'Start Date', '開始日期', '开始日期')}
          </span>
          <input
            type="date"
            className={styles.dateInput}
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
          />
        </div>
        <div className={styles.dateRow}>
          <span className={styles.label}>
            {t(lang, 'End Date', '結束日期', '结束日期')}
          </span>
          <input
            type="date"
            className={styles.dateInput}
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
          />
          <Tooltip text={t(lang,
            'Restrict the search to date folders within the specified range. Leave blank to search all dates.',
            '將搜尋限制在指定範圍內的日期資料夾。留空則搜尋所有日期。',
            '将搜索限制在指定范围内的日期文件夹。留空则搜索所有日期。')}
          />
        </div>
        {dateStart && dateEnd && dateStart > dateEnd && (
          <span className={styles.dateWarn}>
            {t(lang, 'Start date is after end date — no results will match', '開始日期在結束日期之後 — 將無匹配結果', '开始日期在结束日期之后 — 将无匹配结果')}
          </span>
        )}
      </div>
    </GlassCard>
  )
}
