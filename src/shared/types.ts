export interface FolderInfo {
  name: string
  path: string
  isDateFolder: boolean
  isMachineFolder: boolean
}

export interface FolderScanResult {
  rootPath: string
  folders: FolderInfo[]
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
}

export interface SearchRequest {
  rootPath: string
  selectedFolders: string[]
  imeis: string[]
  dateStart?: string
  dateEnd?: string
  timeStart?: string
  timeEnd?: string
  scanIndexFilter: 'all' | 'first_only'
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
  folderCount: number
}

export interface AppSettings {
  sources: {
    id: string
    name: string
    rootPath: string
    folderToggles: Record<string, boolean>
  }[]
  activeSourceId: string
  lastDestination: string
  theme: 'dark' | 'light'
  lang: 'en' | 'zh'
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
  ping: () => Promise<string>
  settingsGet: (key: string) => Promise<unknown>
  settingsSet: (key: string, value: unknown) => Promise<void>
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
}
