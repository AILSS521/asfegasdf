import { aria2Client, DownloadProgress } from './aria2-client'

// 下载选项接口
interface DownloadOptions {
  url: string
  savePath: string
  filename: string
  threads?: number
  headers?: Record<string, string>
  userAgent?: string
}

// 下载管理器 - 基于 aria2
export class DownloadManager {
  private progressCallback: ((progress: DownloadProgress) => void) | null = null
  private isInitialized: boolean = false

  constructor() {
    // 监听 aria2 进度事件
    aria2Client.on('progress', (progress: DownloadProgress) => {
      if (this.progressCallback) {
        this.progressCallback(progress)
      }
    })
  }

  // 初始化 aria2
  async init(): Promise<void> {
    if (this.isInitialized) return
    await aria2Client.start()
    this.isInitialized = true
  }

  // 停止 aria2
  async stop(): Promise<void> {
    await aria2Client.stop()
    this.isInitialized = false
  }

  // 设置进度回调
  setProgressCallback(callback: (progress: DownloadProgress) => void) {
    this.progressCallback = callback
  }

  // 添加并开始下载任务
  async addTask(taskId: string, options: DownloadOptions): Promise<string> {
    // 确保 aria2 已启动
    await this.init()

    // 添加下载任务
    const gid = await aria2Client.addUri(taskId, options.url, {
      dir: options.savePath,
      out: options.filename,
      userAgent: options.userAgent || 'netdisk;pan.baidu.com',
      headers: options.headers
    })

    return gid
  }

  // 暂停下载
  async pauseTask(taskId: string): Promise<void> {
    await aria2Client.pause(taskId)
  }

  // 恢复下载
  async resumeTask(taskId: string): Promise<void> {
    await aria2Client.unpause(taskId)
  }

  // 取消下载
  async cancelTask(taskId: string): Promise<void> {
    await aria2Client.forceRemove(taskId)
  }

  // 获取任务状态
  async getTaskStatus(taskId: string) {
    return await aria2Client.tellStatus(taskId)
  }

  // 检查任务是否存在
  hasTask(taskId: string): boolean {
    return aria2Client.hasTask(taskId)
  }

  // 检查是否就绪
  isReady(): boolean {
    return this.isInitialized && aria2Client.isClientReady()
  }
}

// 创建全局下载管理器实例
export const downloadManager = new DownloadManager()

// 为了兼容性，也导出 DownloadProgress 类型
export type { DownloadProgress }
