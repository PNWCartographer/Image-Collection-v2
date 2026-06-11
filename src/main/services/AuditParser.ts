import { readFile } from 'fs/promises'
import { parse as csvParse } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import { basename, extname } from 'path'
import type { AuditParseResult, AuditHint, HintDetectionMeta } from '../../shared/types'
import { IMEI_REGEX, DATE_FOLDER_REGEX } from '../../shared/utils'

/** Max time to wait for a file read before assuming OneDrive is still hydrating it. */
const READFILE_TIMEOUT_MS = 20_000

/**
 * Read a file with a timeout. OneDrive "Files On-Demand" placeholders can block
 * the read indefinitely while the file downloads; surface a clear, retryable
 * error (AUDIT_FILE_DOWNLOADING) instead of hanging the parse forever.
 */
function withReadTimeout<T>(read: Promise<T>): Promise<T> {
  return Promise.race([
    read,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AUDIT_FILE_DOWNLOADING')), READFILE_TIMEOUT_MS)
    )
  ])
}

// ── Format detection ───────────────────────────────────────────────

function detectFormat(filePath: string): AuditParseResult['format'] {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.csv') return 'csv'
  if (ext === '.xlsx') return 'xlsx'
  if (ext === '.xls') return 'xls'
  if (ext === '.txt') return 'txt'
  return 'unknown'
}

// ── IMEI extraction ────────────────────────────────────────────────

/**
 * Normalize an IMEI cell so values written with separators still validate —
 * e.g. "35-998765-432109-8" or "359 987 654 321 098" → "359987654321098".
 * Clean 15-digit IMEIs (the common case) are returned unchanged. Scientific-
 * notation values from number-formatted Excel cells are recovered separately,
 * at parse time, from the raw cell value (see recoverScientificCells).
 */
function normalizeIMEI(raw: string): string {
  return raw.trim().replace(/[\s-]/g, '')
}

function extractIMEIs(values: string[]): Pick<AuditParseResult, 'validIMEIs' | 'invalidEntries' | 'duplicateCount'> {
  const validIMEIs: string[] = []
  const seen = new Set<string>()
  const invalidEntries: AuditParseResult['invalidEntries'] = []
  let duplicateCount = 0

  for (let i = 0; i < values.length; i++) {
    const raw = values[i].trim()
    if (!raw) continue
    const imei = normalizeIMEI(raw)

    if (!IMEI_REGEX.test(imei)) {
      const reason = imei.length !== 15 ? 'not_15_digits' : 'non_numeric'
      invalidEntries.push({ line: i + 1, value: raw, reason })
      continue
    }

    if (seen.has(imei)) {
      duplicateCount++
    } else {
      seen.add(imei)
      validIMEIs.push(imei)
    }
  }

  return { validIMEIs, invalidEntries, duplicateCount }
}

// ── Machine name normalization ─────────────────────────────────────

const MACHINE_PATTERNS: RegExp[] = [
  /^M-?0*(\d+)$/i,                  // M8, M08, M-8, M-08
  /^[A-Za-z]{1,10}[-_\s]M-?0*(\d+)$/i,  // SG-M16, LAX-M08, SG_M16, SG M16 (site prefix)
  /^Machine\s*(\d+)$/i,             // Machine 8, Machine08
  /^0*(\d{1,2})$/                   // 08, 8 (bare number, 1-2 digits only)
]

function normalizeMachine(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  for (const pattern of MACHINE_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) {
      const num = parseInt(match[1], 10)
      // Bare numbers (last pattern) must be in reasonable machine range 1-99
      // to avoid false positives from quantity/count columns
      if (pattern === MACHINE_PATTERNS[MACHINE_PATTERNS.length - 1] && (num < 1 || num > 99)) {
        continue
      }
      return `M${num}`
    }
  }
  return null
}

// ── Date normalization ─────────────────────────────────────────────

type DateOrder = 'MDY' | 'DMY'

