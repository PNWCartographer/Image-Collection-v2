import { t, type Lang } from '../../../shared/i18n'
import styles from './StatusBar.module.css'

declare const __APP_VERSION__: string
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

interface StatusBarProps {
  message: string
  showLogLink?: boolean
  onOpenLogs?: () => void
  lang?: Lang
}

export default function StatusBar({ message, showLogLink, onOpenLogs, lang = 'en' }: StatusBarProps): JSX.Element {
  return (
    <div className={styles.statusbar}>
      <span className={styles.text}>{message}</span>
      <div className={styles.right}>
        {showLogLink && onOpenLogs && (
          <button className={styles.logLink} onClick={onOpenLogs}>
            {t(lang, 'View Log', '檢視日誌', '查看日志')}
          </button>
        )}
        <span className={styles.version}>v{APP_VERSION}</span>
      </div>
    </div>
  )
}
