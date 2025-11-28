import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  // 下载路径
  const downloadPath = ref('')

  // 初始化 - 从主进程读取配置
  async function init() {
    const currentPath = await window.electronAPI?.getDownloadPath()
    if (currentPath) {
      downloadPath.value = currentPath
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

  return {
    downloadPath,
    init,
    setDownloadPath,
    selectDownloadPath
  }
})
