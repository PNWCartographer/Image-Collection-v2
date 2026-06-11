import { readdir, copyFile, mkdir, rm, stat, rename, writeFile, unlink } from 'fs/promises'
import { join, extname, dirname, resolve, sep } from 'path'
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
 * by-model:      dest/Brand-Model/IMEI_index/
 */
/** Extract a human-readable message from an unknown error. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function buildDestPath(dest: string, match: SearchMatch, organize: ExportRequest['organize']): string {
  const machine = sanitizePathSegment(match.machineName)
  const folder = sanitizePathSegment(match.folderName)
  const model = sanitizePathSegment(match.modelName || 'Unknown')

  switch (organize) {
    case 'flat':
      return join(dest, folder)
    case 'by-machine':
      return join(dest, machine, folder)
    case 'by-date':
      return join(dest, match.date, folder)
    case 'machine-date':
      return join(dest, machine, match.date, folder)
    case 'date-machine':
      return join(dest, match.date, machine, folder)
    case 'by-imei':
      return join(dest, match.imei, `${machine}_${match.date}_${match.scanIndex}`)
    case 'by-model':
      return join(dest, model, folder)
    case 'machine-model':
      return join(dest, machine, model, folder)
    default: {
      const _exhaustive: never = organize
      return _exhaustive
    }
  }
}

/**
 * Build destination path for MR (Model Recognition) exports.
 * MR matches are single .png files, grouped into an IMEI folder.
 *
 * flat:          dest/IMEI/Machine_YYYYMMDD_BrandModel.png
 * by-machine:    dest/Machine/IMEI/YYYYMMDD_BrandModel.png
 * by-date:       dest/YYYYMMDD/IMEI/Machine_BrandModel.png
 * machine-date:  dest/Machine/YYYYMMDD/IMEI/BrandModel.png
 * date-machine:  dest/YYYYMMDD/Machine/IMEI/BrandModel.png
 * by-imei:       dest/IMEI/Machine_YYYYMMDD_BrandModel.png
 * by-model:      dest/Brand-Model/IMEI/Machine_YYYYMMDD_BrandModel.png
 */
function buildMRDestFilePath(dest: string, match: SearchMatch, organize: ExportRequest['organize']): string {
  const mrTag = match.mrFolder || (match.matchType === 'mr-pass' ? 'MR-Pass' : 'MR-Fail')
  // MR matches always carry a model (parsed from the SG-*.png filename) or fall
  // back to the source folder name (e.g. the Brand-Model folder, or 'Error-Error').
  const model = sanitizePathSegment(match.modelName || match.mrFolder || 'Unknown')
  const machine = sanitizePathSegment(match.machineName)

  switch (organize) {
    case 'flat':
    case 'by-imei':
      return join(dest, match.imei, `${machine}_${match.date}_${mrTag}.png`)
    case 'by-machine':
      return join(dest, machine, match.imei, `${match.date}_${mrTag}.png`)
    case 'by-date':
      return join(dest, match.date, match.imei, `${machine}_${mrTag}.png`)
    case 'machine-date':
      return join(dest, machine, match.date, match.imei, `${mrTag}.png`)
    case 'date-machine':
      return join(dest, match.date, machine, match.imei, `${mrTag}.png`)
    case 'by-model':
      return join(dest, model, match.imei, `${machine}_${match.date}_${mrTag}.png`)
    case 'machine-model':
      return join(dest, machine, model, match.imei, `${match.date}_${mrTag}.png`)
    default: {
      const _exhaustive: never = organize
      return _exhaustive
    }
  }
}

/** Files that are always included in every export regardless of image type filter. */
const ALWAYS_INCLUDE_FILES = new Set(['defectlog.xml'])

function isAlwaysIncluded(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (ALWAYS_INCLUDE_FILES.has(lower)) return true
  // MR image (SG-*.png) is always included
  if (lower.startsWith('sg-') && lower.endsWith('.png')) return true
  return false
}

