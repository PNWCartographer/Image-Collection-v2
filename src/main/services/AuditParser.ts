import { readFile } from 'fs/promises'
import { parse as csvParse } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import { basename, extname } from 'path'
import type { AuditParseResult } from '../../shared/types'

const IMEI_REGEX = /^\d{15}$/

function detectFormat(filePath: string): AuditParseResult['format'] {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.csv') return 'csv'
  if (ext === '.xlsx') return 'xlsx'
  if (ext === '.xls') return 'xls'
  if (ext === '.txt') return 'txt'
  return 'unknown'
}

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

async function parseCSV(filePath: string): Promise<string[]> {
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

  if (records.length === 0) return []

  const col = findIMEIColumn(records)

  let startRow = 0
  const firstVal = (records[0][col] || '').trim()
  if (!IMEI_REGEX.test(firstVal)) {
    startRow = 1
  }

  return records.slice(startRow).map((row) => (row[col] || '').trim())
}

async function parseExcel(filePath: string): Promise<string[]> {
  const buffer = await readFile(filePath)
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: ''
  })

  if (rows.length === 0) return []

  const col = findIMEIColumn(rows)

  let startRow = 0
  const firstVal = (rows[0][col] || '').trim()
  if (!IMEI_REGEX.test(firstVal)) {
    startRow = 1
  }

  return rows.slice(startRow).map((row) => (row[col] || '').trim())
}

async function parseTXT(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, 'utf-8')
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export async function parseAuditFile(filePath: string): Promise<AuditParseResult> {
  const format = detectFormat(filePath)
  const fileName = basename(filePath)

  let rawValues: string[]
  switch (format) {
    case 'csv':
      rawValues = await parseCSV(filePath)
      break
    case 'xlsx':
    case 'xls':
      rawValues = await parseExcel(filePath)
      break
    case 'txt':
      rawValues = await parseTXT(filePath)
      break
    default:
      rawValues = await parseTXT(filePath)
  }

  const { validIMEIs, invalidEntries, duplicateCount } = extractIMEIs(rawValues)

  return {
    format,
    filePath,
    fileName,
    totalRows: rawValues.length,
    validIMEIs,
    invalidEntries,
    duplicateCount
  }
}
