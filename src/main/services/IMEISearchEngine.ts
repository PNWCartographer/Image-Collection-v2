import { readdir } from 'fs/promises'
import { join, basename } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { SearchRequest, SearchMatch, SearchProgress, SearchResult, AuditHint } from '../../shared/types'
import { PROGRESS_THROTTLE_MS, IMEI_REGEX, DATE_FOLDER_REGEX } from '../../shared/utils'
import { pooled, type CancelToken } from '../../shared/pool'
import { createSearchLogger, RotatingLogger } from './Logger'

const execFileAsync = promisify(execFile)

/** Concurrency for server-side `dir` lookups — modest, to avoid a process storm. */
const DIR_LOOKUP_CONCURRENCY = 16
/** Concurrency for direct per-IMEI folder reads — exact paths to tiny folders. */
const MR_DIRECT_CONCURRENCY = 16
/** Timeout for a single server-side `dir` lookup (server-side filter is fast). */
const DIR_TIMEOUT_MS = 30_000
/** Matches an IMEI_index folder name: 15 digits, underscore, integer. */
const IMEI_FOLDER_PATTERN = /^(\d{15})_(\d+)$/
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
 * List entry NAMES only (no withFileTypes). Over SMB this avoids a per-entry
 * stat, so it is dramatically faster on large directories (a date folder can
 * hold thousands of IMEI subfolders). Callers recognise IMEI folders by name
 * pattern instead of by directory type.
 */
async function readdirNamesWithTimeout(dirPath: string): Promise<string[]> {
  return Promise.race([
    readdir(dirPath),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`readdir timed out after ${READDIR_TIMEOUT_MS}ms: ${dirPath}`)), READDIR_TIMEOUT_MS)
    )
  ])
}

/**
 * Find IMEI subfolders in a date folder by SERVER-SIDE filtered listing:
 * `cmd /c dir /b /a:d {datePath}\{IMEI}_*`. Over SMB the wildcard is applied on
 * the NAS, so only matching folders are returned WITHOUT enumerating the date
 * folder — which can hold many thousands of IMEI subfolders and otherwise times
 * out on a plain readdir. Returns matched folder names (e.g. "350...534_539").
 *
 * Crucially this runs in a child process, so a slow NAS does not pin Node's fs
 * thread pool (the orphaned readdir problem that also made the UI lag).
 */
