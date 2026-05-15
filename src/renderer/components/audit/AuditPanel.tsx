import { useState } from 'react'
import GlassCard from '../layout/GlassCard'
import styles from './AuditPanel.module.css'

interface AuditPanelProps {
  lang: 'en' | 'zh'
}

export default function AuditPanel({ lang }: AuditPanelProps): JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const [auditFile, setAuditFile] = useState<string | null>(null)

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
    if (file) setAuditFile(file.name)
  }

  const handleBrowse = async (): Promise<void> => {
    const path = await window.electronAPI.openFileDialog()
    if (path) {
      const name = path.split('\\').pop() || path.split('/').pop() || path
      setAuditFile(name)
    }
  }

  const detectFormat = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase()
    if (ext === 'csv') return 'CSV'
    if (ext === 'xlsx' || ext === 'xls') return 'Excel'
    if (ext === 'txt') return 'TXT'
    return 'Unknown'
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
          {dragOver
            ? (lang === 'en' ? 'Drop to import' : '释放以导入')
            : (lang === 'en' ? 'Drag & drop audit file here' : '拖放审计文件到此处')}
        </span>
        <span className={styles.dropHint}>
          {lang === 'en' ? 'or click Browse to select' : '或点击浏览选择'}
        </span>
      </div>

      <div className={styles.fileRow}>
        <span className={styles.label}>{lang === 'en' ? 'File:' : '文件:'}</span>
        <span className={styles.fileName}>
          {auditFile ?? (lang === 'en' ? 'No file loaded' : '未加载文件')}
        </span>
        <button className={styles.browseBtn} onClick={handleBrowse}>
          {lang === 'en' ? 'Browse' : '浏览'}
        </button>
      </div>

      {auditFile && (
        <div className={styles.summary}>
          <span className={styles.badge}>{detectFormat(auditFile)}</span>
          <span className={styles.summaryText}>
            {detectFormat(auditFile)} {lang === 'en' ? 'detected · 0 IMEIs loaded' : '已检测 · 0 个IMEI已加载'}
          </span>
        </div>
      )}
    </GlassCard>
  )
}
