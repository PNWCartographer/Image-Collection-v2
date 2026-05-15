import styles from './TitleBar.module.css'

interface TitleBarProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export default function TitleBar({ theme, onToggleTheme }: TitleBarProps): JSX.Element {
  return (
    <div className={styles.titlebar}>
      <div className={styles.left}>
        <span className={styles.title}>Image Collection v2</span>
      </div>
      <div className={styles.right}>
        <button className={styles.themeBtn} onClick={onToggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button
          className={styles.controlBtn}
          onClick={() => window.electronAPI.windowMinimize()}
          title="Minimize"
        >
          ─
        </button>
        <button
          className={styles.controlBtn}
          onClick={() => window.electronAPI.windowMaximize()}
          title="Maximize"
        >
          □
        </button>
        <button
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          onClick={() => window.electronAPI.windowClose()}
          title="Close"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
