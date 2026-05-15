import { useState, useRef, useEffect } from 'react'
import GlassCard from '../layout/GlassCard'
import Select from '../common/Select'
import Toggle from '../common/Toggle'
import Tooltip from '../common/Tooltip'
import styles from './SettingsPanel.module.css'

const TOOLTIPS = {
  action:
    'Move transfers folders and removes them from the source. Copy duplicates folders, leaving the source unchanged.',
  imageType:
    'BMP: collect .bmp images only. JPEG: collect .jpg/.jpeg only. Both: collect all image types from matched folders.',
  duplicates:
    'Skip: if an IMEI folder already exists at the destination, leave it untouched. Overwrite: replace existing destination folders with the new source data.',
  scanIndex:
    'All: include every scan. First scan only: only _1 entries (first time scanned that day).',
  mrPass:
    'Collects Model Recognition PASS images — devices the AI correctly identified. Searches ModelRecogImages/{date}/{Brand-Model}/ folders for .png files matching audit list IMEIs. Disables standard image collection.',
  mrFail:
    'Collects Model Recognition FAIL images — devices the AI misidentified (wrong placement, wrong color, wrong model). Searches ModelRecogImages/{date}/Error-Error/ for .png files matching audit list IMEIs.',
  aiImages:
    'When enabled, collects only the FD/ subfolder contents (AI detection images) from matched IMEI folders. Standard scan images at the folder root are excluded. When disabled, standard export includes FD/ as part of the full IMEI folder.'
}

const ORGANIZE_OPTIONS = [
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
  },
  {
    value: 'by-scan-index',
    label: 'By Scan Index',
    desc: 'Separates first scans from later scans. Example: dest/scan_1/IMEI_index/, dest/scan_2/IMEI_index/'
  }
]

interface SettingsPanelProps {
  lang: 'en' | 'zh'
}

export default function SettingsPanel({ lang }: SettingsPanelProps): JSX.Element {
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
  const orgRef = useRef<HTMLDivElement>(null)

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

  const selectedOrgLabel = ORGANIZE_OPTIONS.find((o) => o.value === organize)?.label ?? 'Flat'

  return (
    <GlassCard title={lang === 'en' ? 'Settings' : '设置'} delay={0.1}>
      <div className={styles.grid}>
        <div className={styles.row}>
          <Select
            label={lang === 'en' ? 'Action' : '操作'}
            value={action}
            onChange={setAction}
            options={[
              { value: 'copy', label: lang === 'en' ? 'Copy' : '复制' },
              { value: 'move', label: lang === 'en' ? 'Move' : '移动' }
            ]}
          />
          <Tooltip text={TOOLTIPS.action} />
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
          <Tooltip text={TOOLTIPS.imageType} />
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
                {ORGANIZE_OPTIONS.map((opt) => (
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
          <Tooltip text={TOOLTIPS.duplicates} />
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
          <Tooltip text={TOOLTIPS.scanIndex} />
        </div>
      </div>

      <div className={styles.toggleRow}>
        <div className={styles.row}>
          <Toggle label="MR PASS" checked={mrPass} onChange={setMrPass} />
          <Tooltip text={TOOLTIPS.mrPass} />
        </div>
        <div className={styles.row}>
          <Toggle label="MR FAIL" checked={mrFail} onChange={setMrFail} />
          <Tooltip text={TOOLTIPS.mrFail} />
        </div>
        <div className={styles.row}>
          <Toggle
            label={lang === 'en' ? 'AI Images Only' : '仅AI图片'}
            checked={aiImages}
            onChange={setAiImages}
          />
          <Tooltip text={TOOLTIPS.aiImages} />
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
    </GlassCard>
  )
}
