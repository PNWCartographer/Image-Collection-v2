import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tooltip.module.css'

interface TooltipProps {
  text: string
}

export default function Tooltip({ text }: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, above: true })
  const iconRef = useRef<HTMLSpanElement>(null)

  const show = useCallback(() => {
    if (!iconRef.current) return
    const rect = iconRef.current.getBoundingClientRect()
    const above = rect.top > 150
    setPos({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.min(rect.left, window.innerWidth - 300),
      above
    })
    setVisible(true)
  }, [])

  return (
    <>
      <span
        ref={iconRef}
        className={styles.icon}
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
        onFocus={show}
        onBlur={() => setVisible(false)}
        tabIndex={0}
        role="note"
        aria-label="Info"
      >
        ⓘ
      </span>
      {visible &&
        createPortal(
          <div
            className={styles.bubble}
            style={{
              position: 'fixed',
              top: pos.above ? undefined : pos.top,
              bottom: pos.above ? window.innerHeight - pos.top : undefined,
              left: pos.left
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  )
}
