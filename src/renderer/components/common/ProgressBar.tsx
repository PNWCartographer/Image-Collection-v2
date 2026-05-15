import styles from './ProgressBar.module.css'

interface ProgressBarProps {
  percent: number
  label: string
  sublabel?: string
  visible: boolean
}

export default function ProgressBar({
  percent,
  label,
  sublabel,
  visible
}: ProgressBarProps): JSX.Element | null {
  if (!visible) return null

  const indeterminate = percent === 0

  return (
    <div className={styles.container}>
      <div className={styles.track}>
        {indeterminate
          ? <div className={styles.fillIndeterminate} />
          : <div className={styles.fill} style={{ width: `${percent}%` }} />
        }
      </div>
      <div className={styles.info}>
        <span className={styles.label}>
          {indeterminate ? label : `${Math.round(percent)}% · ${label}`}
        </span>
        {sublabel && <span className={styles.sublabel}>{sublabel}</span>}
      </div>
    </div>
  )
}
