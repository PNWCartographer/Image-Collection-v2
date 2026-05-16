import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import GlassCard from '../layout/GlassCard'
import Select from '../common/Select'
import Toggle from '../common/Toggle'
import Tooltip from '../common/Tooltip'
import styles from './SettingsPanel.module.css'

const TOOLTIPS = {
  action: {
    en: 'Move transfers folders and removes them from the source. Copy duplicates folders, leaving the source unchanged.',
    zh: '移动：将文件夹转移并从源位置删除。复制：复制文件夹，源位置保持不变。'
  },
  imageType: {
    en: 'BMP: collect .bmp images only. JPEG: collect .jpg/.jpeg only. Both: collect all image types from matched folders.',
    zh: 'BMP：仅收集 .bmp 图片。JPEG：仅收集 .jpg/.jpeg 图片。全部：收集匹配文件夹中的所有图片类型。'
  },
  duplicates: {
    en: 'Skip: if an IMEI folder already exists at the destination, leave it untouched. Overwrite: replace existing destination folders with the new source data.',
    zh: '跳过：如果目标位置已存在该 IMEI 文件夹，则保持不变。覆盖：用新的源数据替换目标位置中已有的文件夹。'
  },
  scanIndex: {
    en: 'All: include every scan. First scan only: only _1 entries (first time scanned that day).',
    zh: '全部：包含所有扫描记录。仅首次扫描：仅 _1 条目（当天首次扫描）。'
  },
  mrPass: {
    en: 'Collects Model Recognition PASS images — devices the AI correctly identified. Searches ModelRecogImages/{date}/{Brand-Model}/ folders for .png files matching audit list IMEIs. Disables standard image collection.',
    zh: '收集模型识别通过（PASS）图片 — AI 正确识别的设备。在 ModelRecogImages/{日期}/{品牌-型号}/ 文件夹中搜索与审计列表 IMEI 匹配的 .png 文件。启用后将禁用标准图片收集。'
  },
  mrFail: {
    en: 'Collects Model Recognition FAIL images — devices the AI misidentified (wrong placement, wrong color, wrong model). Searches ModelRecogImages/{date}/Error-Error/ for .png files matching audit list IMEIs.',
    zh: '收集模型识别失败（FAIL）图片 — AI 错误识别的设备（放置错误、颜色错误、型号错误）。在 ModelRecogImages/{日期}/Error-Error/ 中搜索与审计列表 IMEI 匹配的 .png 文件。'
  },
  aiImages: {
    en: 'When enabled, collects only the FD/ subfolder contents (AI detection images) from matched IMEI folders. Standard scan images at the folder root are excluded. When disabled, standard export includes FD/ as part of the full IMEI folder.',
    zh: '启用时，仅从匹配的 IMEI 文件夹中收集 FD/ 子文件夹内容（AI 检测图片）。文件夹根目录的标准扫描图片将被排除。禁用时，标准导出会将 FD/ 作为完整 IMEI 文件夹的一部分包含在内。'
  }
}

