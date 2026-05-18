import { readdir } from 'fs/promises'
import { join } from 'path'
import type { SearchRequest, SearchMatch, SearchProgress, SearchResult, AuditHint } from '../../shared/types'
import { PROGRESS_THROTTLE_MS } from '../../shared/utils'
import { pooled, type CancelToken } from '../../shared/pool'

const DATE_REGEX = /^\d{8}$/
const MR_ROOT = 'modelrecogimages'
const MR_FAIL_FOLDER = 'error-error'
const SKIP_FOLDERS = new Set([
  '#recycle', '$recycle.bin', 'bin', MR_ROOT, 'version_control'
])

// Concurrent NAS reads — tuned for RS3617RPxs (12-drive RAID 5, 1Gbps)
// NAS runs at ~50% IOPS capacity during production, plenty of headroom
const CONCURRENCY = 48

/** Per-operation cancellation token — avoids race conditions between overlapping calls. */
let activeToken: CancelToken = { cancelled: false }

export function cancelSearch(): void {
  activeToken.cancelled = true
}

interface SearchContext {
  token: CancelToken
  startTime: number
  imeiSet: Set<string>
  matches: SearchMatch[]
  foundIMEIs: Set<string>
}

function createSearchContext(imeis: string[]): SearchContext {
  const token = { cancelled: false }
  activeToken = token
  return {
    token,
    startTime: Date.now(),
    imeiSet: new Set(imeis),
    matches: [],
    foundIMEIs: new Set<string>()
  }
}

type DateFolder = { machine: string; datePath: string; dateStr: string }

