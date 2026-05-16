import { useState, useEffect, useCallback, useRef } from 'react'
import GlassCard from '../layout/GlassCard'
import Tooltip from '../common/Tooltip'
import type { FolderInfo, SourceConfig } from '../../../shared/types'
import styles from './SourcePanel.module.css'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function inferSourceName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || 'Default'
}

const FOLDER_ZH: Record<string, string> = {
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
  lang: 'en' | 'zh'
  onToggleLang: () => void
  onFoldersChange: (selected: string[], rootPath: string, sourceName: string) => void
  onDateRangeChange?: (range: DateRange) => void
}

export default function SourcePanel({ lang, onToggleLang, onFoldersChange, onDateRangeChange }: SourcePanelProps): JSX.Element {
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

  // ── Browse / manual path ──
  const handleBrowse = async (): Promise<void> => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) {
      setFolderPath(path)
      if (activeSourceId) persistSourcePath(path)
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
      if (activeSourceId) persistSourcePath(folderPath)
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
    <GlassCard title={lang === 'en' ? 'Source' : '来源'} delay={0}>
      {/* ── Source selector row ── */}
      <div className={styles.sourceRow}>
        <span className={styles.label}>
          {lang === 'en' ? 'Source' : '数据源'}
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
              placeholder={lang === 'en' ? 'Source name...' : '数据源名称...'}
            />
            <button
              className={styles.sourceBtn}
              onClick={handleSaveNewSource}
              disabled={!newSourceName.trim()}
              title={lang === 'en' ? 'Save' : '保存'}
            >
              ✓
            </button>
            <button
              className={styles.sourceBtn}
              onClick={() => { setAddingSource(false); setNewSourceName('') }}
              title={lang === 'en' ? 'Cancel' : '取消'}
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
                <option value="">{lang === 'en' ? 'No saved sources' : '无保存数据源'}</option>
              )}
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              className={styles.sourceBtn}
              onClick={() => setAddingSource(true)}
              disabled={!folderPath}
              title={lang === 'en' ? 'Save current path as new source' : '将当前路径保存为新数据源'}
            >
              +
            </button>
            <button
              className={styles.sourceBtn}
              onClick={handleDeleteSource}
              disabled={sources.length === 0}
              title={lang === 'en' ? 'Remove this source' : '删除此数据源'}
            >
              −
            </button>
            <Tooltip text={lang === 'en'
              ? 'Save and switch between multiple NAS or shared folder roots. Each source remembers its own folder toggle states.'
              : '保存并切换多个 NAS 或共享文件夹根目录。每个数据源独立记住其文件夹选择状态。'}
            />
          </>
        )}
      </div>

      {/* ── Path row ── */}
      <div className={styles.topRow}>
        <div className={styles.pathRow}>
          <span className={styles.label}>
            {lang === 'en' ? 'Shared Folder' : '共享文件夹'}
          </span>
          <div className={styles.pathInput}>
            <input
              type="text"
              className={styles.input}
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              onKeyDown={handlePathSubmit}
              placeholder={lang === 'en' ? 'Select shared folder root...' : '选择共享文件夹根目录...'}
            />
            <button className={styles.browseBtn} onClick={handleBrowse}>
              {lang === 'en' ? 'Browse' : '浏览'}
            </button>
          </div>
        </div>
        <button className={styles.langBtn} onClick={onToggleLang}>
          {lang === 'en' ? 'Lang - Chinese' : 'Lang - Eng'}
        </button>
      </div>

      {/* ── Folder grid ── */}
      <div className={styles.gridHeader}>
        <span className={styles.label}>
          {lang === 'en' ? 'Search Folders' : '搜索文件夹'}
          {folders.length > 0 && (
            <span className={styles.folderCount}> ({folders.length})</span>
          )}
        </span>
        <div className={styles.gridActions}>
          <button className={styles.textBtn} onClick={handleSelectAll} disabled={folders.length === 0}>
            {allChecked
              ? (lang === 'en' ? 'Deselect All' : '取消全选')
              : (lang === 'en' ? 'Select All' : '全选')}
          </button>
          <Tooltip text={lang === 'en'
            ? 'Toggle all detected folders on or off for searching.'
            : '切换所有检测到的文件夹的搜索状态。'}
          />
          <button className={styles.textBtn} onClick={handleRefresh} disabled={!folderPath || scanning}>
            {scanning
              ? (lang === 'en' ? '⟳ Scanning...' : '⟳ 扫描中...')
              : (lang === 'en' ? '⟳ Refresh' : '⟳ 刷新')}
          </button>
          <Tooltip text={lang === 'en'
            ? 'Re-scan the shared folder to detect any new or removed subfolders since last check.'
            : '重新扫描共享文件夹以检测自上次检查以来新增或删除的子文件夹。'}
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
                {lang === 'zh' && FOLDER_ZH[folder.name]
                  ? `${FOLDER_ZH[folder.name]} (${folder.name})`
                  : folder.name}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div className={styles.emptyGrid}>
          {folderPath
            ? (lang === 'en' ? 'No subfolders found' : '未找到子文件夹')
            : (lang === 'en' ? 'Select a shared folder to scan' : '选择共享文件夹以扫描')}
        </div>
      )}

      {/* ── Date range filter ── */}
      <div className={styles.dateSection}>
        <div className={styles.dateRow}>
          <span className={styles.label}>
            {lang === 'en' ? 'Start Date' : '开始日期'}
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
            {lang === 'en' ? 'End Date' : '结束日期'}
          </span>
          <input
            type="date"
            className={styles.dateInput}
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
          />
          <Tooltip text={lang === 'en'
            ? 'Restrict the search to date folders within the specified range. Leave blank to search all dates.'
            : '将搜索限制在指定范围内的日期文件夹。留空则搜索所有日期。'}
          />
        </div>
        {dateStart && dateEnd && dateStart > dateEnd && (
          <span className={styles.dateWarn}>
            {lang === 'en' ? 'Start date is after end date — no results will match' : '开始日期在结束日期之后 — 将无匹配结果'}
          </span>
        )}
      </div>
    </GlassCard>
  )
}
