import { EventEmitter } from 'events'
import * as http from 'http'
import * as net from 'net'
import * as path from 'path'
import * as fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'

// aria2 RPC 配置
const RPC_HOST = '127.0.0.1'
const RPC_SECRET = 'baidu_download_secret_' + Math.random().toString(36).substring(7)
const PORT_RANGE_START = 16800
const PORT_RANGE_END = 16899
const MAX_PORT_RETRIES = 10

// aria2 下载状态
export type Aria2Status = 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed'

// aria2 任务状态信息
export interface Aria2TaskStatus {
  gid: string
  status: Aria2Status
  totalLength: string
  completedLength: string
  downloadSpeed: string
  errorCode?: string
  errorMessage?: string
  files?: Array<{
    path: string
    length: string
    completedLength: string
  }>
}

// 下载进度信息
export interface DownloadProgress {
  taskId: string
  gid: string
  totalSize: number
  downloadedSize: number
  speed: number
  progress: number
  status: 'downloading' | 'paused' | 'completed' | 'error'
  error?: string
}

// aria2 RPC 客户端
export class Aria2Client extends EventEmitter {
  private process: ChildProcess | null = null
  private isReady: boolean = false
  private requestId: number = 0
  private taskMap: Map<string, string> = new Map() // taskId -> gid
  private gidMap: Map<string, string> = new Map() // gid -> taskId
  private progressTimer: NodeJS.Timeout | null = null
  private startPromise: Promise<void> | null = null
  private rpcPort: number = 0

  constructor() {
    super()
  }

  // 生成随机端口
  private getRandomPort(): number {
    return Math.floor(Math.random() * (PORT_RANGE_END - PORT_RANGE_START + 1)) + PORT_RANGE_START
  }

