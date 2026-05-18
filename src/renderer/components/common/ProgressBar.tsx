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
    <div
      className={styles.container}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={styles.track}>
        {indeterminate
          ? <div className={styles.fillIndeterminate} />
          : <div className={styles.fill} style={{ transform: `scaleX(${percent / 100})` }} />
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
