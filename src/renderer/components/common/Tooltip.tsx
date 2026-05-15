import { useState, useRef, useEffect } from 'react'
import styles from './Tooltip.module.css'

interface TooltipProps {
  text: string
}

export default function Tooltip({ text }: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [above, setAbove] = useState(true)
  const iconRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (visible && iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect()
      setAbove(rect.top > 120)
    }
  }, [visible])

  return (
    <span className={styles.wrapper}>
      <span
        ref={iconRef}
        className={styles.icon}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
      >
        ⓘ
      </span>
      {visible && (
        <div className={`${styles.bubble} ${above ? styles.above : styles.below}`}>
          {text}
        </div>
      )}
    </span>
  )
}
