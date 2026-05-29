import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import GlassCard from '../layout/GlassCard'
import Select from '../common/Select'
import Toggle from '../common/Toggle'
import Tooltip from '../common/Tooltip'
import { useClickOutside } from '../../hooks/useClickOutside'
import { t, type Lang } from '../../../shared/i18n'
import styles from './SettingsPanel.module.css'

const TOOLTIPS: Record<string, Record<Lang, string>> = {
  action: {
    en: 'Move transfers folders and removes them from the source. Copy duplicates folders, leaving the source unchanged.',
    'zh-TW': '移動：將資料夾轉移並從來源位置刪除。複製：複製資料夾，來源位置保持不變。',
    'zh-CN': '移动：将文件夹转移并从源位置删除。复制：复制文件夹，源位置保持不变。'
  },
  imageType: {
    en: 'BMP: collect .bmp images only. JPEG: collect .jpg/.jpeg only. Both: collect all image types from matched folders.',
    'zh-TW': 'BMP：僅收集 .bmp 圖片。JPEG：僅收集 .jpg/.jpeg 圖片。全部：收集匹配資料夾中的所有圖片類型。',
    'zh-CN': 'BMP：仅收集 .bmp 图片。JPEG：仅收集 .jpg/.jpeg 图片。全部：收集匹配文件夹中的所有图片类型。'
  },
  duplicates: {
    en: 'Skip: if an IMEI folder already exists at the destination, leave it untouched. Overwrite: replace existing destination folders with the new source data.',
    'zh-TW': '略過：如果目標位置已存在該 IMEI 資料夾，則保持不變。覆蓋：用新的來源資料取代目標位置中已有的資料夾。',
    'zh-CN': '跳过：如果目标位置已存在该 IMEI 文件夹，则保持不变。覆盖：用新的源数据替换目标位置中已有的文件夹。'
  },
  scanIndex: {
    en: 'Devices may be scanned more than once. "All" includes every scan attempt. "First only" includes only the first scan of each device.',
    'zh-TW': '裝置可能被掃描多次。「全部」包含所有掃描紀錄。「僅第一個」僅包含每個裝置的首次掃描。',
    'zh-CN': '设备可能被扫描多次。"全部"包含所有扫描记录。"仅第一个"仅包含每个设备的首次扫描。'
  },
  mrPass: {
    en: 'Collect images of devices the system correctly identified by model. Searches ModelRecogImages folders. When enabled, standard image collection is disabled.',
    'zh-TW': '收集模型辨識通過（PASS）圖片 — AI 正確辨識的裝置。在 ModelRecogImages/{日期}/{品牌-型號}/ 資料夾中搜尋與稽核清單 IMEI 匹配的 .png 檔案。啟用後將停用標準圖片收集。',
    'zh-CN': '收集模型识别通过（PASS）图片 — AI 正确识别的设备。在 ModelRecogImages/{日期}/{品牌-型号}/ 文件夹中搜索与审计列表 IMEI 匹配的 .png 文件。启用后将禁用标准图片收集。'
  },
  mrFail: {
    en: 'Collect images of devices the system misidentified (wrong model, wrong placement). Searches Error-Error folders in ModelRecogImages.',
    'zh-TW': '收集模型辨識失敗（FAIL）圖片 — AI 錯誤辨識的裝置（放置錯誤、顏色錯誤、型號錯誤）。在 ModelRecogImages/{日期}/Error-Error/ 中搜尋與稽核清單 IMEI 匹配的 .png 檔案。',
    'zh-CN': '收集模型识别失败（FAIL）图片 — AI 错误识别的设备（放置错误、颜色错误、型号错误）。在 ModelRecogImages/{日期}/Error-Error/ 中搜索与审计列表 IMEI 匹配的 .png 文件。'
  },
  aiImages: {
    en: 'When enabled, exports only the automated inspection photos (FD/ subfolder) instead of all images. When disabled, all images in the folder are exported including inspection photos.',
    'zh-TW': '啟用時，僅從匹配的 IMEI 資料夾中收集 FD/ 子資料夾內容（AI 偵測圖片）。資料夾根目錄的標準掃描圖片將被排除。停用時，標準匯出會將 FD/ 作為完整 IMEI 資料夾的一部分包含在內。',
    'zh-CN': '启用时，仅从匹配的 IMEI 文件夹中收集 FD/ 子文件夹内容（AI 检测图片）。文件夹根目录的标准扫描图片将被排除。禁用时，标准导出会将 FD/ 作为完整 IMEI 文件夹的一部分包含在内。'
  }
}

