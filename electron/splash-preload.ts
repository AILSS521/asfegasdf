import { contextBridge, ipcRenderer } from 'electron'

// 暴露API到启动画面渲染进程
contextBridge.exposeInMainWorld('electronSplashAPI', {
  // 检查版本
  checkVersion: () => ipcRenderer.invoke('splash:checkVersion'),
  // 初始化下载器
  initDownloader: () => ipcRenderer.invoke('splash:initDownloader'),
  // 测试下载器连接
  testDownloader: () => ipcRenderer.invoke('splash:testDownloader'),
  // 版本检查通过，进入主程序
  proceed: () => ipcRenderer.invoke('splash:proceed'),
  // 关闭程序
  close: () => ipcRenderer.invoke('splash:close')
})
