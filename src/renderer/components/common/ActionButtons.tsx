import styles from './ActionButtons.module.css'

interface ActionButtonsProps {
  onSearch: () => void
  onExport: () => void
  onClear: () => void
  onCancel?: () => void
  canSearch: boolean
  canExport: boolean
  searching: boolean
  lang: 'en' | 'zh'
}

export default function ActionButtons({
  onSearch,
  onExport,
  onClear,
  onCancel,
  canSearch,
  canExport,
  searching,
  lang
}: ActionButtonsProps): JSX.Element {
  return (
    <div className={styles.container}>
      {searching ? (
        <button
          className={styles.cancel}
          onClick={onCancel}
        >
          {lang === 'en' ? 'Cancel Search' : '取消搜索'}
        </button>
      ) : (
        <button
          className={styles.primary}
          onClick={onSearch}
          disabled={!canSearch}
        >
          {lang === 'en' ? 'Start Search' : '开始搜索'}
        </button>
      )}
      <button
        className={styles.primary}
        onClick={onExport}
        disabled={!canExport}
      >
        {lang === 'en' ? 'Export Results' : '导出结果'}
      </button>
      <button className={styles.secondary} onClick={onClear}>
        {lang === 'en' ? 'Clear' : '清除'}
      </button>
    </div>
  )
}
