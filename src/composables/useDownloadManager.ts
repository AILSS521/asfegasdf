import { ref } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useSettingsStore } from '@/stores/settings'
import { useApi } from './useApi'
import type { DownloadProgress, DownloadTask, SubFileTask } from '@/types'
import path from 'path-browserify'

const MAX_RETRY = 3
const RETRY_DELAY = 5000

// 获取用于API请求的目录路径
// 规则：
// - 如果文件在分享根目录下（fileDir === basePath），返回 "/"
// - 如果文件在子目录下，返回完整的目录路径
function getApiPath(filePath: string, basePath: string): string {
  const fileDir = path.dirname(filePath)
  // 文件在分享根目录下，path 应该是 "/"
  if (fileDir === basePath) {
    return '/'
  }
  // 文件在子目录下，返回完整的目录路径
  return fileDir || '/'
}

// 用于跟踪文件夹任务中当前正在下载的子文件
const folderDownloadMap = ref<Map<string, { taskId: string; fileIndex: number }>>(new Map())

// 是否有任务正在获取下载链接（限制同时只能有一个）
const isFetchingLink = ref(false)

// 文件夹速度更新定时器
let folderSpeedTimer: ReturnType<typeof setInterval> | null = null

export function useDownloadManager() {
  const downloadStore = useDownloadStore()
  const settingsStore = useSettingsStore()
  const api = useApi()

  const errorCount = ref(0)

  // 设置进度监听
  function setupProgressListener() {
    // 启动文件夹速度更新定时器（每秒一次）
    if (!folderSpeedTimer) {
      folderSpeedTimer = setInterval(() => {
        downloadStore.updateAllFolderSpeeds()
      }, 1000)
    }

    window.electronAPI?.onDownloadProgress((progress: DownloadProgress) => {
      // 检查是否是文件夹子文件的下载
      const folderInfo = folderDownloadMap.value.get(progress.taskId)

      if (folderInfo) {
        // 这是文件夹子文件的下载
        const task = downloadStore.downloadTasks.find(t => t.id === folderInfo.taskId)
        if (!task) return

        if (progress.status === 'creating') {
          // 正在创建/预分配文件
          downloadStore.updateFolderSubFileStatus(folderInfo.taskId, folderInfo.fileIndex, 'creating')
        } else if (progress.status === 'downloading') {
          downloadStore.updateFolderSubFileProgress(
            folderInfo.taskId,
            folderInfo.fileIndex,
            progress.progress,
            progress.speed,
            progress.downloadedSize
          )
        } else if (progress.status === 'completed') {
          // 清理 aria2 记录
          window.electronAPI?.cleanupDownload(progress.taskId)
          downloadStore.markFolderSubFileCompleted(folderInfo.taskId, folderInfo.fileIndex, true)
          folderDownloadMap.value.delete(progress.taskId)
          // 完成后尝试启动下一个子文件
          if (task.status !== 'paused' && task.status !== 'error') {
            // 检查是否所有文件都完成了
            if (task.subFiles) {
              const allDone = task.subFiles.every(sf => sf.status === 'completed' || sf.status === 'error')
              if (allDone) {
                const allSuccess = task.subFiles.every(sf => sf.status === 'completed')
                downloadStore.moveToCompleted(task, allSuccess)
              } else {
                // 继续下载下一个文件
                fillFolderDownloadSlots(task)
              }
            }
          }
          // 处理队列中的其他任务（释放了一个并发位置）
          processQueue()
        } else if (progress.status === 'error') {
          // 清理 aria2 记录
          window.electronAPI?.cleanupDownload(progress.taskId)
          folderDownloadMap.value.delete(progress.taskId)
          // 标记子文件失败，整个文件夹停止
          const folderStopped = downloadStore.markFolderSubFileCompleted(folderInfo.taskId, folderInfo.fileIndex, false, progress.error || '下载失败')
          if (folderStopped) {
            processQueue()
          }
        } else if (progress.status === 'paused') {
          // 文件夹暂停时，子文件也标记暂停
          // 但如果子文件是 waiting/downloading 状态（正在恢复中），不要覆盖
          if (task.subFiles && task.subFiles[folderInfo.fileIndex]) {
            const subFile = task.subFiles[folderInfo.fileIndex]
            if (subFile.status !== 'waiting' && subFile.status !== 'downloading') {
              subFile.status = 'paused'
              // 暂停后释放并发位置，处理等待队列
              processQueue()
            }
          }
        }
      } else {
        // 普通文件下载
        const task = downloadStore.downloadTasks.find(t => t.id === progress.taskId)
        if (!task) return

        if (progress.status === 'creating') {
          // 正在创建/预分配文件
          downloadStore.updateTaskStatus(task.id, 'creating')
        } else if (progress.status === 'downloading') {
          downloadStore.updateTaskProgress(
            task.id,
            progress.progress,
            progress.speed,
            progress.downloadedSize
          )
        } else if (progress.status === 'completed') {
          // 清理 aria2 记录
          window.electronAPI?.cleanupDownload(progress.taskId)
          downloadStore.moveToCompleted(task, true)
          processQueue()
        } else if (progress.status === 'error') {
          // 清理 aria2 记录
          window.electronAPI?.cleanupDownload(progress.taskId)
          task.error = progress.error || '下载失败'
          downloadStore.moveToCompleted(task, false)
          processQueue()
        } else if (progress.status === 'paused') {
          // 只有当任务不是 waiting/downloading 状态时才设为 paused
          // （waiting 表示等待并发位置，downloading 表示正在恢复中）
          if (task.status !== 'waiting' && task.status !== 'downloading') {
            task.status = 'paused'
            // 暂停后释放并发位置，处理等待队列
            processQueue()
          }
        }
      }
    })
  }

  // 移除进度监听
  function removeProgressListener() {
    window.electronAPI?.removeDownloadProgressListener()
    // 停止文件夹速度更新定时器
    if (folderSpeedTimer) {
      clearInterval(folderSpeedTimer)
      folderSpeedTimer = null
    }
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

  // 获取文件夹当前活跃的子文件下载数量
  function getFolderActiveCount(taskId: string): number {
    let count = 0
    folderDownloadMap.value.forEach((info) => {
      if (info.taskId === taskId) {
        count++
      }
    })
    return count
  }

  // 获取当前总活跃下载数（单文件 + 文件夹子文件）
  function getTotalActiveDownloads(): number {
    // 统计正在下载的单文件
    const singleFileDownloads = downloadStore.downloadTasks.filter(t =>
      !t.isFolder && (t.status === 'downloading' || t.status === 'creating' || t.status === 'processing')
    ).length

    // 统计文件夹子文件下载数（通过 folderDownloadMap）
    const folderSubFileDownloads = folderDownloadMap.value.size

    return singleFileDownloads + folderSubFileDownloads
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

    // 检查下载并行数限制（统一计算单文件 + 文件夹子文件）
    if (getTotalActiveDownloads() >= settingsStore.maxConcurrentDownloads) {
      return
    }

    // 检查是否有任务正在获取下载链接（同时只能有一个）
    if (isFetchingLink.value) {
      return
    }

    // 标记正在获取链接
    isFetchingLink.value = true

    if (nextTask.isFolder) {
      await processFolderTask(nextTask)
    } else {
      await processFileTask(nextTask)
    }
  }

  // 处理单个文件任务
  async function processFileTask(task: DownloadTask) {
    // 如果任务已有下载链接（暂停后恢复），直接恢复下载
    if (task.downloadUrl) {
      downloadStore.updateTaskStatus(task.id, 'downloading')
      await window.electronAPI?.resumeDownload(task.id)
      // 释放锁并处理下一个任务
      isFetchingLink.value = false
      processQueue()
      return
    }

    downloadStore.updateTaskStatus(task.id, 'processing')

    // 使用任务自身的会话数据，避免被新下载编码覆盖
    const session = task.sessionData
    if (!session) {
      task.error = '会话数据丢失，请重新添加下载任务'
      downloadStore.moveToCompleted(task, false)
      // 释放锁并处理下一个任务
      isFetchingLink.value = false
      processQueue()
      return
    }

    try {
      // 获取下载链接（通用接口）
      const linkData = await api.getDownloadLink({
        code: session.code,
        session: session.session,
        file_id: task.file.id,
        path: getApiPath(task.file.path, session.basePath)
      })

      // 获取链接后检查任务是否被暂停或已不存在
      const currentTask = downloadStore.downloadTasks.find(t => t.id === task.id)
      if (!currentTask || currentTask.status === 'paused' || currentTask.status === 'error') {
        // 任务被暂停或取消，释放锁并处理下一个任务
        isFetchingLink.value = false
        processQueue()
        return
      }

      task.downloadUrl = linkData.url
      task.headers = linkData.headers

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
      const localPath = path.join(localDir, task.file.name)
      task.localPath = localPath

      // 开始下载前再次检查任务状态
      const taskBeforeDownload = downloadStore.downloadTasks.find(t => t.id === task.id)
      if (!taskBeforeDownload || taskBeforeDownload.status === 'paused' || taskBeforeDownload.status === 'error') {
        // 任务被暂停或取消，释放锁并处理下一个任务
        isFetchingLink.value = false
        processQueue()
        return
      }

      // 使用内置下载器开始下载
      const result = await window.electronAPI?.startDownload(task.id, {
        url: linkData.url,
        savePath: localDir,
        filename: task.file.name,
        userAgent: linkData.headers['User-Agent']
      })

      if (result?.success) {
        downloadStore.updateTaskStatus(task.id, 'downloading')
        errorCount.value = 0
        // 下载已开始，释放锁并处理下一个任务
        isFetchingLink.value = false
        processQueue()
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
        // 失败时释放锁并处理下一个任务
        isFetchingLink.value = false
        processQueue()
      } else {
        // 重试时释放锁
        isFetchingLink.value = false
        setTimeout(() => {
          task.status = 'waiting'
          processQueue()
        }, RETRY_DELAY)
      }
    }
  }

  // 处理文件夹任务
  async function processFolderTask(task: DownloadTask) {
    // 如果文件夹已经有进度（恢复下载），保持 downloading 状态显示进度条
    if (task.progress > 0 || (task.completedCount && task.completedCount > 0)) {
      downloadStore.updateTaskStatus(task.id, 'downloading')
    } else {
      downloadStore.updateTaskStatus(task.id, 'processing')
    }
    // 释放锁
    isFetchingLink.value = false
    // 启动子文件下载（每个文件夹最多同时下载1个文件）
    await fillFolderDownloadSlots(task)
    // 处理队列中的其他任务
    processQueue()
  }

  // 启动文件夹的下一个子文件下载（每个文件夹最多同时下载1个文件）
  async function fillFolderDownloadSlots(task: DownloadTask) {
    if (!task.isFolder || !task.subFiles) return

    // 检查任务状态
    const currentTask = downloadStore.downloadTasks.find(t => t.id === task.id)
    if (!currentTask || currentTask.status === 'paused' || currentTask.status === 'error') return

    // 检查全局并发数限制
    if (getTotalActiveDownloads() >= settingsStore.maxConcurrentDownloads) return

    // 检查该文件夹是否已有活跃下载（每个文件夹最多1个）
    if (getFolderActiveCount(task.id) >= 1) return

    // 启动下一个子文件下载
    const nextSubFile = downloadStore.getNextWaitingSubFile(task.id)
    if (nextSubFile) {
      await startSubFileDownload(task, nextSubFile.index, nextSubFile.subFile)
    }
  }

  // 启动单个子文件下载
  async function startSubFileDownload(task: DownloadTask, index: number, subFile: SubFileTask) {
    if (!task.isFolder || !task.subFiles) return

    // 检查任务是否还在下载列表中
    const currentTask = downloadStore.downloadTasks.find(t => t.id === task.id)
    if (!currentTask) return

    // 检查任务是否被暂停或已失败
    if (currentTask.status === 'paused' || currentTask.status === 'error') return

    // 更新当前正在下载的文件名（显示最新启动的）
    task.currentFileName = subFile.file.name
    task.currentFileIndex = index

    // 生成子文件的下载 ID
    const subFileDownloadId = `${task.id}-sub-${index}`

    // 如果子文件已经有下载链接（暂停后恢复的情况），直接恢复下载
    if (subFile.downloadUrl && subFile.localPath) {
      downloadStore.updateFolderSubFileStatus(task.id, index, 'downloading')
      if (currentTask.status !== 'downloading') {
        downloadStore.updateTaskStatus(task.id, 'downloading')
      }
      // 重新注册映射
      folderDownloadMap.value.set(subFileDownloadId, { taskId: task.id, fileIndex: index })
      // 恢复下载
      window.electronAPI?.resumeDownload(subFileDownloadId)
      return
    }

    downloadStore.updateFolderSubFileStatus(task.id, index, 'processing')

    // 使用任务自身的会话数据，避免被新下载编码覆盖
    const session = task.sessionData
    if (!session) {
      downloadStore.markFolderSubFileCompleted(task.id, index, false, '会话数据丢失，请重新添加下载任务')
      processQueue()
      return
    }

    try {
      // 再次检查任务状态（异步操作前）
      const taskBeforeApi = downloadStore.downloadTasks.find(t => t.id === task.id)
      if (!taskBeforeApi || taskBeforeApi.status === 'paused' || taskBeforeApi.status === 'error') {
        // 恢复子文件状态，以便下次恢复时能找到
        downloadStore.updateFolderSubFileStatus(task.id, index, 'waiting')
        return
      }

      // 获取下载链接（通用接口）
      const linkData = await api.getDownloadLink({
        code: session.code,
        session: session.session,
        file_id: subFile.file.id,
        path: getApiPath(subFile.file.path, session.basePath)
      })

      subFile.downloadUrl = linkData.url
      subFile.headers = linkData.headers

      // 获取链接后再次检查任务状态
      const taskAfterApi = downloadStore.downloadTasks.find(t => t.id === task.id)
      if (!taskAfterApi || taskAfterApi.status === 'paused' || taskAfterApi.status === 'error') {
        // 恢复子文件状态，以便下次恢复时能找到
        downloadStore.updateFolderSubFileStatus(task.id, index, 'waiting')
        return
      }

      // 更新状态
      downloadStore.updateFolderSubFileStatus(task.id, index, 'creating')
      if (taskAfterApi.status !== 'downloading') {
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
      const localPath = path.join(localDir, subFile.file.name)
      subFile.localPath = localPath

      // 记录文件夹下载映射
      folderDownloadMap.value.set(subFileDownloadId, { taskId: task.id, fileIndex: index })

      // 使用内置下载器开始下载
      const result = await window.electronAPI?.startDownload(subFileDownloadId, {
        url: linkData.url,
        savePath: localDir,
        filename: subFile.file.name,
        userAgent: linkData.headers['User-Agent']
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
            fillFolderDownloadSlots(task)
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
    fillFolderDownloadSlots
  }
}
