// 通用文件项（抽象格式，不暴露具体网盘实现）
export interface FileItem {
  id: string              // 文件唯一标识
  name: string            // 文件名
  path: string            // 文件路径
  size: number            // 文件大小
  type: 'file' | 'folder' // 文件类型
  modified: number        // 修改时间戳
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

// 子文件任务（文件夹内的单个文件）
export interface SubFileTask {
  file: FileItem
  status: TaskStatus
  progress: number
  speed: number
  downloadedSize: number
  totalSize: number
  retryCount: number
  error?: string
  downloadUrl?: string
  headers?: Record<string, string>
  localPath?: string
}

// 任务会话数据（加密的会话字符串，客户端不知道内容）
export interface TaskSessionData {
  code: string            // 下载编码
  session: string         // 加密的会话数据（服务端加密，客户端透传）
  basePath: string        // 分享链接的根目录路径，用于计算相对路径
  currentApiPath?: string // 添加任务时的API目录路径，用于获取下载链接
}

// 下载任务
export interface DownloadTask {
  id: string
  file: FileItem // 对于文件夹任务，这是文件夹本身的信息
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
  headers?: Record<string, string>
  localPath?: string
  downloadBasePath?: string | null // 下载基础路径，null 表示直接放在下载目录，不创建子目录
  sessionData?: TaskSessionData // 任务专属的会话数据，避免被新下载编码覆盖

  // 文件夹任务专用字段
  isFolder?: boolean // 是否是文件夹任务
  subFiles?: SubFileTask[] // 文件夹内的所有文件
  completedCount?: number // 已完成的文件数量
  totalCount?: number // 总文件数量
  currentFileIndex?: number // 当前正在下载的文件索引
  currentFileName?: string // 当前正在下载的文件名
}

// API响应
export interface ApiResponse<T = any> {
  code: number
  message: string
  data?: T
}

// 文件列表响应（通用格式）
export interface FileListResponse {
  session: string         // 加密的会话数据
  ttl: number             // 剩余有效期（秒）
  path: string            // 当前路径
  files: FileItem[]       // 文件列表
}

// 下载链接响应（通用格式）
export interface DownloadLinkResponse {
  name: string                      // 文件名
  url: string                       // 下载链接
  headers: Record<string, string>   // 下载时需要的请求头
}

// 下载进度
export interface DownloadProgress {
  taskId: string
  totalSize: number
  downloadedSize: number
  speed: number
  progress: number
  status: 'creating' | 'downloading' | 'paused' | 'completed' | 'error'
  error?: string
}
