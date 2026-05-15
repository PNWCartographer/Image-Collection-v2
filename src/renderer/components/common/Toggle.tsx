import styles from './Toggle.module.css'

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export default function Toggle({ label, checked, onChange }: ToggleProps): JSX.Element {
  return (
    <label className={styles.container}>
      <span className={styles.label}>{label}</span>
      <div
        className={styles.track}
        data-active={checked}
        onClick={() => onChange(!checked)}
      >
        <div className={styles.thumb} />
      </div>
    </label>
  )
}
