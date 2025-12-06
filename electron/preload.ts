import { contextBridge, ipcRenderer } from 'electron'

// 下载进度类型
interface DownloadProgress {
  taskId: string
  totalSize: number
  downloadedSize: number
  speed: number
  progress: number
  status: 'creating' | 'downloading' | 'paused' | 'completed' | 'error'
  error?: string
}

// 连接状态类型
type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

// 连接统计信息类型
interface ConnectionStats {
  status: ConnectionStatus
  rpcFailures: number
  reconnectAttempts: number
  lastHeartbeat: number
  taskCount: number
}

// 暴露API到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // 文件对话框
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // Shell操作
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),

  // 设置
  getDownloadPath: () => ipcRenderer.invoke('settings:getDownloadPath'),
  setDownloadPath: (path: string) => ipcRenderer.invoke('settings:setDownloadPath', path),

  // 配置读写
  getConfig: (key: string) => ipcRenderer.invoke('config:get', key),
  setConfig: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
  getAllConfig: () => ipcRenderer.invoke('config:getAll'),

  // 下载线路
  selectBestRoute: () => ipcRenderer.invoke('route:selectBest'),
  getCurrentRoute: () => ipcRenderer.invoke('route:getCurrent'),
  testCurrentRoute: () => ipcRenderer.invoke('route:testCurrent'),

  // 下载管理
  startDownload: (taskId: string, options: {
    url: string
    savePath: string
    filename: string
    userAgent?: string
  }) => ipcRenderer.invoke('download:start', taskId, options),

  pauseDownload: (taskId: string) => ipcRenderer.invoke('download:pause', taskId),
  resumeDownload: (taskId: string) => ipcRenderer.invoke('download:resume', taskId),
  cancelDownload: (taskId: string) => ipcRenderer.invoke('download:cancel', taskId),

  // 下载器连接状态
  getConnectionStatus: () => ipcRenderer.invoke('download:getConnectionStatus') as Promise<ConnectionStatus>,
  getConnectionStats: () => ipcRenderer.invoke('download:getConnectionStats') as Promise<ConnectionStats>,
  reconnectDownloader: () => ipcRenderer.invoke('download:reconnect') as Promise<{ success: boolean; error?: string }>,

  // 下载进度监听
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    ipcRenderer.on('download:progress', (_, progress) => callback(progress))
  },

  // 连接状态变化监听
  onConnectionStatusChange: (callback: (status: ConnectionStatus, error?: string) => void) => {
    ipcRenderer.on('download:connectionStatus', (_, data: { status: ConnectionStatus; error?: string }) => {
      callback(data.status, data.error)
    })
  },

  // 移除连接状态监听
  removeConnectionStatusListener: () => {
    ipcRenderer.removeAllListeners('download:connectionStatus')
  },

  // 移除下载进度监听
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download:progress')
  }
})

