import { readdir } from 'fs/promises'
import { join } from 'path'
import type { SearchRequest, SearchMatch, SearchProgress, SearchResult, AuditHint } from '../../shared/types'
import { PROGRESS_THROTTLE_MS, IMEI_REGEX, DATE_FOLDER_REGEX } from '../../shared/utils'
import { pooled, type CancelToken } from '../../shared/pool'
const MR_ROOT = 'modelrecogimages'
const MR_FAIL_FOLDER = 'error-error'
const SKIP_FOLDERS = new Set([
  '#recycle', '$recycle.bin', MR_ROOT, 'version_control'
])

// Concurrent NAS reads — tuned for RS3617RPxs (12-drive RAID 5, 1Gbps)
// NAS runs at ~50% IOPS capacity during production, plenty of headroom
const CONCURRENCY = 48

/** Timeout for NAS readdir calls — avoids hanging on SMB disconnect. */
const READDIR_TIMEOUT_MS = 15_000

/** Wraps readdir in a timeout to avoid hanging on NAS disconnect. */
async function readdirWithTimeout(
  dirPath: string,
  options: { withFileTypes: true }
): Promise<import('fs').Dirent[]> {
  return Promise.race([
    readdir(dirPath, options),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`readdir timed out after ${READDIR_TIMEOUT_MS}ms: ${dirPath}`)), READDIR_TIMEOUT_MS)
    )
  ])
}

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
  scanErrors: number
  /** Detailed per-folder error descriptions for scan failures. */
  scanErrorDetails: string[]
  /** Count of IMEIs skipped by scan-index filter (had only higher-index entries). */
  scanIndexFiltered: number
}

function createSearchContext(imeis: string[]): SearchContext {
  // Cancel any in-flight search before starting a new one
  activeToken.cancelled = true
  const token = { cancelled: false }
  activeToken = token
  return {
    token,
    startTime: Date.now(),
    imeiSet: new Set(imeis),
    matches: [],
    foundIMEIs: new Set<string>(),
    scanErrors: 0,
    scanErrorDetails: [],
    scanIndexFiltered: 0
  }
}

type DateFolder = { machine: string; datePath: string; dateStr: string }
type PendingMatch = { imei: string; scanIndex: number; folderName: string; folderPath: string }

/** Scan a date folder for IMEI subfolders matching the given set. */
async function scanDateFolder(
  datePath: string,
  imeiSet: Set<string>,
  scanIndexFilter: SearchRequest['scanIndexFilter']
): Promise<{ pending: PendingMatch[]; filteredCount: number }> {
  const entries = await readdirWithTimeout(datePath, { withFileTypes: true })
  const pending: PendingMatch[] = []
  let filteredCount = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const parsed = parseIMEIFolder(entry.name)
    if (!parsed) continue
    if (scanIndexFilter === 'first_only' && parsed.scanIndex !== 1) {
      // Track IMEIs that exist only at higher scan indices (M11)
      if (imeiSet.has(parsed.imei)) filteredCount++
      continue
    }
    if (imeiSet.has(parsed.imei)) {
      pending.push({
        imei: parsed.imei,
        scanIndex: parsed.scanIndex,
        folderName: entry.name,
        folderPath: join(datePath, entry.name)
      })
    }
  }
  return { pending, filteredCount }
}

/** Shared logic: count files in pending matches and build SearchMatch objects. */
async function buildMatchBatch(
  pending: PendingMatch[],
  machine: string,
  dateStr: string,
  ctx: SearchContext,
  onMatches: (matches: SearchMatch[]) => void
): Promise<void> {
  if (pending.length === 0) return
  // H7: Bounded concurrency — caps NAS reads at 8 per worker instead of unbounded
  const fileCounts = await pooled(pending, 8, ctx.token, async (m) => countFiles(m.folderPath))
  const batch: SearchMatch[] = []
  for (let i = 0; i < pending.length; i++) {
    const m = pending[i]
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
      // M10: -1 signals unreadable folder (vs 0 for genuinely empty)
      totalFiles: fc.error ? -1 : fc.bmp + fc.jpeg + fc.other,
      modelName: fc.modelName ?? undefined
    }
    ctx.matches.push(match)
    batch.push(match)
    ctx.foundIMEIs.add(m.imei)
  }
  if (batch.length > 0) onMatches(batch)
}

