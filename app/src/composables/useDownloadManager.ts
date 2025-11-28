import { ref } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useSettingsStore } from '@/stores/settings'
import { useApi } from './useApi'
import type { DownloadProgress, DownloadTask } from '@/types'
import path from 'path-browserify'

const MAX_CONCURRENT_DOWNLOADS = 3
const MAX_RETRY = 3
const RETRY_DELAY = 5000
const SMALL_FILE_THRESHOLD = 50 * 1024 * 1024 // 50MB，小于此大小的文件不受串行限制

// 用于跟踪文件夹任务中当前正在下载的子文件
const folderDownloadMap = ref<Map<string, { taskId: string; fileIndex: number; isLarge: boolean }>>(new Map())

export function useDownloadManager() {
  const downloadStore = useDownloadStore()
  const settingsStore = useSettingsStore()
  const api = useApi()

  const isProcessingLargeFile = ref(false) // 仅用于大文件（>=50MB）的串行控制
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
          const wasLarge = folderInfo.isLarge
          folderDownloadMap.value.delete(progress.taskId)
          // 大文件下载完成后释放锁，并继续下载下一个文件
          if (wasLarge) {
            isProcessingLargeFile.value = false
            processFolderNextFile(task)
          }
          // 小文件完成后检查是否所有文件都完成了
          if (!wasLarge) {
            const allDone = task.subFiles?.every(sf => sf.status === 'completed' || sf.status === 'error')
            if (allDone) {
              const allSuccess = task.subFiles?.every(sf => sf.status === 'completed')
              downloadStore.moveToCompleted(task, allSuccess ?? false)
              processQueue()
            }
          }
        } else if (progress.status === 'error') {
          folderDownloadMap.value.delete(progress.taskId)
          const wasLarge = folderInfo.isLarge
          if (wasLarge) {
            isProcessingLargeFile.value = false
          }

          // 标记子文件失败，如果返回 true 表示整个文件夹已停止
          const folderStopped = downloadStore.markFolderSubFileCompleted(folderInfo.taskId, folderInfo.fileIndex, false, progress.error || '下载失败')

          if (folderStopped) {
            // 取消该文件夹所有正在进行的下载
            cancelFolderDownloads(folderInfo.taskId)
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
    // 找出该文件夹所有正在下载的子文件并取消
    const toCancel: string[] = []
    folderDownloadMap.value.forEach((info, downloadId) => {
      if (info.taskId === taskId) {
        toCancel.push(downloadId)
        if (info.isLarge) {
          isProcessingLargeFile.value = false
        }
      }
    })

    // 取消下载并清理映射
    toCancel.forEach(downloadId => {
      window.electronAPI?.cancelDownload(downloadId)
      folderDownloadMap.value.delete(downloadId)
    })
  }

  // 判断任务是否为大文件（>=50MB）
  function isLargeFile(task: DownloadTask): boolean {
    if (task.isFolder) {
      // 文件夹任务：检查总大小
      return task.totalSize >= SMALL_FILE_THRESHOLD
    }
    return task.file.size >= SMALL_FILE_THRESHOLD
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

    const isLarge = isLargeFile(nextTask)

    // 大文件需要检查并行限制和串行锁
    if (isLarge) {
      // 检查大文件下载并行数限制
      if (downloadStore.activeDownloadCount >= MAX_CONCURRENT_DOWNLOADS) {
        return
      }
      // 大文件需要串行获取下载链接
      if (isProcessingLargeFile.value) {
        setTimeout(processQueue, 500)
        return
      }
      // 标记大文件开始处理
      isProcessingLargeFile.value = true
    }

    // 立即继续处理队列中的其他任务（小文件可以并行，不受限制）
    setTimeout(processQueue, 50)

    if (nextTask.isFolder) {
      // 处理文件夹任务
      await processFolderTask(nextTask, isLarge)
    } else {
      // 处理单个文件任务
      await processFileTask(nextTask, isLarge)
    }
  }

  // 处理单个文件任务
  async function processFileTask(task: DownloadTask, isLarge: boolean = false) {
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

      // 大文件获取链接完成，释放锁
      if (isLarge) {
        isProcessingLargeFile.value = false
      }

      // 更新状态为创建文件中
      downloadStore.updateTaskStatus(task.id, 'creating')

      // 计算本地路径
      let localDir: string
      if (task.downloadBasePath === null || task.downloadBasePath === undefined) {
        // 单个文件下载，直接放在下载目录根目录
        localDir = settingsStore.downloadPath
      } else {
        // 文件夹下载，计算相对于下载基础路径的子目录
        const fileDirPath = path.dirname(task.file.path)
        // 获取相对于 downloadBasePath 的路径
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
        // 更新为下载中状态
        downloadStore.updateTaskStatus(task.id, 'downloading')
        errorCount.value = 0
      } else {
        throw new Error(result?.error || '启动下载失败')
      }
    } catch (error: any) {
      console.error('获取下载链接失败:', error)

      // 出错也要释放大文件锁
      if (isLarge) {
        isProcessingLargeFile.value = false
      }

      task.retryCount++

      if (task.retryCount >= MAX_RETRY) {
        task.status = 'error'
        task.error = error.message || '获取下载链接失败'
        errorCount.value++
      } else {
        // 等待后重试
        setTimeout(() => {
          task.status = 'waiting'
          processQueue()
        }, RETRY_DELAY)
      }
    }
  }

  // 处理文件夹任务
  async function processFolderTask(task: DownloadTask, isLarge: boolean = false) {
    downloadStore.updateTaskStatus(task.id, 'processing')
    // 开始下载文件夹中的第一个文件
    await processFolderNextFile(task, isLarge)
  }

  // 处理文件夹中的下一个文件
  async function processFolderNextFile(task: DownloadTask, _isLargeFolder: boolean = false) {
    if (!task.isFolder || !task.subFiles) return

    // 检查任务是否还在下载列表中（可能已被移到失败列表）
    const currentTask = downloadStore.downloadTasks.find(t => t.id === task.id)
    if (!currentTask) return

    // 检查任务是否被暂停或已失败
    if (currentTask.status === 'paused' || currentTask.status === 'error') return

    // 获取下一个等待的子文件
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

    // 判断当前子文件是否为大文件
    const isLargeSubFile = subFile.file.size >= SMALL_FILE_THRESHOLD

    // 大文件需要等待锁，并且需要等待下载完成才处理下一个
    if (isLargeSubFile && isProcessingLargeFile.value) {
      // 有大文件正在处理，延迟重试
      setTimeout(() => processFolderNextFile(task, false), 500)
      return
    }

    // 大文件加锁
    if (isLargeSubFile) {
      isProcessingLargeFile.value = true
    }

    downloadStore.updateFolderSubFileStatus(task.id, index, 'processing')

    // 小文件：立即继续处理下一个文件（并行）
    // 大文件：等待下载完成后才处理下一个（在进度回调中触发）
    if (!isLargeSubFile) {
      // 小文件不阻塞，立即处理下一个
      setTimeout(() => processFolderNextFile(task, false), 50)
    }

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

      // 更新状态为创建文件中
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

      // 记录文件夹下载映射，同时记录是否为大文件
      folderDownloadMap.value.set(subFileDownloadId, { taskId: task.id, fileIndex: index, isLarge: isLargeSubFile })

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

      // 出错也要释放锁
      if (isLargeSubFile) {
        isProcessingLargeFile.value = false
      }

      subFile.retryCount++

      if (subFile.retryCount >= MAX_RETRY) {
        // 标记子文件失败，这会导致整个文件夹任务停止
        const folderStopped = downloadStore.markFolderSubFileCompleted(task.id, index, false, error.message || '获取下载链接失败')
        errorCount.value++

        if (folderStopped) {
          // 取消该文件夹所有正在进行的下载
          cancelFolderDownloads(task.id)
          processQueue()
        }
      } else {
        // 等待后重试
        setTimeout(() => {
          // 检查任务是否还在下载列表中（可能已被移到失败列表）
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
    isProcessingLargeFile,
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
