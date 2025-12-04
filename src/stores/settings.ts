import { defineStore } from 'pinia'
import { ref } from 'vue'

// 下载线路类型
export interface DownloadRoute {
  name: string
  ip: string
  latency?: number
}

export const useSettingsStore = defineStore('settings', () => {
  // 下载路径
  const downloadPath = ref('')

  // 最大同时下载任务数（1-3）
  const maxConcurrentDownloads = ref(3)

  // 当前下载线路
  const currentRoute = ref<DownloadRoute | null>(null)

  // 是否正在测试线路
  const isTestingRoute = ref(false)

  // 初始化 - 从主进程读取配置
  async function init() {
    const currentPath = await window.electronAPI?.getDownloadPath()
    if (currentPath) {
      downloadPath.value = currentPath
    }

    // 读取最大并发数配置
    const savedMaxConcurrent = await window.electronAPI?.getConfig('maxConcurrentDownloads')
    if (savedMaxConcurrent !== undefined && savedMaxConcurrent >= 1 && savedMaxConcurrent <= 3) {
      maxConcurrentDownloads.value = savedMaxConcurrent
    }

    // 获取当前线路
    const route = await window.electronAPI?.getCurrentRoute()
    if (route) {
      currentRoute.value = route
    }
  }

  // 设置下载路径 - 保存到主进程配置文件
  async function setDownloadPath(path: string) {
    const newPath = await window.electronAPI?.setDownloadPath(path)
    if (newPath) {
      downloadPath.value = newPath
    }
  }

  // 打开文件夹选择对话框
  async function selectDownloadPath() {
    const selectedPath = await window.electronAPI?.selectFolder()
    if (selectedPath) {
      await setDownloadPath(selectedPath)
    }
  }

  // 设置最大并发下载数
  async function setMaxConcurrentDownloads(value: number) {
    // 限制范围 1-3
    const clampedValue = Math.max(1, Math.min(3, value))
    maxConcurrentDownloads.value = clampedValue
    await window.electronAPI?.setConfig('maxConcurrentDownloads', clampedValue)
  }

  // 测试当前线路延迟
  async function testCurrentRoute() {
    if (isTestingRoute.value) return
    isTestingRoute.value = true
    try {
      const result = await window.electronAPI?.testCurrentRoute()
      if (result?.success && result.route) {
        currentRoute.value = result.route
      }
    } finally {
      isTestingRoute.value = false
    }
  }

  return {
    downloadPath,
    maxConcurrentDownloads,
    currentRoute,
    isTestingRoute,
    init,
    setDownloadPath,
    selectDownloadPath,
    setMaxConcurrentDownloads,
    testCurrentRoute
  }
})
