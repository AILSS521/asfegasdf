import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'

// 下载配置
const DEFAULT_THREADS = 64 // 默认线程数
const MIN_CHUNK_SIZE = 1024 * 1024 // 最小分片 1MB
const MAX_RETRIES = 3 // 最大重试次数
const RETRY_DELAY = 2000 // 重试延迟 2秒
const PROGRESS_INTERVAL = 500 // 进度更新间隔

interface DownloadOptions {
  url: string
  savePath: string
  filename: string
  threads?: number
  headers?: Record<string, string>
  userAgent?: string
}

interface ChunkInfo {
  index: number
  start: number
  end: number
  downloaded: number
  status: 'pending' | 'downloading' | 'completed' | 'error'
  retries: number
}

interface DownloadProgress {
  taskId: string
  totalSize: number
  downloadedSize: number
  speed: number
  progress: number
  status: 'downloading' | 'paused' | 'completed' | 'error'
  error?: string
}

export class MultiThreadDownloader extends EventEmitter {
  private taskId: string
  private url: string
  private savePath: string
  private filename: string
  private threads: number
  private headers: Record<string, string>
  private userAgent: string

  private totalSize: number = 0
  private downloadedSize: number = 0
  private chunks: ChunkInfo[] = []
  private activeRequests: Map<number, http.ClientRequest> = new Map()
  private tempFiles: string[] = []
  private isPaused: boolean = false
  private isAborted: boolean = false
  private lastProgressTime: number = 0
  private lastDownloadedSize: number = 0
  private speed: number = 0
  private progressTimer: NodeJS.Timeout | null = null

  constructor(taskId: string, options: DownloadOptions) {
    super()
    this.taskId = taskId
    this.url = options.url
    this.savePath = options.savePath
    this.filename = options.filename
    this.threads = options.threads || DEFAULT_THREADS
    this.userAgent = options.userAgent || 'netdisk;pan.baidu.com'
    this.headers = {
      'User-Agent': this.userAgent,
      ...options.headers
    }
  }

  // 开始下载
  async start(): Promise<void> {
    try {
      // 确保目录存在
      await fs.promises.mkdir(this.savePath, { recursive: true })

      // 获取文件大小
      this.totalSize = await this.getFileSize()

      if (this.totalSize <= 0) {
        throw new Error('无法获取文件大小')
      }

      // 百度网盘支持 Range 请求，直接使用多线程下载
      // 只有文件太小时才使用单线程
      if (this.totalSize < MIN_CHUNK_SIZE * 2) {
        await this.singleThreadDownload()
      } else {
        await this.multiThreadDownload()
      }
    } catch (error: any) {
      this.emitProgress('error', error.message)
      throw error
    }
  }

