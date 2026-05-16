import { readdir } from 'fs/promises'
import { join } from 'path'
import type { SearchRequest, SearchMatch, SearchProgress, SearchResult } from '../../shared/types'

const DATE_REGEX = /^\d{8}$/
const SKIP_FOLDERS = new Set([
  '#recycle', '$recycle.bin', 'bin', 'modelrecogimages', 'version_control'
])

// Concurrent NAS reads — tuned for RS3617RPxs (12-drive RAID 5, 1Gbps)
// NAS runs at ~50% IOPS capacity during production, plenty of headroom
const CONCURRENCY = 48

let cancelled = false

export function cancelSearch(): void {
  cancelled = true
}

async function pooled<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length && !cancelled) {
      const idx = nextIndex++
      results[idx] = await fn(items[idx])
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}

export async function searchIMEIs(
  request: SearchRequest,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void
): Promise<SearchResult> {
  // MR mode: entirely different search path
  if (request.mrPass || request.mrFail) {
    return searchMRImages(request, onProgress, onMatches)
  }

  cancelled = false
  const startTime = Date.now()

  const imeiSet = new Set(request.imeis)
  const matches: SearchMatch[] = []
  const foundIMEIs = new Set<string>()

  // Phase 1: Discover date folders (parallel across machines)
  type DateFolder = { machine: string; datePath: string; dateStr: string }
  const dateFolders: DateFolder[] = []

  await pooled(request.selectedFolders, CONCURRENCY, async (folderName) => {
    if (cancelled) return
    const machinePath = join(request.rootPath, folderName)

    try {
      const entries = await readdir(machinePath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!DATE_REGEX.test(entry.name)) continue
        if (SKIP_FOLDERS.has(entry.name.toLowerCase())) continue
        if (!isDateInRange(entry.name, request)) continue

        dateFolders.push({
          machine: folderName,
          datePath: join(machinePath, entry.name),
          dateStr: entry.name
        })
      }
    } catch {
      // Machine folder not accessible
    }
  })

  if (cancelled) return buildResult(matches, request.imeis, foundIMEIs, startTime, 0, onProgress)

  const totalFolders = dateFolders.length
  let foldersScanned = 0
  let lastProgressTime = 0

  const sendProgress = (machine: string, dateStr: string): void => {
    const now = Date.now()
    if (now - lastProgressTime < 150) return
    lastProgressTime = now
    onProgress({
      phase: 'scanning',
      percent: totalFolders > 0 ? (foldersScanned / totalFolders) * 100 : 0,
      currentMachine: machine,
      currentDate: dateStr,
      matchesSoFar: matches.length,
      foldersScanned,
      totalFolders,
    })
  }

  // Send initial progress
  if (dateFolders.length > 0) {
    onProgress({
      phase: 'scanning',
      percent: 0,
      currentMachine: dateFolders[0].machine,
      currentDate: dateFolders[0].dateStr,
      matchesSoFar: 0,
      foldersScanned: 0,
      totalFolders,
    })
  }

  // Phase 2: Scan date folders for IMEI matches (parallel pool)
  await pooled(dateFolders, CONCURRENCY, async ({ machine, datePath, dateStr }) => {
    if (cancelled) return

    sendProgress(machine, dateStr)

    try {
      const imeiEntries = await readdir(datePath, { withFileTypes: true })

      const pendingMatches: { imei: string; scanIndex: number; folderName: string; folderPath: string }[] = []

      for (const imeiEntry of imeiEntries) {
        if (cancelled) break
        if (!imeiEntry.isDirectory()) continue

        const parsed = parseIMEIFolder(imeiEntry.name)
        if (!parsed) continue

        if (request.scanIndexFilter === 'first_only' && parsed.scanIndex !== 1) continue

        if (imeiSet.has(parsed.imei)) {
          pendingMatches.push({
            imei: parsed.imei,
            scanIndex: parsed.scanIndex,
            folderName: imeiEntry.name,
            folderPath: join(datePath, imeiEntry.name)
          })
        }
      }

      // Count files in matched folders in parallel
      if (pendingMatches.length > 0 && !cancelled) {
        const fileCounts = await Promise.all(
          pendingMatches.map((m) => countFiles(m.folderPath))
        )

        const batch: SearchMatch[] = []
        for (let i = 0; i < pendingMatches.length; i++) {
          const m = pendingMatches[i]
          const fc = fileCounts[i]
          const match: SearchMatch = {
            imei: m.imei,
            machineName: machine,
            date: dateStr,
            scanIndex: m.scanIndex,
            folderName: m.folderName,
            sourcePath: m.folderPath,
            bmpCount: fc.bmp,
            jpegCount: fc.jpeg,
            otherCount: fc.other,
            totalFiles: fc.bmp + fc.jpeg + fc.other
          }
          matches.push(match)
          batch.push(match)
          foundIMEIs.add(m.imei)
        }

        // Stream batch to UI
        if (batch.length > 0) {
          onMatches(batch)
        }
      }
    } catch {
      // Date folder not accessible
    }

    foldersScanned++
  })

  return buildResult(matches, request.imeis, foundIMEIs, startTime, foldersScanned, onProgress)
}

