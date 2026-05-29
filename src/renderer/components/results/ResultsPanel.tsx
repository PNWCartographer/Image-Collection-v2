import { useState, useEffect, useMemo } from 'react'
import GlassCard from '../layout/GlassCard'
import type { SearchResult } from '../../../shared/types'
import { formatElapsed } from '../../../shared/utils'
import { t, type Lang } from '../../../shared/i18n'
import styles from './ResultsPanel.module.css'

type SortKey = 'imei' | 'machineName' | 'date' | 'scanIndex' | 'totalFiles'

const DISPLAY_LIMIT = 500

interface ResultsPanelProps {
  lang: Lang
  result: SearchResult | null
  searching?: boolean
}

export default function ResultsPanel({ lang, result, searching }: ResultsPanelProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('imei')
  const [sortAsc, setSortAsc] = useState(true)
  const [showMissing, setShowMissing] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [showAllMissing, setShowAllMissing] = useState(false)

  // Reset showAll when results change (new search)
  useEffect(() => {
    setShowAll(false)
    setShowAllMissing(false)
  }, [result])

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
    return result.matches.filter((m) => m.totalFiles > 0 && m.totalFiles <= threshold).length
  }, [result])

  const uniqueFound = useMemo(() => {
    if (!result) return 0
    return new Set(result.matches.map((m) => m.imei)).size
  }, [result])

  const completeCount = result ? result.matches.length - incompleteCount : 0

  return (
    <GlassCard title={t(lang, 'Results', '結果', '结果')} delay={0.15}>
      <div className={styles.summary}>
        <span className={styles.summaryMain}>
          {!result
            ? t(lang, 'No search results yet', '尚無搜尋結果', '暂无搜索结果')
            : searching
              ? (lang === 'en'
                  ? `Searching... ${result.matches.length.toLocaleString()} matches found so far`
                  : lang === 'zh-TW'
                    ? `搜尋中... 已找到 ${result.matches.length.toLocaleString()} 個匹配`
                    : `搜索中... 已找到 ${result.matches.length.toLocaleString()} 个匹配`)
              : (lang === 'en'
                  ? `Found: ${uniqueFound.toLocaleString()} / ${(uniqueFound + result.missingIMEIs.length).toLocaleString()} IMEIs (${result.matches.length.toLocaleString()} total matches) · ${formatElapsed(result.elapsedMs)}`
                  : lang === 'zh-TW'
                    ? `已找到：${uniqueFound.toLocaleString()} / ${(uniqueFound + result.missingIMEIs.length).toLocaleString()} 個IMEI（共 ${result.matches.length.toLocaleString()} 個匹配）· ${formatElapsed(result.elapsedMs)}`
                    : `已找到：${uniqueFound.toLocaleString()} / ${(uniqueFound + result.missingIMEIs.length).toLocaleString()} 个IMEI（共 ${result.matches.length.toLocaleString()} 个匹配）· ${formatElapsed(result.elapsedMs)}`)
          }
        </span>
        <div className={styles.summaryDots}>
          <span className={styles.dotGroup} title={lang === 'en' ? 'Folders with expected file count' : lang === 'zh-TW' ? '檔案數量正常的資料夾' : '文件数量正常的文件夹'}>
            <span className={`${styles.dot} ${styles.dotGreen}`} />
            {completeCount.toLocaleString()} {t(lang, 'complete', '完整', '完成')}
          </span>
          <span className={styles.dotGroup} title={lang === 'en' ? 'Folders with fewer files than expected (below 50% of median)' : lang === 'zh-TW' ? '檔案數量少於預期的資料夾（低於中位數的50%）' : '文件数量少于预期的文件夹（低于中位数的50%）'}>
            <span className={`${styles.dot} ${styles.dotOrange}`} />
            {incompleteCount.toLocaleString()} {t(lang, 'incomplete', '不完整', '不完整')}
          </span>
          <span className={styles.dotGroup} title={lang === 'en' ? 'Serial numbers not found in any searched folder' : lang === 'zh-TW' ? '在任何搜尋資料夾中都找不到的序號' : '在任何搜索文件夹中都找不到的序号'}>
            <span className={`${styles.dot} ${styles.dotRed}`} />
            {(result?.missingIMEIs.length ?? 0).toLocaleString()} {t(lang, 'missing', '缺少', '缺失')}
          </span>
        </div>
      </div>

      {showMissing && result && result.missingIMEIs.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>#</th>
                <th className={styles.th}>{t(lang, 'Missing IMEI', '缺少的IMEI', '缺失的IMEI')}</th>
              </tr>
            </thead>
            <tbody>
              {(showAllMissing ? result.missingIMEIs : result.missingIMEIs.slice(0, DISPLAY_LIMIT)).map((imei, idx) => (
                <tr key={imei} className={styles.tr}>
                  <td className={styles.td}>{idx + 1}</td>
                  <td className={`${styles.td} ${styles.tdMissing}`}>{imei}</td>
                </tr>
              ))}
              {!showAllMissing && result.missingIMEIs.length > DISPLAY_LIMIT && (
                <tr>
                  <td className={styles.showAllRow} colSpan={2}>
                    <button className={styles.showAllBtn} onClick={() => setShowAllMissing(true)}>
                      {lang === 'en'
                        ? `Showing ${DISPLAY_LIMIT} of ${result.missingIMEIs.length.toLocaleString()} — click to show all`
                        : lang === 'zh-TW'
                          ? `顯示 ${DISPLAY_LIMIT} / ${result.missingIMEIs.length.toLocaleString()} — 點擊顯示全部`
                          : `显示 ${DISPLAY_LIMIT} / ${result.missingIMEIs.length.toLocaleString()} — 点击显示全部`}
                    </button>
                  </td>
                </tr>
              )}
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
                  {t(lang, 'Machine', '機器', '机器')}{sortIndicator('machineName')}
                </th>
                <th className={styles.th} onClick={() => handleSort('date')}>
                  {t(lang, 'Date', '日期', '日期')}{sortIndicator('date')}
                </th>
                <th className={styles.th} onClick={() => handleSort('scanIndex')}>
                  {t(lang, 'Index', '序號', '序号')}{sortIndicator('scanIndex')}
                </th>
                <th className={styles.th} onClick={() => handleSort('totalFiles')}>
                  {t(lang, 'Files', '檔案', '文件')}{sortIndicator('totalFiles')}
                </th>
              </tr>
            </thead>
            <tbody>
              {!result || sortedMatches.length === 0 ? (
                <tr>
                  <td className={styles.empty} colSpan={5}>
                    {t(lang, 'Run a search to see results', '執行搜尋以檢視結果', '运行搜索以查看结果')}
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
                            <span className={styles.fileBreakdown} title={`${match.bmpCount} BMP, ${match.jpegCount} JPEG`}>
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
                            ? `Showing ${DISPLAY_LIMIT} of ${sortedMatches.length.toLocaleString()} — click to show all${sortedMatches.length > 5000 ? ' (may be slow)' : ''}`
                            : lang === 'zh-TW'
                              ? `顯示 ${DISPLAY_LIMIT} / ${sortedMatches.length.toLocaleString()} — 點擊顯示全部${sortedMatches.length > 5000 ? '（可能較慢）' : ''}`
                              : `显示 ${DISPLAY_LIMIT} / ${sortedMatches.length.toLocaleString()} — 点击显示全部${sortedMatches.length > 5000 ? '（可能较慢）' : ''}`}
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
            ? t(lang, 'View Matches', '檢視匹配結果', '查看匹配结果')
            : (lang === 'en'
                ? `View Missing IMEIs (${result?.missingIMEIs.length ?? 0})`
                : lang === 'zh-TW'
                  ? `檢視缺少的IMEI (${result?.missingIMEIs.length ?? 0})`
                  : `查看缺失的IMEI (${result?.missingIMEIs.length ?? 0})`)
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
          {t(lang, 'Save Missing IMEIs', '儲存缺少的IMEI', '保存缺失的IMEI')}
        </button>
      </div>
    </GlassCard>
  )
}