function matchesImageType(fileName: string, imageType: ExportRequest['imageType']): boolean {
  // Critical files are always exported
  if (isAlwaysIncluded(fileName)) return true
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

// ── M9: Long path helper for Windows ──────────────────────────────
/** Prefix long paths with \\?\ on Windows to bypass the 260-char limit. */
function toLongPath(p: string): string {
  if (process.platform === 'win32' && p.length > 240 && !p.startsWith('\\\\?\\')) {
    return `\\\\?\\${resolve(p)}`
  }
  return p
}

// ── M13: Path traversal sanitization ──────────────────────────────
/** Strip `.`, `..`, and path separators to prevent directory traversal. */
function sanitizePathSegment(name: string): string {
  // Remove path separators
  let sanitized = name.replace(/[/\\]/g, '')
  // Remove standalone `.` and `..` segments
  sanitized = sanitized.replace(/^\.{1,2}$/, '_')
  // Remove leading/trailing dots that could be abused
  sanitized = sanitized.replace(/^\.+/, '').replace(/\.+$/, '')
  return sanitized || '_'
}

// ── H2: Destination-inside-source validation ──────────────────────
/** Check if child path is a subdirectory of parent path. */
function isSubPath(child: string, parent: string): boolean {
  const resolvedChild = resolve(child).toLowerCase() + sep
  const resolvedParent = resolve(parent).toLowerCase() + sep
  return resolvedChild.startsWith(resolvedParent)
}

// ── C2: Atomic overwrite helper ───────────────────────────────────
/**
 * Atomically overwrite a destination folder by:
 * 1. Renaming old dest to a backup name
 * 2. Running the copy operation
 * 3. Deleting the backup on success, or restoring it on failure
 */
async function atomicOverwrite(
  destPath: string,
  copyFn: () => Promise<CopyStats | null>,
  logger: ExportLogger
): Promise<CopyStats | null> {
  const backupPath = `${destPath}.old-${Date.now()}`
  await rename(destPath, backupPath)
  logger.info(`  Renamed existing folder to backup: ${backupPath}`)

  try {
    const result = await copyFn()
    // Copy succeeded — remove the backup
    try {
      await rm(backupPath, { recursive: true, force: true })
      logger.info(`  Removed backup after successful copy`)
    } catch (cleanupErr) {
      logger.warn(`  Could not remove backup ${backupPath}: ${errorMessage(cleanupErr)}`)
    }
    return result
  } catch (err) {
    // Copy failed — restore the backup
    logger.error(`  Copy failed, restoring backup: ${errorMessage(err)}`)
    try {
      await rm(destPath, { recursive: true, force: true })
    } catch { /* dest may not exist */ }
    try {
      await rename(backupPath, destPath)
      logger.info(`  Backup restored successfully`)
    } catch (restoreErr) {
      logger.error(`  CRITICAL: Could not restore backup ${backupPath}: ${errorMessage(restoreErr)}`)
    }
    throw err
  }
}

// ── Parallel folder copy with file-level concurrency ────────────────

interface CopyStats {
  filesCopied: number
  bytesCopied: number
  filesFailed: number
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
  let filesFailed = 0

  const effectiveSrc = aiImages ? join(srcDir, 'FD') : srcDir

  // Pre-check: if AI Images mode, verify FD/ exists before attempting copy
  if (aiImages) {
    const fdExists = await pathExists(effectiveSrc, 'directory')
    if (!fdExists) {
      logger.warn(`  FD/ subfolder not found in ${srcDir}`)
      return null
    }
  }

  try {
    await mkdir(toLongPath(destDir), { recursive: true })
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
        await copyFile(toLongPath(srcPath), toLongPath(dstPath))
        filesCopied++
        bytesCopied += fileStat.size
        logger.info(`    ${file.name}  (${formatBytes(fileStat.size)})`)
      } catch (err) {
        filesFailed++
        logger.error(`    COPY FAILED ${file.name}: ${errorMessage(err)}`)
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
        filesFailed += sub.filesFailed
      }
    }
  } catch (err) {
    logger.error(`  DIR READ FAILED ${effectiveSrc}: ${errorMessage(err)}`)
  }

  return { filesCopied, bytesCopied, filesFailed }
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
  const errMsg = errorMessage(err)
  failedItems.push({ imei: match.imei, sourcePath: match.sourcePath, error: errMsg })
  logger.error(`  ✗ FAILED — ${errMsg}`)
}

// ── Main export function ────────────────────────────────────────────

