// 文件项
export interface FileItem {
  fs_id: number | string
  server_filename: string
  path: string
  size: number
  isdir: number
  server_mtime: number
  category?: number
  md5?: string
}

// 任务状态
// waiting: 等待中
// processing: 处理中（正在获取下载链接）
// creating: 创建文件中（正在预创建文件）
// downloading: 下载中
// paused: 已暂停
// completed: 已完成
// error: 异常
export type TaskStatus = 'waiting' | 'processing' | 'creating' | 'downloading' | 'paused' | 'completed' | 'error'

// 下载任务
export interface DownloadTask {
  id: string
  file: FileItem
  status: TaskStatus
  progress: number
  speed: number
  downloadedSize: number
  totalSize: number
  createdAt: number
  completedAt?: number
  retryCount: number
  gid?: string // aria2 task id
  error?: string
  downloadUrl?: string
  ua?: string
  localPath?: string
  downloadBasePath?: string | null // 下载基础路径，null 表示直接放在下载目录，不创建子目录
}

// API响应
export interface ApiResponse<T = any> {
  code: number
  message: string
  data?: T
}

// 文件列表响应
export interface FileListResponse {
  uk: string
  shareid: string
  randsk: string
  surl: string
  pwd: string
  list: FileItem[]
  ttl: number
}

// 下载链接响应
export interface DownloadLinkResponse {
  filename: string
  fs_id: string | number
  url: string
  urls: string[]
  ua: string
}

// 下载进度
export interface DownloadProgress {
  taskId: string
  totalSize: number
  downloadedSize: number
  speed: number
  progress: number
  status: 'downloading' | 'paused' | 'completed' | 'error'
  error?: string
}