async function findMatchingIMEIFolders(datePath: string, imeis: string[]): Promise<string[]> {
  if (imeis.length === 0) return []

  if (process.platform !== 'win32') {
    // Non-Windows fallback (dev/test only — the app ships Windows-only): full listing.
    const names = await readdirNamesWithTimeout(datePath)
    const want = new Set(imeis)
    return names.filter((n) => {
      const m = IMEI_FOLDER_PATTERN.exec(n)
      return !!m && want.has(m[1])
    })
  }

  // IMEIs are validated 15-digit numbers, so the patterns are injection-safe.
  // Batch the patterns to stay well under the ~8191-char command-line limit.
  const BATCH = 60
  const out: string[] = []
  for (let i = 0; i < imeis.length; i += BATCH) {
    const patterns = imeis.slice(i, i + BATCH).map((im) => join(datePath, `${im}_*`))
    let stdout = ''
    try {
      const res = await execFileAsync('cmd', ['/d', '/c', 'dir', '/b', '/a:d', ...patterns], {
        timeout: DIR_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      })
      stdout = res.stdout
    } catch (err) {
      const e = err as { stdout?: string; killed?: boolean }
      if (e.killed) throw new Error(`dir timed out after ${DIR_TIMEOUT_MS}ms: ${datePath}`)
      // `dir` exits non-zero when some/all patterns match nothing — any matches are
      // still on stdout, so read them rather than treating this as an error.
      stdout = typeof e.stdout === 'string' ? e.stdout : ''
    }
    for (const line of stdout.split(/\r?\n/)) {
      const name = basename(line.trim())
      if (IMEI_FOLDER_PATTERN.test(name)) out.push(name)
    }
  }
  return out
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
): Promise<{ pending: PendingMatch[]; filteredCount: number; entryCount: number }> {
  // Names-only listing — IMEI folders are recognised by their `{15digits}_{n}`
  // name pattern, so we don't need (slow) per-entry directory-type stats.
  const names = await readdirNamesWithTimeout(datePath)
  const pending: PendingMatch[] = []
  let filteredCount = 0
  for (const name of names) {
    const parsed = parseIMEIFolder(name)
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
        folderName: name,
        folderPath: join(datePath, name)
      })
    }
  }
  return { pending, filteredCount, entryCount: names.length }
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
  const { token, matches, logger } = ctx
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

  await pooled(lookupEntries, DIR_LOOKUP_CONCURRENCY, token, async ([key, imeisInFolder]) => {
    if (token.cancelled) return

    const [machine, dateStr] = key.split('/')
    const datePath = join(request.rootPath, machine, dateStr)

    const t0 = Date.now()
    try {
      // Server-side filtered lookup — finds each IMEI's folder without enumerating
      // the (potentially enormous) date folder. No broad-scan fallback on error:
      // a failure here just leaves those IMEIs missing, with the error logged.
      const matchedNames = await findMatchingIMEIFolders(datePath, imeisInFolder)
      const want = new Set(imeisInFolder)
      const pending: PendingMatch[] = []
      for (const name of matchedNames) {
        const parsed = parseIMEIFolder(name)
        if (!parsed || !want.has(parsed.imei)) continue
        if (request.scanIndexFilter === 'first_only' && parsed.scanIndex !== 1) {
          ctx.scanIndexFiltered++
          continue
        }
        pending.push({ imei: parsed.imei, scanIndex: parsed.scanIndex, folderName: name, folderPath: join(datePath, name) })
      }
      const dt = Date.now() - t0
      if (dt > 3000) {
        logger.info(`  ${machine}/${dateStr}: ${matchedNames.length} matched, ${dt}ms`)
      }
      if (pending.length > 0 && !token.cancelled) {
        await buildMatchBatch(pending, machine, dateStr, ctx, onMatches)
      }
    } catch (err) {
      if (!isBenignDirError(err)) {
        ctx.scanErrors++
        ctx.scanErrorDetails.push(`${machine}/${dateStr} (${Date.now() - t0}ms): ${errorMessage(err)}`)
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
      const names = await readdirNamesWithTimeout(machinePath)

      for (const name of names) {
        if (!DATE_FOLDER_REGEX.test(name)) continue
        if (SKIP_FOLDERS.has(name.toLowerCase())) continue
        if (!isDateInRange(name, request)) continue

        dateFolders.push({
          machine: folderName,
          datePath: join(machinePath, name),
          dateStr: name
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

// ── MR direct collection ───────────────────────────────────────────

interface HintedTarget {
  imei: string
  machine: string
  date: string
  model?: string
}

/** Build per-IMEI exact-path targets from machine+date hints (within range + selected). */
function buildHintedTargets(request: SearchRequest): {
  targets: HintedTarget[]
  droppedNoHint: number
  droppedMachine: number
  droppedDate: number
} {
  const hints = request.hints!
  const selectedSet = new Set(request.selectedFolders)
  const targets: HintedTarget[] = []
  let droppedNoHint = 0
  let droppedMachine = 0
  let droppedDate = 0
  for (const imei of request.imeis) {
    const hint = hints[imei]
    if (!hint?.machine || !hint?.date) { droppedNoHint++; continue }
    if (!selectedSet.has(hint.machine)) { droppedMachine++; continue }
    if (!isDateInRange(hint.date, request)) { droppedDate++; continue }
    targets.push({ imei, machine: hint.machine, date: hint.date, model: hint.model })
  }
  return { targets, droppedNoHint, droppedMachine, droppedDate }
}

/**
 * Open each target's EXACT folder Machine/{date}/{IMEI}/ and take the .png inside.
 * The folder name is the bare IMEI (no scan-index suffix) — how wrong-color / MR
 * upload devices are stored. Opening a known path never enumerates the (enormous)
 * parent date folder, so it's fast regardless of folder size and immune to the
 * concurrency saturation that times out directory listings. Already-found IMEIs
 * are skipped, so this also serves as a probe ahead of standard enumeration.
 */
async function collectMRDirect(
  request: SearchRequest,
  targets: HintedTarget[],
  ctx: SearchContext,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void
): Promise<void> {
  const { token, matches, foundIMEIs } = ctx
  const total = targets.length
  let done = 0

  await pooled(targets, MR_DIRECT_CONCURRENCY, token, async (t) => {
    if (token.cancelled) return
    if (foundIMEIs.has(t.imei)) { done++; return }
    const folderPath = join(request.rootPath, t.machine, t.date, t.imei)
    const started = Date.now()
    try {
      const files = await readdirWithTimeout(folderPath, { withFileTypes: true })
      const png = files.find((f) => f.isFile() && f.name.toLowerCase().endsWith('.png'))
      if (png) {
        const match: SearchMatch = {
          imei: t.imei,
          machineName: t.machine,
          date: t.date,
          scanIndex: 0,
          folderName: png.name,
          sourcePath: join(folderPath, png.name),
          bmpCount: 0,
          jpegCount: 0,
          otherCount: 1,
          totalFiles: 1,
          matchType: 'mr-pass',
          mrFolder: t.model,
          modelName: t.model
        }
        matches.push(match)
        foundIMEIs.add(t.imei)
        onMatches([match])
      } else {
        // Folder exists but holds no .png image
        ctx.noMRImage++
      }
    } catch (err) {
      // ENOENT just means this device has no {IMEI} folder under this machine/date.
      if (!isBenignDirError(err)) {
        ctx.scanErrors++
        ctx.scanErrorDetails.push(`${t.machine}/${t.date}/${t.imei} (${Date.now() - started}ms): ${errorMessage(err)}`)
      }
    }

    done++
    const now = Date.now()
    if (now - ctx.startTime > PROGRESS_THROTTLE_MS * done || done === total) {
      onProgress({
        phase: 'scanning',
        percent: total > 0 ? (done / total) * 100 : 0,
        currentMachine: t.machine,
        currentDate: t.date,
        matchesSoFar: matches.length,
        foldersScanned: done,
        totalFolders: total
      })
    }
  })
}

/** MR collection: open each device's exact IMEI folder and take its image. */
async function searchMRDirect(
  request: SearchRequest,
  ctx: SearchContext,
  onProgress: (progress: SearchProgress) => void,
  onMatches: (matches: SearchMatch[]) => void
): Promise<SearchResult> {
  const { targets, droppedNoHint, droppedMachine, droppedDate } = buildHintedTargets(request)
  ctx.logger.info(`MR direct: opening ${targets.length} device folders (dropped: noHint=${droppedNoHint}, machineNotSelected=${droppedMachine}, dateOutOfRange=${droppedDate})`)
  await collectMRDirect(request, targets, ctx, onProgress, onMatches)
  return buildResult(ctx, request.imeis, targets.length, onProgress)
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
    ctx.logger.info('MR collection: opening each device folder Machine/{date}/{IMEI}/ by exact path and taking its image (no directory listing, no ModelRecogImages scan)')
  }

  // MR mode with hints: open each device's folder by its exact path — instant,
  // no enumeration of the (huge) date folder, no wildcard, no concurrency storm.
  if (mrMode && request.smartSearch && request.hints && Object.keys(request.hints).length > 0) {
    return searchMRDirect(request, ctx, onProgress, onMatches)
  }

  // Smart Search: targeted lookups when audit file had machine + date columns
  if (request.smartSearch && request.hints && Object.keys(request.hints).length > 0) {
    // Bulletproofing: a universal exact-path probe first. Devices stored as a bare
    // {IMEI} folder (wrong-color / MR uploads) are found here instantly — so they're
    // collected even if the operator never enabled MR and the audit had no grade
    // column to auto-enable it. Type A ({IMEI}_index) devices aren't here (fast
    // ENOENT) and fall through to the standard enumeration below.
    const { targets: probeTargets } = buildHintedTargets(request)
    ctx.logger.info(`Exact-path probe: checking ${probeTargets.length} {IMEI} folders before enumeration`)
    await collectMRDirect(request, probeTargets, ctx, onProgress, onMatches)
    if (token.cancelled) {
      return buildResult(ctx, request.imeis, probeTargets.length, onProgress)
    }

    // Standard enumeration only for IMEIs the probe didn't find (Type A {IMEI}_index)
    const unfoundImeis = request.imeis.filter((i) => !foundIMEIs.has(i))
    if (unfoundImeis.length === 0) {
      ctx.logger.info('Exact-path probe found every hinted device — skipping enumeration')
      return buildResult(ctx, request.imeis, probeTargets.length, onProgress)
    }
    const stdRequest: SearchRequest = { ...request, imeis: unfoundImeis }

    const { searched: directSearched, fallbackImeis, machineOnlyGroups } = await searchTargeted(
      stdRequest, ctx, onProgress, onMatches
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
