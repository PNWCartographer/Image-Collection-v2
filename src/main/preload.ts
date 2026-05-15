import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  scanRoot: (rootPath: string) => ipcRenderer.invoke('scanner:scan-root', rootPath),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  ping: () => ipcRenderer.invoke('ping')
}

contextBridge.exposeInMainWorld('electronAPI', api)
