import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { downloadManager } from './downloader'

let mainWindow: BrowserWindow | null = null

// 获取应用程序目录（打包后是exe所在目录，开发时是项目目录）
function getAppDirectory(): string {
  if (app.isPackaged) {
    // 打包后：exe所在目录
    return path.dirname(app.getPath('exe'))
  } else {
    // 开发时：项目根目录
    return path.join(__dirname, '..')
  }
}

// 获取数据存储目录
function getDataPath(): string {
  const dataPath = path.join(getAppDirectory(), 'data')
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true })
  }
  return dataPath
}

// 获取配置文件路径
function getConfigPath(): string {
  return path.join(getDataPath(), 'config.json')
}

// 读取配置
function loadConfig(): Record<string, any> {
  const configPath = getConfigPath()
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, 'utf-8')
      return JSON.parse(data)
    } catch (e) {
      return {}
    }
  }
  return {}
}

// 保存配置
function saveConfig(config: Record<string, any>): void {
  const configPath = getConfigPath()
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

// 获取默认下载目录（软件目录下的 Downloads）
function getDefaultDownloadPath(): string {
  const downloadPath = path.join(getAppDirectory(), 'Downloads')
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true })
  }
  return downloadPath
}

// 获取当前下载路径（优先使用配置的路径）
function getCurrentDownloadPath(): string {
  const config = loadConfig()
  if (config.downloadPath && fs.existsSync(config.downloadPath)) {
    return config.downloadPath
  }
  return getDefaultDownloadPath()
}

// 创建主窗口
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 500,
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
  return getCurrentDownloadPath()
})

ipcMain.handle('settings:setDownloadPath', (_, newPath: string) => {
  if (!fs.existsSync(newPath)) {
    fs.mkdirSync(newPath, { recursive: true })
  }
  // 保存到配置文件
  const config = loadConfig()
  config.downloadPath = newPath
  saveConfig(config)
  return newPath
})

// IPC处理 - 配置读写
ipcMain.handle('config:get', (_, key: string) => {
  const config = loadConfig()
  return config[key]
})

ipcMain.handle('config:set', (_, key: string, value: any) => {
  const config = loadConfig()
  config[key] = value
  saveConfig(config)
  return true
})

ipcMain.handle('config:getAll', () => {
  return loadConfig()
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
