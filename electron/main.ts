import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import net from 'net'
import { downloadManager } from './downloader'
import { aria2Client } from './aria2-client'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

// 调试日志文件路径
let debugLogPath: string | null = null
let debugLogStream: fs.WriteStream | null = null

// 初始化调试日志
function initDebugLog() {
  const logDir = app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'log')
    : path.join(__dirname, '..', 'log')

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
  debugLogPath = path.join(logDir, `debug-${timestamp}.log`)
  debugLogStream = fs.createWriteStream(debugLogPath, { flags: 'a' })

  console.log(`[Debug] 日志文件: ${debugLogPath}`)

  // 设置 aria2Client 的日志回调
  aria2Client.setDebugLogCallback((message) => {
    writeDebugLog(message)
  })
}

// 写入调试日志
function writeDebugLog(message: string) {
  if (debugLogStream) {
    debugLogStream.write(message + '\n')
  }
  console.log('[Debug]', message)
}

// 当前客户端版本
const CLIENT_VERSION = '1.0.9'
// 版本检查API地址
const VERSION_API_URL = 'https://download.linglong521.cn/version.php'
// 下载线路API地址
const ROUTES_API_URL = 'https://download.linglong521.cn/getRoutes.php'

// 下载线路配置
interface DownloadRoute {
  name: string
  ip: string
  latency?: number
}

// 线路API响应
interface RoutesApiResponse {
  code: number
  message: string
  data?: {
    routes: DownloadRoute[]
    host: string
  }
}

// 从远程获取的线路列表
let downloadRoutes: DownloadRoute[] = []
// 需要映射的主机名
let routeHost: string = 'allall02.baidupcs.com'

// 当前选择的线路
let currentRoute: DownloadRoute | null = null

// 测试单个 IP 的延迟（TCP 连接测试）
function testLatency(ip: string, port: number = 443, timeout: number = 5000): Promise<number> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()

    socket.setTimeout(timeout)

    socket.on('connect', () => {
      const latency = Date.now() - start
      socket.destroy()
      resolve(latency)
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve(-1) // 超时返回 -1
    })

    socket.on('error', () => {
      socket.destroy()
      resolve(-1) // 错误返回 -1
    })

    socket.connect(port, ip)
  })
}

// 从远程API获取下载线路列表
function fetchRoutes(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const request = https.get(ROUTES_API_URL, { timeout: 10000 }, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          const json: RoutesApiResponse = JSON.parse(data)
          if (json.code === 200 && json.data?.routes && json.data.routes.length > 0) {
            downloadRoutes = json.data.routes
            routeHost = json.data.host || 'allall02.baidupcs.com'
            console.log(`[routes] 获取到 ${downloadRoutes.length} 个下载线路`)
            resolve({ success: true })
          } else {
            resolve({ success: false, error: json.message || '线路列表为空' })
          }
        } catch (e) {
          resolve({ success: false, error: '解析线路信息失败' })
        }
      })
    })

    request.on('error', (err) => {
      resolve({ success: false, error: `网络请求失败: ${err.message}` })
    })

    request.on('timeout', () => {
      request.destroy()
      resolve({ success: false, error: '请求超时' })
    })
  })
}

// 测试所有线路并选择最优
async function testAllRoutes(): Promise<DownloadRoute[]> {
  const results: DownloadRoute[] = []

  for (const route of downloadRoutes) {
    const latency = await testLatency(route.ip)
    results.push({ ...route, latency })
  }

  return results
}

// 选择最优线路
// 返回 null 表示所有线路都不可用
async function selectBestRoute(): Promise<DownloadRoute | null> {
  if (downloadRoutes.length === 0) {
    return null
  }

  const results = await testAllRoutes()

  // 过滤掉超时的线路，按延迟排序
  const validRoutes = results.filter(r => r.latency !== undefined && r.latency >= 0)
    .sort((a, b) => (a.latency || 0) - (b.latency || 0))

  if (validRoutes.length > 0) {
    currentRoute = validRoutes[0]
    return currentRoute
  }

  // 全部超时，返回 null
  return null
}

// 获取当前线路
function getCurrentRoute(): DownloadRoute | null {
  return currentRoute
}

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
          if (json.code === 200 && json.data?.versions && Array.isArray(json.data.versions)) {
            // 支持多版本：检查当前版本是否在允许的版本列表中
            const allowedVersions: string[] = json.data.versions
            if (allowedVersions.includes(CLIENT_VERSION)) {
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
    maximizable: false,
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

// 清理已完成/失败的下载记录
ipcMain.handle('download:cleanup', async (_, taskId: string) => {
  try {
    await downloadManager.cleanupTask(taskId)
    return { success: true }
  } catch (error: any) {
    console.error('清理下载记录失败:', error)
    return { success: false, error: error.message }
  }
})

// 获取下载任务状态（用于恢复前检查任务是否已完成）
ipcMain.handle('download:getStatus', async (_, taskId: string) => {
  try {
    const status = await downloadManager.getTaskStatus(taskId)
    writeDebugLog(`[Main] getStatus: taskId=${taskId}, status=${status?.status || 'null'}`)
    return { success: true, status }
  } catch (error: any) {
    writeDebugLog(`[Main] getStatus error: taskId=${taskId}, error=${error.message}`)
    // 任务不存在返回 null
    return { success: true, status: null }
  }
})

// 写入调试日志（渲染进程调用）
ipcMain.handle('debug:writeLog', async (_, message: string) => {
  writeDebugLog(`[Renderer] ${message}`)
})

// IPC处理 - 下载线路
ipcMain.handle('route:selectBest', async () => {
  try {
    const route = await selectBestRoute()
    if (!route) {
      return { success: false, error: '所有下载服务器连接超时' }
    }
    // 设置 aria2 使用选择的 IP
    aria2Client.setHostMapping(routeHost, route.ip)
    return { success: true, route }
  } catch (error: any) {
    console.error('选择线路失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('route:getCurrent', () => {
  return getCurrentRoute()
})

ipcMain.handle('route:testCurrent', async () => {
  if (!currentRoute) {
    return { success: false, error: '未选择线路' }
  }
  const latency = await testLatency(currentRoute.ip)
  currentRoute.latency = latency
  return { success: true, route: currentRoute }
})

// IPC处理 - 启动画面
ipcMain.handle('splash:checkVersion', async () => {
  return await checkVersion()
})

ipcMain.handle('splash:initDownloader', async () => {
  try {
    // 1. 从远程获取下载线路
    console.log('[routes] 获取下载线路...')
    const routesResult = await fetchRoutes()
    if (!routesResult.success) {
      console.error('[routes] 获取线路失败:', routesResult.error)
      return { success: false, error: `无法获取下载服务器: ${routesResult.error}` }
    }

    // 2. 初始化下载器
    await downloadManager.init()

    // 3. 选择最优下载线路
    console.log('[route] 开始测试下载线路...')
    const route = await selectBestRoute()

    // 4. 检查是否所有线路都不可用
    if (!route) {
      console.error('[route] 所有下载线路均不可用')
      return { success: false, error: '所有下载服务器连接超时' }
    }

    // 5. 设置主机映射
    aria2Client.setHostMapping(routeHost, route.ip)
    console.log(`[route] 已选择线路: ${route.name} (${route.ip}) 延迟: ${route.latency}ms`)

    return { success: true, route }
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
    initDebugLog()
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
