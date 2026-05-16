import { readdir, copyFile, mkdir, rm, stat, access } from 'fs/promises'
import { join, extname, dirname } from 'path'
import { constants as fsConstants } from 'fs'
import type { ExportRequest, ExportProgress, ExportResult, SearchMatch } from '../../shared/types'
import { formatElapsed, formatBytes, PROGRESS_THROTTLE_MS } from '../../shared/utils'
import { pooledVoid, type CancelToken } from '../../shared/pool'
import { createExportLogger, type ExportLogger } from './Logger'

// ── Concurrency tuning ──────────────────────────────────────────────
// 8 IMEI folders processed simultaneously × 4 file copies each = 32
// concurrent NAS reads in-flight.  Saturates the 1 Gbps pipe without
// overwhelming SMB or the local disk.
const FOLDER_CONCURRENCY = 8
const FILE_CONCURRENCY = 4

/** Per-operation cancellation token — avoids race conditions between overlapping calls. */
let activeToken: CancelToken = { cancelled: false }

export function cancelExport(): void {
  activeToken.cancelled = true
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
  }
}

function matchesImageType(fileName: string, imageType: ExportRequest['imageType']): boolean {
  if (imageType === 'both') return true
  const ext = extname(fileName).toLowerCase()
  if (imageType === 'bmp') return ext === '.bmp'
  if (imageType === 'jpeg') return ext === '.jpg' || ext === '.jpeg'
  // Exhaustive check — compile error if a new imageType is added without handling
  const _exhaustive: never = imageType
  return _exhaustive
}

async function pathExists(path: string, type: 'file' | 'directory'): Promise<boolean> {
  try {
    const s = await stat(path)
    return type === 'file' ? s.isFile() : s.isDirectory()
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
  token: CancelToken,
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
    await pooledVoid(files, FILE_CONCURRENCY, token, async (file) => {
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

async function removeSource(folderPath: string): Promise<boolean> {
  try {
    await rm(folderPath, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** Record a failed export item and log it. */
function recordFailure(
  err: unknown,
  match: SearchMatch,
  failedItems: ExportResult['failedItems'],
  logger: ExportLogger
): void {
  const errMsg = err instanceof Error ? err.message : String(err)
  failedItems.push({ imei: match.imei, sourcePath: match.sourcePath, error: errMsg })
  logger.error(`  ✗ FAILED — ${errMsg}`)
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
    if (now - lastProgressTime < PROGRESS_THROTTLE_MS) return
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
  await pooledVoid(matches, FOLDER_CONCURRENCY, token, async (match) => {
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
        const exists = await pathExists(destFilePath, 'file')

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
        recordFailure(err, match, failedItems, logger)
      }
    } else {
      // ── Standard export: folder-level copy ──
      const destPath = buildDestPath(destination, match, organize)

      logger.info(`── ${match.folderName}  (${match.machineName} / ${match.date}) ──`)
      logger.info(`  Source : ${match.sourcePath}`)
      logger.info(`  Dest   : ${destPath}`)

      try {
        const exists = await pathExists(destPath, 'directory')

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
          fdMissingCount++
          failed++
          failedItems.push({ imei: match.imei, sourcePath: match.sourcePath, error: 'FD/ subfolder not found (AI Images mode)' })
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
          const removed = await removeSource(match.sourcePath)
          if (removed) {
            logger.warn(`  Source deleted (move mode)`)
          } else {
            logger.error(`  Source deletion FAILED — files may still exist at ${match.sourcePath}`)
          }
        }
      } catch (err) {
        failed++
        recordFailure(err, match, failedItems, logger)
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
