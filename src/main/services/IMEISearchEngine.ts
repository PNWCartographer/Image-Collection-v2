import { readdir } from 'fs/promises'
import { join } from 'path'
import type { SearchRequest, SearchMatch, SearchProgress, SearchResult, AuditHint } from '../../shared/types'
import { PROGRESS_THROTTLE_MS, IMEI_REGEX, DATE_FOLDER_REGEX } from '../../shared/utils'
import { pooled, type CancelToken } from '../../shared/pool'
import { createSearchLogger, RotatingLogger } from './Logger'
const MR_ROOT = 'modelrecogimages'
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

/**
 * A missing or non-directory path is expected during discovery — it means
 * "nothing here", not a real failure. Real failures (permission, timeout,
 * network) are still surfaced as scan errors.
 */
function isBenignDirError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
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
  /**
   * MR mode: collect only the SG-*.png Model Recognition image from each IMEI
   * folder (the same image the AI captured) instead of the full folder. This
   * reuses the fast IMEI-folder lookup — ModelRecogImages model folders are far
   * too large to enumerate over SMB, but the SG-*.png also lives in the IMEI
   * folder alongside the scan images.
   */
  mrMode: boolean
  /** MR mode: number of matched IMEI folders that had no SG-*.png. */
  noMRImage: number
  /** Diagnostic log for this search (no-op if logging unavailable). */
  logger: RotatingLogger
}

async function createSearchContext(imeis: string[], logsDir?: string, mrMode = false): Promise<SearchContext> {
  // Cancel any in-flight search before starting a new one
  activeToken.cancelled = true
  const token = { cancelled: false }
  activeToken = token
  const logger = logsDir ? await createSearchLogger(logsDir) : new RotatingLogger(null, '')
  return {
    token,
    startTime: Date.now(),
    imeiSet: new Set(imeis),
    matches: [],
    foundIMEIs: new Set<string>(),
    scanErrors: 0,
    scanErrorDetails: [],
    scanIndexFiltered: 0,
    mrMode,
    noMRImage: 0,
    logger
  }
}

/** Write the standard start-of-search header to the diagnostic log. */
function logSearchHeader(logger: RotatingLogger, request: SearchRequest, mode: 'standard' | 'MR'): void {
  logger.info('===== SEARCH STARTED =====')
  logger.info(`Mode: ${mode}   IMEIs: ${request.imeis.length}   Hints: ${request.hints ? Object.keys(request.hints).length : 0}   SmartSearch: ${!!request.smartSearch}`)
  logger.info(`MR PASS/FAIL: ${!!request.mrPass}/${!!request.mrFail}   ScanIndex: ${request.scanIndexFilter}`)
  logger.info(`Date range: ${request.dateStart || '(none)'} .. ${request.dateEnd || '(none)'}`)
  logger.info(`Folders (${request.selectedFolders.length}): ${request.selectedFolders.join(',')}`)
  logger.info(`Root: ${request.rootPath}`)
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

    if (ctx.mrMode) {
      // MR mode: emit a match for the SG-*.png MR image inside this IMEI folder.
      if (!fc.mrImagePath || !fc.mrImageName) {
        ctx.noMRImage++
        continue
      }
      const isFail = !!fc.modelName && /error[-_]?error/i.test(fc.modelName)
      const match: SearchMatch = {
        imei: m.imei,
        machineName: machine,
        date: dateStr,
        scanIndex: m.scanIndex,
        folderName: fc.mrImageName,
        sourcePath: fc.mrImagePath,
        bmpCount: 0,
        jpegCount: 0,
        otherCount: 1,
        totalFiles: 1,
        matchType: isFail ? 'mr-fail' : 'mr-pass',
        mrFolder: fc.modelName ?? undefined,
        modelName: fc.modelName ?? undefined
      }
      ctx.matches.push(match)
      batch.push(match)
      ctx.foundIMEIs.add(m.imei)
      continue
    }

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
  const { token, matches, foundIMEIs, logger } = ctx
  const hints = request.hints!
  const selectedSet = new Set(request.selectedFolders)

  // Group hints by machine+date for efficient batch lookups
  const directLookups = new Map<string, string[]>()
  const fallbackImeis: string[] = []

  // Partial hints: machine-only → narrow broad scan to one machine per IMEI
  // Group by machine for a constrained broad scan
  const machineOnlyGroups = new Map<string, string[]>()

  let droppedMachineNotSelected = 0
  let droppedDateOutOfRange = 0

  for (const imei of request.imeis) {
    const hint: AuditHint | undefined = hints[imei]

    if (hint?.machine && hint?.date) {
      // Full hint — direct lookup
      if (!selectedSet.has(hint.machine)) { fallbackImeis.push(imei); droppedMachineNotSelected++; continue }
      if (!isDateInRange(hint.date, request)) { fallbackImeis.push(imei); droppedDateOutOfRange++; continue }
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

  logger.info(`Targeted: directLookups=${totalLookups}  machineOnly=${machineOnlyGroups.size}  fallback=${fallbackImeis.length}  (dropped: machineNotSelected=${droppedMachineNotSelected}, dateOutOfRange=${droppedDateOutOfRange})`)

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
      if (!isBenignDirError(err)) {
        ctx.scanErrors++
        ctx.scanErrorDetails.push(`${machine}/${dateStr}: ${errorMessage(err)}`)
      }
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
  const { token, imeiSet, matches, logger } = ctx

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
      if (!isBenignDirError(err)) {
        ctx.scanErrors++
        ctx.scanErrorDetails.push(`${folderName}: ${errorMessage(err)}`)
      }
    }
  })

  if (token.cancelled) return 0

  logger.info(`Broad scan: discovered ${dateFolders.length} date folders across ${request.selectedFolders.length} machines`)

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
      if (!isBenignDirError(err)) {
        ctx.scanErrors++
        ctx.scanErrorDetails.push(`${machine}/${dateStr}: ${errorMessage(err)}`)
      }
    }

    foldersScanned.value++
  })

  return foldersScanned.value
}

