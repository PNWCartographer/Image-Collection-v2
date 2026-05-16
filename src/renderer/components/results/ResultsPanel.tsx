import { useState, useMemo } from 'react'
import GlassCard from '../layout/GlassCard'
import type { SearchResult } from '../../../shared/types'
import { formatElapsed } from '../../../shared/utils'
import styles from './ResultsPanel.module.css'

type SortKey = 'imei' | 'machineName' | 'date' | 'scanIndex' | 'totalFiles'

interface ResultsPanelProps {
  lang: 'en' | 'zh'
  result: SearchResult | null
  searching?: boolean
}

export default function ResultsPanel({ lang, result, searching }: ResultsPanelProps): JSX.Element {
  const DISPLAY_LIMIT = 500

  const [sortKey, setSortKey] = useState<SortKey>('imei')
  const [sortAsc, setSortAsc] = useState(true)
  const [showMissing, setShowMissing] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const sortedMatches = useMemo(() => {
    if (!result) return []
    const sorted = [...result.matches]
    sorted.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'imei') cmp = a.imei.localeCompare(b.imei)
      else if (sortKey === 'machineName') cmp = a.machineName.localeCompare(b.machineName)
      else if (sortKey === 'date') cmp = a.date.localeCompare(b.date)
      else if (sortKey === 'scanIndex') cmp = a.scanIndex - b.scanIndex
      else if (sortKey === 'totalFiles') cmp = a.totalFiles - b.totalFiles
      return sortAsc ? cmp : -cmp
    })
    return sorted
  }, [result, sortKey, sortAsc])

  const handleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortIndicator = (key: SortKey): string => {
    if (sortKey !== key) return ''
    return sortAsc ? ' ▲' : ' ▼'
  }

  // Compute incomplete count: flag matches with files significantly below median
  const incompleteCount = useMemo(() => {
    if (!result || result.matches.length === 0) return 0
    const fileCounts = result.matches.map((m) => m.totalFiles).sort((a, b) => a - b)
    const median = fileCounts[Math.floor(fileCounts.length / 2)]
    if (median === 0) return 0
    const threshold = median * 0.5
    return result.matches.filter((m) => m.totalFiles < threshold).length
  }, [result])

  const uniqueFound = useMemo(() => {
    if (!result) return 0
    return new Set(result.matches.map((m) => m.imei)).size
  }, [result])

  const completeCount = result ? result.matches.length - incompleteCount : 0

  return (
    <GlassCard title={lang === 'en' ? 'Results' : '结果'} delay={0.15}>
      <div className={styles.summary}>
        <span className={styles.summaryMain}>
          {!result
            ? (lang === 'en' ? 'No search results yet' : '暂无搜索结果')
            : searching
              ? (lang === 'en'
                  ? `Searching... ${result.matches.length.toLocaleString()} matches found so far`
                  : `搜索中... 已找到 ${result.matches.length.toLocaleString()} 个匹配`)
              : (lang === 'en'
                  ? `Found: ${uniqueFound.toLocaleString()} / ${(uniqueFound + result.missingIMEIs.length).toLocaleString()} IMEIs (${result.matches.length.toLocaleString()} total matches) · ${formatElapsed(result.elapsedMs)}`
                  : `已找到：${uniqueFound.toLocaleString()} / ${(uniqueFound + result.missingIMEIs.length).toLocaleString()} 个IMEI（共 ${result.matches.length.toLocaleString()} 个匹配）· ${formatElapsed(result.elapsedMs)}`)
          }
        </span>
        <div className={styles.summaryDots}>
          <span className={styles.dotGroup}>
            <span className={`${styles.dot} ${styles.dotGreen}`} />
            {completeCount.toLocaleString()} {lang === 'en' ? 'complete' : '完成'}
          </span>
          <span className={styles.dotGroup}>
            <span className={`${styles.dot} ${styles.dotOrange}`} />
            {incompleteCount.toLocaleString()} {lang === 'en' ? 'incomplete' : '不完整'}
          </span>
          <span className={styles.dotGroup}>
            <span className={`${styles.dot} ${styles.dotRed}`} />
            {(result?.missingIMEIs.length ?? 0).toLocaleString()} {lang === 'en' ? 'missing' : '缺失'}
          </span>
        </div>
      </div>

      {showMissing && result && result.missingIMEIs.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>#</th>
                <th className={styles.th}>{lang === 'en' ? 'Missing IMEI' : '缺失的IMEI'}</th>
              </tr>
            </thead>
            <tbody>
              {result.missingIMEIs.map((imei, idx) => (
                <tr key={imei} className={styles.tr}>
                  <td className={styles.td}>{idx + 1}</td>
                  <td className={`${styles.td} ${styles.tdMissing}`}>{imei}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th} onClick={() => handleSort('imei')}>
                  IMEI{sortIndicator('imei')}
                </th>
                <th className={styles.th} onClick={() => handleSort('machineName')}>
                  {lang === 'en' ? 'Machine' : '机器'}{sortIndicator('machineName')}
                </th>
                <th className={styles.th} onClick={() => handleSort('date')}>
                  {lang === 'en' ? 'Date' : '日期'}{sortIndicator('date')}
                </th>
                <th className={styles.th} onClick={() => handleSort('scanIndex')}>
                  {lang === 'en' ? 'Index' : '序号'}{sortIndicator('scanIndex')}
                </th>
                <th className={styles.th} onClick={() => handleSort('totalFiles')}>
                  {lang === 'en' ? 'Files' : '文件'}{sortIndicator('totalFiles')}
                </th>
              </tr>
            </thead>
            <tbody>
              {!result || sortedMatches.length === 0 ? (
                <tr>
                  <td className={styles.empty} colSpan={5}>
                    {lang === 'en' ? 'Run a search to see results' : '运行搜索以查看结果'}
                  </td>
                </tr>
              ) : (
                <>
                  {(showAll ? sortedMatches : sortedMatches.slice(0, DISPLAY_LIMIT)).map((match) => {
                    const isMR = match.matchType === 'mr-pass' || match.matchType === 'mr-fail'
                    return (
                      <tr key={`${match.imei}-${match.machineName}-${match.date}-${match.scanIndex}-${match.matchType || 'std'}`} className={styles.tr}>
                        <td className={styles.td}>{match.imei}</td>
                        <td className={styles.td}>{match.machineName}</td>
                        <td className={styles.td}>{match.date}</td>
                        {isMR ? (
                          <td className={`${styles.td} ${match.matchType === 'mr-pass' ? styles.mrPass : styles.mrFail}`}>
                            {match.mrFolder}
                          </td>
                        ) : (
                          <td className={styles.td}>{match.scanIndex}</td>
                        )}
                        <td className={styles.td}>
                          {match.totalFiles}
                          {!isMR && (
                            <span className={styles.fileBreakdown}>
                              ({match.bmpCount}b {match.jpegCount}j)
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {!showAll && sortedMatches.length > DISPLAY_LIMIT && (
                    <tr>
                      <td className={styles.showAllRow} colSpan={5}>
                        <button
                          className={styles.showAllBtn}
                          onClick={() => setShowAll(true)}
                        >
                          {lang === 'en'
                            ? `Showing ${DISPLAY_LIMIT} of ${sortedMatches.length.toLocaleString()} — click to show all`
                            : `显示 ${DISPLAY_LIMIT} / ${sortedMatches.length.toLocaleString()} — 点击显示全部`}
                        </button>
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.textBtn}
          disabled={!result || result.missingIMEIs.length === 0}
          onClick={() => setShowMissing(!showMissing)}
        >
          {showMissing
            ? (lang === 'en' ? 'View Matches' : '查看匹配结果')
            : (lang === 'en' ? `View Missing IMEIs (${result?.missingIMEIs.length ?? 0})` : `查看缺失的IMEI (${result?.missingIMEIs.length ?? 0})`)
          }
        </button>
        <button
          className={styles.textBtn}
          disabled={!result || result.missingIMEIs.length === 0}
          onClick={async () => {
            if (!result) return
            const content = result.missingIMEIs.join('\n')
            await window.electronAPI.saveFile(
              'missing-imeis.txt',
              [
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'CSV Files', extensions: ['csv'] }
              ],
              content
            )
          }}
        >
          {lang === 'en' ? 'Save Missing IMEIs' : '保存缺失的IMEI'}
        </button>
      </div>
    </GlassCard>
  )
}
