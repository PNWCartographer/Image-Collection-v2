import { ReactNode } from 'react'
import { motion } from 'framer-motion'
import styles from './GlassCard.module.css'

interface GlassCardProps {
  title: string
  children: ReactNode
  delay?: number
}

export default function GlassCard({ title, children, delay = 0 }: GlassCardProps): JSX.Element {
  return (
    <motion.div
      className={styles.card}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: 'easeOut' }}
    >
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.body}>{children}</div>
    </motion.div>
  )
}
