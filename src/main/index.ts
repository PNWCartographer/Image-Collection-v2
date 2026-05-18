import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { scanRootFolder } from './services/FolderScanner'
import { parseAuditFile } from './services/AuditParser'
import { searchIMEIs, cancelSearch } from './services/IMEISearchEngine'
import { exportResults, cancelExport } from './services/ExportEngine'
import { getSetting, setSetting } from './services/SettingsStore'
import type { SearchRequest, ExportRequest } from '../shared/types'

let mainWindow: BrowserWindow | null = null

function getIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icon.ico')
  }
  return join(__dirname, '../../resources/icon.ico')
}

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
    icon: getIconPath(),
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

  const logsDir = join(app.getPath('userData'), 'logs')

  ipcMain.handle('export:start', async (_event, request: ExportRequest) => {
    return exportResults(
      request,
      logsDir,
      (progress) => {
        mainWindow?.webContents.send('export:progress', progress)
      }
    )
  })

  ipcMain.on('export:cancel', () => {
    cancelExport()
  })

  ipcMain.handle('dialog:save-file', async (_event, defaultName: string, filters: { name: string; extensions: string[] }[], content: string) => {
    if (!mainWindow) return false
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, content, 'utf-8')
    return true
  })

  ipcMain.on('logs:open-folder', () => {
    shell.openPath(logsDir)
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
  // Required for Windows taskbar integration (right-click menu, pinning, jump lists)
  app.setAppUserModelId('com.imagecollection.v2')
  registerIPC()
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
