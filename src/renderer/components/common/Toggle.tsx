import styles from './Toggle.module.css'

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export default function Toggle({ label, checked, onChange }: ToggleProps): JSX.Element {
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onChange(!checked)
    }
  }

  return (
    <label className={styles.container}>
      <span className={styles.label}>{label}</span>
      <div
        className={styles.track}
        data-active={checked}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.thumb} />
      </div>
    </label>
  )
}
