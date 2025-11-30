import { ref } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useSettingsStore } from '@/stores/settings'
import { useApi } from './useApi'
import type { DownloadProgress, DownloadTask, SubFileTask } from '@/types'
import path from 'path-browserify'

const MAX_CONCURRENT_DOWNLOADS = 3
const MAX_FOLDER_CONCURRENT = 3  // 文件夹内子文件最大并行数
const MAX_RETRY = 3
const RETRY_DELAY = 5000

// 获取用于API请求的目录路径
// 规则：
// - 如果文件在分享根目录下（fileDir === basePath），返回 "/"
// - 如果文件在子目录下，返回完整的目录路径
function getApiDir(filePath: string, basePath: string): string {
  const fileDir = path.dirname(filePath)
  // 文件在分享根目录下，dir 应该是 "/"
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
          downloadStore.markFolderSubFileCompleted(folderInfo.taskId, folderInfo.fileIndex, true)
          folderDownloadMap.value.delete(progress.taskId)
          // 并行下载：完成后尝试启动更多子文件
          if (task.status !== 'paused' && task.status !== 'error') {
            // 检查是否所有文件都完成了
            if (task.subFiles) {
              const allDone = task.subFiles.every(sf => sf.status === 'completed' || sf.status === 'error')
              if (allDone) {
                const allSuccess = task.subFiles.every(sf => sf.status === 'completed')
                downloadStore.moveToCompleted(task, allSuccess)
                processQueue()
              } else {
                // 继续下载下一批文件
                fillFolderDownloadSlots(task)
              }
            }
          }
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
      // 获取下载链接
      // dir 参数：分享根目录下的文件用 "/"，子目录下的文件用完整路径
      const linkData = await api.getDownloadLink({
        code: session.code,
        randsk: session.randsk,
        uk: session.uk,
        shareid: session.shareid,
        fs_id: task.file.fs_id,
        surl: session.surl,
        dir: getApiDir(task.file.path, session.basePath),
        pwd: session.pwd
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
        filename: task.file.server_filename,
        userAgent: linkData.ua
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
    // 文件夹任务已开始处理，释放锁并处理下一个任务
    isFetchingLink.value = false
    processQueue()
    // 并行启动多个子文件下载
    await fillFolderDownloadSlots(task)
  }

  // 填充文件夹的下载槽位（并行下载）
  async function fillFolderDownloadSlots(task: DownloadTask) {
    if (!task.isFolder || !task.subFiles) return

    // 检查任务状态
    const currentTask = downloadStore.downloadTasks.find(t => t.id === task.id)
    if (!currentTask || currentTask.status === 'paused' || currentTask.status === 'error') return

    // 计算可以启动的数量
    const activeCount = getFolderActiveCount(task.id)
    const slotsAvailable = MAX_FOLDER_CONCURRENT - activeCount

    if (slotsAvailable <= 0) return

    // 启动多个子文件下载
    for (let i = 0; i < slotsAvailable; i++) {
      const nextSubFile = downloadStore.getNextWaitingSubFile(task.id)
      if (!nextSubFile) break

      // 不等待，直接启动（并行）
      startSubFileDownload(task, nextSubFile.index, nextSubFile.subFile)
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
    task.currentFileName = subFile.file.server_filename
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

      // 获取下载链接
      // dir 参数：分享根目录下的文件用 "/"，子目录下的文件用完整路径
      const linkData = await api.getDownloadLink({
        code: session.code,
        randsk: session.randsk,
        uk: session.uk,
        shareid: session.shareid,
        fs_id: subFile.file.fs_id,
        surl: session.surl,
        dir: getApiDir(subFile.file.path, session.basePath),
        pwd: session.pwd
      })

      subFile.downloadUrl = linkData.url
      subFile.ua = linkData.ua

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
      const localPath = path.join(localDir, subFile.file.server_filename)
      subFile.localPath = localPath

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
