import { useState, useEffect, useCallback } from 'react'
import GlassCard from '../layout/GlassCard'
import Tooltip from '../common/Tooltip'
import type { FolderInfo } from '../../../shared/types'
import styles from './SourcePanel.module.css'

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

const FOLDER_ZH: Record<string, string> = {
  audits: '审计',
  crackimages: '裂纹图像',
  'GRR Images': 'GRR 图像',
  version_control: '版本控制',
  ModelRecogImages: '模型识别图像',
  Bin: '回收站',
}

interface SourcePanelProps {
  lang: 'en' | 'zh'
  onToggleLang: () => void
  onFoldersChange: (selected: string[], rootPath: string) => void
}

export default function SourcePanel({ lang, onToggleLang, onFoldersChange }: SourcePanelProps): JSX.Element {
  const [folderPath, setFolderPath] = useState('')
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [scanning, setScanning] = useState(false)
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [hourStart, setHourStart] = useState('')
  const [minStart, setMinStart] = useState('')
  const [hourEnd, setHourEnd] = useState('')
  const [minEnd, setMinEnd] = useState('')

  useEffect(() => {
    window.electronAPI.settingsGet('lastRootPath').then((saved) => {
      if (saved && typeof saved === 'string') {
        setFolderPath(saved)
        scanFolder(saved)
      }
    })
  }, [])

  useEffect(() => {
    const selected = Object.entries(toggles)
      .filter(([, v]) => v)
      .map(([k]) => k)
    onFoldersChange(selected, folderPath)
  }, [toggles, folderPath])

  const scanFolder = useCallback(async (path: string) => {
    if (!path) return
    setScanning(true)
    try {
      const result = await window.electronAPI.scanRoot(path)
      setFolders(result.folders)

      const savedToggles = await window.electronAPI.settingsGet(`toggles:${path}`) as Record<string, boolean> | null

      const newToggles: Record<string, boolean> = {}
      for (const folder of result.folders) {
        if (savedToggles && folder.name in savedToggles) {
          newToggles[folder.name] = savedToggles[folder.name]
        } else {
          newToggles[folder.name] = folder.isMachineFolder
        }
      }
      setToggles(newToggles)

      await window.electronAPI.settingsSet('lastRootPath', path)
      await window.electronAPI.settingsSet(`toggles:${path}`, newToggles)
    } catch (err) {
      console.error('Scan failed:', err)
      setFolders([])
      setToggles({})
    } finally {
      setScanning(false)
    }
  }, [])

  const handleBrowse = async (): Promise<void> => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) {
      setFolderPath(path)
      scanFolder(path)
    }
  }

  const handleRefresh = (): void => {
    if (folderPath) scanFolder(folderPath)
  }

  const handlePathSubmit = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && folderPath) scanFolder(folderPath)
  }

  const allChecked = folders.length > 0 && Object.values(toggles).every(Boolean)

  const handleSelectAll = (): void => {
    const next: Record<string, boolean> = {}
    folders.forEach((f) => {
      next[f.name] = !allChecked
    })
    setToggles(next)
    window.electronAPI.settingsSet(`toggles:${folderPath}`, next)
  }

  const handleToggle = (folderName: string): void => {
    setToggles((prev) => {
      const next = { ...prev, [folderName]: !prev[folderName] }
      window.electronAPI.settingsSet(`toggles:${folderPath}`, next)
      return next
    })
  }

  return (
    <GlassCard title={lang === 'en' ? 'Source' : '来源'} delay={0}>
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

      <div className={styles.dateSection}>
        <div className={styles.dateRow}>
          <span className={styles.label}>
            {lang === 'en' ? 'Start' : '开始'}
          </span>
          <input
            type="date"
            className={styles.dateInput}
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
          />
          <select
            className={styles.timeSelect}
            value={hourStart}
            onChange={(e) => setHourStart(e.target.value)}
          >
            <option value="">{lang === 'en' ? 'HH' : '时'}</option>
            {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <span className={styles.timeSep}>:</span>
          <select
            className={styles.timeSelect}
            value={minStart}
            onChange={(e) => setMinStart(e.target.value)}
          >
            <option value="">{lang === 'en' ? 'MM' : '分'}</option>
            {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className={styles.dateRow}>
          <span className={styles.label}>
            {lang === 'en' ? 'End' : '结束'}
          </span>
          <input
            type="date"
            className={styles.dateInput}
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
          />
          <select
            className={styles.timeSelect}
            value={hourEnd}
            onChange={(e) => setHourEnd(e.target.value)}
          >
            <option value="">{lang === 'en' ? 'HH' : '时'}</option>
            {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <span className={styles.timeSep}>:</span>
          <select
            className={styles.timeSelect}
            value={minEnd}
            onChange={(e) => setMinEnd(e.target.value)}
          >
            <option value="">{lang === 'en' ? 'MM' : '分'}</option>
            {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Tooltip text={lang === 'en'
            ? 'Restrict the search to date folders within the specified range. Time is optional — leave blank to search all times within the selected dates.'
            : '将搜索限制在指定范围内的日期文件夹。时间为可选 — 留空则搜索所选日期内的所有时间。'}
          />
        </div>
      </div>
    </GlassCard>
  )
}
