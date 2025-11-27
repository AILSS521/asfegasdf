import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  // 下载路径
  const downloadPath = ref('')

  // 初始化
  async function init() {
    // 从本地存储读取设置
    const savedPath = localStorage.getItem('downloadPath')
    if (savedPath) {
      downloadPath.value = savedPath
    } else {
      // 获取默认下载路径
      const defaultPath = await window.electronAPI?.getDownloadPath()
      if (defaultPath) {
        downloadPath.value = defaultPath
      }
    }
  }

  // 设置下载路径
  async function setDownloadPath(path: string) {
    const newPath = await window.electronAPI?.setDownloadPath(path)
    if (newPath) {
      downloadPath.value = newPath
      localStorage.setItem('downloadPath', newPath)
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