function buildResult(
  matches: SearchMatch[],
  allImeis: string[],
  foundIMEIs: Set<string>,
  startTime: number,
  foldersScanned: number,
  onProgress: (progress: SearchProgress) => void
): SearchResult {
  const missingIMEIs = allImeis.filter((imei) => !foundIMEIs.has(imei))
  const elapsedMs = Date.now() - startTime

  onProgress({
    phase: cancelled ? 'cancelled' : 'complete',
    percent: 100,
    currentMachine: '',
    currentDate: '',
    matchesSoFar: matches.length,
    foldersScanned,
    totalFolders: foldersScanned
  })

  return {
    matches,
    missingIMEIs,
    totalSearched: foldersScanned,
    elapsedMs,
    folderCount: foldersScanned
  }
}

function parseIMEIFolder(name: string): { imei: string; scanIndex: number } | null {
  const underscoreIdx = name.indexOf('_')
  if (underscoreIdx === -1) return null

  const imeiPart = name.substring(0, underscoreIdx)
  const indexPart = name.substring(underscoreIdx + 1)

  if (!/^\d{15}$/.test(imeiPart)) return null

  const scanIndex = parseInt(indexPart, 10)
  if (isNaN(scanIndex)) return null

  return { imei: imeiPart, scanIndex }
}

function isDateInRange(dateStr: string, request: SearchRequest): boolean {
  if (!request.dateStart && !request.dateEnd) return true

  const folderDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`

  if (request.dateStart && folderDate < request.dateStart) return false
  if (request.dateEnd && folderDate > request.dateEnd) return false

  return true
}

// ── MR (Model Recognition) search ──────────────────────────────────
// Searches ModelRecogImages/{date}/{Brand-Model|Error-Error}/ for .png
// files whose filename is a 15-digit IMEI matching the audit list.

async function searchMRImages(
  request: SearchRequest,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void
): Promise<SearchResult> {
  cancelled = false
  const startTime = Date.now()

  const imeiSet = new Set(request.imeis)
  const matches: SearchMatch[] = []
  const foundIMEIs = new Set<string>()

  // Phase 1: Discover date folders inside ModelRecogImages per machine
  type MRDateFolder = { machine: string; datePath: string; dateStr: string }
  const dateFolders: MRDateFolder[] = []

  await pooled(request.selectedFolders, CONCURRENCY, async (folderName) => {
    if (cancelled) return
    const mrPath = join(request.rootPath, folderName, 'ModelRecogImages')

    try {
      const entries = await readdir(mrPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!DATE_REGEX.test(entry.name)) continue
        if (!isDateInRange(entry.name, request)) continue

        dateFolders.push({
          machine: folderName,
          datePath: join(mrPath, entry.name),
          dateStr: entry.name
        })
      }
    } catch {
      // ModelRecogImages not found for this machine — skip
    }
  })

  if (cancelled) return buildResult(matches, request.imeis, foundIMEIs, startTime, 0, onProgress)

  const totalFolders = dateFolders.length
  let foldersScanned = 0
  let lastProgressTime = 0

  const sendProgress = (machine: string, dateStr: string): void => {
    const now = Date.now()
    if (now - lastProgressTime < 150) return
    lastProgressTime = now
    onProgress({
      phase: 'scanning',
      percent: totalFolders > 0 ? (foldersScanned / totalFolders) * 100 : 0,
      currentMachine: machine,
      currentDate: dateStr,
      matchesSoFar: matches.length,
      foldersScanned,
      totalFolders,
    })
  }

  if (dateFolders.length > 0) {
    onProgress({
      phase: 'scanning',
      percent: 0,
      currentMachine: dateFolders[0].machine,
      currentDate: dateFolders[0].dateStr,
      matchesSoFar: 0,
      foldersScanned: 0,
      totalFolders,
    })
  }

  // Phase 2: Scan date folders for Brand-Model / Error-Error subfolders
  await pooled(dateFolders, CONCURRENCY, async ({ machine, datePath, dateStr }) => {
    if (cancelled) return
    sendProgress(machine, dateStr)

    try {
      const subFolders = await readdir(datePath, { withFileTypes: true })

      for (const sub of subFolders) {
        if (cancelled) break
        if (!sub.isDirectory()) continue

        const isErrorFolder = sub.name.toLowerCase() === 'error-error'

        // Only scan folders matching the active toggles
        if (isErrorFolder && !request.mrFail) continue
        if (!isErrorFolder && !request.mrPass) continue

        const subPath = join(datePath, sub.name)

        try {
          const files = await readdir(subPath, { withFileTypes: true })
          const batch: SearchMatch[] = []

          for (const file of files) {
            if (!file.isFile()) continue
            if (!file.name.toLowerCase().endsWith('.png')) continue

            const imeiFromFile = file.name.replace(/\.png$/i, '')
            if (!/^\d{15}$/.test(imeiFromFile)) continue
            if (!imeiSet.has(imeiFromFile)) continue

            const match: SearchMatch = {
              imei: imeiFromFile,
              machineName: machine,
              date: dateStr,
              scanIndex: 0,
              folderName: file.name,
              sourcePath: join(subPath, file.name),
              bmpCount: 0,
              jpegCount: 0,
              otherCount: 1,
              totalFiles: 1,
              matchType: isErrorFolder ? 'mr-fail' : 'mr-pass',
              mrFolder: sub.name
            }
            matches.push(match)
            batch.push(match)
            foundIMEIs.add(imeiFromFile)
          }

          if (batch.length > 0) onMatches(batch)
        } catch {
          // Subfolder not accessible
        }
      }
    } catch {
      // Date folder not accessible
    }

    foldersScanned++
  })

  return buildResult(matches, request.imeis, foundIMEIs, startTime, foldersScanned, onProgress)
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