  // 检查端口是否可用
  private checkPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => {
        resolve(false)
      })
      server.once('listening', () => {
        server.close()
        resolve(true)
      })
      server.listen(port, RPC_HOST)
    })
  }

  // 查找可用端口
  private async findAvailablePort(): Promise<number> {
    for (let i = 0; i < MAX_PORT_RETRIES; i++) {
      const port = this.getRandomPort()
      if (await this.checkPortAvailable(port)) {
        return port
      }
    }
    throw new Error('无法找到可用端口')
  }

  // 获取当前 RPC 端口
  getRpcPort(): number {
    return this.rpcPort
  }

  // 获取 aria2c 可执行文件路径
  private getAria2Path(): string {
    if (app.isPackaged) {
      // 打包后：resources/aria2/aria2c.exe
      return path.join(process.resourcesPath, 'aria2', 'aria2c.exe')
    } else {
      // 开发时：项目根目录/resources/aria2/aria2c.exe
      return path.join(__dirname, '..', 'resources', 'aria2', 'aria2c.exe')
    }
  }

  // 获取 aria2 会话文件路径
  private getSessionPath(): string {
    const dataPath = app.isPackaged
      ? path.join(path.dirname(app.getPath('exe')), 'data')
      : path.join(__dirname, '..', 'data')

    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true })
    }
    return path.join(dataPath, 'aria2.session')
  }

  // 启动 aria2 进程
  async start(): Promise<void> {
    if (this.isReady) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this._start()
    return this.startPromise
  }

  private async _start(): Promise<void> {
    const aria2Path = this.getAria2Path()
    const sessionPath = this.getSessionPath()

    // 确保会话文件存在
    if (!fs.existsSync(sessionPath)) {
      fs.writeFileSync(sessionPath, '', 'utf-8')
    }

    // 查找可用端口
    this.rpcPort = await this.findAvailablePort()
    console.log(`[aria2] 使用端口: ${this.rpcPort}`)

    // 启动 aria2 进程
    const args = [
      '--enable-rpc',
      `--rpc-listen-port=${this.rpcPort}`,
      '--rpc-listen-all=false',
      `--rpc-secret=${RPC_SECRET}`,
      '--rpc-allow-origin-all=true',
      `--input-file=${sessionPath}`,
      `--save-session=${sessionPath}`,
      '--save-session-interval=30',
      '--max-concurrent-downloads=5',
      '--max-connection-per-server=16',
      '--split=16',
      '--min-split-size=1M',
      '--max-tries=5',
      '--retry-wait=3',
      '--connect-timeout=30',
      '--timeout=60',
      '--continue=true',
      '--auto-file-renaming=false',
      '--allow-overwrite=true',
      '--file-allocation=prealloc',
      '--console-log-level=warn',
      '--summary-interval=0',
      '--disk-cache=64M',
    ]

    return new Promise((resolve, reject) => {
      this.process = spawn(aria2Path, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      this.process.stdout?.on('data', (data) => {
        console.log('[aria2]', data.toString())
      })

      this.process.stderr?.on('data', (data) => {
        console.error('[aria2 error]', data.toString())
      })

      this.process.on('error', (err) => {
        console.error('aria2 进程启动失败:', err)
        this.isReady = false
        reject(err)
      })

      this.process.on('exit', (code) => {
        console.log('aria2 进程退出，退出码:', code)
        this.isReady = false
        this.stopProgressMonitor()
      })

      // 等待 aria2 启动完成
      const checkReady = async (retries = 30): Promise<void> => {
        try {
          await this.getVersion()
          this.isReady = true
          this.startProgressMonitor()
          resolve()
        } catch {
          if (retries > 0) {
            setTimeout(() => checkReady(retries - 1), 100)
          } else {
            reject(new Error('aria2 启动超时'))
          }
        }
      }

      setTimeout(() => checkReady(), 200)
    })
  }

  // 停止 aria2 进程
  async stop(): Promise<void> {
    this.stopProgressMonitor()

    if (this.process) {
      try {
        await this.shutdown()
      } catch {
        // 忽略
      }
      this.process.kill()
      this.process = null
    }
    this.isReady = false
    this.taskMap.clear()
    this.gidMap.clear()
  }

  // 发送 JSON-RPC 请求
  private sendRequest(method: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: id.toString(),
        method: `aria2.${method}`,
        params: [`token:${RPC_SECRET}`, ...params]
      })

      const options = {
        hostname: RPC_HOST,
        port: this.rpcPort,
        path: '/jsonrpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 10000
      }

      const req = http.request(options, (res) => {
        let data = ''
        res.on('data', (chunk) => data += chunk)
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            if (json.error) {
              reject(new Error(json.error.message || 'RPC error'))
            } else {
              resolve(json.result)
            }
          } catch (e) {
            reject(new Error('解析响应失败'))
          }
        })
      })

      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('请求超时'))
      })
      req.write(body)
      req.end()
    })
  }

  // 获取 aria2 版本
  async getVersion(): Promise<string> {
    const result = await this.sendRequest('getVersion')
    return result.version
  }

  // 关闭 aria2
  async shutdown(): Promise<void> {
    await this.sendRequest('shutdown')
  }

  // 添加下载任务
  async addUri(
    taskId: string,
    url: string,
    options: {
      dir: string
      out: string
      userAgent?: string
      headers?: Record<string, string>
    }
  ): Promise<string> {
    const aria2Options: Record<string, string> = {
      dir: options.dir,
      out: options.out,
    }

    if (options.userAgent) {
      aria2Options['user-agent'] = options.userAgent
    }

    if (options.headers) {
      const headerList = Object.entries(options.headers)
        .map(([k, v]) => `${k}: ${v}`)
      if (headerList.length > 0) {
        aria2Options['header'] = headerList.join('\n')
      }
    }

    const gid = await this.sendRequest('addUri', [[url], aria2Options])
    this.taskMap.set(taskId, gid)
    this.gidMap.set(gid, taskId)
    return gid
  }

  // 暂停下载
  async pause(taskId: string): Promise<void> {
    const gid = this.taskMap.get(taskId)
    if (gid) {
      try {
        await this.sendRequest('pause', [gid])
      } catch (e: any) {
        // 如果任务已完成或已移除，忽略错误
        if (!e.message?.includes('is not found')) {
          throw e
        }
      }
    }
  }

  // 恢复下载
  async unpause(taskId: string): Promise<void> {
    const gid = this.taskMap.get(taskId)
    if (gid) {
      await this.sendRequest('unpause', [gid])
    }
  }

  // 取消下载
  async remove(taskId: string): Promise<void> {
    const gid = this.taskMap.get(taskId)
    if (gid) {
      try {
        await this.sendRequest('remove', [gid])
      } catch (e: any) {
        // 如果任务已完成或已移除，尝试从结果中删除
        if (e.message?.includes('is not found')) {
          try {
            await this.sendRequest('removeDownloadResult', [gid])
          } catch {
            // 忽略
          }
        } else {
          throw e
        }
      }
      this.taskMap.delete(taskId)
      this.gidMap.delete(gid)
    }
  }

  // 强制取消下载（不等待任务停止）
  async forceRemove(taskId: string): Promise<void> {
    const gid = this.taskMap.get(taskId)
    if (gid) {
      try {
        await this.sendRequest('forceRemove', [gid])
      } catch {
        // 忽略错误
      }
      this.taskMap.delete(taskId)
      this.gidMap.delete(gid)
    }
  }

  // 获取任务状态
  async tellStatus(taskId: string): Promise<Aria2TaskStatus | null> {
    const gid = this.taskMap.get(taskId)
    if (!gid) return null

    try {
      const result = await this.sendRequest('tellStatus', [gid])
      return {
        gid: result.gid,
        status: result.status,
        totalLength: result.totalLength,
        completedLength: result.completedLength,
        downloadSpeed: result.downloadSpeed,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        files: result.files
      }
    } catch {
      return null
    }
  }

  // 获取所有活动任务
  async tellActive(): Promise<Aria2TaskStatus[]> {
    try {
      const results = await this.sendRequest('tellActive')
      return results.map((r: any) => ({
        gid: r.gid,
        status: r.status,
        totalLength: r.totalLength,
        completedLength: r.completedLength,
        downloadSpeed: r.downloadSpeed,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        files: r.files
      }))
    } catch {
      return []
    }
  }

  // 获取等待任务
  async tellWaiting(offset: number = 0, num: number = 100): Promise<Aria2TaskStatus[]> {
    try {
      const results = await this.sendRequest('tellWaiting', [offset, num])
      return results.map((r: any) => ({
        gid: r.gid,
        status: r.status,
        totalLength: r.totalLength,
        completedLength: r.completedLength,
        downloadSpeed: r.downloadSpeed,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        files: r.files
      }))
    } catch {
      return []
    }
  }

  // 获取已停止任务
  async tellStopped(offset: number = 0, num: number = 100): Promise<Aria2TaskStatus[]> {
    try {
      const results = await this.sendRequest('tellStopped', [offset, num])
      return results.map((r: any) => ({
        gid: r.gid,
        status: r.status,
        totalLength: r.totalLength,
        completedLength: r.completedLength,
        downloadSpeed: r.downloadSpeed,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        files: r.files
      }))
    } catch {
      return []
    }
  }

  // 启动进度监控
  private startProgressMonitor(): void {
    if (this.progressTimer) return

    this.progressTimer = setInterval(async () => {
      await this.checkProgress()
    }, 500) // 每500ms检查一次
  }

  // 停止进度监控
  private stopProgressMonitor(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer)
      this.progressTimer = null
    }
  }

  // 检查所有任务进度
  private async checkProgress(): Promise<void> {
    if (!this.isReady || this.taskMap.size === 0) return

    try {
      // 获取活动任务
      const activeTasks = await this.tellActive()
      for (const task of activeTasks) {
        this.emitProgress(task)
      }

      // 获取等待任务
      const waitingTasks = await this.tellWaiting()
      for (const task of waitingTasks) {
        this.emitProgress(task)
      }

      // 获取已停止任务（完成或出错）
      const stoppedTasks = await this.tellStopped()
      for (const task of stoppedTasks) {
        this.emitProgress(task)
      }
    } catch (e) {
      // 忽略错误
    }
  }

  // 发送进度事件
  private emitProgress(task: Aria2TaskStatus): void {
    const taskId = this.gidMap.get(task.gid)
    if (!taskId) return

    const totalSize = parseInt(task.totalLength) || 0
    const downloadedSize = parseInt(task.completedLength) || 0
    const speed = parseInt(task.downloadSpeed) || 0

    let status: DownloadProgress['status']
    let error: string | undefined

    switch (task.status) {
      case 'active':
        status = 'downloading'
        break
      case 'waiting':
        status = 'downloading' // 等待中也算下载中
        break
      case 'paused':
        status = 'paused'
        break
      case 'complete':
        status = 'completed'
        // 完成后清理映射
        setTimeout(() => {
          this.taskMap.delete(taskId)
          this.gidMap.delete(task.gid)
        }, 1000)
        break
      case 'error':
      case 'removed':
        status = 'error'
        error = task.errorMessage || `错误代码: ${task.errorCode}`
        break
      default:
        status = 'downloading'
    }

    const progress: DownloadProgress = {
      taskId,
      gid: task.gid,
      totalSize,
      downloadedSize,
      speed,
      progress: totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0,
      status,
      error
    }

    this.emit('progress', progress)
  }

  // 检查是否就绪
  isClientReady(): boolean {
    return this.isReady
  }

  // 获取 taskId 对应的 gid
  getGid(taskId: string): string | undefined {
    return this.taskMap.get(taskId)
  }

  // 检查任务是否存在
  hasTask(taskId: string): boolean {
    return this.taskMap.has(taskId)
  }
}

// 创建全局 aria2 客户端实例
export const aria2Client = new Aria2Client()