function createProgressTracker(
  dateFolders: DateFolder[],
  matches: SearchMatch[],
  onProgress: (progress: SearchProgress) => void
): { sendProgress: (machine: string, dateStr: string) => void; foldersScanned: { value: number } } {
  const totalFolders = dateFolders.length
  const foldersScanned = { value: 0 }
  let lastProgressTime = 0

  const sendProgress = (machine: string, dateStr: string): void => {
    const now = Date.now()
    if (now - lastProgressTime < PROGRESS_THROTTLE_MS) return
    lastProgressTime = now
    onProgress({
      phase: 'scanning',
      percent: totalFolders > 0 ? (foldersScanned.value / totalFolders) * 100 : 0,
      currentMachine: machine,
      currentDate: dateStr,
      matchesSoFar: matches.length,
      foldersScanned: foldersScanned.value,
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

  return { sendProgress, foldersScanned }
}

// ── Smart Search: targeted lookups using audit file hints ───────────

/**
 * Targeted search — when audit data includes Machine + Date columns,
 * go directly to root/Machine/Date/ and look for the IMEI folders.
 * Returns the list of IMEIs that couldn't be resolved (fallbacks).
 */
async function searchTargeted(
  request: SearchRequest,
  ctx: SearchContext,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void
): Promise<{ searched: number; fallbackImeis: string[] }> {
  const { token, matches, foundIMEIs } = ctx
  const hints = request.hints!
  const selectedSet = new Set(request.selectedFolders)

  // Group hints by machine+date for efficient batch lookups
  const directLookups = new Map<string, string[]>()
  const fallbackImeis: string[] = []

  for (const imei of request.imeis) {
    const hint: AuditHint | undefined = hints[imei]
    if (!hint?.machine || !hint?.date) {
      fallbackImeis.push(imei)
      continue
    }
    if (!selectedSet.has(hint.machine)) {
      fallbackImeis.push(imei)
      continue
    }
    if (!isDateInRange(hint.date, request)) {
      fallbackImeis.push(imei)
      continue
    }
    const key = `${hint.machine}/${hint.date}`
    const existing = directLookups.get(key)
    if (existing) existing.push(imei)
    else directLookups.set(key, [imei])
  }

  const lookupEntries = [...directLookups.entries()]
  let searched = 0
  const totalLookups = lookupEntries.length

  // Initial progress
  if (totalLookups > 0) {
    const [firstMachine, firstDate] = lookupEntries[0][0].split('/')
    onProgress({
      phase: 'scanning',
      percent: 0,
      currentMachine: firstMachine,
      currentDate: firstDate,
      matchesSoFar: 0,
      foldersScanned: 0,
      totalFolders: totalLookups + (fallbackImeis.length > 0 ? 1 : 0) // +1 placeholder for fallback phase
    })
  }

  await pooled(lookupEntries, CONCURRENCY, token, async ([key, imeisInFolder]) => {
    if (token.cancelled) return

    const [machine, dateStr] = key.split('/')
    const datePath = join(request.rootPath, machine, dateStr)

    try {
      const localImeiSet = new Set(imeisInFolder)
      const entries = await readdir(datePath, { withFileTypes: true })
      const pendingMatches: { imei: string; scanIndex: number; folderName: string; folderPath: string }[] = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const parsed = parseIMEIFolder(entry.name)
        if (!parsed) continue
        if (request.scanIndexFilter === 'first_only' && parsed.scanIndex !== 1) continue
        if (localImeiSet.has(parsed.imei)) {
          pendingMatches.push({
            imei: parsed.imei,
            scanIndex: parsed.scanIndex,
            folderName: entry.name,
            folderPath: join(datePath, entry.name)
          })
        }
      }

      if (pendingMatches.length > 0 && !token.cancelled) {
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
        if (batch.length > 0) onMatches(batch)
      }
    } catch {
      // Date folder not accessible — these IMEIs need fallback
      for (const imei of imeisInFolder) {
        if (!foundIMEIs.has(imei)) fallbackImeis.push(imei)
      }
    }

    searched++
    const now = Date.now()
    if (now - ctx.startTime > PROGRESS_THROTTLE_MS * searched || searched === totalLookups) {
      onProgress({
        phase: 'scanning',
        percent: totalLookups > 0 ? (searched / totalLookups) * (fallbackImeis.length > 0 ? 80 : 100) : 0,
        currentMachine: key.split('/')[0],
        currentDate: key.split('/')[1],
        matchesSoFar: matches.length,
        foldersScanned: searched,
        totalFolders: totalLookups
      })
    }
  })

  return { searched, fallbackImeis }
}

// ── Broad scan (original search path) ──────────────────────────────

async function searchBroad(
  request: SearchRequest,
  ctx: SearchContext,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void,
  percentOffset: number = 0
): Promise<number> {
  const { token, imeiSet, matches, foundIMEIs } = ctx

  // Phase 1: Discover date folders (parallel across machines)
  const dateFolders: DateFolder[] = []

  await pooled(request.selectedFolders, CONCURRENCY, token, async (folderName) => {
    if (token.cancelled) return
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

  if (token.cancelled) return 0

  const totalFolders = dateFolders.length
  const foldersScanned = { value: 0 }
  let lastProgressTime = 0
  const percentRange = 100 - percentOffset

  if (dateFolders.length > 0) {
    onProgress({
      phase: 'scanning',
      percent: percentOffset,
      currentMachine: dateFolders[0].machine,
      currentDate: dateFolders[0].dateStr,
      matchesSoFar: matches.length,
      foldersScanned: 0,
      totalFolders
    })
  }

  // Phase 2: Scan date folders for IMEI matches (parallel pool)
  await pooled(dateFolders, CONCURRENCY, token, async ({ machine, datePath, dateStr }) => {
    if (token.cancelled) return

    const now = Date.now()
    if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
      lastProgressTime = now
      onProgress({
        phase: 'scanning',
        percent: percentOffset + (totalFolders > 0 ? (foldersScanned.value / totalFolders) * percentRange : 0),
        currentMachine: machine,
        currentDate: dateStr,
        matchesSoFar: matches.length,
        foldersScanned: foldersScanned.value,
        totalFolders
      })
    }

    try {
      const imeiEntries = await readdir(datePath, { withFileTypes: true })

      const pendingMatches: { imei: string; scanIndex: number; folderName: string; folderPath: string }[] = []

      for (const imeiEntry of imeiEntries) {
        if (token.cancelled) break
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
      if (pendingMatches.length > 0 && !token.cancelled) {
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

    foldersScanned.value++
  })

  return foldersScanned.value
}

// ── Main search dispatcher ─────────────────────────────────────────

export async function searchIMEIs(
  request: SearchRequest,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void
): Promise<SearchResult> {
  // MR mode: entirely different search path
  if (request.mrPass || request.mrFail) {
    return searchMRImages(request, onProgress, onMatches)
  }

  const ctx = createSearchContext(request.imeis)
  const { token, matches, foundIMEIs, startTime } = ctx

  // Smart Search: targeted lookups when audit file had machine + date columns
  if (request.smartSearch && request.hints && Object.keys(request.hints).length > 0) {
    const { searched: directSearched, fallbackImeis } = await searchTargeted(
      request, ctx, onProgress, onMatches
    )

    if (token.cancelled) {
      return buildResult(matches, request.imeis, foundIMEIs, startTime, directSearched, token, onProgress)
    }

    // If all IMEIs were handled, done
    if (fallbackImeis.length === 0) {
      return buildResult(matches, request.imeis, foundIMEIs, startTime, directSearched, token, onProgress)
    }

    // Broad scan for remaining IMEIs without complete hints
    const fallbackSet = new Set(fallbackImeis)
    ctx.imeiSet.clear()
    for (const imei of fallbackImeis) ctx.imeiSet.add(imei)

    const fallbackRequest: SearchRequest = {
      ...request,
      imeis: fallbackImeis.filter((imei) => fallbackSet.has(imei)),
      hints: undefined,
      smartSearch: false
    }

    const broadScanned = await searchBroad(fallbackRequest, ctx, onProgress, onMatches, 80)
    return buildResult(matches, request.imeis, foundIMEIs, startTime, directSearched + broadScanned, token, onProgress)
  }

  // Standard broad scan (no hints available)
  const scanned = await searchBroad(request, ctx, onProgress, onMatches)
  return buildResult(matches, request.imeis, foundIMEIs, startTime, scanned, token, onProgress)
}

function buildResult(
  matches: SearchMatch[],
  allImeis: string[],
  foundIMEIs: Set<string>,
  startTime: number,
  foldersScanned: number,
  token: CancelToken,
  onProgress: (progress: SearchProgress) => void
): SearchResult {
  const missingIMEIs = allImeis.filter((imei) => !foundIMEIs.has(imei))
  const elapsedMs = Date.now() - startTime

  onProgress({
    phase: token.cancelled ? 'cancelled' : 'complete',
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

/**
 * Extract the 15-digit IMEI from an MR image filename.
 * Format: SG-{machine}-{code}-{IMEI}-{brand}-{model}.png
 * Returns the IMEI string or null if the filename doesn't match.
 */
function extractMRImei(fileName: string): string | null {
  const segments = fileName.replace(/\.png$/i, '').split('-')
  // Minimum segments: SG, machine, code, IMEI, brand, model = 6
  // But model names like "iPhone13ProMax" are a single segment, and
  // brand-model combos vary, so just ensure index 3 exists and is 15 digits
  if (segments.length < 4) return null
  const candidate = segments[3]
  if (/^\d{15}$/.test(candidate)) return candidate
  return null
}

// ── MR (Model Recognition) search ──────────────────────────────────
// Searches ModelRecogImages/{date}/{Brand-Model|Error-Error}/ for .png
// files named SG-{machine}-{code}-{IMEI}-{brand}-{model}.png.
// The IMEI is extracted from the 4th hyphen-delimited segment.

async function searchMRImages(
  request: SearchRequest,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void
): Promise<SearchResult> {
  const ctx = createSearchContext(request.imeis)
  const { token, imeiSet, matches, foundIMEIs, startTime } = ctx

  // Phase 1: Discover date folders inside ModelRecogImages per machine
  const dateFolders: DateFolder[] = []

  await pooled(request.selectedFolders, CONCURRENCY, token, async (folderName) => {
    if (token.cancelled) return
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

  if (token.cancelled) return buildResult(matches, request.imeis, foundIMEIs, startTime, 0, token, onProgress)

  const { sendProgress, foldersScanned } = createProgressTracker(dateFolders, matches, onProgress)

  // Phase 2: Scan date folders for Brand-Model / Error-Error subfolders
  await pooled(dateFolders, CONCURRENCY, token, async ({ machine, datePath, dateStr }) => {
    if (token.cancelled) return
    sendProgress(machine, dateStr)

    try {
      const subFolders = await readdir(datePath, { withFileTypes: true })

      for (const sub of subFolders) {
        if (token.cancelled) break
        if (!sub.isDirectory()) continue

        const isErrorFolder = sub.name.toLowerCase() === MR_FAIL_FOLDER

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

            const imeiFromFile = extractMRImei(file.name)
            if (!imeiFromFile) continue
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

    foldersScanned.value++
  })

  return buildResult(matches, request.imeis, foundIMEIs, startTime, foldersScanned.value, token, onProgress)
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
