import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { scanRootFolder } from './services/FolderScanner'
import { parseAuditFile } from './services/AuditParser'
import { searchIMEIs, cancelSearch } from './services/IMEISearchEngine'
import { getSetting, setSetting } from './services/SettingsStore'
import type { SearchRequest } from '../shared/types'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const saved = getSetting('windowBounds') as
    | { x: number; y: number; width: number; height: number }
    | undefined

  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1100,
    height: saved?.height ?? 800,
    x: saved?.x,
    y: saved?.y,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('close', () => {
    if (mainWindow) {
      const bounds = mainWindow.getBounds()
      setSetting('windowBounds', bounds)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIPC(): void {
  ipcMain.handle('ping', () => 'pong')

  ipcMain.handle('dialog:open-folder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:open-file', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Audit Files', extensions: ['csv', 'xlsx', 'xls', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('scanner:scan-root', async (_event, rootPath: string) => {
    return scanRootFolder(rootPath)
  })

  ipcMain.handle('audit:parse', async (_event, filePath: string) => {
    return parseAuditFile(filePath)
  })

  ipcMain.handle('search:start', async (_event, request: SearchRequest) => {
    return searchIMEIs(
      request,
      (progress) => {
        mainWindow?.webContents.send('search:progress', progress)
      },
      (matches) => {
        mainWindow?.webContents.send('search:matches', matches)
      }
    )
  })

  ipcMain.on('search:cancel', () => {
    cancelSearch()
  })

  ipcMain.handle('settings:get', (_event, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    setSetting(key, value)
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())
}

app.whenReady().then(() => {
  registerIPC()
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
