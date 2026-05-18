import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import GlassCard from '../layout/GlassCard'
import Select from '../common/Select'
import Toggle from '../common/Toggle'
import Tooltip from '../common/Tooltip'
import { useClickOutside } from '../../hooks/useClickOutside'
import styles from './SettingsPanel.module.css'

const TOOLTIPS = {
  action: {
    en: 'Move transfers folders and removes them from the source. Copy duplicates folders, leaving the source unchanged.',
    zh: '移動：將資料夾轉移並從來源位置刪除。複製：複製資料夾，來源位置保持不變。'
  },
  imageType: {
    en: 'BMP: collect .bmp images only. JPEG: collect .jpg/.jpeg only. Both: collect all image types from matched folders.',
    zh: 'BMP：僅收集 .bmp 圖片。JPEG：僅收集 .jpg/.jpeg 圖片。全部：收集匹配資料夾中的所有圖片類型。'
  },
  duplicates: {
    en: 'Skip: if an IMEI folder already exists at the destination, leave it untouched. Overwrite: replace existing destination folders with the new source data.',
    zh: '略過：如果目標位置已存在該 IMEI 資料夾，則保持不變。覆蓋：用新的來源資料取代目標位置中已有的資料夾。'
  },
  scanIndex: {
    en: 'All: include every scan. First scan only: only _1 entries (first time scanned that day).',
    zh: '全部：包含所有掃描記錄。僅首次掃描：僅 _1 條目（當天首次掃描）。'
  },
  mrPass: {
    en: 'Collects Model Recognition PASS images — devices the AI correctly identified. Searches ModelRecogImages/{date}/{Brand-Model}/ folders for .png files matching audit list IMEIs. Disables standard image collection.',
    zh: '收集模型辨識通過（PASS）圖片 — AI 正確辨識的裝置。在 ModelRecogImages/{日期}/{品牌-型號}/ 資料夾中搜尋與稽核清單 IMEI 匹配的 .png 檔案。啟用後將停用標準圖片收集。'
  },
  mrFail: {
    en: 'Collects Model Recognition FAIL images — devices the AI misidentified (wrong placement, wrong color, wrong model). Searches ModelRecogImages/{date}/Error-Error/ for .png files matching audit list IMEIs.',
    zh: '收集模型辨識失敗（FAIL）圖片 — AI 錯誤辨識的裝置（放置錯誤、顏色錯誤、型號錯誤）。在 ModelRecogImages/{日期}/Error-Error/ 中搜尋與稽核清單 IMEI 匹配的 .png 檔案。'
  },
  aiImages: {
    en: 'When enabled, collects only the FD/ subfolder contents (AI detection images) from matched IMEI folders. Standard scan images at the folder root are excluded. When disabled, standard export includes FD/ as part of the full IMEI folder.',
    zh: '啟用時，僅從匹配的 IMEI 資料夾中收集 FD/ 子資料夾內容（AI 偵測圖片）。資料夾根目錄的標準掃描圖片將被排除。停用時，標準匯出會將 FD/ 作為完整 IMEI 資料夾的一部分包含在內。'
  }
}

interface OrganizeOption {
  value: SettingsState['organize']
  label: { en: string; zh: string }
  desc: { en: string; zh: string }
}

const ORGANIZE_OPTIONS: OrganizeOption[] = [
  {
    value: 'flat',
    label: { en: 'Flat', zh: '平鋪' },
    desc: { en: 'All IMEI folders in a single destination folder. Example: dest/IMEI_index/', zh: '所有 IMEI 資料夾放在同一個目標資料夾中。範例：dest/IMEI_index/' }
  },
  {
    value: 'by-machine',
    label: { en: 'By Machine', zh: '按機器' },
    desc: { en: 'One level of grouping by source machine. Example: dest/M8/IMEI_index/', zh: '按來源機器分組（一級）。範例：dest/M8/IMEI_index/' }
  },
  {
    value: 'by-date',
    label: { en: 'By Date', zh: '按日期' },
    desc: { en: 'One level of grouping by scan date. Example: dest/20260515/IMEI_index/', zh: '按掃描日期分組（一級）。範例：dest/20260515/IMEI_index/' }
  },
  {
    value: 'machine-date',
    label: { en: 'Machine → Date', zh: '機器 → 日期' },
    desc: { en: 'Two-level nesting: machine folder then date. Example: dest/M8/20260515/IMEI_index/', zh: '兩級巢狀：先按機器資料夾，再按日期。範例：dest/M8/20260515/IMEI_index/' }
  },
  {
    value: 'date-machine',
    label: { en: 'Date → Machine', zh: '日期 → 機器' },
    desc: { en: 'Two-level nesting: date folder then machine. Example: dest/20260515/M8/IMEI_index/', zh: '兩級巢狀：先按日期資料夾，再按機器。範例：dest/20260515/M8/IMEI_index/' }
  },
  {
    value: 'by-imei',
    label: { en: 'By IMEI', zh: '按 IMEI' },
    desc: { en: 'Groups all instances of the same device across machines/dates. Example: dest/350002267153742/M8_20260515_192/', zh: '將同一裝置在不同機器/日期的所有記錄分組。範例：dest/350002267153742/M8_20260515_192/' }
  }
]

