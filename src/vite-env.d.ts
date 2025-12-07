/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'path-browserify'

// 下载进度类型
interface DownloadProgress {
  taskId: string
  totalSize: number
  downloadedSize: number
  speed: number
  progress: number
  status: 'downloading' | 'paused' | 'completed' | 'error'
  error?: string
}

// 下载线路类型
interface DownloadRoute {
  name: string
  ip: string
  latency?: number
}

interface ElectronAPI {
  // 窗口控制
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>

  // 文件对话框
  selectFolder: () => Promise<string | null>

  // Shell 操作
  openPath: (path: string) => Promise<void>
  showItemInFolder: (path: string) => Promise<void>

  // 设置
  getDownloadPath: () => Promise<string>
  setDownloadPath: (path: string) => Promise<string>

  // 配置读写
  getConfig: (key: string) => Promise<any>
  setConfig: (key: string, value: any) => Promise<boolean>

  // 下载线路
  selectBestRoute: () => Promise<DownloadRoute>
  getCurrentRoute: () => Promise<DownloadRoute | null>
  testCurrentRoute: () => Promise<{ success: boolean; route?: DownloadRoute; error?: string }>

  // 下载管理
  startDownload: (taskId: string, options: {
    url: string
    savePath: string
    filename: string
    userAgent?: string
  }) => Promise<{ success: boolean; error?: string }>
  pauseDownload: (taskId: string) => Promise<{ success: boolean }>
  resumeDownload: (taskId: string) => Promise<{ success: boolean; error?: string }>
  cancelDownload: (taskId: string) => Promise<{ success: boolean; error?: string }>
  cleanupDownload: (taskId: string) => Promise<{ success: boolean; error?: string }>

  // 下载进度监听
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => void
  removeDownloadProgressListener: () => void
}

interface Window {
  electronAPI: ElectronAPI
}
