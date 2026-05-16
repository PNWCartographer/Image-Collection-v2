import { createWriteStream, type WriteStream } from 'fs'
import { readdir, unlink, mkdir } from 'fs/promises'
import { join } from 'path'

export class ExportLogger {
  private stream: WriteStream | null
  private filePath: string

  constructor(stream: WriteStream | null, filePath: string) {
    this.stream = stream
    this.filePath = filePath
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
    if (!this.stream) return
    const ts = new Date().toISOString()
    this.stream.write(`[${ts}] [${level}] ${msg}\n`)
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

/**
 * Create a new export logger.
 * Rotates old logs — keeps the 3 most recent, deletes the rest.
 * Falls back to a no-op logger (null stream) if log creation fails.
 */
export async function createExportLogger(logsDir: string): Promise<ExportLogger> {
  try {
    await mkdir(logsDir, { recursive: true })

    // Find existing export logs, sorted oldest-first
    const allFiles = await readdir(logsDir)
    const logFiles = allFiles
      .filter((f) => f.startsWith('export-') && f.endsWith('.log'))
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
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const logFile = `export-${ts}.log`
    const logPath = join(logsDir, logFile)

    const stream = createWriteStream(logPath, { encoding: 'utf-8', flags: 'w' })

    return new ExportLogger(stream, logPath)
  } catch {
    // If we can't create the log, return a no-op logger (null stream) so export still works
    return new ExportLogger(null, '')
  }
}