const ORGANIZE_OPTIONS = {
  en: [
    {
      value: 'flat',
      label: 'Flat',
      desc: 'All IMEI folders in a single destination folder. Example: dest/IMEI_index/'
    },
    {
      value: 'by-machine',
      label: 'By Machine',
      desc: 'One level of grouping by source machine. Example: dest/M8/IMEI_index/'
    },
    {
      value: 'by-date',
      label: 'By Date',
      desc: 'One level of grouping by scan date. Example: dest/20260515/IMEI_index/'
    },
    {
      value: 'machine-date',
      label: 'Machine → Date',
      desc: 'Two-level nesting: machine folder then date. Example: dest/M8/20260515/IMEI_index/'
    },
    {
      value: 'date-machine',
      label: 'Date → Machine',
      desc: 'Two-level nesting: date folder then machine. Example: dest/20260515/M8/IMEI_index/'
    },
    {
      value: 'by-imei',
      label: 'By IMEI',
      desc: 'Groups all instances of the same device across machines/dates. Example: dest/350002267153742/M8_20260515_192/'
    }
  ],
  zh: [
    {
      value: 'flat',
      label: '平铺',
      desc: '所有 IMEI 文件夹放在同一个目标文件夹中。示例：dest/IMEI_index/'
    },
    {
      value: 'by-machine',
      label: '按机器',
      desc: '按来源机器分组（一级）。示例：dest/M8/IMEI_index/'
    },
    {
      value: 'by-date',
      label: '按日期',
      desc: '按扫描日期分组（一级）。示例：dest/20260515/IMEI_index/'
    },
    {
      value: 'machine-date',
      label: '机器 → 日期',
      desc: '两级嵌套：先按机器文件夹，再按日期。示例：dest/M8/20260515/IMEI_index/'
    },
    {
      value: 'date-machine',
      label: '日期 → 机器',
      desc: '两级嵌套：先按日期文件夹，再按机器。示例：dest/20260515/M8/IMEI_index/'
    },
    {
      value: 'by-imei',
      label: '按 IMEI',
      desc: '将同一设备在不同机器/日期的所有记录分组。示例：dest/350002267153742/M8_20260515_192/'
    }
  ]
}

export interface SettingsState {
  action: string
  imageType: string
  organize: string
  duplicates: string
  scanIndex: string
  mrPass: boolean
  mrFail: boolean
  aiImages: boolean
  destination: string
}

interface SettingsPanelProps {
  lang: 'en' | 'zh'
  onSettingsChange?: (settings: SettingsState) => void
}

