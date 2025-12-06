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

// 连接稳定性配置
const HEARTBEAT_INTERVAL = 5000      // 心跳检测间隔 5 秒
const HEARTBEAT_TIMEOUT = 3000       // 心跳超时 3 秒
const MAX_RPC_FAILURES = 3           // 最大连续 RPC 失败次数
const RECONNECT_DELAY = 2000         // 重连延迟 2 秒
const MAX_RECONNECT_ATTEMPTS = 5     // 最大重连次数
const PROGRESS_INTERVAL = 500        // 进度轮询间隔 500ms

// 连接状态
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

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
  status: 'creating' | 'downloading' | 'paused' | 'completed' | 'error'
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
  private heartbeatTimer: NodeJS.Timeout | null = null
  private startPromise: Promise<void> | null = null
  private rpcPort: number = 0

  // 连接稳定性相关状态
  private connectionStatus: ConnectionStatus = 'disconnected'
  private rpcFailureCount: number = 0
  private reconnectAttempts: number = 0
  private isReconnecting: boolean = false
  private lastHeartbeatTime: number = 0

  // 已处理的完成任务集合（防止重复触发）
  private completedGids: Set<string> = new Set()

  constructor() {
    super()
  }

  // 获取当前连接状态
  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus
  }

  // 更新连接状态并发送事件
  private setConnectionStatus(status: ConnectionStatus, error?: string): void {
    const prevStatus = this.connectionStatus
    this.connectionStatus = status
    if (prevStatus !== status) {
      console.log(`[aria2] 连接状态变更: ${prevStatus} -> ${status}`)
      this.emit('connectionStatus', { status, error })
    }
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

    this.setConnectionStatus('connecting')
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
      '--max-connection-per-server=32',
      '--split=64',
      '--check-certificate=false',
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
        this.setConnectionStatus('error', err.message)
        reject(err)
      })

      this.process.on('exit', (code) => {
        console.log('aria2 进程退出，退出码:', code)
        this.isReady = false
        this.stopProgressMonitor()
        this.stopHeartbeat()

        // 如果不是主动停止，尝试重连
        if (!this.isReconnecting && this.connectionStatus !== 'disconnected') {
          this.setConnectionStatus('disconnected', `aria2 进程意外退出 (${code})`)
          this.handleProcessExit()
        }
      })

      // 等待 aria2 启动完成
      const checkReady = async (retries = 30): Promise<void> => {
        try {
          await this.getVersion()
          this.isReady = true
          this.rpcFailureCount = 0
          this.reconnectAttempts = 0
          this.setConnectionStatus('connected')
          this.startProgressMonitor()
          this.startHeartbeat()
          resolve()
        } catch {
          if (retries > 0) {
            setTimeout(() => checkReady(retries - 1), 100)
          } else {
            this.setConnectionStatus('error', 'aria2 启动超时')
            reject(new Error('aria2 启动超时'))
          }
        }
      }

      setTimeout(() => checkReady(), 200)
    })
  }

  // 处理进程意外退出
  private async handleProcessExit(): Promise<void> {
    if (this.isReconnecting) return

    this.isReconnecting = true
    this.reconnectAttempts++

    if (this.reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      console.log(`[aria2] 尝试重连 (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`)
      this.setConnectionStatus('reconnecting')

      // 清理旧状态
      this.startPromise = null
      this.process = null

      // 延迟后重连
      await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY))

      try {
        await this.start()
        console.log('[aria2] 重连成功')
        // 重新注册之前的任务（如果有）
        this.emit('reconnected')
      } catch (error: any) {
        console.error('[aria2] 重连失败:', error.message)
        if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.isReconnecting = false
          this.handleProcessExit()
        } else {
          this.setConnectionStatus('error', '重连失败，已达到最大重试次数')
        }
      }
    } else {
      this.setConnectionStatus('error', '重连失败，已达到最大重试次数')
    }

    this.isReconnecting = false
  }

  // 启动心跳检测
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return

    this.lastHeartbeatTime = Date.now()
    this.heartbeatTimer = setInterval(async () => {
      await this.checkHeartbeat()
    }, HEARTBEAT_INTERVAL)
  }

  // 停止心跳检测
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // 心跳检测
  private async checkHeartbeat(): Promise<void> {
    if (!this.isReady) return

    try {
      const startTime = Date.now()
      await this.sendRequestWithTimeout('getVersion', [], HEARTBEAT_TIMEOUT)
      this.lastHeartbeatTime = Date.now()
      this.rpcFailureCount = 0

      const latency = Date.now() - startTime
      if (latency > 1000) {
        console.warn(`[aria2] 心跳延迟较高: ${latency}ms`)
      }
    } catch (error: any) {
      this.rpcFailureCount++
      console.warn(`[aria2] 心跳检测失败 (${this.rpcFailureCount}/${MAX_RPC_FAILURES}): ${error.message}`)

      if (this.rpcFailureCount >= MAX_RPC_FAILURES) {
        console.error('[aria2] 连续心跳失败，连接可能已断开')
        this.setConnectionStatus('error', '连接超时，正在尝试恢复...')

        // 尝试恢复连接
        this.isReady = false
        this.stopHeartbeat()
        this.stopProgressMonitor()

        // 如果进程还在，先杀掉
        if (this.process) {
          try {
            this.process.kill()
          } catch {}
          this.process = null
        }
        this.startPromise = null

        this.handleProcessExit()
      }
    }
  }

  // 带超时的 RPC 请求
  private sendRequestWithTimeout(method: string, params: any[] = [], timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('RPC 请求超时'))
      }, timeout)

      this.sendRequest(method, params)
        .then(result => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch(error => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  // 停止 aria2 进程
  async stop(): Promise<void> {
    this.setConnectionStatus('disconnected')
    this.stopProgressMonitor()
    this.stopHeartbeat()

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
    this.completedGids.clear()
    this.startPromise = null
    this.rpcFailureCount = 0
    this.reconnectAttempts = 0
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

  // 自定义域名到 IP 的映射
  private hostMapping: Record<string, string> = {}

  // 设置域名到 IP 的映射
  setHostMapping(hostname: string, ip: string): void {
    this.hostMapping[hostname] = ip
    console.log(`[aria2] 设置域名映射: ${hostname} -> ${ip}`)
  }

  // 获取当前映射的 IP
  getHostMapping(hostname: string): string | undefined {
    return this.hostMapping[hostname]
  }

  // 处理 URL，将域名替换为 IP 并返回原始 Host
  private resolveUrl(url: string): { url: string; host: string | null } {
    try {
      const urlObj = new URL(url)
      const mappedIp = this.hostMapping[urlObj.hostname]
      if (mappedIp) {
        const originalHost = urlObj.hostname
        urlObj.hostname = mappedIp
        return { url: urlObj.toString(), host: originalHost }
      }
    } catch {
      // URL 解析失败，返回原始 URL
    }
    return { url, host: null }
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
    // 处理域名到 IP 的映射
    const { url: resolvedUrl, host: originalHost } = this.resolveUrl(url)

    const aria2Options: Record<string, string> = {
      dir: options.dir,
      out: options.out,
    }

    if (options.userAgent) {
      aria2Options['user-agent'] = options.userAgent
    }

    // 构建 header 列表
    const headerList: string[] = []

    // 如果做了域名映射，添加 Host header
    if (originalHost) {
      headerList.push(`Host: ${originalHost}`)
    }

    if (options.headers) {
      Object.entries(options.headers).forEach(([k, v]) => {
        headerList.push(`${k}: ${v}`)
      })
    }

    if (headerList.length > 0) {
      aria2Options['header'] = headerList.join('\n')
    }

    const gid = await this.sendRequest('addUri', [[resolvedUrl], aria2Options])
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

  // 清理已完成任务的记录（从 aria2 的已停止任务列表中移除）
  async removeDownloadResult(gid: string): Promise<void> {
    try {
      await this.sendRequest('removeDownloadResult', [gid])
      console.log(`[aria2] 已清理 aria2 任务记录: ${gid}`)
    } catch (e: any) {
      // 如果任务不存在，忽略错误
      if (!e.message?.includes('is not found')) {
        console.warn(`[aria2] 清理任务记录失败: ${gid}`, e.message)
      }
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
    }, PROGRESS_INTERVAL)
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

      // 获取已停止任务（完成或出错）- 只查询最近的任务
      const stoppedTasks = await this.tellStopped(0, 20)
      for (const task of stoppedTasks) {
        // 只处理我们跟踪的任务
        if (this.gidMap.has(task.gid)) {
          this.emitProgress(task)
        }
      }

      // 重置 RPC 失败计数（成功执行了轮询）
      this.rpcFailureCount = 0
    } catch (error: any) {
      this.rpcFailureCount++
      console.warn(`[aria2] 进度查询失败 (${this.rpcFailureCount}/${MAX_RPC_FAILURES}): ${error.message}`)

      // 如果连续失败次数过多，会由心跳检测处理重连
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
        // 如果还没有下载数据，说明正在预分配文件空间
        if (downloadedSize === 0 && totalSize > 0) {
          status = 'creating'
        } else {
          status = 'downloading'
        }
        // 从已完成集合中移除（可能是重新开始的任务）
        this.completedGids.delete(task.gid)
        break
      case 'waiting':
        status = 'creating' // 等待中显示为创建中
        this.completedGids.delete(task.gid)
        break
      case 'paused':
        status = 'paused'
        break
      case 'complete':
        // 检查是否已经处理过此完成事件（防止重复触发）
        if (this.completedGids.has(task.gid)) {
          return // 已经处理过，跳过
        }
        status = 'completed'
        // 标记为已处理
        this.completedGids.add(task.gid)
        // 立即清理映射（不再延迟）
        this.taskMap.delete(taskId)
        this.gidMap.delete(task.gid)
        // 清理 aria2 中的任务记录
        this.removeDownloadResult(task.gid)
        // 延迟清理已完成集合（给足够时间确保不会重复处理）
        setTimeout(() => {
          this.completedGids.delete(task.gid)
        }, 5000)
        break
      case 'error':
      case 'removed':
        // 检查是否已经处理过此错误事件
        if (this.completedGids.has(task.gid)) {
          return
        }
        status = 'error'
        error = task.errorMessage || `错误代码: ${task.errorCode}`
        // 标记为已处理
        this.completedGids.add(task.gid)
        // 清理映射
        this.taskMap.delete(taskId)
        this.gidMap.delete(task.gid)
        // 清理 aria2 中的任务记录
        this.removeDownloadResult(task.gid)
        setTimeout(() => {
          this.completedGids.delete(task.gid)
        }, 5000)
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

  // 获取所有活跃任务的 taskId 列表
  getActiveTaskIds(): string[] {
    return Array.from(this.taskMap.keys())
  }

  // 获取连接统计信息
  getConnectionStats(): {
    status: ConnectionStatus
    rpcFailures: number
    reconnectAttempts: number
    lastHeartbeat: number
    taskCount: number
  } {
    return {
      status: this.connectionStatus,
      rpcFailures: this.rpcFailureCount,
      reconnectAttempts: this.reconnectAttempts,
      lastHeartbeat: this.lastHeartbeatTime,
      taskCount: this.taskMap.size
    }
  }

  // 手动触发重连
  async reconnect(): Promise<void> {
    console.log('[aria2] 手动触发重连')
    this.isReady = false
    this.stopHeartbeat()
    this.stopProgressMonitor()

    if (this.process) {
      try {
        this.process.kill()
      } catch {}
      this.process = null
    }
    this.startPromise = null
    this.reconnectAttempts = 0 // 重置重连计数

    await this.start()
  }

  // 重置重连计数（用于外部重试）
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0
  }
}

// 创建全局 aria2 客户端实例
export const aria2Client = new Aria2Client()
