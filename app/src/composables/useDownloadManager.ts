import { ref } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useSettingsStore } from '@/stores/settings'
import { useApi } from './useApi'
import { useAria2 } from './useAria2'
import type { DownloadTask } from '@/types'
import path from 'path-browserify'

const MAX_CONCURRENT_DOWNLOADS = 3
const MAX_RETRY = 3
const RETRY_DELAY = 5000

export function useDownloadManager() {
  const downloadStore = useDownloadStore()
  const settingsStore = useSettingsStore()
  const api = useApi()
  const aria2 = useAria2()

  const isProcessing = ref(false)
  const errorCount = ref(0)

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

      // 添加到aria2
      const gid = await aria2.addUri(linkData.url, {
        dir: localDir,
        out: nextTask.file.server_filename,
        userAgent: linkData.ua
      })

      nextTask.gid = gid

      // 移动到下载中
      downloadStore.moveToDownloading(nextTask)
      errorCount.value = 0

      // 开始监控下载进度
      startProgressMonitor(nextTask)
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

  // 监控下载进度
  function startProgressMonitor(task: DownloadTask) {
    const interval = setInterval(async () => {
      if (!task.gid) {
        clearInterval(interval)
        return
      }

      try {
        const status = await aria2.tellStatus(task.gid)

        const totalLength = parseInt(status.totalLength) || task.totalSize
        const completedLength = parseInt(status.completedLength) || 0
        const downloadSpeed = parseInt(status.downloadSpeed) || 0
        const progress = totalLength > 0 ? (completedLength / totalLength) * 100 : 0

        downloadStore.updateTaskProgress(task.id, progress, downloadSpeed, completedLength)

        // 检查是否完成
        if (status.status === 'complete') {
          clearInterval(interval)
          downloadStore.moveToCompleted(task, true)
          processWaitingQueue()
        } else if (status.status === 'error') {
          clearInterval(interval)
          task.error = status.errorMessage || '下载失败'
          downloadStore.moveToCompleted(task, false)
          processWaitingQueue()
        } else if (status.status === 'removed') {
          clearInterval(interval)
        }
      } catch (error) {
        console.error('获取下载状态失败:', error)
      }
    }, 1000)
  }

  // 开始下载
  function startDownload() {
    processWaitingQueue()
  }

  // 重置错误计数
  function resetErrorCount() {
    errorCount.value = 0
  }

  return {
    isProcessing,
    errorCount,
    startDownload,
    processWaitingQueue,
    resetErrorCount
  }
}