function normalizeDate(raw: string, ambiguousOrder: DateOrder): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Strip time component if present (e.g., "5/14/26 11:57" → "5/14/26")
  const dateOnly = trimmed.split(/[\sT]+/)[0]

  // Excel serial date — a date stored as a plain number (e.g. 46180 = 2026-06-04),
  // which happens when a date cell is exported with a "General" number format.
  // Range-bounded (~2009–2064) so plain integers in other columns aren't misread.
  const serialMatch = dateOnly.match(/^(\d{5})(?:\.\d+)?$/)
  if (serialMatch) {
    const serial = parseInt(serialMatch[1], 10)
    if (serial >= 40000 && serial <= 60000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
      const y = dt.getUTCFullYear()
      if (y >= 2000 && y <= 2099) {
        return `${y}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`
      }
    }
  }

  // YYYYMMDD (no separators)
  if (DATE_FOLDER_REGEX.test(dateOnly)) {
    const y = parseInt(dateOnly.substring(0, 4), 10)
    const m = parseInt(dateOnly.substring(4, 6), 10)
    const d = parseInt(dateOnly.substring(6, 8), 10)
    if (y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return dateOnly
    }
    return null
  }

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = dateOnly.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (isoMatch) {
    const [, ys, ms, ds] = isoMatch
    const y = parseInt(ys, 10), m = parseInt(ms, 10), d = parseInt(ds, 10)
    if (y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${ys}${ms.padStart(2, '0')}${ds.padStart(2, '0')}`
    }
    return null
  }

  // MM/DD/YYYY or DD/MM/YYYY (4-digit year, resolved by ambiguousOrder)
  const ambigMatch = dateOnly.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (ambigMatch) {
    const [, p1, p2, ys] = ambigMatch
    const y = parseInt(ys, 10)
    if (y < 2000 || y > 2099) return null

    let m: number, d: number
    if (ambiguousOrder === 'MDY') {
      m = parseInt(p1, 10); d = parseInt(p2, 10)
    } else {
      d = parseInt(p1, 10); m = parseInt(p2, 10)
    }
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${ys}${m.toString().padStart(2, '0')}${d.toString().padStart(2, '0')}`
    }
    return null
  }

  // M/D/YY or MM/DD/YY or DD/MM/YY (2-digit year, resolved by ambiguousOrder)
  const shortYearMatch = dateOnly.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/)
  if (shortYearMatch) {
    const [, p1, p2, ys] = shortYearMatch
    const y = 2000 + parseInt(ys, 10)
    if (y < 2000 || y > 2099) return null

    let m: number, d: number
    if (ambiguousOrder === 'MDY') {
      m = parseInt(p1, 10); d = parseInt(p2, 10)
    } else {
      d = parseInt(p1, 10); m = parseInt(p2, 10)
    }
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}${m.toString().padStart(2, '0')}${d.toString().padStart(2, '0')}`
    }
    return null
  }

  return null
}

/**
 * Sample all date values in a column to disambiguate MM/DD/YYYY vs DD/MM/YYYY.
 * If any row has first number > 12, it must be DD/MM.
 * If any row has second number > 12, it must be MM/DD.
 * Default to MDY (US format) if fully ambiguous.
 */
function detectDateOrder(values: string[]): { order: DateOrder; ambiguous: boolean } {
  let mdyVotes = 0
  let dmyVotes = 0
  let ambiguousFormatSeen = false
  for (const raw of values) {
    const dateOnly = raw.trim().split(/[\sT]+/)[0]
    const match = dateOnly.match(/^(\d{1,2})[-/](\d{1,2})[-/]\d{2,4}$/)
    if (!match) continue
    ambiguousFormatSeen = true
    const first = parseInt(match[1], 10)
    const second = parseInt(match[2], 10)
    if (first > 12 && second <= 12) dmyVotes++
    else if (second > 12 && first <= 12) mdyVotes++
  }
  const order: DateOrder = dmyVotes > mdyVotes ? 'DMY' : 'MDY'
  // Ambiguous only when the column uses an M/D-style format but no value could
  // disambiguate it (every day ≤ 12) — then the MDY default is just an assumption.
  const ambiguous = ambiguousFormatSeen && mdyVotes === 0 && dmyVotes === 0
  return { order, ambiguous }
}

/** Human-readable label for the detected date format. */
function describeDateFormat(values: string[], order: DateOrder): string | null {
  for (const raw of values) {
    const dateOnly = raw.trim().split(/[\sT]+/)[0]
    if (DATE_FOLDER_REGEX.test(dateOnly)) return 'YYYYMMDD'
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(dateOnly)) {
      return dateOnly.includes('/') ? 'YYYY/MM/DD' : 'YYYY-MM-DD'
    }
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(dateOnly)) {
      const sep = dateOnly.includes('/') ? '/' : '-'
      return order === 'MDY' ? `MM${sep}DD${sep}YYYY` : `DD${sep}MM${sep}YYYY`
    }
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2}$/.test(dateOnly)) {
      const sep = dateOnly.includes('/') ? '/' : '-'
      return order === 'MDY' ? `M${sep}D${sep}YY` : `D${sep}M${sep}YY`
    }
  }
  return null
}

// ── Column detection ───────────────────────────────────────────────

/** Device-grade vocabulary — used to recognise an MR/CMC "fail list" audit. */
const GRADE_WORDS = /\b(wrong|pass|fail|error|mismatch|defect|reject|good)\b/i

/**
 * Reduce a "Brand-Model-Color" label (e.g. "Apple-iPhone11-Purple") to just the
 * device model ("Apple-iPhone11") by dropping the trailing color segment. Used
 * for Machine→Model organization of MR collection audits.
 */
function deviceModel(raw: string): string {
  const t = raw.trim()
  const parts = t.split('-')
  return parts.length >= 3 ? parts.slice(0, -1).join('-') : t
}

interface ColumnDetection {
  machineCol: number | null
  machineHeader: string | null
  dateCol: number | null
  dateHeader: string | null
  dateOrder: DateOrder
  dateFormatGuess: string | null
  modelCol: number | null
  modelHeader: string | null
  gradeCol: number | null
  gradeHeader: string | null
}

function detectHintColumns(rows: string[][], imeiCol: number, hasHeader: boolean): ColumnDetection {
  const result: ColumnDetection = {
    machineCol: null, machineHeader: null,
    dateCol: null, dateHeader: null,
    dateOrder: 'MDY', dateFormatGuess: null,
    modelCol: null, modelHeader: null,
    gradeCol: null, gradeHeader: null
  }

  if (rows.length === 0) return result

  const dataRows = rows.slice(hasHeader ? 1 : 0)
  const sampleRows = dataRows.slice(0, Math.min(30, dataRows.length))
  const numCols = Math.max(...rows.slice(0, 5).map((r) => r.length))

  let bestMachineCol = -1, bestMachineCount = 0
  let bestDateCol = -1, bestDateCount = 0

  for (let col = 0; col < numCols; col++) {
    if (col === imeiCol) continue

    let machineCount = 0
    let dateCount = 0
    for (const row of sampleRows) {
      const val = (row[col] || '').trim()
      if (!val) continue
      if (normalizeMachine(val) !== null) machineCount++
      if (normalizeDate(val, 'MDY') !== null) dateCount++
    }

    if (machineCount > bestMachineCount) {
      bestMachineCount = machineCount
      bestMachineCol = col
    }
    if (dateCount > bestDateCount) {
      bestDateCount = dateCount
      bestDateCol = col
    }
  }

  // Require at least 50% of sample rows to match for positive detection
  const threshold = Math.max(1, Math.floor(sampleRows.length * 0.5))

  if (bestMachineCount >= threshold && bestMachineCol !== -1) {
    result.machineCol = bestMachineCol
    result.machineHeader = hasHeader ? (rows[0][bestMachineCol] || '').trim() || null : null
  }

  if (bestDateCount >= threshold && bestDateCol !== -1) {
    result.dateCol = bestDateCol
    result.dateHeader = hasHeader ? (rows[0][bestDateCol] || '').trim() || null : null
    // Disambiguate date format using all data rows
    const allDateValues = dataRows.map((r) => (r[result.dateCol!] || '').trim())
    const orderResult = detectDateOrder(allDateValues)
    result.dateOrder = orderResult.order
    result.dateFormatGuess = describeDateFormat(allDateValues, orderResult.order)
    // Flag an undecidable M/D vs D/M so the UI shows the order was assumed.
    if (orderResult.ambiguous && result.dateFormatGuess) {
      result.dateFormatGuess += orderResult.order === 'MDY' ? ' — MDY assumed' : ' — DMY assumed'
    }
  }

  // ── Model + Grade columns ──
  // A grade column (e.g. "Grade-D2C" = "Wrong Color") marks this as an MR
  // collection audit (auto-enables MR mode). A model column ("Model") drives
  // Machine→Model organization. Both are header-driven; grade falls back to a
  // content check so a "fail list" without a grade header is still recognised.
  const headerOf = (col: number): string | null =>
    hasHeader ? ((rows[0][col] || '').trim() || null) : null

  for (let col = 0; col < numCols; col++) {
    if (col === imeiCol || col === result.machineCol || col === result.dateCol) continue
    const h = hasHeader ? (rows[0][col] || '').trim().toLowerCase() : ''
    if (result.modelCol === null && h.includes('model')) {
      result.modelCol = col
      result.modelHeader = headerOf(col)
    }
    if (result.gradeCol === null && h.includes('grade')) {
      result.gradeCol = col
      result.gradeHeader = headerOf(col)
    }
  }

  // Content fallback for grade when there's no "grade" header
  if (result.gradeCol === null) {
    let bestGradeCol = -1
    let bestGradeCount = 0
    for (let col = 0; col < numCols; col++) {
      if (col === imeiCol || col === result.machineCol || col === result.dateCol || col === result.modelCol) continue
      let gradeCount = 0
      for (const row of sampleRows) {
        const val = (row[col] || '').trim()
        if (val && GRADE_WORDS.test(val)) gradeCount++
      }
      if (gradeCount > bestGradeCount) {
        bestGradeCount = gradeCount
        bestGradeCol = col
      }
    }
    if (bestGradeCount >= threshold && bestGradeCol !== -1) {
      result.gradeCol = bestGradeCol
      result.gradeHeader = headerOf(bestGradeCol)
    }
  }

  return result
}

// ── Build per-IMEI hints from detected columns ─────────────────────

interface HintBuildResult {
  hints: Record<string, AuditHint>
  meta: HintDetectionMeta
}

function buildHints(
  rows: string[][],
  imeiCol: number,
  hasHeader: boolean,
  detection: ColumnDetection
): HintBuildResult {
  const hints: Record<string, AuditHint> = {}
  let machineValidCount = 0
  let dateValidCount = 0
  const dataRows = rows.slice(hasHeader ? 1 : 0)

  for (const row of dataRows) {
    const imei = normalizeIMEI(row[imeiCol] || '')
    if (!IMEI_REGEX.test(imei)) continue

    const hint: AuditHint = {}

    if (detection.machineCol !== null) {
      const rawMachine = (row[detection.machineCol] || '').trim()
      const normalized = normalizeMachine(rawMachine)
      if (normalized) {
        hint.machine = normalized
        machineValidCount++
      }
    }

    if (detection.dateCol !== null) {
      const rawDate = (row[detection.dateCol] || '').trim()
      const normalized = normalizeDate(rawDate, detection.dateOrder)
      if (normalized) {
        hint.date = normalized
        dateValidCount++
      }
    }

    if (detection.modelCol !== null) {
      const rawModel = (row[detection.modelCol] || '').trim()
      if (rawModel) hint.model = deviceModel(rawModel)
    }

    if (hint.machine || hint.date || hint.model) {
      // For duplicate IMEIs (re-tested devices) keep the MOST RECENT by date.
      // Dates are YYYYMMDD so string comparison gives chronological order.
      const existing = hints[imei]
      if (!existing || (hint.date && (!existing.date || hint.date > existing.date))) {
        hints[imei] = hint
      }
    }
  }

  return {
    hints,
    meta: {
      machineColumn: detection.machineHeader,
      dateColumn: detection.dateHeader,
      machineValidCount,
      dateValidCount,
      totalHintedRows: dataRows.length,
      dateFormatGuess: detection.dateFormatGuess
    }
  }
}

// ── File parsers (return full row data for hint detection) ──────────

function findIMEIColumn(rows: string[][]): number {
  if (rows.length === 0) return 0

  const sampleRows = rows.slice(0, Math.min(20, rows.length))
  let bestCol = 0
  let bestCount = 0

  const numCols = Math.max(...sampleRows.map((r) => r.length))
  for (let col = 0; col < numCols; col++) {
    let count = 0
    for (const row of sampleRows) {
      if (IMEI_REGEX.test(normalizeIMEI(row[col] || ''))) count++
    }
    if (count > bestCount) {
      bestCount = count
      bestCol = col
    }
  }

  return bestCol
}

/** Column-header keywords — mark a row as a header even when a cell looks like data. */
const HEADER_WORDS = /\b(imei|machine|date|model|grade|serial|sn|esn|meid)\b/i

/** True when a row looks like a header (contains a known column keyword). */
function looksLikeHeaderRow(row: string[]): boolean {
  return row.some((cell) => HEADER_WORDS.test(cell || ''))
}

interface ParsedRows {
  rows: string[][]
  imeiCol: number
  hasHeader: boolean
}

/**
 * Decode a text-file buffer, honouring a UTF-16 (LE/BE) or UTF-8 byte-order
 * mark. Without this a UTF-16-encoded CSV/TXT (e.g. Excel "Unicode Text" export)
 * would be read as garbled UTF-8 and lose every row.
 */
function decodeTextBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2)
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3)
  return buf.toString('utf8')
}

/**
 * Replace cells Excel rendered in scientific notation (e.g. a 15-digit IMEI
 * stored as a number → "3.50308E+14") with their full-precision raw integer
 * value — recoverable because a 15-digit integer is exact in JS (< 2^53). Runs
 * before column detection / IMEI extraction so those values aren't lost. Only
 * cells that ARE scientific notation with a numeric raw value are touched.
 */
function recoverScientificCells(rows: string[][], rowsRaw: unknown[][]): void {
  const SCI = /^\s*-?\d[.,]?\d*[eE][+-]?\d+\s*$/
  for (let r = 0; r < rows.length; r++) {
    const rawRow = rowsRaw[r]
    if (!rawRow) continue
    const row = rows[r]
    for (let c = 0; c < row.length; c++) {
      if (typeof row[c] === 'string' && SCI.test(row[c])) {
        const rawVal = rawRow[c]
        if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
          row[c] = String(Math.round(rawVal))
        }
      }
    }
  }
}

async function parseCSV(filePath: string): Promise<ParsedRows> {
  const content = decodeTextBuffer(await withReadTimeout(readFile(filePath)))

  let records: string[][]
  try {
    records = csvParse(content, {
      relax_column_count: true,
      skip_empty_lines: true
    })
  } catch {
    records = content
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => line.split(/[,\t;]/))
  }

  if (records.length === 0) return { rows: [], imeiCol: 0, hasHeader: false }

  const col = findIMEIColumn(records)
  const firstRow = records[0]
  const firstVal = (firstRow[col] || '').trim()
  const hasHeader = looksLikeHeaderRow(firstRow) || !IMEI_REGEX.test(normalizeIMEI(firstVal))

  return { rows: records, imeiCol: col, hasHeader }
}

/**
 * Choose the worksheet most likely to hold the IMEI list — the one with the most
 * IMEI-matching cells in its first rows. Falls back to the first sheet. Keeps the
 * parser single-sheet (no concatenation) while preventing silent data loss when a
 * template puts a cover/notes sheet before the data sheet.
 */
function pickBestSheet(workbook: XLSX.WorkBook): string {
  const names = workbook.SheetNames
  if (names.length <= 1) return names[0]
  let bestName = names[0]
  let bestCount = -1
  for (const name of names) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
    const rowsRaw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
    recoverScientificCells(rows, rowsRaw)
    let count = 0
    for (const row of rows.slice(0, 50)) {
      if (row.some((cell) => IMEI_REGEX.test(normalizeIMEI(String(cell || ''))))) count++
    }
    if (count > bestCount) {
      bestCount = count
      bestName = name
    }
  }
  return bestName
}

async function parseExcel(filePath: string): Promise<ParsedRows> {
  const buffer = await withReadTimeout(readFile(filePath))
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  // Pick the worksheet with the most IMEI-looking cells — guards against a cover
  // or notes sheet preceding the data sheet (taking sheet 0 blindly would silently
  // drop every IMEI on the real sheet).
  const sheetName = pickBestSheet(workbook)
  const sheet = workbook.Sheets[sheetName]
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  const rowsRaw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
  // Recover IMEIs (and other long IDs) Excel rendered in scientific notation.
  recoverScientificCells(rows, rowsRaw)

  if (rows.length === 0) return { rows: [], imeiCol: 0, hasHeader: false }

  const col = findIMEIColumn(rows)
  const firstRow = rows[0]
  const firstVal = (firstRow[col] || '').trim()
  const hasHeader = looksLikeHeaderRow(firstRow) || !IMEI_REGEX.test(normalizeIMEI(firstVal))

  return { rows, imeiCol: col, hasHeader }
}

async function parseTXT(filePath: string): Promise<ParsedRows> {
  const content = decodeTextBuffer(await withReadTimeout(readFile(filePath)))
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return { rows: lines.map((l) => [l]), imeiCol: 0, hasHeader: false }
}

// ── Main entry point ───────────────────────────────────────────────

export async function parseAuditFile(filePath: string): Promise<AuditParseResult> {
  const format = detectFormat(filePath)
  const fileName = basename(filePath)

  let parsed: ParsedRows
  switch (format) {
    case 'csv':
      parsed = await parseCSV(filePath)
      break
    case 'xlsx':
    case 'xls':
      parsed = await parseExcel(filePath)
      break
    case 'txt':
      parsed = await parseTXT(filePath)
      break
    default:
      throw new Error(`Unsupported file format: ${extname(filePath)}`)
  }

  // Extract IMEI values from the detected column
  const dataRows = parsed.rows.slice(parsed.hasHeader ? 1 : 0)
  const rawValues = dataRows.map((row) => (row[parsed.imeiCol] || '').trim())
  const { validIMEIs, invalidEntries, duplicateCount } = extractIMEIs(rawValues)

  // Detect hint columns (machine, date, model, grade) — only for multi-column formats
  const detection = detectHintColumns(parsed.rows, parsed.imeiCol, parsed.hasHeader)
  const hasHints =
    detection.machineCol !== null || detection.dateCol !== null ||
    detection.modelCol !== null || detection.gradeCol !== null

  let hints: Record<string, AuditHint> | undefined
  let hintMeta: HintDetectionMeta | undefined

  if (hasHints) {
    const hintResult = buildHints(parsed.rows, parsed.imeiCol, parsed.hasHeader, detection)
    hints = hintResult.hints
    hintMeta = hintResult.meta
  }

  // A detected grade column means this is an MR-collection "fail list" (e.g.
  // Wrong Color) — the app uses this to auto-enable MR collection.
  const isMRAudit = detection.gradeCol !== null

  return {
    format,
    filePath,
    fileName,
    totalRows: rawValues.length,
    validIMEIs,
    invalidEntries,
    duplicateCount,
    hints,
    hintMeta,
    isMRAudit
  }
}
