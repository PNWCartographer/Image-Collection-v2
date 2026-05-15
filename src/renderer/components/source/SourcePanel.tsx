import { useState } from 'react'
import GlassCard from '../layout/GlassCard'
import Tooltip from '../common/Tooltip'
import styles from './SourcePanel.module.css'

const PLACEHOLDER_FOLDERS = [
  'M8', 'M10', 'M12', 'M13', 'M14', 'M15', 'M16', 'M17',
  'M20', 'M21', 'M22', 'M23', 'M24', 'M34', 'M35', 'M38',
  'M39', 'audits', 'crackimages'
]

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

interface SourcePanelProps {
  lang: 'en' | 'zh'
  onToggleLang: () => void
}

export default function SourcePanel({ lang, onToggleLang }: SourcePanelProps): JSX.Element {
  const [folderPath, setFolderPath] = useState('')
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    PLACEHOLDER_FOLDERS.forEach((f) => {
      init[f] = /^M\d+$/i.test(f)
    })
    return init
  })
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [hourStart, setHourStart] = useState('')
  const [minStart, setMinStart] = useState('')
  const [hourEnd, setHourEnd] = useState('')
  const [minEnd, setMinEnd] = useState('')

  const allChecked = Object.values(toggles).every(Boolean)

  const handleSelectAll = (): void => {
    const next: Record<string, boolean> = {}
    PLACEHOLDER_FOLDERS.forEach((f) => {
      next[f] = !allChecked
    })
    setToggles(next)
  }

  const handleToggle = (folder: string): void => {
    setToggles((prev) => ({ ...prev, [folder]: !prev[folder] }))
  }

  const handleBrowse = async (): Promise<void> => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) setFolderPath(path)
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
        </span>
        <div className={styles.gridActions}>
          <button className={styles.textBtn} onClick={handleSelectAll}>
            {allChecked
              ? (lang === 'en' ? 'Deselect All' : '取消全选')
              : (lang === 'en' ? 'Select All' : '全选')}
          </button>
          <Tooltip text={lang === 'en'
            ? 'Toggle all detected folders on or off for searching.'
            : '切换所有检测到的文件夹的搜索状态。'}
          />
          <button className={styles.textBtn} title="Refresh folder list">
            {lang === 'en' ? '⟳ Refresh' : '⟳ 刷新'}
          </button>
          <Tooltip text={lang === 'en'
            ? 'Re-scan the shared folder to detect any new or removed subfolders since last check.'
            : '重新扫描共享文件夹以检测自上次检查以来新增或删除的子文件夹。'}
          />
        </div>
      </div>

      <div className={styles.grid}>
        {PLACEHOLDER_FOLDERS.map((folder) => (
          <label key={folder} className={styles.checkItem}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={toggles[folder] ?? false}
              onChange={() => handleToggle(folder)}
            />
            <span className={styles.checkLabel}>{folder}</span>
          </label>
        ))}
      </div>

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
