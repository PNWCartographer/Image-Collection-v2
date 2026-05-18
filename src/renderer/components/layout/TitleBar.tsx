import { t, type Lang } from '../../../shared/i18n'
import styles from './TitleBar.module.css'

interface TitleBarProps {
  theme: 'dark' | 'light'
  lang: Lang
  onToggleTheme: () => void
}

export default function TitleBar({ theme, lang, onToggleTheme }: TitleBarProps): JSX.Element {
  return (
    <div className={styles.titlebar}>
      <div className={styles.left}>
        <span className={styles.title}>Image Collection v2</span>
      </div>
      <div className={styles.right}>
        <button className={styles.themeBtn} onClick={onToggleTheme} title={t(lang, 'Toggle theme', '切換主題', '切换主题')}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button
          className={styles.controlBtn}
          onClick={() => window.electronAPI.windowMinimize()}
          title={t(lang, 'Minimize', '最小化', '最小化')}
        >
          ─
        </button>
        <button
          className={styles.controlBtn}
          onClick={() => window.electronAPI.windowMaximize()}
          title={t(lang, 'Maximize', '最大化', '最大化')}
        >
          □
        </button>
        <button
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          onClick={() => window.electronAPI.windowClose()}
          title={t(lang, 'Close', '關閉', '关闭')}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
