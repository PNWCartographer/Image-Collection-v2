import styles from './TitleBar.module.css'

interface TitleBarProps {
  theme: 'dark' | 'light'
  lang: 'en' | 'zh'
  onToggleTheme: () => void
}

export default function TitleBar({ theme, lang, onToggleTheme }: TitleBarProps): JSX.Element {
  return (
    <div className={styles.titlebar}>
      <div className={styles.left}>
        <span className={styles.title}>Image Collection v2</span>
      </div>
      <div className={styles.right}>
        <button className={styles.themeBtn} onClick={onToggleTheme} title={lang === 'en' ? 'Toggle theme' : '切换主题'}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button
          className={styles.controlBtn}
          onClick={() => window.electronAPI.windowMinimize()}
          title={lang === 'en' ? 'Minimize' : '最小化'}
        >
          ─
        </button>
        <button
          className={styles.controlBtn}
          onClick={() => window.electronAPI.windowMaximize()}
          title={lang === 'en' ? 'Maximize' : '最大化'}
        >
          □
        </button>
        <button
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          onClick={() => window.electronAPI.windowClose()}
          title={lang === 'en' ? 'Close' : '关闭'}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