interface OrganizeOption {
  value: SettingsState['organize']
  label: Record<Lang, string>
  desc: Record<Lang, string>
}

const ORGANIZE_OPTIONS: OrganizeOption[] = [
  {
    value: 'flat',
    label: { en: 'Flat', 'zh-TW': '平鋪', 'zh-CN': '平铺' },
    desc: { en: 'All IMEI folders in a single destination folder. Example: dest/IMEI_index/', 'zh-TW': '所有 IMEI 資料夾放在同一個目標資料夾中。範例：dest/IMEI_index/', 'zh-CN': '所有 IMEI 文件夹放在同一个目标文件夹中。示例：dest/IMEI_index/' }
  },
  {
    value: 'by-machine',
    label: { en: 'By Machine', 'zh-TW': '按機器', 'zh-CN': '按机器' },
    desc: { en: 'One level of grouping by source machine. Example: dest/M8/IMEI_index/', 'zh-TW': '按來源機器分組（一級）。範例：dest/M8/IMEI_index/', 'zh-CN': '按来源机器分组（一级）。示例：dest/M8/IMEI_index/' }
  },
  {
    value: 'by-date',
    label: { en: 'By Date', 'zh-TW': '按日期', 'zh-CN': '按日期' },
    desc: { en: 'One level of grouping by scan date. Example: dest/20260515/IMEI_index/', 'zh-TW': '按掃描日期分組（一級）。範例：dest/20260515/IMEI_index/', 'zh-CN': '按扫描日期分组（一级）。示例：dest/20260515/IMEI_index/' }
  },
  {
    value: 'machine-date',
    label: { en: 'Machine → Date', 'zh-TW': '機器 → 日期', 'zh-CN': '机器 → 日期' },
    desc: { en: 'Two-level nesting: machine folder then date. Example: dest/M8/20260515/IMEI_index/', 'zh-TW': '兩級巢狀：先按機器資料夾，再按日期。範例：dest/M8/20260515/IMEI_index/', 'zh-CN': '两级嵌套：先按机器文件夹，再按日期。示例：dest/M8/20260515/IMEI_index/' }
  },
  {
    value: 'date-machine',
    label: { en: 'Date → Machine', 'zh-TW': '日期 → 機器', 'zh-CN': '日期 → 机器' },
    desc: { en: 'Two-level nesting: date folder then machine. Example: dest/20260515/M8/IMEI_index/', 'zh-TW': '兩級巢狀：先按日期資料夾，再按機器。範例：dest/20260515/M8/IMEI_index/', 'zh-CN': '两级嵌套：先按日期文件夹，再按机器。示例：dest/20260515/M8/IMEI_index/' }
  },
  {
    value: 'by-imei',
    label: { en: 'By IMEI', 'zh-TW': '按 IMEI', 'zh-CN': '按 IMEI' },
    desc: { en: 'Groups all instances of the same device across machines/dates. Example: dest/350002267153742/M8_20260515_192/', 'zh-TW': '將同一裝置在不同機器/日期的所有記錄分組。範例：dest/350002267153742/M8_20260515_192/', 'zh-CN': '将同一设备在不同机器/日期的所有记录分组。示例：dest/350002267153742/M8_20260515_192/' }
  },
  {
    value: 'by-model',
    label: { en: 'By Model', 'zh-TW': '按型號', 'zh-CN': '按型号' },
    desc: { en: 'Groups IMEI folders by device model (parsed from MR image filename). Example: dest/Apple-iPhone13Pro/IMEI_index/', 'zh-TW': '依裝置型號分組（從 MR 影像檔名解析）。範例：dest/Apple-iPhone13Pro/IMEI_index/', 'zh-CN': '按设备型号分组（从 MR 图像文件名解析）。示例：dest/Apple-iPhone13Pro/IMEI_index/' }
  }
]

export interface SettingsState {
  action: 'copy' | 'move'
  imageType: 'both' | 'bmp' | 'jpeg'
  organize: 'flat' | 'by-machine' | 'by-date' | 'machine-date' | 'date-machine' | 'by-imei' | 'by-model'
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
  lang: Lang
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

  const selectedOrgLabel = ORGANIZE_OPTIONS.find((o) => o.value === organize)?.label[lang] ?? t(lang, 'Flat', '平鋪', '平铺')

