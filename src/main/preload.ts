import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  scanRoot: (rootPath) => ipcRenderer.invoke('scanner:scan-root', rootPath),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  parseAuditFile: (filePath) => ipcRenderer.invoke('audit:parse', filePath),
  searchIMEIs: (request) => ipcRenderer.invoke('search:start', request),
  cancelSearch: () => ipcRenderer.send('search:cancel'),
  onSearchProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown): void => {
      callback(progress as Parameters<typeof callback>[0])
    }
    ipcRenderer.on('search:progress', handler)
    return () => ipcRenderer.removeListener('search:progress', handler)
  },
  onSearchMatches: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, matches: unknown): void => {
      callback(matches as Parameters<typeof callback>[0])
    }
    ipcRenderer.on('search:matches', handler)
    return () => ipcRenderer.removeListener('search:matches', handler)
  },
  exportResults: (request) => ipcRenderer.invoke('export:start', request),
  cancelExport: () => ipcRenderer.send('export:cancel'),
  onExportProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown): void => {
      callback(progress as Parameters<typeof callback>[0])
    }
    ipcRenderer.on('export:progress', handler)
    return () => ipcRenderer.removeListener('export:progress', handler)
  },
  saveFile: (defaultName, filters, content) => ipcRenderer.invoke('dialog:save-file', defaultName, filters, content),
  openLogsFolder: () => ipcRenderer.send('logs:open-folder'),
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  settingsGet: (key) => ipcRenderer.invoke('settings:get', key),
  settingsSet: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('electronAPI', api)
