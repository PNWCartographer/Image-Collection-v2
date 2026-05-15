import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import type { SearchRequest, SearchMatch, SearchProgress, SearchResult } from '../../shared/types'

const DATE_REGEX = /^\d{8}$/
const SKIP_FOLDERS = new Set([
  '#recycle', '$recycle.bin', 'bin', 'modelrecogimages', 'version_control'
])

let cancelled = false

export function cancelSearch(): void {
  cancelled = true
}

export async function searchIMEIs(
  request: SearchRequest,
  onProgress: (progress: SearchProgress) => void
): Promise<SearchResult> {
  cancelled = false
  const startTime = Date.now()

  const imeiSet = new Set(request.imeis)
  const matches: SearchMatch[] = []
  const foundIMEIs = new Set<string>()

  // Phase 1: count total date folders for progress tracking
  const machineDateFolders: { machine: string; datePath: string; dateStr: string }[] = []

  for (const folderName of request.selectedFolders) {
    if (cancelled) break
    const machinePath = join(request.rootPath, folderName)

    try {
      const entries = await readdir(machinePath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!DATE_REGEX.test(entry.name)) continue
        if (SKIP_FOLDERS.has(entry.name.toLowerCase())) continue

        // Apply date range filter
        if (!isDateInRange(entry.name, request)) continue

        machineDateFolders.push({
          machine: folderName,
          datePath: join(machinePath, entry.name),
          dateStr: entry.name
        })
      }
    } catch {
      // Machine folder might not be accessible, skip it
    }
  }

  const totalFolders = machineDateFolders.length
  let foldersScanned = 0

  // Phase 2: scan each date folder for IMEI matches
  for (const { machine, datePath, dateStr } of machineDateFolders) {
    if (cancelled) break

    onProgress({
      phase: 'scanning',
      percent: totalFolders > 0 ? (foldersScanned / totalFolders) * 100 : 0,
      currentMachine: machine,
      currentDate: dateStr,
      matchesSoFar: matches.length,
      foldersScanned,
      totalFolders
    })

    try {
      const imeiEntries = await readdir(datePath, { withFileTypes: true })

      for (const imeiEntry of imeiEntries) {
        if (cancelled) break
        if (!imeiEntry.isDirectory()) continue

        const parsed = parseIMEIFolder(imeiEntry.name)
        if (!parsed) continue

        // Apply scan index filter
        if (request.scanIndexFilter === 'first_only' && parsed.scanIndex !== 1) continue

        if (imeiSet.has(parsed.imei)) {
          const folderPath = join(datePath, imeiEntry.name)
          const fileCounts = await countFiles(folderPath)

          matches.push({
            imei: parsed.imei,
            machineName: machine,
            date: dateStr,
            scanIndex: parsed.scanIndex,
            folderName: imeiEntry.name,
            sourcePath: folderPath,
            bmpCount: fileCounts.bmp,
            jpegCount: fileCounts.jpeg,
            otherCount: fileCounts.other,
            totalFiles: fileCounts.bmp + fileCounts.jpeg + fileCounts.other
          })
          foundIMEIs.add(parsed.imei)
        }
      }
    } catch {
      // Date folder might not be accessible, skip
    }

    foldersScanned++
  }

  const missingIMEIs = request.imeis.filter((imei) => !foundIMEIs.has(imei))
  const elapsedMs = Date.now() - startTime

  const result: SearchResult = {
    matches,
    missingIMEIs,
    totalSearched: totalFolders,
    elapsedMs,
    folderCount: foldersScanned
  }

  onProgress({
    phase: cancelled ? 'cancelled' : 'complete',
    percent: 100,
    currentMachine: '',
    currentDate: '',
    matchesSoFar: matches.length,
    foldersScanned,
    totalFolders
  })

  return result
}

function parseIMEIFolder(name: string): { imei: string; scanIndex: number } | null {
  const underscoreIdx = name.indexOf('_')
  if (underscoreIdx === -1) return null

  const imeiPart = name.substring(0, underscoreIdx)
  const indexPart = name.substring(underscoreIdx + 1)

  // IMEI must be exactly 15 digits
  if (!/^\d{15}$/.test(imeiPart)) return null

  const scanIndex = parseInt(indexPart, 10)
  if (isNaN(scanIndex)) return null

  return { imei: imeiPart, scanIndex }
}

function isDateInRange(dateStr: string, request: SearchRequest): boolean {
  // No date filter set — include all
  if (!request.dateStart && !request.dateEnd) return true

  // Parse YYYYMMDD to comparable format YYYY-MM-DD
  const folderDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`

  if (request.dateStart) {
    let startCompare = request.dateStart
    // If time is set, we still compare at the date level for folder filtering.
    // Time filtering would apply to file modified times, but folder names
    // only encode date, so we compare dates only.
    if (folderDate < startCompare) return false
  }

  if (request.dateEnd) {
    let endCompare = request.dateEnd
    if (folderDate > endCompare) return false
  }

  return true
}

async function countFiles(folderPath: string): Promise<{ bmp: number; jpeg: number; other: number }> {
  const counts = { bmp: 0, jpeg: 0, other: 0 }

  try {
    const entries = await readdir(folderPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = entry.name.toLowerCase()

      if (ext.endsWith('.bmp')) {
        counts.bmp++
      } else if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
        counts.jpeg++
      } else {
        counts.other++
      }
    }
  } catch {
    // Can't read folder contents
  }

  return counts
}
