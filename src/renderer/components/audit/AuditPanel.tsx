import { useState } from 'react'
import GlassCard from '../layout/GlassCard'
import type { AuditParseResult } from '../../../shared/types'
import styles from './AuditPanel.module.css'

interface AuditPanelProps {
  lang: 'en' | 'zh'
  onAuditLoaded: (result: AuditParseResult | null) => void
}

export default function AuditPanel({ lang, onAuditLoaded }: AuditPanelProps): JSX.Element {
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

  return (
    <GlassCard title={lang === 'en' ? 'Audit List' : '审计列表'} delay={0.05}>
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
              ? (lang === 'en' ? 'Drop to import' : '释放以导入')
              : (lang === 'en' ? 'Drag & drop audit file here' : '拖放审计文件到此处')}
        </span>
        <span className={styles.dropHint}>
          {lang === 'en' ? 'Supports CSV, Excel (.xlsx/.xls), and TXT' : '支持 CSV、Excel (.xlsx/.xls) 和 TXT'}
        </span>
      </div>

      <div className={styles.fileRow}>
        <span className={styles.label}>{lang === 'en' ? 'File:' : '文件:'}</span>
        <span className={styles.fileName}>
          {result?.fileName ?? (lang === 'en' ? 'No file loaded' : '未加载文件')}
        </span>
        <button className={styles.browseBtn} onClick={handleBrowse} disabled={parsing}>
          {lang === 'en' ? 'Browse' : '浏览'}
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
              {result.validIMEIs.length.toLocaleString()} {lang === 'en' ? 'IMEIs loaded' : '个IMEI已加载'}
            </span>
          </div>
          {(result.invalidEntries.length > 0 || result.duplicateCount > 0) && (
            <div className={styles.warnings}>
              {result.invalidEntries.length > 0 && (
                <span className={styles.warn}>
                  {result.invalidEntries.length} {lang === 'en' ? 'invalid entries skipped' : '个无效条目已跳过'}
                </span>
              )}
              {result.duplicateCount > 0 && (
                <span className={styles.warn}>
                  {result.duplicateCount} {lang === 'en' ? 'duplicates found' : '个重复项'}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
