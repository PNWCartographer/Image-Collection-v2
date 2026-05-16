import { useState, useRef, useEffect } from 'react'
import type { SearchHistoryEntry } from '../../../shared/types'
import styles from './ActionButtons.module.css'

interface ActionButtonsProps {
  onSearch: () => void
  onExport: () => void
  onClear: () => void
  onCancel?: () => void
  onCancelExport?: () => void
  canSearch: boolean
  canExport: boolean
  searching: boolean
  exporting?: boolean
  searchHistory?: SearchHistoryEntry[]
  lang: 'en' | 'zh'
}

function formatTimestamp(ts: number, lang: 'en' | 'zh'): string {
  const d = new Date(ts)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  if (lang === 'zh') return `${month}/${day} ${h12}:${m}${ampm}`
  return `${month}/${day} ${h12}:${m} ${ampm}`
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const min = Math.floor(s / 60)
  const sec = s % 60
  if (min === 0) return `${sec}s`
  return `${min}m ${sec}s`
}

export default function ActionButtons({
  onSearch,
  onExport,
  onClear,
  onCancel,
  onCancelExport,
  canSearch,
  canExport,
  searching,
  exporting,
  searchHistory = [],
  lang
}: ActionButtonsProps): JSX.Element {
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className={styles.container}>
      {searching ? (
        <button
          className={styles.cancel}
          onClick={onCancel}
        >
          {lang === 'en' ? 'Cancel Search' : '取消搜索'}
        </button>
      ) : (
        <button
          className={styles.primary}
          onClick={onSearch}
          disabled={!canSearch}
        >
          {lang === 'en' ? 'Start Search' : '开始搜索'}
        </button>
      )}
      {exporting ? (
        <button
          className={styles.cancel}
          onClick={onCancelExport}
        >
          {lang === 'en' ? 'Cancel Export' : '取消导出'}
        </button>
      ) : (
        <button
          className={styles.primary}
          onClick={onExport}
          disabled={!canExport}
        >
          {lang === 'en' ? 'Export Results' : '导出结果'}
        </button>
      )}
      <button className={styles.secondary} onClick={onClear}>
        {lang === 'en' ? 'Clear' : '清除'}
      </button>

      {/* ── Search History ── */}
      <div className={styles.historyWrap} ref={historyRef}>
        <button
          className={styles.historyBtn}
          onClick={() => setHistoryOpen(!historyOpen)}
          disabled={searchHistory.length === 0}
          title={lang === 'en' ? 'Recent searches' : '最近搜索'}
        >
          {lang === 'en' ? 'History' : '历史'}
          {searchHistory.length > 0 && (
            <span className={styles.historyBadge}>{searchHistory.length}</span>
          )}
        </button>
        {historyOpen && searchHistory.length > 0 && (
          <div className={styles.historyDropdown}>
            <div className={styles.historyTitle}>
              {lang === 'en' ? 'Recent Searches' : '最近搜索'}
            </div>
            {searchHistory.map((entry) => {
              const uniqueFound = entry.matchCount > 0
                ? `${entry.imeiCount - entry.missingCount}/${entry.imeiCount}`
                : `0/${entry.imeiCount}`
              return (
                <div key={entry.id} className={styles.historyItem}>
                  <div className={styles.historyItemHeader}>
                    <span className={styles.historyTime}>
                      {formatTimestamp(entry.timestamp, lang)}
                    </span>
                    <span className={styles.historyElapsed}>
                      {formatElapsed(entry.elapsedMs)}
                    </span>
                  </div>
                  <div className={styles.historyItemBody}>
                    <span className={styles.historySource}>
                      {entry.sourceName || entry.rootPath}
                    </span>
                    <span className={styles.historyStats}>
                      {uniqueFound} IMEIs
                      {' · '}
                      {entry.matchCount.toLocaleString()} {lang === 'en' ? 'matches' : '匹配'}
                      {(entry.mrPass || entry.mrFail) && (
                        <span className={styles.historyMR}> MR</span>
                      )}
                    </span>
                  </div>
                  <div className={styles.historyItemFooter}>
                    <span className={styles.historyAudit}>
                      {entry.auditFileName}
                    </span>
                    {entry.dateStart && (
                      <span className={styles.historyDates}>
                        {entry.dateStart}{entry.dateEnd ? ` → ${entry.dateEnd}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
