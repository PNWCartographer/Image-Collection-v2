export interface FolderScanResult {
  rootPath: string
  folders: {
    name: string
    path: string
    isDateFolder: boolean
    isMachineFolder: boolean
  }[]
}

export interface ElectronAPI {
  scanRoot: (rootPath: string) => Promise<FolderScanResult>
  openFolderDialog: () => Promise<string | null>
  openFileDialog: () => Promise<string | null>
  ping: () => Promise<string>
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
}