export interface SettingsState {
  action: 'copy' | 'move'
  imageType: 'both' | 'bmp' | 'jpeg'
  organize: 'flat' | 'by-machine' | 'by-date' | 'machine-date' | 'date-machine' | 'by-imei'
  duplicates: 'skip' | 'overwrite'
  scanIndex: 'all' | 'first_only'
  mrPass: boolean
  mrFail: boolean
  aiImages: boolean
  destination: string
}

const VALID_ORGANIZE_VALUES = ORGANIZE_OPTIONS.map((o) => o.value) as readonly SettingsState['organize'][]

function isOneOf<T extends string>(value: unknown, valid: readonly T[]): value is T {
  return typeof value === 'string' && (valid as readonly string[]).includes(value)
}

interface SettingsPanelProps {
  lang: 'en' | 'zh'
  onSettingsChange?: (settings: SettingsState) => void
}

export default function SettingsPanel({ lang, onSettingsChange }: SettingsPanelProps): JSX.Element {
  const [action, setAction] = useState<SettingsState['action']>('copy')
  const [imageType, setImageType] = useState<SettingsState['imageType']>('both')
  const [organize, setOrganize] = useState<SettingsState['organize']>('flat')
  const [orgOpen, setOrgOpen] = useState(false)
  const [duplicates, setDuplicates] = useState<SettingsState['duplicates']>('skip')
  const [scanIndex, setScanIndex] = useState<SettingsState['scanIndex']>('all')
  const [mrPass, setMrPass] = useState(false)
  const [mrFail, setMrFail] = useState(false)
  const [aiImages, setAiImages] = useState(false)
  const [destination, setDestination] = useState('')
  const [showMoveWarning, setShowMoveWarning] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const orgRef = useRef<HTMLDivElement>(null)

  // Load saved settings on mount
  useEffect(() => {
    window.electronAPI.settingsGet('settingsPanel').then((saved) => {
      if (saved && typeof saved === 'object') {
        const s = saved as Record<string, unknown>
        if (s.action === 'copy') setAction('copy') // Never restore 'move' for safety
        if (isOneOf(s.imageType, ['both', 'bmp', 'jpeg'] as const)) setImageType(s.imageType)
        if (isOneOf(s.organize, VALID_ORGANIZE_VALUES)) setOrganize(s.organize)
        if (isOneOf(s.duplicates, ['skip', 'overwrite'] as const)) setDuplicates(s.duplicates)
        if (isOneOf(s.scanIndex, ['all', 'first_only'] as const)) setScanIndex(s.scanIndex)
        if (typeof s.mrPass === 'boolean') setMrPass(s.mrPass)
        if (typeof s.mrFail === 'boolean') setMrFail(s.mrFail)
        if (typeof s.aiImages === 'boolean') setAiImages(s.aiImages)
        if (typeof s.destination === 'string' && s.destination) setDestination(s.destination)
      }
      setLoaded(true)
    })
  }, [])

  const handleActionChange = (value: SettingsState['action']): void => {
    if (value === 'move') {
      setShowMoveWarning(true)
    } else {
      setAction(value)
    }
  }

  // Notify parent immediately on every change
  const settings = useMemo(
    () => ({ action, imageType, organize, duplicates, scanIndex, mrPass, mrFail, aiImages, destination }),
    [action, imageType, organize, duplicates, scanIndex, mrPass, mrFail, aiImages, destination]
  )
  useEffect(() => {
    onSettingsChange?.(settings)
  }, [settings, onSettingsChange])

  // Debounce persistence to avoid excessive disk writes during typing
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      window.electronAPI.settingsSet('settingsPanel', settings)
    }, 400)
    return () => clearTimeout(timer)
  }, [settings, loaded])

  const [orgDirection, setOrgDirection] = useState<'up' | 'down'>('up')

  const handleOrgToggle = useCallback(() => {
    setOrgOpen((prev) => {
      if (!prev && orgRef.current) {
        const rect = orgRef.current.getBoundingClientRect()
        const spaceAbove = rect.top
        const spaceBelow = window.innerHeight - rect.bottom
        setOrgDirection(spaceBelow >= 400 ? 'down' : spaceAbove >= spaceBelow ? 'up' : 'down')
      }
      return !prev
    })
  }, [])

  const closeOrgDropdown = useCallback(() => setOrgOpen(false), [])
  useClickOutside(orgRef, closeOrgDropdown)

  const handleBrowseDest = async (): Promise<void> => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) setDestination(path)
  }

  const selectedOrgLabel = ORGANIZE_OPTIONS.find((o) => o.value === organize)?.label[lang] ?? (lang === 'en' ? 'Flat' : '平铺')

  return (
    <GlassCard title={lang === 'en' ? 'Settings' : '設定'} delay={0.1} elevated={orgOpen}>
      <div className={styles.grid}>
        <div className={styles.row}>
          <Select
            label={lang === 'en' ? 'Action' : '操作'}
            value={action}
            onChange={handleActionChange}
            options={[
              { value: 'copy', label: lang === 'en' ? 'Copy' : '複製' },
              { value: 'move', label: lang === 'en' ? 'Move' : '移動' }
            ]}
          />
          <Tooltip text={TOOLTIPS.action[lang]} />
        </div>
        <div className={styles.row}>
          <Select
            label={lang === 'en' ? 'Image Type' : '圖片類型'}
            value={imageType}
            onChange={setImageType}
            options={[
              { value: 'both', label: lang === 'en' ? 'Both' : '全部' },
              { value: 'bmp', label: 'BMP' },
              { value: 'jpeg', label: 'JPEG' }
            ]}
          />
          <Tooltip text={TOOLTIPS.imageType[lang]} />
        </div>

        <div className={styles.row}>
          <div className={styles.orgContainer} ref={orgRef}>
            <span className={styles.orgLabel}>{lang === 'en' ? 'Organize' : '整理方式'}</span>
            <button
              className={styles.orgTrigger}
              onClick={handleOrgToggle}
            >
              {selectedOrgLabel}
              <span className={styles.orgArrow}>▾</span>
            </button>
            {orgOpen && (
              <div className={`${styles.orgDropdown} ${orgDirection === 'down' ? styles.orgDropdownDown : ''}`}>
                {ORGANIZE_OPTIONS.map((opt) => (
                  <div
                    key={opt.value}
                    className={`${styles.orgOption} ${organize === opt.value ? styles.orgOptionActive : ''}`}
                    onClick={() => {
                      setOrganize(opt.value)
                      setOrgOpen(false)
                    }}
                  >
                    <span className={styles.orgOptionLabel}>{opt.label[lang]}</span>
                    <span className={styles.orgOptionDesc}>{opt.desc[lang]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.row}>
          <Select
            label={lang === 'en' ? 'Duplicates' : '重複'}
            value={duplicates}
            onChange={setDuplicates}
            options={[
              { value: 'skip', label: lang === 'en' ? 'Skip' : '略過' },
              { value: 'overwrite', label: lang === 'en' ? 'Overwrite' : '覆蓋' }
            ]}
          />
          <Tooltip text={TOOLTIPS.duplicates[lang]} />
        </div>
        <div className={styles.row}>
          <Select
            label={lang === 'en' ? 'Scan Index' : '掃描序號'}
            value={scanIndex}
            onChange={setScanIndex}
            options={[
              { value: 'all', label: lang === 'en' ? 'All' : '全部' },
              { value: 'first_only', label: lang === 'en' ? 'First scan only' : '僅首次掃描' }
            ]}
          />
          <Tooltip text={TOOLTIPS.scanIndex[lang]} />
        </div>
      </div>

      <div className={styles.toggleRow}>
        <div className={styles.row}>
          <Toggle label={lang === 'en' ? 'MR PASS' : 'MR 通過'} checked={mrPass} onChange={setMrPass} />
          <Tooltip text={TOOLTIPS.mrPass[lang]} />
        </div>
        <div className={styles.row}>
          <Toggle label={lang === 'en' ? 'MR FAIL' : 'MR 失敗'} checked={mrFail} onChange={setMrFail} />
          <Tooltip text={TOOLTIPS.mrFail[lang]} />
        </div>
        <div className={styles.row}>
          <Toggle
            label={lang === 'en' ? 'AI Images Only' : '僅AI圖片'}
            checked={aiImages}
            onChange={setAiImages}
          />
          <Tooltip text={TOOLTIPS.aiImages[lang]} />
        </div>
      </div>

      <div className={styles.destRow}>
        <span className={styles.label}>{lang === 'en' ? 'Destination' : '目標位置'}</span>
        <div className={styles.destInput}>
          <input
            type="text"
            className={styles.input}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={lang === 'en' ? 'Select export destination...' : '選擇匯出目標位置...'}
          />
          <button className={styles.browseBtn} onClick={handleBrowseDest}>
            {lang === 'en' ? 'Browse' : '瀏覽'}
          </button>
        </div>
      </div>

      {showMoveWarning && createPortal(
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <span className={styles.modalIcon}>⚠️</span>
            <h3 className={styles.modalTitle}>
              {lang === 'en' ? 'WARNING' : '警告'}
            </h3>
            <p className={styles.modalText}>
              {lang === 'en'
                ? 'This will MOVE data off the NAS. Source files will be permanently deleted after transfer. Use at your own risk!'
                : '此操作將從NAS移動資料。來源檔案將在傳輸後被永久刪除。風險自負！'}
            </p>
            <div className={styles.modalButtons}>
              <button
                className={styles.modalCancel}
                onClick={() => setShowMoveWarning(false)}
              >
                {lang === 'en' ? 'Cancel' : '取消'}
              </button>
              <button
                className={styles.modalConfirm}
                onClick={() => {
                  setAction('move')
                  setShowMoveWarning(false)
                }}
              >
                {lang === 'en' ? 'I Understand, Use Move' : '我了解風險，使用移動'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </GlassCard>
  )
}
