import { readFile } from 'fs/promises'
import { parse as csvParse } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import { basename, extname } from 'path'
import type { AuditParseResult, AuditHint, HintDetectionMeta } from '../../shared/types'

const IMEI_REGEX = /^\d{15}$/

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

function extractIMEIs(values: string[]): Pick<AuditParseResult, 'validIMEIs' | 'invalidEntries' | 'duplicateCount'> {
  const validIMEIs: string[] = []
  const seen = new Set<string>()
  const invalidEntries: AuditParseResult['invalidEntries'] = []
  let duplicateCount = 0

  for (let i = 0; i < values.length; i++) {
    const raw = values[i].trim()
    if (!raw) continue

    if (!IMEI_REGEX.test(raw)) {
      const reason = raw.length !== 15 ? 'not_15_digits' : 'non_numeric'
      invalidEntries.push({ line: i + 1, value: raw, reason })
      continue
    }

    if (seen.has(raw)) {
      duplicateCount++
    } else {
      seen.add(raw)
      validIMEIs.push(raw)
    }
  }

  return { validIMEIs, invalidEntries, duplicateCount }
}

// ── Machine name normalization ─────────────────────────────────────

const MACHINE_PATTERNS: RegExp[] = [
  /^M-?0*(\d+)$/i,          // M8, M08, M-8, M-08
  /^Machine\s*(\d+)$/i,     // Machine 8, Machine08
  /^0*(\d+)$/                // 08, 8 (bare number)
]

function normalizeMachine(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  for (const pattern of MACHINE_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) {
      return `M${parseInt(match[1], 10)}`
    }
  }
  return null
}

// ── Date normalization ─────────────────────────────────────────────

type DateOrder = 'MDY' | 'DMY'

function normalizeDate(raw: string, ambiguousOrder: DateOrder): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // YYYYMMDD (no separators)
  if (/^\d{8}$/.test(trimmed)) {
    const y = parseInt(trimmed.substring(0, 4), 10)
    const m = parseInt(trimmed.substring(4, 6), 10)
    const d = parseInt(trimmed.substring(6, 8), 10)
    if (y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return trimmed
    }
    return null
  }

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (isoMatch) {
    const [, ys, ms, ds] = isoMatch
    const y = parseInt(ys, 10), m = parseInt(ms, 10), d = parseInt(ds, 10)
    if (y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${ys}${ms.padStart(2, '0')}${ds.padStart(2, '0')}`
    }
    return null
  }

  // Ambiguous: MM/DD/YYYY or DD/MM/YYYY (resolved by ambiguousOrder)
  const ambigMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
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

  return null
}

/**
 * Sample all date values in a column to disambiguate MM/DD/YYYY vs DD/MM/YYYY.
 * If any row has first number > 12, it must be DD/MM.
 * If any row has second number > 12, it must be MM/DD.
 * Default to MDY (US format) if fully ambiguous.
 */
function detectDateOrder(values: string[]): DateOrder {
  let mdyVotes = 0
  let dmyVotes = 0
  for (const raw of values) {
    const match = raw.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/]\d{4}$/)
    if (!match) continue
    const first = parseInt(match[1], 10)
    const second = parseInt(match[2], 10)
    if (first > 12 && second <= 12) dmyVotes++
    else if (second > 12 && first <= 12) mdyVotes++
  }
  return dmyVotes > mdyVotes ? 'DMY' : 'MDY'
}

/** Human-readable label for the detected date format. */
function describeDateFormat(values: string[], order: DateOrder): string | null {
  for (const raw of values) {
    const trimmed = raw.trim()
    if (/^\d{8}$/.test(trimmed)) return 'YYYYMMDD'
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(trimmed)) {
      return trimmed.includes('/') ? 'YYYY/MM/DD' : 'YYYY-MM-DD'
    }
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(trimmed)) {
      const sep = trimmed.includes('/') ? '/' : '-'
      return order === 'MDY' ? `MM${sep}DD${sep}YYYY` : `DD${sep}MM${sep}YYYY`
    }
  }
  return null
}

// ── Column detection ───────────────────────────────────────────────

interface ColumnDetection {
  machineCol: number | null
  machineHeader: string | null
  dateCol: number | null
  dateHeader: string | null
  dateOrder: DateOrder
  dateFormatGuess: string | null
}

function detectHintColumns(rows: string[][], imeiCol: number, hasHeader: boolean): ColumnDetection {
  const result: ColumnDetection = {
    machineCol: null, machineHeader: null,
    dateCol: null, dateHeader: null,
    dateOrder: 'MDY', dateFormatGuess: null
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
    result.dateOrder = detectDateOrder(allDateValues)
    result.dateFormatGuess = describeDateFormat(allDateValues, result.dateOrder)
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
    const imei = (row[imeiCol] || '').trim()
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

    if (hint.machine || hint.date) {
      hints[imei] = hint
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
      const val = (row[col] || '').trim()
      if (IMEI_REGEX.test(val)) count++
    }
    if (count > bestCount) {
      bestCount = count
      bestCol = col
    }
  }

  return bestCol
}

interface ParsedRows {
  rows: string[][]
  imeiCol: number
  hasHeader: boolean
}

async function parseCSV(filePath: string): Promise<ParsedRows> {
  const content = await readFile(filePath, 'utf-8')

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
  const firstVal = (records[0][col] || '').trim()
  const hasHeader = !IMEI_REGEX.test(firstVal)

  return { rows: records, imeiCol: col, hasHeader }
}

async function parseExcel(filePath: string): Promise<ParsedRows> {
  const buffer = await readFile(filePath)
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: ''
  })

  if (rows.length === 0) return { rows: [], imeiCol: 0, hasHeader: false }

  const col = findIMEIColumn(rows)
  const firstVal = (rows[0][col] || '').trim()
  const hasHeader = !IMEI_REGEX.test(firstVal)

  return { rows, imeiCol: col, hasHeader }
}

async function parseTXT(filePath: string): Promise<ParsedRows> {
  const content = await readFile(filePath, 'utf-8')
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
      parsed = await parseTXT(filePath)
  }

  // Extract IMEI values from the detected column
  const dataRows = parsed.rows.slice(parsed.hasHeader ? 1 : 0)
  const rawValues = dataRows.map((row) => (row[parsed.imeiCol] || '').trim())
  const { validIMEIs, invalidEntries, duplicateCount } = extractIMEIs(rawValues)

  // Detect hint columns (machine, date) — only for multi-column formats
  const detection = detectHintColumns(parsed.rows, parsed.imeiCol, parsed.hasHeader)
  const hasHints = detection.machineCol !== null || detection.dateCol !== null

  let hints: Record<string, AuditHint> | undefined
  let hintMeta: HintDetectionMeta | undefined

  if (hasHints) {
    const hintResult = buildHints(parsed.rows, parsed.imeiCol, parsed.hasHeader, detection)
    hints = hintResult.hints
    hintMeta = hintResult.meta
  }

  return {
    format,
    filePath,
    fileName,
    totalRows: rawValues.length,
    validIMEIs,
    invalidEntries,
    duplicateCount,
    hints,
    hintMeta
  }
}
