import { readdir, copyFile, mkdir, rm, stat, access } from 'fs/promises'
import { join, extname, dirname } from 'path'
import { constants as fsConstants } from 'fs'
import type { ExportRequest, ExportProgress, ExportResult, SearchMatch } from '../../shared/types'
import { formatElapsed, formatBytes } from '../../shared/utils'
import { createExportLogger, type ExportLogger } from './Logger'

// ── Concurrency tuning ──────────────────────────────────────────────
// 8 IMEI folders processed simultaneously × 4 file copies each = 32
// concurrent NAS reads in-flight.  Saturates the 1 Gbps pipe without
// overwhelming SMB or the local disk.
const FOLDER_CONCURRENCY = 8
const FILE_CONCURRENCY = 4

/** Per-operation cancellation token — avoids race conditions between overlapping calls. */
let activeToken: { cancelled: boolean } = { cancelled: false }

export function cancelExport(): void {
  activeToken.cancelled = true
}

// ── Pooled async concurrency (same pattern as search engine) ────────
async function pooled<T>(
  items: T[],
  concurrency: number,
  token: { cancelled: boolean },
  fn: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length && !token.cancelled) {
      const idx = nextIndex++
      await fn(items[idx])
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  )
  await Promise.all(workers)
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Build the destination subfolder path based on organize mode.
 *
 * flat:          dest/IMEI_index/
 * by-machine:    dest/Machine/IMEI_index/
 * by-date:       dest/YYYYMMDD/IMEI_index/
 * machine-date:  dest/Machine/YYYYMMDD/IMEI_index/
 * date-machine:  dest/YYYYMMDD/Machine/IMEI_index/
 * by-imei:       dest/IMEI/Machine_YYYYMMDD_index/
 */
function buildDestPath(dest: string, match: SearchMatch, organize: ExportRequest['organize']): string {
  switch (organize) {
    case 'flat':
      return join(dest, match.folderName)
    case 'by-machine':
      return join(dest, match.machineName, match.folderName)
    case 'by-date':
      return join(dest, match.date, match.folderName)
    case 'machine-date':
      return join(dest, match.machineName, match.date, match.folderName)
    case 'date-machine':
      return join(dest, match.date, match.machineName, match.folderName)
    case 'by-imei':
      return join(dest, match.imei, `${match.machineName}_${match.date}_${match.scanIndex}`)
    default:
      return join(dest, match.folderName)
  }
}

/**
 * Build destination path for MR (Model Recognition) exports.
 * MR matches are single .png files, so the path includes the filename.
 */
function buildMRDestFilePath(dest: string, match: SearchMatch, organize: ExportRequest['organize']): string {
  const mrTag = match.mrFolder || (match.matchType === 'mr-pass' ? 'MR-Pass' : 'MR-Fail')
  const fileName = `${match.imei}_${mrTag}.png`

  switch (organize) {
    case 'flat':
      return join(dest, `${match.imei}_${match.machineName}_${match.date}_${mrTag}.png`)
    case 'by-machine':
      return join(dest, match.machineName, `${match.imei}_${match.date}_${mrTag}.png`)
    case 'by-date':
      return join(dest, match.date, `${match.imei}_${match.machineName}_${mrTag}.png`)
    case 'machine-date':
      return join(dest, match.machineName, match.date, fileName)
    case 'date-machine':
      return join(dest, match.date, match.machineName, fileName)
    case 'by-imei':
      return join(dest, match.imei, `${match.machineName}_${match.date}_${mrTag}.png`)
    default:
      return join(dest, `${match.imei}_${match.machineName}_${match.date}_${mrTag}.png`)
  }
}

function matchesImageType(fileName: string, imageType: ExportRequest['imageType']): boolean {
  if (imageType === 'both') return true
  const ext = extname(fileName).toLowerCase()
  if (imageType === 'bmp') return ext === '.bmp'
  if (imageType === 'jpeg') return ext === '.jpg' || ext === '.jpeg'
  return true
}

async function folderExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

// ── Parallel folder copy with file-level concurrency ────────────────

interface CopyStats {
  filesCopied: number
  bytesCopied: number
}

/**
 * Recursively copy a folder with parallel file copies and image type
 * filtering. When aiImages is true, only copies the FD/ subfolder.
 * Returns null if the effective source doesn't exist (FD/ missing).
 */