function createProgressTracker(
  dateFolders: DateFolder[],
  matches: SearchMatch[],
  onProgress: (progress: SearchProgress) => void,
  percentOffset: number = 0
): { sendProgress: (machine: string, dateStr: string) => void; foldersScanned: { value: number } } {
  const totalFolders = dateFolders.length
  const percentRange = 100 - percentOffset
  const foldersScanned = { value: 0 }
  let lastProgressTime = 0

  const sendProgress = (machine: string, dateStr: string): void => {
    const now = Date.now()
    if (now - lastProgressTime < PROGRESS_THROTTLE_MS) return
    lastProgressTime = now
    onProgress({
      phase: 'scanning',
      percent: percentOffset + (totalFolders > 0 ? (foldersScanned.value / totalFolders) * percentRange : 0),
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
      percent: percentOffset,
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
 * Returns fallback IMEIs and machine-only groups for narrowed broad scans.
 */
async function searchTargeted(
  request: SearchRequest,
  ctx: SearchContext,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void
): Promise<{ searched: number; fallbackImeis: string[]; machineOnlyGroups: Map<string, string[]> }> {
  const { token, matches, foundIMEIs } = ctx
  const hints = request.hints!
  const selectedSet = new Set(request.selectedFolders)

  // Group hints by machine+date for efficient batch lookups
  const directLookups = new Map<string, string[]>()
  const fallbackImeis: string[] = []

  // Partial hints: machine-only → narrow broad scan to one machine per IMEI
  // Group by machine for a constrained broad scan
  const machineOnlyGroups = new Map<string, string[]>()

  for (const imei of request.imeis) {
    const hint: AuditHint | undefined = hints[imei]

    if (hint?.machine && hint?.date) {
      // Full hint — direct lookup
      if (!selectedSet.has(hint.machine)) { fallbackImeis.push(imei); continue }
      if (!isDateInRange(hint.date, request)) { fallbackImeis.push(imei); continue }
      const key = `${hint.machine}/${hint.date}`
      const existing = directLookups.get(key)
      if (existing) existing.push(imei)
      else directLookups.set(key, [imei])
    } else if (hint?.machine && selectedSet.has(hint.machine)) {
      // Machine-only hint — will narrow the broad scan to this machine
      const existing = machineOnlyGroups.get(hint.machine)
      if (existing) existing.push(imei)
      else machineOnlyGroups.set(hint.machine, [imei])
    } else {
      // No usable hints — full broad scan fallback
      fallbackImeis.push(imei)
    }
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
      const { pending, filteredCount } = await scanDateFolder(datePath, localImeiSet, request.scanIndexFilter)
      ctx.scanIndexFiltered += filteredCount
      if (pending.length > 0 && !token.cancelled) {
        await buildMatchBatch(pending, machine, dateStr, ctx, onMatches)
      }
    } catch (err) {
      // Date folder not accessible — these IMEIs need fallback
      ctx.scanErrors++
      ctx.scanErrorDetails.push(`${machine}/${dateStr}: ${errorMessage(err)}`)
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

  return { searched, fallbackImeis, machineOnlyGroups }
}

// ── Broad scan (original search path) ──────────────────────────────

async function searchBroad(
  request: SearchRequest,
  ctx: SearchContext,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void,
  percentOffset: number = 0
): Promise<number> {
  const { token, imeiSet, matches } = ctx

  // Phase 1: Discover date folders (parallel across machines)
  const dateFolders: DateFolder[] = []

  await pooled(request.selectedFolders, CONCURRENCY, token, async (folderName) => {
    if (token.cancelled) return
    const machinePath = join(request.rootPath, folderName)

    try {
      const entries = await readdirWithTimeout(machinePath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!DATE_FOLDER_REGEX.test(entry.name)) continue
        if (SKIP_FOLDERS.has(entry.name.toLowerCase())) continue
        if (!isDateInRange(entry.name, request)) continue

        dateFolders.push({
          machine: folderName,
          datePath: join(machinePath, entry.name),
          dateStr: entry.name
        })
      }
    } catch (err) {
      // Machine folder not accessible
      ctx.scanErrors++
      ctx.scanErrorDetails.push(`${folderName}: ${errorMessage(err)}`)
    }
  })

  if (token.cancelled) return 0

  const { sendProgress, foldersScanned } = createProgressTracker(dateFolders, matches, onProgress, percentOffset)

  // Phase 2: Scan date folders for IMEI matches (parallel pool)
  await pooled(dateFolders, CONCURRENCY, token, async ({ machine, datePath, dateStr }) => {
    if (token.cancelled) return
    sendProgress(machine, dateStr)

    try {
      const { pending, filteredCount } = await scanDateFolder(datePath, imeiSet, request.scanIndexFilter)
      ctx.scanIndexFiltered += filteredCount
      if (pending.length > 0 && !token.cancelled) {
        await buildMatchBatch(pending, machine, dateStr, ctx, onMatches)
      }
    } catch (err) {
      // Date folder not accessible
      ctx.scanErrors++
      ctx.scanErrorDetails.push(`${machine}/${dateStr}: ${errorMessage(err)}`)
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
    const { searched: directSearched, fallbackImeis, machineOnlyGroups } = await searchTargeted(
      request, ctx, onProgress, onMatches
    )

    if (token.cancelled) {
      return buildResult(matches, request.imeis, foundIMEIs, startTime, directSearched, ctx.scanErrors, token, onProgress, ctx.scanErrorDetails, ctx.scanIndexFiltered)
    }

    let totalScanned = directSearched

    // Machine-only hints: run narrowed broad scans per machine
    for (const [machine, imeisForMachine] of machineOnlyGroups) {
      if (token.cancelled) break
      ctx.imeiSet.clear()
      for (const imei of imeisForMachine) ctx.imeiSet.add(imei)

      const narrowRequest: SearchRequest = {
        ...request,
        imeis: imeisForMachine,
        selectedFolders: [machine],
        hints: undefined,
        smartSearch: false
      }
      const scanned = await searchBroad(narrowRequest, ctx, onProgress, onMatches, 80)
      totalScanned += scanned
    }

    // M5: Machine-only hinted IMEIs not found on their hinted machine
    // need a full broad scan fallback — otherwise they're silently "missing"
    for (const [, imeisForMachine] of machineOnlyGroups) {
      for (const imei of imeisForMachine) {
        if (!foundIMEIs.has(imei)) fallbackImeis.push(imei)
      }
    }

    if (token.cancelled || fallbackImeis.length === 0) {
      return buildResult(matches, request.imeis, foundIMEIs, startTime, totalScanned, ctx.scanErrors, token, onProgress, ctx.scanErrorDetails, ctx.scanIndexFiltered)
    }

    // Full broad scan for remaining IMEIs without any usable hints
    ctx.imeiSet.clear()
    for (const imei of fallbackImeis) ctx.imeiSet.add(imei)

    const fallbackRequest: SearchRequest = {
      ...request,
      imeis: fallbackImeis,
      hints: undefined,
      smartSearch: false
    }

    const broadScanned = await searchBroad(fallbackRequest, ctx, onProgress, onMatches, 90)
    return buildResult(matches, request.imeis, foundIMEIs, startTime, totalScanned + broadScanned, ctx.scanErrors, token, onProgress, ctx.scanErrorDetails, ctx.scanIndexFiltered)
  }

  // Standard broad scan (no hints available)
  const scanned = await searchBroad(request, ctx, onProgress, onMatches)
  return buildResult(matches, request.imeis, foundIMEIs, startTime, scanned, ctx.scanErrors, token, onProgress, ctx.scanErrorDetails, ctx.scanIndexFiltered)
}

function buildResult(
  matches: SearchMatch[],
  allImeis: string[],
  foundIMEIs: Set<string>,
  startTime: number,
  foldersScanned: number,
  scanErrors: number,
  token: CancelToken,
  onProgress: (progress: SearchProgress) => void,
  scanErrorDetails: string[] = [],
  scanIndexFiltered: number = 0
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
    scanErrors,
    elapsedMs,
    // TODO: Add scanErrorDetails: string[] and scanIndexFiltered: number to SearchResult in types.ts
    ...(scanErrorDetails.length > 0 ? { scanErrorDetails } : {}),
    ...(scanIndexFiltered > 0 ? { scanIndexFiltered } : {})
  } as SearchResult
}

function parseIMEIFolder(name: string): { imei: string; scanIndex: number } | null {
  const underscoreIdx = name.indexOf('_')
  if (underscoreIdx === -1) return null

  const imeiPart = name.substring(0, underscoreIdx)
  const indexPart = name.substring(underscoreIdx + 1)

  if (!IMEI_REGEX.test(imeiPart)) return null

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
 * L2: Scans all segments for a 15-digit match instead of assuming position 3,
 * making extraction robust against format variations.
 */
function extractMRImei(fileName: string): string | null {
  const segments = fileName.replace(/\.png$/i, '').split('-')
  for (const seg of segments) {
    if (IMEI_REGEX.test(seg)) return seg
  }
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

  // Smart Search for MR: if hints have machine + date, go directly to
  // Machine/ModelRecogImages/Date/ instead of discovering all date folders
  const dateFolders: DateFolder[] = []

  if (request.smartSearch && request.hints && Object.keys(request.hints).length > 0) {
    const selectedSet = new Set(request.selectedFolders)
    const addedPaths = new Set<string>()

    for (const imei of request.imeis) {
      const hint = request.hints[imei]
      if (!hint?.machine || !hint?.date) continue
      if (!selectedSet.has(hint.machine)) continue
      if (!isDateInRange(hint.date, request)) continue

      const key = `${hint.machine}/${hint.date}`
      if (addedPaths.has(key)) continue
      addedPaths.add(key)

      dateFolders.push({
        machine: hint.machine,
        datePath: join(request.rootPath, hint.machine, 'ModelRecogImages', hint.date),
        dateStr: hint.date
      })
    }
  }

  // If no targeted MR folders, fall back to full discovery
  if (dateFolders.length === 0) {
    await pooled(request.selectedFolders, CONCURRENCY, token, async (folderName) => {
      if (token.cancelled) return
      const mrPath = join(request.rootPath, folderName, 'ModelRecogImages')

      try {
        const entries = await readdirWithTimeout(mrPath, { withFileTypes: true })

        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          if (!DATE_FOLDER_REGEX.test(entry.name)) continue
          if (!isDateInRange(entry.name, request)) continue

          dateFolders.push({
            machine: folderName,
            datePath: join(mrPath, entry.name),
            dateStr: entry.name
          })
        }
      } catch {
        // H6: MR folder errors were silently swallowed — now counted
        ctx.scanErrors++
      }
    })
  }

  if (token.cancelled) return buildResult(matches, request.imeis, foundIMEIs, startTime, 0, ctx.scanErrors, token, onProgress, ctx.scanErrorDetails, ctx.scanIndexFiltered)

  const { sendProgress, foldersScanned } = createProgressTracker(dateFolders, matches, onProgress)

  // Phase 2: Scan date folders for Brand-Model / Error-Error subfolders
  await pooled(dateFolders, CONCURRENCY, token, async ({ machine, datePath, dateStr }) => {
    if (token.cancelled) return
    sendProgress(machine, dateStr)

    try {
      const subFolders = await readdirWithTimeout(datePath, { withFileTypes: true })

      for (const sub of subFolders) {
        if (token.cancelled) break
        if (!sub.isDirectory()) continue

        const isErrorFolder = sub.name.toLowerCase() === MR_FAIL_FOLDER

        // Only scan folders matching the active toggles
        if (isErrorFolder && !request.mrFail) continue
        if (!isErrorFolder && !request.mrPass) continue

        const subPath = join(datePath, sub.name)

        try {
          const files = await readdirWithTimeout(subPath, { withFileTypes: true })
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
        } catch (err) {
          // Subfolder not accessible
          ctx.scanErrors++
          ctx.scanErrorDetails.push(`MR ${machine}/${dateStr}/${sub.name}: ${errorMessage(err)}`)
        }
      }
    } catch (err) {
      // Date folder not accessible
      ctx.scanErrors++
      ctx.scanErrorDetails.push(`MR ${machine}/${dateStr}: ${errorMessage(err)}`)
    }

    foldersScanned.value++
  })

  return buildResult(matches, request.imeis, foundIMEIs, startTime, foldersScanned.value, ctx.scanErrors, token, onProgress, ctx.scanErrorDetails, ctx.scanIndexFiltered)
}

interface FileCountResult {
  bmp: number
  jpeg: number
  other: number
  /** Brand-Model extracted from SG-*.png filename, e.g. "Apple-iPhone13Pro" */
  modelName: string | null
  /** M10: true when the folder could not be read (distinguishes from empty). */
  error?: boolean
}

async function countFiles(folderPath: string): Promise<FileCountResult> {
  const counts: FileCountResult = { bmp: 0, jpeg: 0, other: 0, modelName: null }

  try {
    await countFilesRecursive(folderPath, counts)
  } catch {
    // M10: Signal unreadable folder so UI can distinguish from empty
    counts.error = true
  }

  return counts
}

/** H5/M3: Recursively count files in subdirectories (especially FD/) so AI Images mode shows accurate counts. */
async function countFilesRecursive(dirPath: string, counts: FileCountResult): Promise<void> {
  const entries = await readdirWithTimeout(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Recurse into subdirectories (e.g. FD/)
      try {
        await countFilesRecursive(join(dirPath, entry.name), counts)
      } catch {
        // Subdirectory not readable — skip but continue counting other entries
      }
      continue
    }

    if (!entry.isFile()) continue
    const name = entry.name
    const lower = name.toLowerCase()

    if (lower.endsWith('.bmp')) {
      counts.bmp++
    } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      counts.jpeg++
    } else {
      counts.other++
    }

    // Detect MR image (SG-*.png) and extract Brand-Model
    if (!counts.modelName && lower.startsWith('sg-') && lower.endsWith('.png')) {
      const model = extractModelFromMRFilename(name)
      if (model) counts.modelName = model
    }
  }
}

/**
 * Extract Brand-Model from an MR image filename.
 * Format: SG-{machine}-{code}-{IMEI}-{Brand}-{Model}.png
 * Returns e.g. "Apple-iPhone13Pro" or null if unparseable.
 */
function extractModelFromMRFilename(fileName: string): string | null {
  const segments = fileName.replace(/\.png$/i, '').split('-')
  // SG, machine, code, IMEI, ...Brand-Model parts
  if (segments.length < 6) return null
  // Segment 3 must be 15-digit IMEI
  if (!IMEI_REGEX.test(segments[3])) return null
  // Everything after the IMEI is Brand-Model (rejoin in case of extra hyphens)
  // L8: Sanitize path separators and ".." to prevent path traversal in export
  const model = segments.slice(4).join('-')
  return model.replace(/[/\\]/g, '_').replace(/\.\./g, '_')
}

/** Extract a safe error message from an unknown catch value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
