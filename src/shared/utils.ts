/**
 * Shared utility functions and constants used across main and renderer processes.
 */

/** 15-digit IMEI pattern. */
export const IMEI_REGEX = /^\d{15}$/

/** 8-digit YYYYMMDD date folder pattern. */
export const DATE_FOLDER_REGEX = /^\d{8}$/

/** IPC progress throttle — max one event per this many ms. */
export const PROGRESS_THROTTLE_MS = 120

/** Generate a short random ID suitable for local-only identifiers. */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * Add `delta` days to a YYYYMMDD string, returning a YYYYMMDD string.
 * Uses UTC math so it never drifts across month/year boundaries or DST.
 * Returns the input unchanged if it isn't a parseable date.
 */
export function addDaysToYMD(yyyymmdd: string, delta: number): string {
  const y = parseInt(yyyymmdd.substring(0, 4), 10)
  const m = parseInt(yyyymmdd.substring(4, 6), 10)
  const d = parseInt(yyyymmdd.substring(6, 8), 10)
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return yyyymmdd
  const ms = Date.UTC(y, m - 1, d) + delta * 86_400_000
  const dt = new Date(ms)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

/** Expand a YYYYMMDD date into [previousDay, day, nextDay] — catches midnight folder rollovers. */
export function expandDateRange(yyyymmdd: string): string[] {
  return [addDaysToYMD(yyyymmdd, -1), yyyymmdd, addDaysToYMD(yyyymmdd, 1)]
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
