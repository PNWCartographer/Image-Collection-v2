import { createWriteStream, appendFileSync, writeFileSync, type WriteStream } from 'fs'
import { readdir, unlink, mkdir } from 'fs/promises'
import { join } from 'path'

export class RotatingLogger {
  private stream: WriteStream | null
  private filePath: string
  /** When true, write each line synchronously (appendFileSync) so logs survive a hang. */
  private sync: boolean

  constructor(stream: WriteStream | null, filePath: string, sync = false) {
    this.stream = stream
    this.filePath = filePath
    this.sync = sync
  }

  info(msg: string): void {
    this.write('INFO', msg)
  }

  warn(msg: string): void {
    this.write('WARN', msg)
  }

  error(msg: string): void {
    this.write('ERROR', msg)
  }

  private write(level: string, msg: string): void {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`
    if (this.sync) {
      // Synchronous append — guarantees the line is on disk immediately, so a
      // search that hangs (or is cancelled) still leaves a readable log.
      if (!this.filePath) return
      try {
        appendFileSync(this.filePath, line)
      } catch {
        // Disable on failure (disk full, permission) rather than throwing
        this.filePath = ''
      }
      return
    }
    if (!this.stream || this.stream.destroyed) return
    this.stream.write(line)
  }

  getLogPath(): string {
    return this.filePath
  }

  async close(): Promise<void> {
    if (!this.stream) return
    return new Promise((resolve) => {
      this.stream!.end(() => resolve())
    })
  }
}

/** Back-compat alias — export logging used this name. */
export const ExportLogger = RotatingLogger
export type ExportLogger = RotatingLogger

/**
 * Create a new rotating logger for the given prefix (e.g. 'export', 'search').
 * Keeps the 3 most recent logs of that prefix, deletes the rest.
 * Falls back to a no-op logger (null stream) if log creation fails.
 * Each prefix rotates independently so search logs never evict export logs.
 *
 * When `sync` is true the logger writes each line synchronously — slower, but
 * the log is always readable on disk even if the operation hangs or is killed.
 */
export async function createRotatingLogger(logsDir: string, prefix: string, sync = false): Promise<RotatingLogger> {
  try {
    await mkdir(logsDir, { recursive: true })

    // Find existing logs for this prefix, sorted oldest-first
    const allFiles = await readdir(logsDir)
    const logFiles = allFiles
      .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.log'))
      .sort()

    // Keep only 2 most recent (so adding the new one makes 3 total)
    while (logFiles.length >= 3) {
      const oldest = logFiles.shift()!
      try {
        await unlink(join(logsDir, oldest))
      } catch {
        // Best-effort cleanup
      }
    }

    // Create new log file with timestamp
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}`
    const logFile = `${prefix}-${ts}.log`
    const logPath = join(logsDir, logFile)

    if (sync) {
      // Create the file up front so appendFileSync has a target.
      writeFileSync(logPath, '')
      return new RotatingLogger(null, logPath, true)
    }

    const stream = createWriteStream(logPath, { encoding: 'utf-8', flags: 'w' })
    stream.on('error', () => {
      // Disable logging on stream error (disk full, permission change)
      // Operation continues without logging rather than crashing
      stream.destroy()
    })

    return new RotatingLogger(stream, logPath)
  } catch {
    // If we can't create the log, return a no-op logger (null stream) so the operation still works
    return new RotatingLogger(null, '')
  }
}

/** Create a new export logger (keeps 3 most recent export logs). */
export async function createExportLogger(logsDir: string): Promise<RotatingLogger> {
  return createRotatingLogger(logsDir, 'export')
}

/** Create a new search logger (keeps 3 most recent search logs). Writes synchronously. */
export async function createSearchLogger(logsDir: string): Promise<RotatingLogger> {
  return createRotatingLogger(logsDir, 'search', true)
}
