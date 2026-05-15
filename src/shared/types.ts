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
  ping: () => Promise<string>
  settingsGet: (key: string) => Promise<unknown>
  settingsSet: (key: string, value: unknown) => Promise<void>
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
}