// ── Main search dispatcher ─────────────────────────────────────────

export async function searchIMEIs(
  request: SearchRequest,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void,
  logsDir?: string
): Promise<SearchResult> {
  // MR mode reuses the fast IMEI-folder search and pulls the SG-*.png out of
  // each folder (see SearchContext.mrMode) — it does NOT scan ModelRecogImages.
  const mrMode = !!(request.mrPass || request.mrFail)
  const ctx = await createSearchContext(request.imeis, logsDir, mrMode)
  const { token, foundIMEIs } = ctx

  logSearchHeader(ctx.logger, request, mrMode ? 'MR' : 'standard')
  if (mrMode) {
    ctx.logger.info('MR collection: locating each IMEI folder and extracting its SG-*.png (ModelRecogImages folders are NOT scanned — too large to enumerate)')
  }

  // Smart Search: targeted lookups when audit file had machine + date columns
  if (request.smartSearch && request.hints && Object.keys(request.hints).length > 0) {
    const { searched: directSearched, fallbackImeis, machineOnlyGroups } = await searchTargeted(
      request, ctx, onProgress, onMatches
    )

    if (token.cancelled) {
      return buildResult(ctx, request.imeis, directSearched, onProgress)
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
      return buildResult(ctx, request.imeis, totalScanned, onProgress)
    }

    // Full broad scan for remaining IMEIs without any usable hints
    ctx.imeiSet.clear()
    for (const imei of fallbackImeis) ctx.imeiSet.add(imei)

    ctx.logger.info(`Broad fallback: ${fallbackImeis.length} IMEIs without usable hints -> full scan`)

    const fallbackRequest: SearchRequest = {
      ...request,
      imeis: fallbackImeis,
      hints: undefined,
      smartSearch: false
    }

    const broadScanned = await searchBroad(fallbackRequest, ctx, onProgress, onMatches, 90)
    return buildResult(ctx, request.imeis, totalScanned + broadScanned, onProgress)
  }

  // Standard broad scan (no hints available)
  if (request.smartSearch) {
    ctx.logger.warn('Smart Search requested but no hints available — running full broad scan')
  }
  const scanned = await searchBroad(request, ctx, onProgress, onMatches)
  return buildResult(ctx, request.imeis, scanned, onProgress)
}

async function buildResult(
  ctx: SearchContext,
  allImeis: string[],
  foldersScanned: number,
  onProgress: (progress: SearchProgress) => void
): Promise<SearchResult> {
  const missingIMEIs = allImeis.filter((imei) => !ctx.foundIMEIs.has(imei))
  const elapsedMs = Date.now() - ctx.startTime

  onProgress({
    phase: ctx.token.cancelled ? 'cancelled' : 'complete',
    percent: 100,
    currentMachine: '',
    currentDate: '',
    matchesSoFar: ctx.matches.length,
    foldersScanned,
    totalFolders: foldersScanned
  })

  if (ctx.mrMode && ctx.noMRImage > 0) {
    ctx.logger.info(`MR: ${ctx.noMRImage} matched IMEI folder(s) had no SG-*.png MR image`)
  }
  if (ctx.scanErrorDetails.length > 0) {
    ctx.logger.warn(`Scan errors (${ctx.scanErrors}):`)
    for (const d of ctx.scanErrorDetails.slice(0, 50)) ctx.logger.warn(`  ${d}`)
  }
  ctx.logger.info('===== SEARCH COMPLETE =====')
  ctx.logger.info(`Matches: ${ctx.matches.length}   Missing: ${missingIMEIs.length}   FoldersScanned: ${foldersScanned}   ScanErrors: ${ctx.scanErrors}   Elapsed: ${elapsedMs}ms   Status: ${ctx.token.cancelled ? 'cancelled' : 'complete'}`)
  const logPath = ctx.logger.getLogPath()
  await ctx.logger.close()

  return {
    matches: ctx.matches,
    missingIMEIs,
    totalSearched: foldersScanned,
    scanErrors: ctx.scanErrors,
    elapsedMs,
    logPath,
    ...(ctx.scanErrorDetails.length > 0 ? { scanErrorDetails: ctx.scanErrorDetails } : {}),
    ...(ctx.scanIndexFiltered > 0 ? { scanIndexFiltered: ctx.scanIndexFiltered } : {})
  }
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

interface FileCountResult {
  bmp: number
  jpeg: number
  other: number
  /** Brand-Model extracted from SG-*.png filename, e.g. "Apple-iPhone13Pro" */
  modelName: string | null
  /** M10: true when the folder could not be read (distinguishes from empty). */
  error?: boolean
  /** MR mode: filename of the SG-*.png Model Recognition image in this folder. */
  mrImageName?: string
  /** MR mode: full path to the SG-*.png Model Recognition image. */
  mrImagePath?: string
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

    // Detect MR image (SG-*.png) — capture its name/path and Brand-Model.
    if (!counts.mrImageName && lower.startsWith('sg-') && lower.endsWith('.png')) {
      counts.mrImageName = name
      counts.mrImagePath = join(dirPath, name)
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
