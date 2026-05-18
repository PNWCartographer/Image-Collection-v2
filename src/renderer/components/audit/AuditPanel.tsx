import { useState } from 'react'
import GlassCard from '../layout/GlassCard'
import Toggle from '../common/Toggle'
import Tooltip from '../common/Tooltip'
import type { AuditParseResult } from '../../../shared/types'
import styles from './AuditPanel.module.css'

interface AuditPanelProps {
  lang: 'en' | 'zh'
  onAuditLoaded: (result: AuditParseResult | null) => void
  smartSearch?: boolean
  onSmartSearchChange?: (enabled: boolean) => void
}

export default function AuditPanel({ lang, onAuditLoaded, smartSearch, onSmartSearchChange }: AuditPanelProps): JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<AuditParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadFile = async (filePath: string): Promise<void> => {
    setParsing(true)
    setError(null)
    try {
      const parsed = await window.electronAPI.parseAuditFile(filePath)
      setResult(parsed)
      onAuditLoaded(parsed)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse file'
      setError(msg)
      setResult(null)
      onAuditLoaded(null)
    } finally {
      setParsing(false)
    }
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (): void => {
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      const filePath = window.electronAPI.getFilePath(file)
      loadFile(filePath)
    }
  }

  const handleBrowse = async (): Promise<void> => {
    const path = await window.electronAPI.openFileDialog()
    if (path) loadFile(path)
  }

  const formatLabel = (fmt: string): string => {
    if (fmt === 'csv') return 'CSV'
    if (fmt === 'xlsx' || fmt === 'xls') return 'Excel'
    if (fmt === 'txt') return 'TXT'
    return fmt.toUpperCase()
  }

  const hintMeta = result?.hintMeta
  const hasHints = hintMeta && (hintMeta.machineColumn !== null || hintMeta.dateColumn !== null)

  return (
    <GlassCard title={lang === 'en' ? 'Audit List' : '稽核清單'} delay={0.05}>
      <div
        className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className={styles.dropIcon}>📄</span>
        <span className={styles.dropText}>
          {parsing
            ? (lang === 'en' ? 'Parsing...' : '解析中...')
            : dragOver
              ? (lang === 'en' ? 'Drop to import' : '放開以匯入')
              : (lang === 'en' ? 'Drag & drop audit file here' : '拖放稽核檔案到此處')}
        </span>
        <span className={styles.dropHint}>
          {lang === 'en' ? 'Supports CSV, Excel (.xlsx/.xls), and TXT' : '支援 CSV、Excel (.xlsx/.xls) 和 TXT'}
        </span>
      </div>

      <div className={styles.fileRow}>
        <span className={styles.label}>{lang === 'en' ? 'File:' : '檔案:'}</span>
        <span className={styles.fileName}>
          {result?.fileName ?? (lang === 'en' ? 'No file loaded' : '未載入檔案')}
        </span>
        <button className={styles.browseBtn} onClick={handleBrowse} disabled={parsing}>
          {lang === 'en' ? 'Browse' : '瀏覽'}
        </button>
      </div>

      {error && (
        <div className={styles.error}>{error}</div>
      )}

      {result && (
        <div className={styles.summaryWrap}>
          <div className={styles.summary}>
            <span className={styles.badge}>{formatLabel(result.format)}</span>
            <span className={styles.summaryText}>
              {result.validIMEIs.length.toLocaleString()} {lang === 'en' ? 'IMEIs loaded' : '個IMEI已載入'}
            </span>
          </div>
          {(result.invalidEntries.length > 0 || result.duplicateCount > 0) && (
            <div className={styles.warnings}>
              {result.invalidEntries.length > 0 && (
                <span className={styles.warn}>
                  {result.invalidEntries.length} {lang === 'en' ? 'invalid entries skipped' : '個無效條目已略過'}
                </span>
              )}
              {result.duplicateCount > 0 && (
                <span className={styles.warn}>
                  {result.duplicateCount} {lang === 'en' ? 'duplicates found' : '個重複項'}
                </span>
              )}
            </div>
          )}

          {/* ── Smart Search hint detection ── */}
          {hasHints && (
            <div className={styles.hintSection}>
              <div className={styles.hintRow}>
                <div className={styles.hintInfo}>
                  {hintMeta.machineColumn !== null && (
                    <span className={`${styles.hintBadge} ${
                      hintMeta.machineValidCount === hintMeta.totalHintedRows
                        ? styles.hintBadgeGood
                        : hintMeta.machineValidCount >= hintMeta.totalHintedRows * 0.8
                          ? styles.hintBadgeWarn
                          : styles.hintBadgeError
                    }`}>
                      {lang === 'en' ? 'Machine' : '機器'}: {hintMeta.machineValidCount}/{hintMeta.totalHintedRows}
                    </span>
                  )}
                  {hintMeta.dateColumn !== null && (
                    <span className={`${styles.hintBadge} ${
                      hintMeta.dateValidCount === hintMeta.totalHintedRows
                        ? styles.hintBadgeGood
                        : hintMeta.dateValidCount >= hintMeta.totalHintedRows * 0.8
                          ? styles.hintBadgeWarn
                          : styles.hintBadgeError
                    }`}>
                      {lang === 'en' ? 'Date' : '日期'}: {hintMeta.dateValidCount}/{hintMeta.totalHintedRows}
                      {hintMeta.dateFormatGuess && ` (${hintMeta.dateFormatGuess})`}
                    </span>
                  )}
                </div>
                <div className={styles.hintToggle}>
                  <Toggle
                    label={lang === 'en' ? 'Smart Search' : '智慧搜尋'}
                    checked={smartSearch ?? true}
                    onChange={(v) => onSmartSearchChange?.(v)}
                  />
                  <Tooltip text={lang === 'en'
                    ? 'Uses Machine and Date columns for targeted folder lookups instead of scanning all folders. Much faster when both columns are available. Turn off to fall back to IMEI-only search.'
                    : '使用機器和日期欄位進行定向資料夾查找，而非掃描所有資料夾。當兩欄都可用時速度大幅提升。關閉則回退到僅IMEI搜尋。'
                  } />
                </div>
              </div>
              {hintMeta.machineValidCount < hintMeta.totalHintedRows && hintMeta.machineColumn !== null && (
                <div className={styles.hintWarn}>
                  {lang === 'en'
                    ? `${hintMeta.totalHintedRows - hintMeta.machineValidCount} IMEIs have unrecognized machine values — these will use broad scan as fallback`
                    : `${hintMeta.totalHintedRows - hintMeta.machineValidCount} 個IMEI的機器值無法辨識 — 將使用廣泛掃描作為備援`}
                </div>
              )}
              {hintMeta.dateValidCount < hintMeta.totalHintedRows && hintMeta.dateColumn !== null && (
                <div className={styles.hintWarn}>
                  {lang === 'en'
                    ? `${hintMeta.totalHintedRows - hintMeta.dateValidCount} IMEIs have unparseable date values — these will use broad scan as fallback`
                    : `${hintMeta.totalHintedRows - hintMeta.dateValidCount} 個IMEI的日期值無法解析 — 將使用廣泛掃描作為備援`}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
