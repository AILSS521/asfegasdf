import { ref } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useSettingsStore } from '@/stores/settings'
import { useApi } from './useApi'
import type { DownloadProgress, DownloadTask } from '@/types'
import path from 'path-browserify'

const MAX_CONCURRENT_DOWNLOADS = 3
const MAX_RETRY = 3
const RETRY_DELAY = 5000

// 用于跟踪文件夹任务中当前正在下载的子文件
const folderDownloadMap = ref<Map<string, { taskId: string; fileIndex: number }>>(new Map())

export function useDownloadManager() {
  const downloadStore = useDownloadStore()
  const settingsStore = useSettingsStore()
  const api = useApi()

  const errorCount = ref(0)

  // 设置进度监听
  function setupProgressListener() {
    window.electronAPI?.onDownloadProgress((progress: DownloadProgress) => {
      // 检查是否是文件夹子文件的下载
      const folderInfo = folderDownloadMap.value.get(progress.taskId)

      if (folderInfo) {
        // 这是文件夹子文件的下载
        const task = downloadStore.downloadTasks.find(t => t.id === folderInfo.taskId)
        if (!task) return

        if (progress.status === 'downloading') {
          downloadStore.updateFolderSubFileProgress(
            folderInfo.taskId,
            folderInfo.fileIndex,
            progress.progress,
            progress.speed,
            progress.downloadedSize
          )
        } else if (progress.status === 'completed') {
          downloadStore.markFolderSubFileCompleted(folderInfo.taskId, folderInfo.fileIndex, true)
          folderDownloadMap.value.delete(progress.taskId)
          // 串行下载：完成后继续下载下一个文件
          processFolderNextFile(task)
        } else if (progress.status === 'error') {
          folderDownloadMap.value.delete(progress.taskId)
          // 标记子文件失败，整个文件夹停止
          const folderStopped = downloadStore.markFolderSubFileCompleted(folderInfo.taskId, folderInfo.fileIndex, false, progress.error || '下载失败')
          if (folderStopped) {
            processQueue()
          }
        } else if (progress.status === 'paused') {
          // 文件夹暂停时，子文件也标记暂停
          if (task.subFiles && task.subFiles[folderInfo.fileIndex]) {
            task.subFiles[folderInfo.fileIndex].status = 'paused'
          }
        }
      } else {
        // 普通文件下载
        const task = downloadStore.downloadTasks.find(t => t.id === progress.taskId)
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
          processQueue()
        } else if (progress.status === 'error') {
          task.error = progress.error || '下载失败'
          downloadStore.moveToCompleted(task, false)
          processQueue()
        } else if (progress.status === 'paused') {
          task.status = 'paused'
        }
      }
    })
  }

  // 移除进度监听
  function removeProgressListener() {
    window.electronAPI?.removeDownloadProgressListener()
  }

  // 取消文件夹的所有正在进行的下载
  function cancelFolderDownloads(taskId: string) {
    const toCancel: string[] = []
    folderDownloadMap.value.forEach((info, downloadId) => {
      if (info.taskId === taskId) {
        toCancel.push(downloadId)
      }
    })

    toCancel.forEach(downloadId => {
      window.electronAPI?.cancelDownload(downloadId)
      folderDownloadMap.value.delete(downloadId)
    })
  }

  // 处理等待队列
  async function processQueue() {
    // 检查错误数量
    if (errorCount.value >= 3) {
      downloadStore.pauseAll()
      return
    }

    // 获取下一个等待任务
    const nextTask = downloadStore.getNextWaitingTask()
    if (!nextTask) return

    // 检查下载并行数限制
    if (downloadStore.activeDownloadCount >= MAX_CONCURRENT_DOWNLOADS) {
      return
    }

    // 立即继续处理队列中的其他任务
    setTimeout(processQueue, 50)

    if (nextTask.isFolder) {
      await processFolderTask(nextTask)
    } else {
      await processFileTask(nextTask)
    }
  }

  // 处理单个文件任务
  async function processFileTask(task: DownloadTask) {
    downloadStore.updateTaskStatus(task.id, 'processing')

    try {
      // 获取下载链接
      const linkData = await api.getDownloadLink({
        code: downloadStore.currentCode,
        randsk: downloadStore.sessionData!.randsk,
        uk: downloadStore.sessionData!.uk,
        shareid: downloadStore.sessionData!.shareid,
        fs_id: task.file.fs_id,
        surl: downloadStore.sessionData!.surl,
        dir: path.dirname(task.file.path) || '/',
        pwd: downloadStore.sessionData!.pwd
      })

      task.downloadUrl = linkData.url
      task.ua = linkData.ua

      // 更新状态为创建文件中
      downloadStore.updateTaskStatus(task.id, 'creating')

      // 计算本地路径
      let localDir: string
      if (task.downloadBasePath === null || task.downloadBasePath === undefined) {
        localDir = settingsStore.downloadPath
      } else {
        const fileDirPath = path.dirname(task.file.path)
        let relativePath = ''
        if (fileDirPath.startsWith(task.downloadBasePath)) {
          relativePath = fileDirPath.slice(task.downloadBasePath.length)
          if (relativePath.startsWith('/')) {
            relativePath = relativePath.slice(1)
          }
        }
        localDir = relativePath
          ? path.join(settingsStore.downloadPath, relativePath)
          : settingsStore.downloadPath
      }
      const localPath = path.join(localDir, task.file.server_filename)
      task.localPath = localPath

      // 使用内置下载器开始下载
      const result = await window.electronAPI?.startDownload(task.id, {
        url: linkData.url,
        savePath: localDir,
        filename: task.file.server_filename,
        userAgent: linkData.ua
      })

      if (result?.success) {
        downloadStore.updateTaskStatus(task.id, 'downloading')
        errorCount.value = 0
      } else {
        throw new Error(result?.error || '启动下载失败')
      }
    } catch (error: any) {
      console.error('获取下载链接失败:', error)

      task.retryCount++

      if (task.retryCount >= MAX_RETRY) {
        task.status = 'error'
        task.error = error.message || '获取下载链接失败'
        downloadStore.moveToCompleted(task, false)
        errorCount.value++
        processQueue()
      } else {
        setTimeout(() => {
          task.status = 'waiting'
          processQueue()
        }, RETRY_DELAY)
      }
    }
  }

  // 处理文件夹任务
  async function processFolderTask(task: DownloadTask) {
    downloadStore.updateTaskStatus(task.id, 'processing')
    // 开始串行下载文件夹中的文件
    await processFolderNextFile(task)
  }

  // 处理文件夹中的下一个文件（严格串行）
  async function processFolderNextFile(task: DownloadTask) {
    if (!task.isFolder || !task.subFiles) return

    // 检查任务是否还在下载列表中
    const currentTask = downloadStore.downloadTasks.find(t => t.id === task.id)
    if (!currentTask) return

    // 检查任务是否被暂停或已失败
    if (currentTask.status === 'paused' || currentTask.status === 'error') return

    // 获取下一个需要下载的子文件（跳过已完成的）
    const nextSubFile = downloadStore.getNextWaitingSubFile(task.id)
    if (!nextSubFile) {
      // 没有更多文件需要下载，检查是否全部完成
      const allDone = task.subFiles.every(sf => sf.status === 'completed' || sf.status === 'error')
      if (allDone) {
        const allSuccess = task.subFiles.every(sf => sf.status === 'completed')
        downloadStore.moveToCompleted(task, allSuccess)
        processQueue()
      }
      return
    }

    const { index, subFile } = nextSubFile

    // 更新当前正在下载的文件名
    task.currentFileName = subFile.file.server_filename
    task.currentFileIndex = index

    downloadStore.updateFolderSubFileStatus(task.id, index, 'processing')

    try {
      // 获取下载链接
      const linkData = await api.getDownloadLink({
        code: downloadStore.currentCode,
        randsk: downloadStore.sessionData!.randsk,
        uk: downloadStore.sessionData!.uk,
        shareid: downloadStore.sessionData!.shareid,
        fs_id: subFile.file.fs_id,
        surl: downloadStore.sessionData!.surl,
        dir: path.dirname(subFile.file.path) || '/',
        pwd: downloadStore.sessionData!.pwd
      })

      subFile.downloadUrl = linkData.url
      subFile.ua = linkData.ua

      // 更新状态
      downloadStore.updateFolderSubFileStatus(task.id, index, 'creating')
      if (task.status !== 'downloading') {
        downloadStore.updateTaskStatus(task.id, 'downloading')
      }

      // 计算本地路径
      const fileDirPath = path.dirname(subFile.file.path)
      let relativePath = ''
      if (task.downloadBasePath && fileDirPath.startsWith(task.downloadBasePath)) {
        relativePath = fileDirPath.slice(task.downloadBasePath.length)
        if (relativePath.startsWith('/')) {
          relativePath = relativePath.slice(1)
        }
      }
      const localDir = relativePath
        ? path.join(settingsStore.downloadPath, relativePath)
        : settingsStore.downloadPath
      const localPath = path.join(localDir, subFile.file.server_filename)
      subFile.localPath = localPath

      // 生成子文件的下载 ID
      const subFileDownloadId = `${task.id}-sub-${index}`

      // 记录文件夹下载映射
      folderDownloadMap.value.set(subFileDownloadId, { taskId: task.id, fileIndex: index })

      // 使用内置下载器开始下载
      const result = await window.electronAPI?.startDownload(subFileDownloadId, {
        url: linkData.url,
        savePath: localDir,
        filename: subFile.file.server_filename,
        userAgent: linkData.ua
      })

      if (result?.success) {
        downloadStore.updateFolderSubFileStatus(task.id, index, 'downloading')
        errorCount.value = 0
      } else {
        throw new Error(result?.error || '启动下载失败')
      }
    } catch (error: any) {
      console.error('获取下载链接失败:', error)

      subFile.retryCount++

      if (subFile.retryCount >= MAX_RETRY) {
        // 标记子文件失败，整个文件夹停止
        const folderStopped = downloadStore.markFolderSubFileCompleted(task.id, index, false, error.message || '获取下载链接失败')
        errorCount.value++

        if (folderStopped) {
          cancelFolderDownloads(task.id)
          processQueue()
        }
      } else {
        // 等待后重试当前文件
        setTimeout(() => {
          const stillExists = downloadStore.downloadTasks.find(t => t.id === task.id)
          if (stillExists && stillExists.status !== 'paused' && stillExists.status !== 'error') {
            subFile.status = 'waiting'
            processFolderNextFile(task)
          }
        }, RETRY_DELAY)
      }
    }
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
    processQueue()
  }

  // 重置错误计数
  function resetErrorCount() {
    errorCount.value = 0
  }

  return {
    errorCount,
    startDownload,
    processQueue,
    resetErrorCount,
    pauseTask,
    resumeTask,
    cancelTask,
    setupProgressListener,
    removeProgressListener,
    processFolderNextFile
  }
}