  // 获取文件大小
  private getFileSize(): Promise<number> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.url)
      const client = urlObj.protocol === 'https:' ? https : http

      const req = client.request(this.url, {
        method: 'HEAD',
        headers: this.headers,
        timeout: 30000
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // 处理重定向
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            this.url = redirectUrl
            resolve(this.getFileSize())
            return
          }
        }

        const contentLength = res.headers['content-length']
        if (contentLength) {
          resolve(parseInt(contentLength, 10))
        } else {
          resolve(0)
        }
      })

      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('获取文件信息超时'))
      })
      req.end()
    })
  }

  // 检查是否支持 Range 请求
  private checkRangeSupport(): Promise<boolean> {
    return new Promise((resolve) => {
      const urlObj = new URL(this.url)
      const client = urlObj.protocol === 'https:' ? https : http

      const req = client.request(this.url, {
        method: 'HEAD',
        headers: {
          ...this.headers,
          'Range': 'bytes=0-0'
        },
        timeout: 30000
      }, (res) => {
        // 处理重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            this.url = redirectUrl
            // 递归检查重定向后的URL
            this.checkRangeSupport().then(resolve)
            return
          }
        }
        // 206 表示支持 Range，有些服务器返回 200 但在 Accept-Ranges 头中声明支持
        const acceptRanges = res.headers['accept-ranges']
        resolve(res.statusCode === 206 || acceptRanges === 'bytes')
      })

      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.end()
    })
  }

  // 单线程下载
  private singleThreadDownload(): Promise<void> {
    return new Promise((resolve, reject) => {
      const filePath = path.join(this.savePath, this.filename)
      const fileStream = fs.createWriteStream(filePath)
      const urlObj = new URL(this.url)
      const client = urlObj.protocol === 'https:' ? https : http

      this.startProgressTimer()

      const req = client.get(this.url, { headers: this.headers }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            this.url = redirectUrl
            fileStream.close()
            this.singleThreadDownload().then(resolve).catch(reject)
            return
          }
        }

        if (res.statusCode !== 200) {
          fileStream.close()
          reject(new Error(`HTTP 错误: ${res.statusCode}`))
          return
        }

        res.on('data', (chunk: Buffer) => {
          if (this.isPaused || this.isAborted) {
            req.destroy()
            return
          }
          this.downloadedSize += chunk.length
        })

        res.pipe(fileStream)

        fileStream.on('finish', () => {
          this.stopProgressTimer()
          this.emitProgress('completed')
          resolve()
        })
      })

      req.on('error', (err) => {
        this.stopProgressTimer()
        fileStream.close()
        reject(err)
      })

      this.activeRequests.set(0, req)
    })
  }

  // 多线程下载
  private async multiThreadDownload(): Promise<void> {
    // 计算分片
    const chunkSize = Math.max(
      MIN_CHUNK_SIZE,
      Math.ceil(this.totalSize / this.threads)
    )

    let start = 0
    let index = 0

    while (start < this.totalSize) {
      const end = Math.min(start + chunkSize - 1, this.totalSize - 1)
      this.chunks.push({
        index,
        start,
        end,
        downloaded: 0,
        status: 'pending',
        retries: 0
      })
      this.tempFiles.push(path.join(this.savePath, `${this.filename}.part${index}`))
      start = end + 1
      index++
    }

    this.startProgressTimer()

    // 并发下载所有分片
    const downloadPromises = this.chunks.map(chunk => this.downloadChunk(chunk))

    try {
      await Promise.all(downloadPromises)

      // 如果被暂停或取消，不继续处理
      if (this.isAborted) {
        await this.cleanup()
        return
      }

      if (this.isPaused) {
        // 暂停状态，不合并文件，等待恢复
        this.stopProgressTimer()
        return
      }

      // 检查是否所有分片都已完成
      const allCompleted = this.chunks.every(c => c.status === 'completed')
      if (!allCompleted) {
        // 有分片未完成，可能是暂停导致的
        this.stopProgressTimer()
        return
      }

      // 合并文件
      await this.mergeChunks()
      this.stopProgressTimer()
      this.emitProgress('completed')
    } catch (error) {
      this.stopProgressTimer()
      await this.cleanup()
      throw error
    }
  }

  // 下载单个分片
  private downloadChunk(chunk: ChunkInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isPaused || this.isAborted) {
        resolve()
        return
      }

      chunk.status = 'downloading'
      const tempPath = this.tempFiles[chunk.index]
      // 如果已下载部分数据，则追加写入；否则从头写入
      const fileStream = chunk.downloaded > 0
        ? fs.createWriteStream(tempPath, { flags: 'a' })
        : fs.createWriteStream(tempPath)
      const urlObj = new URL(this.url)
      const client = urlObj.protocol === 'https:' ? https : http

      const req = client.get(this.url, {
        headers: {
          ...this.headers,
          'Range': `bytes=${chunk.start + chunk.downloaded}-${chunk.end}`
        }
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            this.url = redirectUrl
            fileStream.close()
            this.downloadChunk(chunk).then(resolve).catch(reject)
            return
          }
        }

        if (res.statusCode !== 206 && res.statusCode !== 200) {
          fileStream.close()
          this.handleChunkError(chunk, new Error(`HTTP 错误: ${res.statusCode}`), resolve, reject)
          return
        }

        res.on('data', (data: Buffer) => {
          if (this.isPaused || this.isAborted) {
            req.destroy()
            return
          }
          chunk.downloaded += data.length
          this.downloadedSize += data.length
        })

        res.pipe(fileStream)

        fileStream.on('finish', () => {
          this.activeRequests.delete(chunk.index)
          // 只有当分片确实完整下载时才标记为完成
          const expectedSize = chunk.end - chunk.start + 1
          if (chunk.downloaded >= expectedSize) {
            chunk.status = 'completed'
          } else if (!this.isPaused && !this.isAborted) {
            // 如果没有暂停/取消但下载不完整，标记为 pending 以便重试
            chunk.status = 'pending'
          }
          resolve()
        })

        res.on('error', (err) => {
          fileStream.close()
          this.handleChunkError(chunk, err, resolve, reject)
        })
      })

      req.on('error', (err) => {
        fileStream.close()
        this.handleChunkError(chunk, err, resolve, reject)
      })

      req.on('timeout', () => {
        req.destroy()
        fileStream.close()
        this.handleChunkError(chunk, new Error('下载超时'), resolve, reject)
      })

      this.activeRequests.set(chunk.index, req)
    })
  }

  // 处理分片下载错误
  private handleChunkError(
    chunk: ChunkInfo,
    error: Error,
    resolve: () => void,
    reject: (err: Error) => void
  ) {
    chunk.retries++
    this.activeRequests.delete(chunk.index)

    if (chunk.retries < MAX_RETRIES && !this.isAborted) {
      chunk.status = 'pending'
      setTimeout(() => {
        this.downloadChunk(chunk).then(resolve).catch(reject)
      }, RETRY_DELAY)
    } else {
      chunk.status = 'error'
      reject(error)
    }
  }

  // 合并分片文件
  private async mergeChunks(): Promise<void> {
    const finalPath = path.join(this.savePath, this.filename)
    const writeStream = fs.createWriteStream(finalPath)

    for (const tempFile of this.tempFiles) {
      const data = await fs.promises.readFile(tempFile)
      writeStream.write(data)
    }

    writeStream.end()

    // 等待写入完成
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
    })

    // 删除临时文件
    for (const tempFile of this.tempFiles) {
      try {
        await fs.promises.unlink(tempFile)
      } catch {
        // 忽略删除失败
      }
    }
  }

  // 清理临时文件
  private async cleanup(): Promise<void> {
    for (const tempFile of this.tempFiles) {
      try {
        await fs.promises.unlink(tempFile)
      } catch {
        // 忽略
      }
    }
  }

  // 开始进度定时器
  private startProgressTimer() {
    this.lastProgressTime = Date.now()
    this.lastDownloadedSize = 0

    this.progressTimer = setInterval(() => {
      const now = Date.now()
      const timeDiff = (now - this.lastProgressTime) / 1000
      const sizeDiff = this.downloadedSize - this.lastDownloadedSize

      this.speed = timeDiff > 0 ? sizeDiff / timeDiff : 0
      this.lastProgressTime = now
      this.lastDownloadedSize = this.downloadedSize

      this.emitProgress('downloading')
    }, PROGRESS_INTERVAL)
  }

  // 停止进度定时器
  private stopProgressTimer() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer)
      this.progressTimer = null
    }
  }

  // 发送进度事件
  private emitProgress(status: DownloadProgress['status'], error?: string) {
    const progress: DownloadProgress = {
      taskId: this.taskId,
      totalSize: this.totalSize,
      downloadedSize: this.downloadedSize,
      speed: this.speed,
      progress: this.totalSize > 0 ? (this.downloadedSize / this.totalSize) * 100 : 0,
      status,
      error
    }
    this.emit('progress', progress)
  }

  // 暂停下载
  pause() {
    this.isPaused = true
    this.stopProgressTimer()
    // 停止所有活动请求
    this.activeRequests.forEach(req => req.destroy())
    this.activeRequests.clear()
    // 将正在下载的分片标记为 pending
    this.chunks.forEach(chunk => {
      if (chunk.status === 'downloading') {
        chunk.status = 'pending'
      }
    })
    this.emitProgress('paused')
  }

  // 恢复下载
  async resume() {
    if (!this.isPaused) return
    this.isPaused = false

    // 重新下载未完成的分片
    const pendingChunks = this.chunks.filter(c => c.status !== 'completed')
    if (pendingChunks.length > 0) {
      this.startProgressTimer()
      try {
        const promises = pendingChunks.map(chunk => this.downloadChunk(chunk))
        await Promise.all(promises)

        if (!this.isAborted && !this.isPaused) {
          await this.mergeChunks()
          this.stopProgressTimer()
          this.emitProgress('completed')
        }
      } catch (error: any) {
        this.stopProgressTimer()
        this.emitProgress('error', error.message)
      }
    } else if (this.chunks.length === 0) {
      // 单线程下载模式，需要重新开始
      // 因为单线程下载没有分片信息，暂停后无法断点续传
      // 发送错误提示
      this.emitProgress('error', '单线程下载不支持断点续传，请重新下载')
    }
  }

  // 取消下载
  async abort() {
    this.isAborted = true
    this.stopProgressTimer()
    this.activeRequests.forEach(req => req.destroy())
    this.activeRequests.clear()
    await this.cleanup()
  }

  // 获取任务ID
  getTaskId(): string {
    return this.taskId
  }
}

