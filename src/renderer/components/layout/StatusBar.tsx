import styles from './StatusBar.module.css'

declare const __APP_VERSION__: string
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

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
            {lang === 'en' ? 'View Log' : '檢視日誌'}
          </button>
        )}
        <span className={styles.version}>v{APP_VERSION}</span>
      </div>
    </div>
  )
}