async function copyFolderParallel(
  srcDir: string,
  destDir: string,
  imageType: ExportRequest['imageType'],
  aiImages: boolean,
  token: { cancelled: boolean },
  logger: ExportLogger
): Promise<CopyStats | null> {
  let filesCopied = 0
  let bytesCopied = 0

  const effectiveSrc = aiImages ? join(srcDir, 'FD') : srcDir

  // Pre-check: if AI Images mode, verify FD/ exists before attempting copy
  if (aiImages) {
    try {
      await access(effectiveSrc, fsConstants.R_OK)
    } catch {
      logger.warn(`  FD/ subfolder not found in ${srcDir}`)
      return null
    }
  }

  try {
    await mkdir(destDir, { recursive: true })
    const entries = await readdir(effectiveSrc, { withFileTypes: true })

    // Split into files (parallel) and directories (recurse)
    const files = entries.filter((e) => e.isFile() && matchesImageType(e.name, imageType))
    const dirs = entries.filter((e) => e.isDirectory())

    // ── Parallel file copy ──
    await pooled(files, FILE_CONCURRENCY, token, async (file) => {
      if (token.cancelled) return
      const srcPath = join(effectiveSrc, file.name)
      const dstPath = join(destDir, file.name)

      try {
        const fileStat = await stat(srcPath)
        await copyFile(srcPath, dstPath)
        filesCopied++
        bytesCopied += fileStat.size
        logger.info(`    ${file.name}  (${formatBytes(fileStat.size)})`)
      } catch (err) {
        logger.error(`    COPY FAILED ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    })

    // ── Recurse into subdirectories ──
    for (const dir of dirs) {
      if (token.cancelled) break
      const sub = await copyFolderParallel(
        join(effectiveSrc, dir.name),
        join(destDir, dir.name),
        imageType,
        false, // already inside effective source
        token,
        logger
      )
      if (sub) {
        filesCopied += sub.filesCopied
        bytesCopied += sub.bytesCopied
      }
    }
  } catch (err) {
    logger.error(`  DIR READ FAILED ${effectiveSrc}: ${err instanceof Error ? err.message : String(err)}`)
  }

  return { filesCopied, bytesCopied }
}

async function removeSource(folderPath: string): Promise<void> {
  try {
    await rm(folderPath, { recursive: true, force: true })
  } catch {
    // Best-effort — don't fail the export if cleanup fails
  }
}

// ── Main export function ────────────────────────────────────────────

export async function exportResults(
  request: ExportRequest,
  logsDir: string,
  onProgress: (progress: ExportProgress) => void
): Promise<ExportResult> {
  const token = { cancelled: false }
  activeToken = token
  const startTime = Date.now()
  const logger = await createExportLogger(logsDir)

  const { matches, destination, action, imageType, organize, duplicates, aiImages } = request
  const totalItems = matches.length

  // ── Log header ──
  logger.info('═══════════════════════════════════════════════════════════')
  logger.info('  EXPORT STARTED')
  logger.info('═══════════════════════════════════════════════════════════')
  logger.info(`Timestamp   : ${new Date().toISOString()}`)
  logger.info(`Destination : ${destination}`)
  logger.info(`Action      : ${action}`)
  logger.info(`Image Type  : ${imageType}`)
  logger.info(`Organize    : ${organize}`)
  logger.info(`Duplicates  : ${duplicates}`)
  logger.info(`AI Images   : ${aiImages}`)
  logger.info(`Matches     : ${totalItems}`)
  logger.info(`Concurrency : ${FOLDER_CONCURRENCY} folders × ${FILE_CONCURRENCY} files`)
  logger.info('')

  let exported = 0
  let skipped = 0
  let failed = 0
  const failedItems: ExportResult['failedItems'] = []
  let totalBytesCopied = 0
  let totalFilesCopied = 0

  let lastProgressTime = 0
  const sendProgress = (currentMatch: SearchMatch): void => {
    const now = Date.now()
    if (now - lastProgressTime < 100) return
    lastProgressTime = now

    onProgress({
      phase: 'exporting',
      percent: totalItems > 0 ? ((exported + skipped + failed) / totalItems) * 100 : 0,
      currentIMEI: currentMatch.imei,
      currentFolder: currentMatch.folderName,
      exported,
      skipped,
      failed,
      totalItems
    })
  }

  let fdMissingCount = 0

  // Initial progress
  if (matches.length > 0) {
    onProgress({
      phase: 'exporting',
      percent: 0,
      currentIMEI: matches[0].imei,
      currentFolder: matches[0].folderName,
      exported: 0,
      skipped: 0,
      failed: 0,
      totalItems
    })
  }

  // ── Parallel folder export ──
  await pooled(matches, FOLDER_CONCURRENCY, token, async (match) => {
    if (token.cancelled) return

    sendProgress(match)

    const isMR = match.matchType === 'mr-pass' || match.matchType === 'mr-fail'
    const folderStart = Date.now()

    if (isMR) {
      // ── MR export: single .png file copy ──
      const destFilePath = buildMRDestFilePath(destination, match, organize)
      const destDir = dirname(destFilePath)

      logger.info(`── MR ${match.matchType === 'mr-pass' ? 'PASS' : 'FAIL'}: ${match.imei}  (${match.machineName} / ${match.date} / ${match.mrFolder}) ──`)
      logger.info(`  Source : ${match.sourcePath}`)
      logger.info(`  Dest   : ${destFilePath}`)

      try {
        const exists = await fileExists(destFilePath)

        if (exists && duplicates === 'skip') {
          skipped++
          logger.warn(`  SKIPPED — file already exists at destination`)
          sendProgress(match)
          return
        }

        await mkdir(destDir, { recursive: true })
        if (exists && duplicates === 'overwrite') {
          logger.info(`  Overwriting existing file`)
        }

        const fileStat = await stat(match.sourcePath)
        await copyFile(match.sourcePath, destFilePath)
        totalFilesCopied++
        totalBytesCopied += fileStat.size
        exported++

        const elapsed = Date.now() - folderStart
        logger.info(`  ✓ 1 file  (${formatBytes(fileStat.size)})  ${elapsed}ms`)
        // MR exports always copy — never delete source MR images from NAS
      } catch (err) {
        failed++
        const errMsg = err instanceof Error ? err.message : String(err)
        failedItems.push({
          imei: match.imei,
          sourcePath: match.sourcePath,
          error: errMsg
        })
        logger.error(`  ✗ FAILED — ${errMsg}`)
      }
    } else {
      // ── Standard export: folder-level copy ──
      const destPath = buildDestPath(destination, match, organize)

      logger.info(`── ${match.folderName}  (${match.machineName} / ${match.date}) ──`)
      logger.info(`  Source : ${match.sourcePath}`)
      logger.info(`  Dest   : ${destPath}`)

      try {
        const exists = await folderExists(destPath)

        if (exists && duplicates === 'skip') {
          skipped++
          logger.warn(`  SKIPPED — folder already exists at destination`)
          sendProgress(match)
          return
        }

        if (exists && duplicates === 'overwrite') {
          await rm(destPath, { recursive: true, force: true })
          logger.info(`  Overwriting existing destination folder`)
        }

        const copyResult = await copyFolderParallel(
          match.sourcePath,
          destPath,
          imageType,
          aiImages,
          token,
          logger
        )

        if (copyResult === null) {
          // FD/ subfolder missing in AI Images mode
          fdMissingCount++
          failed++
          failedItems.push({
            imei: match.imei,
            sourcePath: match.sourcePath,
            error: 'FD/ subfolder not found (AI Images mode)'
          })
          logger.warn(`  ✗ SKIPPED — FD/ subfolder not found`)
          sendProgress(match)
          return
        }

        totalFilesCopied += copyResult.filesCopied
        totalBytesCopied += copyResult.bytesCopied
        exported++

        const elapsed = Date.now() - folderStart
        logger.info(`  ✓ ${copyResult.filesCopied} files  (${formatBytes(copyResult.bytesCopied)})  ${elapsed}ms`)

        if (action === 'move') {
          await removeSource(match.sourcePath)
          logger.warn(`  Source deleted (move mode)`)
        }
      } catch (err) {
        failed++
        const errMsg = err instanceof Error ? err.message : String(err)
        failedItems.push({
          imei: match.imei,
          sourcePath: match.sourcePath,
          error: errMsg
        })
        logger.error(`  ✗ FAILED — ${errMsg}`)
      }
    }

    sendProgress(match)
  })

  const elapsedMs = Date.now() - startTime
  const throughput = elapsedMs > 0 ? totalBytesCopied / (elapsedMs / 1000) : 0

  // ── Log summary ──
  logger.info('')
  logger.info('═══════════════════════════════════════════════════════════')
  logger.info('  EXPORT COMPLETE')
  logger.info('═══════════════════════════════════════════════════════════')
  logger.info(`Status     : ${token.cancelled ? 'CANCELLED' : 'SUCCESS'}`)
  logger.info(`Exported   : ${exported} folders  (${totalFilesCopied} files, ${formatBytes(totalBytesCopied)})`)
  logger.info(`Skipped    : ${skipped}`)
  logger.info(`Failed     : ${failed}${fdMissingCount > 0 ? ` (${fdMissingCount} missing FD/)` : ''}`)
  logger.info(`Total time : ${formatElapsed(elapsedMs)}`)
  logger.info(`Throughput : ${formatBytes(throughput)}/s`)

  if (failedItems.length > 0) {
    logger.info('')
    logger.info('── Failed Items ──')
    for (const item of failedItems) {
      logger.error(`  ${item.imei}  ${item.sourcePath}  →  ${item.error}`)
    }
  }

  const logPath = logger.getLogPath()
  await logger.close()

  onProgress({
    phase: token.cancelled ? 'cancelled' : 'complete',
    percent: 100,
    currentIMEI: '',
    currentFolder: '',
    exported,
    skipped,
    failed,
    totalItems
  })

  return {
    exported,
    skipped,
    failed,
    failedItems,
    elapsedMs,
    destinationPath: destination,
    logPath
  }
}
