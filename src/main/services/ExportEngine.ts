import { readdir, copyFile, mkdir, rm, stat } from 'fs/promises'
import { join, extname } from 'path'
import type { ExportRequest, ExportProgress, ExportResult, SearchMatch } from '../../shared/types'

let cancelled = false

export function cancelExport(): void {
  cancelled = true
}

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
 * Check if a file extension matches the image type filter.
 */
function matchesImageType(fileName: string, imageType: ExportRequest['imageType']): boolean {
  if (imageType === 'both') return true

  const ext = extname(fileName).toLowerCase()
  if (imageType === 'bmp') return ext === '.bmp'
  if (imageType === 'jpeg') return ext === '.jpg' || ext === '.jpeg'
  return true
}

/**
 * Recursively copy a folder, filtering files by image type.
 * When aiImages is true, only copies the FD/ subfolder contents.
 */
async function copyFolderFiltered(
  srcDir: string,
  destDir: string,
  imageType: ExportRequest['imageType'],
  aiImages: boolean
): Promise<number> {
  let filesCopied = 0

  // If AI Images Only is enabled, redirect source to the FD subfolder
  const effectiveSrc = aiImages ? join(srcDir, 'FD') : srcDir

  try {
    await mkdir(destDir, { recursive: true })

    const entries = await readdir(effectiveSrc, { withFileTypes: true })

    for (const entry of entries) {
      if (cancelled) break

      const srcPath = join(effectiveSrc, entry.name)
      const destPath = join(destDir, entry.name)

      if (entry.isDirectory()) {
        // Skip FD subfolder in normal mode — it gets included naturally via recursion
        // In AI mode we're already inside FD, so recurse normally
        filesCopied += await copyFolderFiltered(srcPath, destPath, imageType, false)
      } else if (entry.isFile()) {
        if (matchesImageType(entry.name, imageType)) {
          await copyFile(srcPath, destPath)
          filesCopied++
        }
      }
    }
  } catch {
    // Source folder (or FD subfolder) not accessible
  }

  return filesCopied
}

/**
 * Remove a source folder after successful move operation.
 */
async function removeSource(folderPath: string): Promise<void> {
  try {
    await rm(folderPath, { recursive: true, force: true })
  } catch {
    // Best-effort deletion — don't fail the export if cleanup fails
  }
}

/**
 * Check if a destination folder already exists.
 */
async function folderExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}

export async function exportResults(
  request: ExportRequest,
  onProgress: (progress: ExportProgress) => void
): Promise<ExportResult> {
  cancelled = false
  const startTime = Date.now()

  const { matches, destination, action, imageType, organize, duplicates, aiImages } = request
  const totalItems = matches.length

  let exported = 0
  let skipped = 0
  let failed = 0
  const failedItems: ExportResult['failedItems'] = []

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

  // Send initial progress
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

  for (const match of matches) {
    if (cancelled) break

    sendProgress(match)

    const destPath = buildDestPath(destination, match, organize)

    try {
      // Check if destination already exists
      const exists = await folderExists(destPath)

      if (exists && duplicates === 'skip') {
        skipped++
        continue
      }

      // If overwrite mode and folder exists, remove it first
      if (exists && duplicates === 'overwrite') {
        await rm(destPath, { recursive: true, force: true })
      }

      // Copy folder with image type filtering
      const filesCopied = await copyFolderFiltered(match.sourcePath, destPath, imageType, aiImages)

      if (filesCopied === 0) {
        // No files matched the filter — still count as exported (empty folder created)
        exported++
      } else {
        exported++
      }

      // If move action, delete source after successful copy
      if (action === 'move') {
        await removeSource(match.sourcePath)
      }
    } catch (err) {
      failed++
      failedItems.push({
        imei: match.imei,
        sourcePath: match.sourcePath,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const elapsedMs = Date.now() - startTime

  onProgress({
    phase: cancelled ? 'cancelled' : 'complete',
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
    destinationPath: destination
  }
}
