import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  scanRoot: (rootPath) => ipcRenderer.invoke('scanner:scan-root', rootPath),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  parseAuditFile: (filePath) => ipcRenderer.invoke('audit:parse', filePath),
  ping: () => ipcRenderer.invoke('ping'),
  settingsGet: (key) => ipcRenderer.invoke('settings:get', key),
  settingsSet: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('electronAPI', api)
