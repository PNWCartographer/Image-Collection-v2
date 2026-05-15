import styles from './StatusBar.module.css'

interface StatusBarProps {
  message: string
}

export default function StatusBar({ message }: StatusBarProps): JSX.Element {
  return (
    <div className={styles.statusbar}>
      <span className={styles.text}>{message}</span>
    </div>
  )
}
