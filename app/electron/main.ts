import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { downloadManager } from './downloader'

let mainWindow: BrowserWindow | null = null

// 获取默认下载目录
function getDefaultDownloadPath(): string {
  const downloadPath = path.join(os.homedir(), 'Downloads', '图片下载器')
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true })
  }
  return downloadPath
}

// 创建主窗口
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 设置下载进度回调
  downloadManager.setProgressCallback((progress) => {
    mainWindow?.webContents.send('download:progress', progress)
  })
}

// IPC处理 - 窗口控制
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

// IPC处理 - 对话框
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  return result.filePaths[0] || null
})

// IPC处理 - Shell
ipcMain.handle('shell:openPath', async (_, filePath: string) => {
  await shell.openPath(filePath)
})

ipcMain.handle('shell:showItemInFolder', async (_, filePath: string) => {
  shell.showItemInFolder(filePath)
})

// IPC处理 - 设置
ipcMain.handle('settings:getDownloadPath', () => {
  return getDefaultDownloadPath()
})

ipcMain.handle('settings:setDownloadPath', (_, newPath: string) => {
  if (!fs.existsSync(newPath)) {
    fs.mkdirSync(newPath, { recursive: true })
  }
  return newPath
})

// IPC处理 - 下载管理
ipcMain.handle('download:start', (_, taskId: string, options: {
  url: string
  savePath: string
  filename: string
  userAgent?: string
}) => {
  try {
    downloadManager.addTask(taskId, {
      url: options.url,
      savePath: options.savePath,
      filename: options.filename,
      userAgent: options.userAgent,
      threads: 64
    })
    // 在后台启动下载，不阻塞 IPC 返回
    downloadManager.startTask(taskId).catch((error: Error) => {
      console.error('下载失败:', error)
    })
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('download:pause', (_, taskId: string) => {
  downloadManager.pauseTask(taskId)
  return { success: true }
})

ipcMain.handle('download:resume', (_, taskId: string) => {
  try {
    // 在后台恢复下载，不阻塞 IPC 返回
    downloadManager.resumeTask(taskId).catch((error: Error) => {
      console.error('恢复下载失败:', error)
    })
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('download:cancel', async (_, taskId: string) => {
  try {
    await downloadManager.cancelTask(taskId)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

// 应用生命周期
app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
