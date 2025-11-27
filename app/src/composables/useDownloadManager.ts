import { ref, onMounted, onUnmounted } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useSettingsStore } from '@/stores/settings'
import { useApi } from './useApi'
import type { DownloadProgress } from '@/types'
import path from 'path-browserify'

const MAX_CONCURRENT_DOWNLOADS = 3
const MAX_RETRY = 3
const RETRY_DELAY = 5000

export function useDownloadManager() {
  const downloadStore = useDownloadStore()
  const settingsStore = useSettingsStore()
  const api = useApi()

  const isProcessing = ref(false)
  const errorCount = ref(0)

  // 设置进度监听
  function setupProgressListener() {
    window.electronAPI?.onDownloadProgress((progress: DownloadProgress) => {
      const task = downloadStore.downloadingTasks.find(t => t.id === progress.taskId)
      if (!task) return

      if (progress.status === 'downloading') {
        downloadStore.updateTaskProgress(
          task.id,
          progress.progress,
          progress.speed,
          progress.downloadedSize
        )
      } else if (progress.status === 'completed') {
        downloadStore.moveToCompleted(task, true)
        processWaitingQueue()
      } else if (progress.status === 'error') {
        task.error = progress.error || '下载失败'
        downloadStore.moveToCompleted(task, false)
        processWaitingQueue()
      } else if (progress.status === 'paused') {
        task.status = 'paused'
      }
    })
  }

  // 移除进度监听
  function removeProgressListener() {
    window.electronAPI?.removeDownloadProgressListener()
  }

  // 处理等待队列
  async function processWaitingQueue() {
    if (isProcessing.value) return

    // 检查下载中任务数
    if (downloadStore.activeDownloadCount >= MAX_CONCURRENT_DOWNLOADS) {
      return
    }

    // 检查错误数量
    if (errorCount.value >= 3) {
      downloadStore.pauseAllWaiting()
      return
    }

    // 获取下一个等待任务
    const nextTask = downloadStore.waitingTasks.find(
      t => t.status === 'waiting'
    )

    if (!nextTask) return

    isProcessing.value = true
    downloadStore.updateWaitingTaskStatus(nextTask.id, 'processing')

    try {
      // 获取下载链接
      const linkData = await api.getDownloadLink({
        code: downloadStore.currentCode,
        randsk: downloadStore.sessionData!.randsk,
        uk: downloadStore.sessionData!.uk,
        shareid: downloadStore.sessionData!.shareid,
        fs_id: nextTask.file.fs_id,
        surl: downloadStore.sessionData!.surl,
        dir: path.dirname(nextTask.file.path) || '/',
        pwd: downloadStore.sessionData!.pwd
      })

      nextTask.downloadUrl = linkData.url
      nextTask.ua = linkData.ua

      // 计算本地路径
      const localDir = path.join(
        settingsStore.downloadPath,
        path.dirname(nextTask.file.path).replace(/^\//, '')
      )
      const localPath = path.join(localDir, nextTask.file.server_filename)
      nextTask.localPath = localPath

      // 使用内置下载器开始下载
      const result = await window.electronAPI?.startDownload(nextTask.id, {
        url: linkData.url,
        savePath: localDir,
        filename: nextTask.file.server_filename,
        userAgent: linkData.ua
      })

      if (result?.success) {
        // 移动到下载中
        downloadStore.moveToDownloading(nextTask)
        errorCount.value = 0
      } else {
        throw new Error(result?.error || '启动下载失败')
      }
    } catch (error: any) {
      console.error('获取下载链接失败:', error)
      nextTask.retryCount++

      if (nextTask.retryCount >= MAX_RETRY) {
        nextTask.status = 'error'
        nextTask.error = error.message || '获取下载链接失败'
        errorCount.value++
      } else {
        // 等待后重试
        setTimeout(() => {
          nextTask.status = 'waiting'
          processWaitingQueue()
        }, RETRY_DELAY)
      }
    } finally {
      isProcessing.value = false
    }

    // 继续处理队列
    setTimeout(processWaitingQueue, 500)
  }

  // 暂停下载
  async function pauseTask(taskId: string) {
    await window.electronAPI?.pauseDownload(taskId)
  }

  // 恢复下载
  async function resumeTask(taskId: string) {
    await window.electronAPI?.resumeDownload(taskId)
  }

  // 取消下载
  async function cancelTask(taskId: string) {
    await window.electronAPI?.cancelDownload(taskId)
  }

  // 开始下载
  function startDownload() {
    processWaitingQueue()
  }

  // 重置错误计数
  function resetErrorCount() {
    errorCount.value = 0
  }

  // 组件挂载时设置监听
  onMounted(() => {
    setupProgressListener()
  })

  // 组件卸载时移除监听
  onUnmounted(() => {
    removeProgressListener()
  })

  return {
    isProcessing,
    errorCount,
    startDownload,
    processWaitingQueue,
    resetErrorCount,
    pauseTask,
    resumeTask,
    cancelTask,
    setupProgressListener,
    removeProgressListener
  }
}
