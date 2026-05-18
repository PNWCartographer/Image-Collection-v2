export interface FolderInfo {
  name: string
  path: string
  isMachineFolder: boolean
}

export interface FolderScanResult {
  rootPath: string
  folders: FolderInfo[]
}

/** Per-IMEI search hint extracted from audit file columns. */
export interface AuditHint {
  machine?: string   // Normalized to NAS folder name, e.g. "M8", "M10"
  date?: string      // Normalized to YYYYMMDD format
}

/** Metadata about hint column detection quality. */
export interface HintDetectionMeta {
  machineColumn: string | null      // Original header name, null if not detected
  dateColumn: string | null         // Original header name, null if not detected
  machineValidCount: number         // How many rows had a parseable machine value
  dateValidCount: number            // How many rows had a parseable date value
  totalHintedRows: number           // Total data rows examined
  dateFormatGuess: string | null    // Detected date format, e.g. "YYYY-MM-DD", "MM/DD/YYYY"
}

export interface AuditParseResult {
  format: 'csv' | 'xlsx' | 'xls' | 'txt' | 'unknown'
  filePath: string
  fileName: string
  totalRows: number
  validIMEIs: string[]
  invalidEntries: {
    line: number
    value: string
    reason: string
  }[]
  duplicateCount: number
  hints?: Record<string, AuditHint>   // IMEI -> hint (only present when columns detected)
  hintMeta?: HintDetectionMeta        // Detection metadata
}

export interface SearchRequest {
  rootPath: string
  selectedFolders: string[]
  imeis: string[]
  dateStart?: string
  dateEnd?: string
  scanIndexFilter: 'all' | 'first_only'
  mrPass?: boolean
  mrFail?: boolean
  hints?: Record<string, AuditHint>
  smartSearch?: boolean
}

export interface SearchMatch {
  imei: string
  machineName: string
  date: string
  scanIndex: number
  folderName: string
  sourcePath: string
  bmpCount: number
  jpegCount: number
  otherCount: number
  totalFiles: number
  /** Set only for ModelRecogImages matches. Undefined for standard IMEI folder matches. */
  matchType?: 'mr-pass' | 'mr-fail'
  /** Brand-Model folder name (MR PASS) or 'Error-Error' (MR FAIL) */
  mrFolder?: string
}

export interface SearchProgress {
  phase: 'scanning' | 'complete' | 'cancelled'
  percent: number
  currentMachine: string
  currentDate: string
  matchesSoFar: number
  foldersScanned: number
  totalFolders: number
}

export interface SearchResult {
  matches: SearchMatch[]
  missingIMEIs: string[]
  totalSearched: number
  elapsedMs: number
}

export interface ExportRequest {
  matches: SearchMatch[]
  destination: string
  action: 'copy' | 'move'
  imageType: 'both' | 'bmp' | 'jpeg'
  organize: 'flat' | 'by-machine' | 'by-date' | 'machine-date' | 'date-machine' | 'by-imei'
  duplicates: 'skip' | 'overwrite'
  aiImages: boolean
}

export interface ExportProgress {
  phase: 'exporting' | 'complete' | 'cancelled'
  percent: number
  currentIMEI: string
  currentFolder: string
  exported: number
  skipped: number
  failed: number
  totalItems: number
}

export interface ExportResult {
  exported: number
  skipped: number
  failed: number
  failedItems: { imei: string; sourcePath: string; error: string }[]
  elapsedMs: number
  destinationPath: string
  logPath: string
}

export interface SourceConfig {
  id: string
  name: string
  rootPath: string
  folderToggles: Record<string, boolean>
}

export interface SearchHistoryEntry {
  id: string
  timestamp: number
  auditFileName: string
  imeiCount: number
  rootPath: string
  sourceName: string
  selectedFolders: string[]
  dateStart?: string
  dateEnd?: string
  scanIndexFilter: 'all' | 'first_only'
  mrPass: boolean
  mrFail: boolean
  matchCount: number
  missingCount: number
  elapsedMs: number
}

export interface ElectronAPI {
  scanRoot: (rootPath: string) => Promise<FolderScanResult>
  openFolderDialog: () => Promise<string | null>
  openFileDialog: () => Promise<string | null>
  parseAuditFile: (filePath: string) => Promise<AuditParseResult>
  searchIMEIs: (request: SearchRequest) => Promise<SearchResult>
  cancelSearch: () => void
  onSearchProgress: (callback: (progress: SearchProgress) => void) => () => void
  onSearchMatches: (callback: (matches: SearchMatch[]) => void) => () => void
  exportResults: (request: ExportRequest) => Promise<ExportResult>
  cancelExport: () => void
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
  saveFile: (defaultName: string, filters: { name: string; extensions: string[] }[], content: string) => Promise<boolean>
  openLogsFolder: () => void
  getFilePath: (file: File) => string

  settingsGet: (key: string) => Promise<unknown>
  settingsSet: (key: string, value: unknown) => Promise<void>
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
}
