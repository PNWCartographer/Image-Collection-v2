import styles from './StatusBar.module.css'

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
      {showLogLink && onOpenLogs && (
        <button className={styles.logLink} onClick={onOpenLogs}>
          {lang === 'en' ? 'View Log' : '查看日志'}
        </button>
      )}
    </div>
  )
}
