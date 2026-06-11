import { app, BrowserWindow, ipcMain, dialog, shell, screen, globalShortcut } from 'electron'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
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

/**
 * Validate saved window bounds against connected displays.
 * Returns the bounds if at least 100px of the window is visible
 * on any display, otherwise returns undefined to use defaults.
 */
function validateBounds(
  saved: { x: number; y: number; width: number; height: number } | undefined
): { x: number; y: number; width: number; height: number } | undefined {
  if (!saved) return undefined
  const displays = screen.getAllDisplays()
  const visible = displays.some((d) => {
    const wa = d.workArea
    // At least 100px of the window must overlap with the work area
    return (
      saved.x + saved.width > wa.x + 100 &&
      saved.x < wa.x + wa.width - 100 &&
      saved.y + saved.height > wa.y + 50 &&
      saved.y < wa.y + wa.height - 50
    )
  })
  return visible ? saved : undefined
}

/**
 * Re-enable the WS_SYSMENU window style on frameless windows so
 * shift+right-click on the taskbar shows the system menu (Move,
 * Size, Minimize, Maximize, Close). Electron strips this style
 * when frame: false is set. Runs asynchronously — non-blocking.
 */
function restoreSystemMenu(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  try {
    const hwnd = win.getNativeWindowHandle()
    // HWND is 8 bytes on 64-bit Windows
    const hwndStr = hwnd.readBigUInt64LE(0).toString()
    const script = `
Add-Type @'
using System;using System.Runtime.InteropServices;
public class W{
[DllImport("user32.dll")]public static extern int GetWindowLong(IntPtr h,int i);
[DllImport("user32.dll")]public static extern int SetWindowLong(IntPtr h,int i,int v);
}
'@
$s=[W]::GetWindowLong([IntPtr]::new(${hwndStr}),-16)
[W]::SetWindowLong([IntPtr]::new(${hwndStr}),-16,$s-bor 0x80000)
`
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], () => {
      // No-op callback — prevents unhandled 'error' event if PowerShell is unavailable
    })
  } catch {
    // Non-critical — system menu is a convenience, not essential
  }
}

function createWindow(): void {
  const saved = getSetting('windowBounds') as
    | { x: number; y: number; width: number; height: number }
    | undefined
  const bounds = validateBounds(saved)

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1100,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
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

  // Re-enable system menu for taskbar shift+right-click
  restoreSystemMenu(mainWindow)

  // Center on primary display shortcut (recovery from off-screen)
  globalShortcut.register('Ctrl+Shift+Home', () => {
    if (!mainWindow) return
    const primary = screen.getPrimaryDisplay().workArea
    mainWindow.setBounds({
      x: Math.round(primary.x + (primary.width - 1100) / 2),
      y: Math.round(primary.y + (primary.height - 800) / 2),
      width: 1100,
      height: 800
    })
    mainWindow.show()
    mainWindow.focus()
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
  const logsDir = join(app.getPath('userData'), 'logs')

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
      },
      logsDir
    )
  })

  ipcMain.on('search:cancel', () => {
    cancelSearch()
  })

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

  ipcMain.on('logs:open-folder', async () => {
    await mkdir(logsDir, { recursive: true })
    shell.openPath(logsDir)
  })

  ipcMain.handle('shell:open-path', async (_event, path: string) => {
    if (path) shell.openPath(path)
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
  cancelSearch()
  cancelExport()
  globalShortcut.unregisterAll()
  app.quit()
})