export async function exportResults(
  request: ExportRequest,
  logsDir: string,
  onProgress: (progress: ExportProgress) => void
): Promise<ExportResult> {
  // Cancel any in-flight export before starting a new one
  activeToken.cancelled = true
  const token = { cancelled: false }
  activeToken = token
  const startTime = Date.now()
  const logger = await createExportLogger(logsDir)

  const { matches, destination, action, imageType, organize, duplicates, aiImages } = request

  // Validate destination is accessible and writable before starting work
  try {
    await mkdir(destination, { recursive: true })
  } catch (err) {
    await logger.close()
    throw new Error(`Destination not accessible: ${errorMessage(err)}`)
  }

  // M14: Verify actual file write permission (mkdir can succeed where writes fail)
  const testFile = join(destination, `.write-test-${Date.now()}`)
  try {
    await writeFile(testFile, 'test')
    await unlink(testFile)
  } catch (err) {
    try { await unlink(testFile) } catch { /* test file may not exist */ }
    await logger.close()
    throw new Error(`Destination not writable: ${errorMessage(err)}`)
  }

  // H2: Prevent destination inside any source root (would cause recursive copies)
  const resolvedDest = resolve(destination)
  for (const match of matches) {
    const sourceParent = dirname(resolve(match.sourcePath))
    if (isSubPath(resolvedDest, sourceParent)) {
      await logger.close()
      throw new Error(
        `Destination "${destination}" is inside source root "${sourceParent}". ` +
        `Choose a destination outside the NAS source directories.`
      )
    }
  }

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
  // M1: Circuit breaker — abort after too many consecutive failures
  let consecutiveFailures = 0
  let cancelledByCircuitBreaker = false
  const CIRCUIT_BREAKER_THRESHOLD = 10

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

        await mkdir(toLongPath(destDir), { recursive: true })
        if (exists && duplicates === 'overwrite') {
          logger.info(`  Overwriting existing file`)
        }

        const fileStat = await stat(match.sourcePath)
        await copyFile(toLongPath(match.sourcePath), toLongPath(destFilePath))
        totalFilesCopied++
        totalBytesCopied += fileStat.size
        exported++
        consecutiveFailures = 0

        const elapsed = Date.now() - folderStart
        logger.info(`  ✓ 1 file  (${formatBytes(fileStat.size)})  ${elapsed}ms`)
        // MR exports always copy — never delete source MR images from NAS
      } catch (err) {
        failed++
        consecutiveFailures++
        recordFailure(err, match, failedItems, logger)
        if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          logger.error(`Export aborted: too many consecutive failures (${CIRCUIT_BREAKER_THRESHOLD})`)
          cancelledByCircuitBreaker = true
          token.cancelled = true
        }
      }
    } else {
      // ── Standard export: folder-level copy ──
      const destPath = buildDestPath(destination, match, organize)

      logger.info(`── ${match.folderName}  (${match.machineName} / ${match.date}) ──`)
      logger.info(`  Source : ${match.sourcePath}`)
      logger.info(`  Dest   : ${destPath}`)

      try {
        const exists = await pathExists(destPath, 'directory')

        // H4: When skipping existing folders, verify they are reasonably complete.
        // If the destination has less than 50% of expected files, re-export
        // instead of skipping — the folder is likely from an interrupted export.
        if (exists && duplicates === 'skip') {
          const destFiles = await readdir(destPath)
          const destFileCount = destFiles.length
          const expectedFiles = match.totalFiles
          if (expectedFiles > 0 && destFileCount < expectedFiles * 0.5) {
            logger.warn(`  Destination has ${destFileCount}/${expectedFiles} files — likely incomplete, re-exporting with overwrite`)
            // Fall through to overwrite behavior instead of skipping
            await rm(destPath, { recursive: true, force: true })
          } else {
            skipped++
            logger.warn(`  SKIPPED — folder already exists at destination`)
            sendProgress(match)
            return
          }
        }

        // C2: Atomic overwrite — rename old dest to backup, copy, then clean up
        let copyResult: CopyStats | null
        if (exists && duplicates === 'overwrite') {
          logger.info(`  Overwriting existing destination folder (atomic)`)
          copyResult = await atomicOverwrite(
            destPath,
            () => copyFolderParallel(match.sourcePath, destPath, imageType, aiImages, token, logger),
            logger
          )
        } else {
          copyResult = await copyFolderParallel(
            match.sourcePath,
            destPath,
            imageType,
            aiImages,
            token,
            logger
          )
        }

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
        consecutiveFailures = 0

        const elapsed = Date.now() - folderStart
        logger.info(`  ✓ ${copyResult.filesCopied} files  (${formatBytes(copyResult.bytesCopied)})  ${elapsed}ms`)

        if (action === 'move') {
          // C1: Block source deletion when filtering by image type — deleting the
          // entire source folder would destroy file types that were not exported.
          if (imageType !== 'both') {
            logger.warn(`  Source NOT deleted — move mode with image type filter "${imageType}" would destroy unselected files`)
          } else if (copyResult.filesCopied === 0) {
            logger.warn(`  Source NOT deleted — no files were copied`)
          } else if (copyResult.filesFailed > 0) {
            logger.warn(`  Source NOT deleted — ${copyResult.filesFailed} file(s) failed to copy`)
          } else {
            const removed = await removeSource(match.sourcePath)
            if (removed) {
              logger.warn(`  Source deleted (move mode)`)
            } else {
              // H12: When removeSource fails, count it as a failure so the user
              // sees accurate counts instead of a false success.
              exported--
              failed++
              failedItems.push({ imei: match.imei, sourcePath: match.sourcePath, error: 'Source deletion failed after copy' })
              logger.error(`  Source deletion FAILED — files may still exist at ${match.sourcePath}`)
            }
          }
        }
      } catch (err) {
        failed++
        consecutiveFailures++
        recordFailure(err, match, failedItems, logger)
        if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          logger.error(`Export aborted: too many consecutive failures (${CIRCUIT_BREAKER_THRESHOLD})`)
          cancelledByCircuitBreaker = true
          token.cancelled = true
        }
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
  logger.info(`Status     : ${cancelledByCircuitBreaker ? 'ABORTED (circuit breaker)' : token.cancelled ? 'CANCELLED' : 'SUCCESS'}`)
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
    phase: (token.cancelled || cancelledByCircuitBreaker) ? 'cancelled' : 'complete',
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
