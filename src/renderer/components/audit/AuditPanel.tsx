import { useState } from 'react'
import GlassCard from '../layout/GlassCard'
import Toggle from '../common/Toggle'
import Tooltip from '../common/Tooltip'
import type { AuditParseResult } from '../../../shared/types'
import { t, type Lang } from '../../../shared/i18n'
import styles from './AuditPanel.module.css'

interface AuditPanelProps {
  lang: Lang
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
      const msg = err instanceof Error ? err.message : t(lang, 'Failed to parse file', '檔案解析失敗', '文件解析失败')
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
      const ext = filePath.toLowerCase().split('.').pop() || ''
      if (!['csv', 'xlsx', 'xls', 'txt'].includes(ext)) {
        setError(t(lang,
          'Unsupported file type. Please use CSV, Excel (.xlsx/.xls), or TXT files.',
          '不支援的檔案類型。請使用 CSV、Excel (.xlsx/.xls) 或 TXT 檔案。',
          '不支持的文件类型。请使用 CSV、Excel (.xlsx/.xls) 或 TXT 文件。'))
        return
      }
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
    <GlassCard title={t(lang, 'Audit List', '稽核清單', '审计列表')} delay={0.05}>
      <div
        className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className={styles.dropIcon}>📄</span>
        <span className={styles.dropText}>
          {parsing
            ? t(lang, 'Parsing...', '解析中...', '解析中...')
            : dragOver
              ? t(lang, 'Drop to import', '放開以匯入', '释放以导入')
              : t(lang, 'Drag & drop audit file here', '拖放稽核檔案到此處', '拖放审计文件到此处')}
        </span>
        <span className={styles.dropHint}>
          {t(lang, 'Supports CSV, Excel (.xlsx/.xls), and TXT', '支援 CSV、Excel (.xlsx/.xls) 和 TXT', '支持 CSV、Excel (.xlsx/.xls) 和 TXT')}
        </span>
      </div>

      <div className={styles.fileRow}>
        <span className={styles.label}>{t(lang, 'File:', '檔案:', '文件:')}</span>
        <span className={styles.fileName}>
          {result?.fileName ?? t(lang, 'No file loaded', '未載入檔案', '未加载文件')}
        </span>
        <button className={styles.browseBtn} onClick={handleBrowse} disabled={parsing}>
          {t(lang, 'Browse', '瀏覽', '浏览')}
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
              {result.validIMEIs.length.toLocaleString()} {t(lang, 'IMEIs loaded', '個IMEI已載入', '个IMEI已加载')}
            </span>
          </div>
          {(result.invalidEntries.length > 0 || result.duplicateCount > 0) && (
            <div className={styles.warnings}>
              {result.invalidEntries.length > 0 && (
                <span className={styles.warn}>
                  {result.invalidEntries.length} {t(lang, 'invalid entries skipped', '個無效條目已略過', '个无效条目已跳过')}
                </span>
              )}
              {result.duplicateCount > 0 && (
                <span className={styles.warn}>
                  {result.duplicateCount} {t(lang, 'duplicates found', '個重複項', '个重复项')}
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
                      {t(lang, 'Machine', '機器', '机器')}: {hintMeta.machineValidCount}/{hintMeta.totalHintedRows}
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
                      {t(lang, 'Date', '日期', '日期')}: {hintMeta.dateValidCount}/{hintMeta.totalHintedRows}
                      {hintMeta.dateFormatGuess && ` (${hintMeta.dateFormatGuess})`}
                    </span>
                  )}
                </div>
                <div className={styles.hintToggle}>
                  <Toggle
                    label={t(lang, 'Smart Search', '智慧搜尋', '智能搜索')}
                    checked={smartSearch ?? true}
                    onChange={(v) => onSmartSearchChange?.(v)}
                  />
                  <Tooltip text={t(lang,
                    'Uses Machine and Date columns for targeted folder lookups instead of scanning all folders. Much faster when both columns are available. Turn off to fall back to IMEI-only search.',
                    '使用機器和日期欄位進行定向資料夾查找，而非掃描所有資料夾。當兩欄都可用時速度大幅提升。關閉則回退到僅IMEI搜尋。',
                    '使用机器和日期列进行定向文件夹查找，而不是扫描所有文件夹。当两列都可用时速度大幅提升。关闭则回退到仅IMEI搜索。'
                  )} />
                </div>
              </div>
              {hintMeta.machineValidCount < hintMeta.totalHintedRows && hintMeta.machineColumn !== null && (
                <div className={styles.hintWarn}>
                  {lang === 'en'
                    ? `${hintMeta.totalHintedRows - hintMeta.machineValidCount} IMEIs have unrecognized machine values — these will use broad scan as fallback`
                    : lang === 'zh-TW'
                      ? `${hintMeta.totalHintedRows - hintMeta.machineValidCount} 個IMEI的機器值無法辨識 — 將使用廣泛掃描作為備援`
                      : `${hintMeta.totalHintedRows - hintMeta.machineValidCount} 个IMEI的机器值无法识别 — 这些将使用广泛扫描作为后备`}
                </div>
              )}
              {hintMeta.dateValidCount < hintMeta.totalHintedRows && hintMeta.dateColumn !== null && (
                <div className={styles.hintWarn}>
                  {lang === 'en'
                    ? `${hintMeta.totalHintedRows - hintMeta.dateValidCount} IMEIs have unparseable date values — these will use broad scan as fallback`
                    : lang === 'zh-TW'
                      ? `${hintMeta.totalHintedRows - hintMeta.dateValidCount} 個IMEI的日期值無法解析 — 將使用廣泛掃描作為備援`
                      : `${hintMeta.totalHintedRows - hintMeta.dateValidCount} 个IMEI的日期值无法解析 — 这些将使用广泛扫描作为后备`}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