export default function SettingsPanel({ lang, onSettingsChange }: SettingsPanelProps): JSX.Element {
  const [action, setAction] = useState('copy')
  const [imageType, setImageType] = useState('both')
  const [organize, setOrganize] = useState('flat')
  const [orgOpen, setOrgOpen] = useState(false)
  const [duplicates, setDuplicates] = useState('skip')
  const [scanIndex, setScanIndex] = useState('all')
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
        const s = saved as Partial<SettingsState>
        if (s.action && s.action !== 'move') setAction(s.action)
        if (s.imageType) setImageType(s.imageType)
        if (s.organize) setOrganize(s.organize)
        if (s.duplicates) setDuplicates(s.duplicates)
        if (s.scanIndex) setScanIndex(s.scanIndex)
        if (typeof s.mrPass === 'boolean') setMrPass(s.mrPass)
        if (typeof s.mrFail === 'boolean') setMrFail(s.mrFail)
        if (typeof s.aiImages === 'boolean') setAiImages(s.aiImages)
        if (s.destination) setDestination(s.destination)
      }
      setLoaded(true)
    })
  }, [])

  const handleActionChange = (value: string): void => {
    if (value === 'move') {
      setShowMoveWarning(true)
    } else {
      setAction(value)
    }
  }

  // Notify parent and persist on every change (skip until initial load completes)
  useEffect(() => {
    const settings = { action, imageType, organize, duplicates, scanIndex, mrPass, mrFail, aiImages, destination }
    onSettingsChange?.(settings)
    if (loaded) {
      window.electronAPI.settingsSet('settingsPanel', settings)
    }
  }, [action, imageType, organize, duplicates, scanIndex, mrPass, mrFail, aiImages, destination, loaded])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (orgRef.current && !orgRef.current.contains(e.target as Node)) {
        setOrgOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleBrowseDest = async (): Promise<void> => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) setDestination(path)
  }

  const orgOptions = ORGANIZE_OPTIONS[lang]
  const selectedOrgLabel = orgOptions.find((o) => o.value === organize)?.label ?? (lang === 'en' ? 'Flat' : '平铺')

  return (
    <GlassCard title={lang === 'en' ? 'Settings' : '设置'} delay={0.1} elevated={orgOpen}>
      <div className={styles.grid}>
        <div className={styles.row}>
          <Select
            label={lang === 'en' ? 'Action' : '操作'}
            value={action}
            onChange={handleActionChange}
            options={[
              { value: 'copy', label: lang === 'en' ? 'Copy' : '复制' },
              { value: 'move', label: lang === 'en' ? 'Move' : '移动' }
            ]}
          />
          <Tooltip text={TOOLTIPS.action[lang]} />
        </div>
        <div className={styles.row}>
          <Select
            label={lang === 'en' ? 'Image Type' : '图片类型'}
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
            <span className={styles.orgLabel}>{lang === 'en' ? 'Organize' : '整理'}</span>
            <button
              className={styles.orgTrigger}
              onClick={() => setOrgOpen(!orgOpen)}
            >
              {selectedOrgLabel}
              <span className={styles.orgArrow}>▾</span>
            </button>
            {orgOpen && (
              <div className={styles.orgDropdown}>
                {orgOptions.map((opt) => (
                  <div
                    key={opt.value}
                    className={`${styles.orgOption} ${organize === opt.value ? styles.orgOptionActive : ''}`}
                    onClick={() => {
                      setOrganize(opt.value)
                      setOrgOpen(false)
                    }}
                  >
                    <span className={styles.orgOptionLabel}>{opt.label}</span>
                    <span className={styles.orgOptionDesc}>{opt.desc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.row}>
          <Select
            label={lang === 'en' ? 'Duplicates' : '重复'}
            value={duplicates}
            onChange={setDuplicates}
            options={[
              { value: 'skip', label: lang === 'en' ? 'Skip' : '跳过' },
              { value: 'overwrite', label: lang === 'en' ? 'Overwrite' : '覆盖' }
            ]}
          />
          <Tooltip text={TOOLTIPS.duplicates[lang]} />
        </div>
        <div className={styles.row}>
          <Select
            label={lang === 'en' ? 'Scan Index' : '扫描序号'}
            value={scanIndex}
            onChange={setScanIndex}
            options={[
              { value: 'all', label: lang === 'en' ? 'All' : '全部' },
              { value: 'first_only', label: lang === 'en' ? 'First scan only' : '仅首次扫描' }
            ]}
          />
          <Tooltip text={TOOLTIPS.scanIndex[lang]} />
        </div>
      </div>

      <div className={styles.toggleRow}>
        <div className={styles.row}>
          <Toggle label={lang === 'en' ? 'MR PASS' : 'MR 通过'} checked={mrPass} onChange={setMrPass} />
          <Tooltip text={TOOLTIPS.mrPass[lang]} />
        </div>
        <div className={styles.row}>
          <Toggle label={lang === 'en' ? 'MR FAIL' : 'MR 失败'} checked={mrFail} onChange={setMrFail} />
          <Tooltip text={TOOLTIPS.mrFail[lang]} />
        </div>
        <div className={styles.row}>
          <Toggle
            label={lang === 'en' ? 'AI Images Only' : '仅AI图片'}
            checked={aiImages}
            onChange={setAiImages}
          />
          <Tooltip text={TOOLTIPS.aiImages[lang]} />
        </div>
      </div>

      <div className={styles.destRow}>
        <span className={styles.label}>{lang === 'en' ? 'Destination' : '目标位置'}</span>
        <div className={styles.destInput}>
          <input
            type="text"
            className={styles.input}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={lang === 'en' ? 'Select export destination...' : '选择导出目标位置...'}
          />
          <button className={styles.browseBtn} onClick={handleBrowseDest}>
            {lang === 'en' ? 'Browse' : '浏览'}
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
                : '此操作将从NAS移动数据。源文件将在传输后被永久删除。风险自负！'}
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
                {lang === 'en' ? 'I Understand, Use Move' : '我了解风险，使用移动'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </GlassCard>
  )
}
