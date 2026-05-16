import styles from './StatusBar.module.css'

const APP_VERSION = '1.1.0'

interface StatusBarProps {
  message: string
  showLogLink?: boolean
  onOpenLogs?: () => void
  lang?: 'en' | 'zh'
}

export default function StatusBar({ message, showLogLink, onOpenLogs, lang = 'en' }: StatusBarProps): JSX.Element {
  return (
    <div className={styles.statusbar}>
      <span className={styles.text}>{message}</span>
      <div className={styles.right}>
        {showLogLink && onOpenLogs && (
          <button className={styles.logLink} onClick={onOpenLogs}>
            {lang === 'en' ? 'View Log' : '查看日志'}
          </button>
        )}
        <span className={styles.version}>v{APP_VERSION}</span>
      </div>
    </div>
  )
}
