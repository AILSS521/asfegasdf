import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import { downloadManager } from './downloader'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

// 当前客户端版本
const CLIENT_VERSION = '1.0.5'
// 版本检查API地址
const VERSION_API_URL = 'https://download.linglong521.cn/version.php'

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

// 解析 302 跳转，获取最终 URL
function resolveRedirectUrl(url: string, userAgent?: string, maxRedirects: number = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('重定向次数过多'))
      return
    }

    const isHttps = url.startsWith('https://')
    const httpModule = isHttps ? https : http

    const options: http.RequestOptions = {
      method: 'HEAD',
      timeout: 15000,
      headers: {
        'User-Agent': userAgent || 'netdisk;pan.baidu.com'
      }
    }

    const request = httpModule.request(url, options, (res) => {
      // 如果是重定向响应
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location
        // 处理相对路径重定向
        let absoluteUrl: string
        if (redirectUrl.startsWith('http://') || redirectUrl.startsWith('https://')) {
          absoluteUrl = redirectUrl
        } else {
          const urlObj = new URL(url)
          absoluteUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`
        }
        console.log(`[redirect] ${res.statusCode} -> ${absoluteUrl}`)
        // 递归解析下一个重定向
        resolveRedirectUrl(absoluteUrl, userAgent, maxRedirects - 1)
          .then(resolve)
          .catch(reject)
      } else {
        // 不是重定向，返回当前 URL
        resolve(url)
      }
    })

    request.on('error', (err) => {
      console.error('[redirect] 请求错误:', err.message)
      reject(err)
    })

    request.on('timeout', () => {
      request.destroy()
      reject(new Error('请求超时'))
    })

    request.end()
  })
}

// 版本检查
function checkVersion(): Promise<{ success: boolean; needUpdate?: boolean; error?: string }> {
  return new Promise((resolve) => {
    const request = https.get(VERSION_API_URL, { timeout: 10000 }, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.code === 200 && json.data?.version) {
            const serverVersion = json.data.version
            if (serverVersion === CLIENT_VERSION) {
              resolve({ success: true })
            } else {
              resolve({ success: false, needUpdate: true })
            }
          } else {
            resolve({ success: false, error: '无法获取版本号' })
          }
        } catch (e) {
          resolve({ success: false, error: '解析版本信息失败' })
        }
      })
    })

    request.on('error', () => {
      resolve({ success: false, error: '网络请求失败' })
    })

    request.on('timeout', () => {
      request.destroy()
      resolve({ success: false, error: '请求超时' })
    })
  })
}

// 创建启动画面窗口
function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 320,
    height: 160,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 居中显示
  splashWindow.center()

  if (process.env.VITE_DEV_SERVER_URL) {
    splashWindow.loadFile(path.join(__dirname, '../public/splash.html'))
  } else {
    splashWindow.loadFile(path.join(__dirname, '../dist/splash.html'))
  }

  splashWindow.on('closed', () => {
    splashWindow = null
  })
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
ipcMain.handle('download:start', async (_, taskId: string, options: {
  url: string
  savePath: string
  filename: string
  userAgent?: string
}) => {
  try {
    let finalUrl = options.url

    // 如果 URL 不是直接的百度下载链接，先解析 302 跳转获取最终 URL
    if (!options.url.includes('baidupcs.com')) {
      console.log(`[download] 解析重定向: ${options.url}`)
      try {
        finalUrl = await resolveRedirectUrl(options.url, options.userAgent)
        console.log(`[download] 最终 URL: ${finalUrl}`)
      } catch (redirectError: any) {
        console.error('[download] 解析重定向失败，使用原始 URL:', redirectError.message)
        // 如果解析失败，继续使用原始 URL
      }
    }

    // 使用 aria2 添加下载任务
    await downloadManager.addTask(taskId, {
      url: finalUrl,
      savePath: options.savePath,
      filename: options.filename,
      userAgent: options.userAgent
    })
    return { success: true }
  } catch (error: any) {
    console.error('添加下载任务失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('download:pause', async (_, taskId: string) => {
  try {
    await downloadManager.pauseTask(taskId)
    return { success: true }
  } catch (error: any) {
    console.error('暂停下载失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('download:resume', async (_, taskId: string) => {
  try {
    await downloadManager.resumeTask(taskId)
    return { success: true }
  } catch (error: any) {
    console.error('恢复下载失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('download:cancel', async (_, taskId: string) => {
  try {
    await downloadManager.cancelTask(taskId)
    return { success: true }
  } catch (error: any) {
    console.error('取消下载失败:', error)
    return { success: false, error: error.message }
  }
})

// IPC处理 - 启动画面
ipcMain.handle('splash:checkVersion', async () => {
  return await checkVersion()
})

ipcMain.handle('splash:initDownloader', async () => {
  try {
    await downloadManager.init()
    return { success: true }
  } catch (error: any) {
    console.error('初始化下载器失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('splash:testDownloader', async () => {
  try {
    if (!downloadManager.isReady()) {
      return { success: false, error: '下载器未就绪' }
    }
    // 测试获取 aria2 版本来验证连接
    const status = await downloadManager.getTaskStatus('__test__')
    return { success: true }
  } catch (error: any) {
    // 即使获取状态失败，只要下载器已就绪就算成功
    if (downloadManager.isReady()) {
      return { success: true }
    }
    return { success: false, error: error.message }
  }
})

ipcMain.handle('splash:proceed', () => {
  // 关闭启动画面，打开主窗口
  if (splashWindow) {
    splashWindow.close()
    splashWindow = null
  }
  createWindow()
})

ipcMain.handle('splash:close', () => {
  // 关闭程序
  app.quit()
})

// 单实例锁，防止多开
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // 如果获取锁失败，说明已有实例在运行，退出当前实例
  app.quit()
} else {
  // 当尝试启动第二个实例时，聚焦到已有窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else if (splashWindow) {
      splashWindow.focus()
    }
  })

  // 应用生命周期
  app.whenReady().then(() => {
    createSplashWindow()
  })
}

app.on('window-all-closed', async () => {
  // 停止 aria2 进程
  try {
    await downloadManager.stop()
  } catch {
    // 忽略错误
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  // 确保 aria2 进程被停止
  try {
    await downloadManager.stop()
  } catch {
    // 忽略错误
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
