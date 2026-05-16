/**
 * Shared utility functions used across main and renderer processes.
 */

/** IPC progress throttle — max one event per this many ms. */
export const PROGRESS_THROTTLE_MS = 120

/** Generate a short random ID suitable for local-only identifiers. */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** Format milliseconds into a human-readable elapsed time string. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

/** Format a byte count into a human-readable size string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