  return (
    <GlassCard title={t(lang, 'Settings', '設定', '设置')} delay={0.1} elevated={orgOpen}>
      <div className={styles.grid}>
        <div className={styles.row}>
          <Select
            label={t(lang, 'Action', '操作', '操作')}
            value={action}
            onChange={handleActionChange}
            options={[
              { value: 'copy', label: t(lang, 'Copy', '複製', '复制') },
              { value: 'move', label: t(lang, 'Move', '移動', '移动') }
            ]}
          />
          <Tooltip text={TOOLTIPS.action[lang]} />
        </div>
        <div className={styles.row}>
          <Select
            label={t(lang, 'Image Type', '圖片類型', '图片类型')}
            value={imageType}
            onChange={setImageType}
            options={[
              { value: 'both', label: t(lang, 'Both', '全部', '全部') },
              { value: 'bmp', label: 'BMP' },
              { value: 'jpeg', label: 'JPEG' }
            ]}
          />
          <Tooltip text={TOOLTIPS.imageType[lang]} />
        </div>

        <div className={styles.row}>
          <div className={styles.orgContainer} ref={orgRef}>
            <span className={styles.orgLabel}>{t(lang, 'Organize', '整理方式', '整理')}</span>
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
            label={t(lang, 'Duplicates', '重複', '重复')}
            value={duplicates}
            onChange={setDuplicates}
            options={[
              { value: 'skip', label: t(lang, 'Skip', '略過', '跳过') },
              { value: 'overwrite', label: t(lang, 'Overwrite', '覆蓋', '覆盖') }
            ]}
          />
          <Tooltip text={TOOLTIPS.duplicates[lang]} />
        </div>
        <div className={styles.row}>
          <Select
            label={t(lang, 'Scan Index', '掃描序號', '扫描序号')}
            value={scanIndex}
            onChange={setScanIndex}
            options={[
              { value: 'all', label: t(lang, 'All', '全部', '全部') },
              { value: 'first_only', label: t(lang, 'First only', '僅第一個', '仅第一个') }
            ]}
          />
          <Tooltip text={TOOLTIPS.scanIndex[lang]} />
        </div>
      </div>

      <div className={styles.toggleRow}>
        <div className={styles.row}>
          <Toggle label={t(lang, 'MR PASS', 'MR 通過', 'MR 通过')} checked={mrPass} onChange={setMrPass} />
          <Tooltip text={TOOLTIPS.mrPass[lang]} />
        </div>
        <div className={styles.row}>
          <Toggle label={t(lang, 'MR FAIL', 'MR 失敗', 'MR 失败')} checked={mrFail} onChange={setMrFail} />
          <Tooltip text={TOOLTIPS.mrFail[lang]} />
        </div>
        <div className={styles.row}>
          <Toggle
            label={t(lang, 'AI Images Only', '僅AI圖片', '仅AI图片')}
            checked={aiImages}
            onChange={setAiImages}
          />
          <Tooltip text={TOOLTIPS.aiImages[lang]} />
        </div>
      </div>

      <div className={styles.destRow}>
        <span className={styles.label}>{t(lang, 'Destination', '目標位置', '目标位置')}</span>
        <div className={styles.destInput}>
          <input
            type="text"
            className={styles.input}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={t(lang, 'Select export destination...', '選擇匯出目標位置...', '选择导出目标位置...')}
          />
          <button className={styles.browseBtn} onClick={handleBrowseDest}>
            {t(lang, 'Browse', '瀏覽', '浏览')}
          </button>
        </div>
      </div>

      {showMoveWarning && createPortal(
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <span className={styles.modalIcon}>⚠️</span>
            <h3 className={styles.modalTitle}>
              {t(lang, 'WARNING', '警告', '警告')}
            </h3>
            <p className={styles.modalText}>
              {t(lang,
                'This will MOVE data off the source folder. Source files will be permanently deleted after transfer. Use at your own risk!',
                '此操作將從NAS移動資料。來源檔案將在傳輸後被永久刪除。風險自負！',
                '此操作将从NAS移动数据。源文件将在传输后被永久删除。风险自负！')}
            </p>
            <div className={styles.modalButtons}>
              <button
                className={styles.modalCancel}
                onClick={() => setShowMoveWarning(false)}
              >
                {t(lang, 'Cancel', '取消', '取消')}
              </button>
              <button
                className={styles.modalConfirm}
                onClick={() => {
                  setAction('move')
                  setShowMoveWarning(false)
                }}
              >
                {t(lang, 'I Understand, Use Move', '我了解風險，使用移動', '我了解风险，使用移动')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </GlassCard>
  )
}