// 下载管理器
export class DownloadManager {
  private tasks: Map<string, MultiThreadDownloader> = new Map()
  private progressCallback: ((progress: DownloadProgress) => void) | null = null

  // 设置进度回调
  setProgressCallback(callback: (progress: DownloadProgress) => void) {
    this.progressCallback = callback
  }

  // 添加下载任务
  addTask(taskId: string, options: DownloadOptions): MultiThreadDownloader {
    const downloader = new MultiThreadDownloader(taskId, options)

    downloader.on('progress', (progress: DownloadProgress) => {
      if (this.progressCallback) {
        this.progressCallback(progress)
      }
    })

    this.tasks.set(taskId, downloader)
    return downloader
  }

  // 开始下载
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (task) {
      await task.start()
    }
  }

  // 暂停下载
  pauseTask(taskId: string) {
    const task = this.tasks.get(taskId)
    if (task) {
      task.pause()
    }
  }

  // 恢复下载
  async resumeTask(taskId: string) {
    const task = this.tasks.get(taskId)
    if (task) {
      await task.resume()
    }
  }

  // 取消下载
  async cancelTask(taskId: string) {
    const task = this.tasks.get(taskId)
    if (task) {
      await task.abort()
      this.tasks.delete(taskId)
    }
  }

  // 获取任务
  getTask(taskId: string): MultiThreadDownloader | undefined {
    return this.tasks.get(taskId)
  }

  // 获取所有任务
  getAllTasks(): Map<string, MultiThreadDownloader> {
    return this.tasks
  }
}

// 创建全局下载管理器实例
export const downloadManager = new DownloadManager()
