import { ref } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useSettingsStore } from '@/stores/settings'
import { useApi } from './useApi'
import type { DownloadProgress, DownloadTask, SubFileTask } from '@/types'
import path from 'path-browserify'

const MAX_RETRY = 3
const RETRY_DELAY = 5000

// 调试日志函数 - 写入到文件
function debugLog(message: string, data?: any) {
  const timestamp = new Date().toISOString()
  const logEntry = data
    ? `[${timestamp}] ${message}: ${JSON.stringify(data)}`
    : `[${timestamp}] ${message}`
  console.log('[DownloadManager]', logEntry)
  // 写入到文件
  window.electronAPI?.writeDebugLog(logEntry)
}

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

// 同步锁：用于防止 startSubFileDownload 的竞态条件
// 这个Set在检查的同一时刻就加锁，不用等到后面设置状态
const subFileProcessingLock = new Set<string>()

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

      // 对关键状态变化记录日志
      if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'paused') {
        debugLog('收到进度回调', {
          taskId: progress.taskId,
          status: progress.status,
          error: progress.error,
          isFolderSubFile: !!folderInfo
        })
      }

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
          debugLog('子文件下载完成', {
            taskId: progress.taskId,
            folderTaskId: folderInfo.taskId,
            fileIndex: folderInfo.fileIndex
          })
          // 清理 aria2 记录、映射和同步锁
          window.electronAPI?.cleanupDownload(progress.taskId)
          downloadStore.markFolderSubFileCompleted(folderInfo.taskId, folderInfo.fileIndex, true)
          folderDownloadMap.value.delete(progress.taskId)
          subFileProcessingLock.delete(progress.taskId)
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
          debugLog('子文件下载出错', {
            taskId: progress.taskId,
            error: progress.error,
            folderTaskId: folderInfo.taskId,
            fileIndex: folderInfo.fileIndex
          })
          // 清理 aria2 记录、映射和同步锁
          window.electronAPI?.cleanupDownload(progress.taskId)
          folderDownloadMap.value.delete(progress.taskId)
          subFileProcessingLock.delete(progress.taskId)
          // 标记子文件失败，整个文件夹停止
          const folderStopped = downloadStore.markFolderSubFileCompleted(folderInfo.taskId, folderInfo.fileIndex, false, progress.error || '下载失败')
          if (folderStopped) {
            processQueue()
          }
        } else if (progress.status === 'paused') {
          debugLog('收到暂停回调', {
            taskId: progress.taskId,
            taskStatus: task.status,
            subFileStatus: task.subFiles?.[folderInfo.fileIndex]?.status
          })
          // 文件夹暂停时，子文件也标记暂停
          // 但如果任务已经恢复（waiting/downloading/processing），不要覆盖
          // 同时检查文件夹任务本身的状态，防止竞态条件
          if (task.status !== 'waiting' && task.status !== 'downloading' && task.status !== 'processing') {
            if (task.subFiles && task.subFiles[folderInfo.fileIndex]) {
              const subFile = task.subFiles[folderInfo.fileIndex]
              if (subFile.status !== 'waiting' && subFile.status !== 'downloading' && subFile.status !== 'processing') {
                subFile.status = 'paused'
              }
            }
            // 清理该子文件的映射和同步锁，释放并发位置
            folderDownloadMap.value.delete(progress.taskId)
            subFileProcessingLock.delete(progress.taskId)
            // 暂停后处理等待队列
            processQueue()
          } else {
            // 任务已恢复，但收到了延迟的暂停回调，清理旧映射和同步锁即可
            folderDownloadMap.value.delete(progress.taskId)
            subFileProcessingLock.delete(progress.taskId)
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

  // 获取当前总活跃下载数（单文件 + 文件夹子文件）
  function getTotalActiveDownloads(): number {
    // 统计正在下载的单文件
    const singleFileDownloads = downloadStore.downloadTasks.filter(t =>
      !t.isFolder && (t.status === 'downloading' || t.status === 'creating' || t.status === 'processing')
    ).length

    // 统计文件夹子文件下载数（基于实际子文件状态，而不是 folderDownloadMap）
    // 这样可以避免快速暂停/恢复时旧映射残留导致的计数错误
    let folderSubFileDownloads = 0
    downloadStore.downloadTasks.forEach(t => {
      if (t.isFolder && t.subFiles) {
        for (const sf of t.subFiles) {
          if (sf.status === 'downloading' || sf.status === 'creating' || sf.status === 'processing') {
            folderSubFileDownloads++
          }
        }
      }
    })

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
    // 如果任务已有下载链接（暂停后恢复），先检查 aria2 状态
    if (task.downloadUrl) {
      // 先查询 aria2 中该任务的实际状态，防止重复下载已完成的文件
      const statusResult = await window.electronAPI?.getDownloadStatus(task.id)
      if (statusResult?.success && statusResult.status) {
        const aria2Status = statusResult.status.status
        if (aria2Status === 'complete') {
          // aria2 显示已完成，直接标记成功
          downloadStore.moveToCompleted(task, true)
          // 释放锁并处理下一个任务
          isFetchingLink.value = false
          processQueue()
          return
        }
      }

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

    // 获取当前活跃下载数（只统计状态为 downloading/creating/processing 的子文件）
    // 注意：不能只看 folderDownloadMap，因为可能有延迟的 paused 回调还没清理映射
    let realActiveCount = 0
    if (currentTask.subFiles) {
      for (const sf of currentTask.subFiles) {
        if (sf.status === 'downloading' || sf.status === 'creating' || sf.status === 'processing') {
          realActiveCount++
        }
      }
    }

    // 如果有真正活跃的下载，不启动新的
    if (realActiveCount >= 1) return

    // 清理该文件夹所有无效的映射（子文件状态不是 downloading/creating/processing 的）
    // 这样可以修复快速暂停/恢复时旧映射残留的问题
    const toCleanup: string[] = []
    folderDownloadMap.value.forEach((info, downloadId) => {
      if (info.taskId === task.id) {
        const subFile = currentTask.subFiles?.[info.fileIndex]
        if (!subFile || (subFile.status !== 'downloading' && subFile.status !== 'creating' && subFile.status !== 'processing')) {
          toCleanup.push(downloadId)
        }
      }
    })
    toCleanup.forEach(downloadId => folderDownloadMap.value.delete(downloadId))

    // 启动下一个子文件下载
    const nextSubFile = downloadStore.getNextWaitingSubFile(task.id)
    if (nextSubFile) {
      await startSubFileDownload(task, nextSubFile.index, nextSubFile.subFile)
    }
  }

  // 启动单个子文件下载
  async function startSubFileDownload(task: DownloadTask, index: number, subFile: SubFileTask) {
    // 生成子文件的下载 ID（放在最前面，用于同步锁）
    const subFileDownloadId = `${task.id}-sub-${index}`

    // 【关键】同步锁检查 - 必须在任何 await 之前执行
    // 使用原子操作：检查 + 加锁在同一个同步代码块中
    if (subFileProcessingLock.has(subFileDownloadId)) {
      debugLog('startSubFileDownload: 同步锁命中，跳过重复调用', { subFileDownloadId })
      return
    }
    // 立即加锁，阻止后续并行调用
    subFileProcessingLock.add(subFileDownloadId)

    debugLog('startSubFileDownload 开始', {
      taskId: task.id,
      index,
      fileName: subFile.file.name,
      subFileStatus: subFile.status,
      hasDownloadUrl: !!subFile.downloadUrl,
      hasLocalPath: !!subFile.localPath
    })

    if (!task.isFolder || !task.subFiles) {
      subFileProcessingLock.delete(subFileDownloadId)
      return
    }

    // 检查任务是否还在下载列表中
    const currentTask = downloadStore.downloadTasks.find(t => t.id === task.id)
    if (!currentTask) {
      debugLog('startSubFileDownload: 任务不在下载列表中，退出')
      subFileProcessingLock.delete(subFileDownloadId)
      return
    }

    // 检查任务是否被暂停或已失败
    if (currentTask.status === 'paused' || currentTask.status === 'error') {
      debugLog('startSubFileDownload: 任务已暂停或失败，退出', { status: currentTask.status })
      subFileProcessingLock.delete(subFileDownloadId)
      return
    }

    debugLog('生成子文件下载ID', { subFileDownloadId })

    // 检查是否已经在 folderDownloadMap 中（双重保险）
    if (folderDownloadMap.value.has(subFileDownloadId)) {
      debugLog('startSubFileDownload: 子文件已在下载中，跳过', { subFileDownloadId })
      subFileProcessingLock.delete(subFileDownloadId)
      return
    }

    // 检查子文件状态，只处理 waiting 状态的
    const currentSubFile = currentTask.subFiles?.[index]
    if (!currentSubFile || currentSubFile.status !== 'waiting') {
      debugLog('startSubFileDownload: 子文件状态不是 waiting，跳过', {
        status: currentSubFile?.status
      })
      subFileProcessingLock.delete(subFileDownloadId)
      return
    }

    // 立即标记为处理中并注册映射
    downloadStore.updateFolderSubFileStatus(task.id, index, 'processing')
    folderDownloadMap.value.set(subFileDownloadId, { taskId: task.id, fileIndex: index })

    // 更新当前正在下载的文件名（显示最新启动的）
    task.currentFileName = subFile.file.name
    task.currentFileIndex = index

    // 如果子文件已经有下载链接（暂停后恢复的情况），先检查 aria2 任务状态
    if (subFile.downloadUrl && subFile.localPath) {
      debugLog('子文件有下载链接，检查 aria2 状态', {
        downloadUrl: subFile.downloadUrl?.substring(0, 50) + '...',
        localPath: subFile.localPath
      })

      // 先查询 aria2 中该任务的实际状态，防止重复下载已完成的文件
      const statusResult = await window.electronAPI?.getDownloadStatus(subFileDownloadId)
      debugLog('aria2 状态查询结果', statusResult)

      if (statusResult?.success && statusResult.status) {
        const aria2Status = statusResult.status.status
        debugLog('aria2 任务状态', { aria2Status })

        if (aria2Status === 'complete') {
          debugLog('aria2 显示已完成，直接标记成功')
          // 清理映射和同步锁
          folderDownloadMap.value.delete(subFileDownloadId)
          subFileProcessingLock.delete(subFileDownloadId)
          // aria2 显示已完成，直接标记成功
          downloadStore.markFolderSubFileCompleted(task.id, index, true)
          // 检查文件夹是否全部完成
          if (currentTask.subFiles) {
            const allDone = currentTask.subFiles.every(sf => sf.status === 'completed' || sf.status === 'error')
            if (allDone) {
              const allSuccess = currentTask.subFiles.every(sf => sf.status === 'completed')
              downloadStore.moveToCompleted(currentTask, allSuccess)
            } else {
              // 继续下载下一个文件
              fillFolderDownloadSlots(currentTask)
            }
          }
          processQueue()
          return
        }
      } else {
        debugLog('aria2 状态查询失败或无状态，检查文件是否已存在')

        // aria2 没有记录这个任务，但文件可能已经下载完成
        // 检查本地文件是否存在且大小匹配
        const fileCheckResult = await window.electronAPI?.checkFileExists(
          subFile.localPath,
          subFile.file.size
        )
        debugLog('文件存在检查结果', fileCheckResult)

        if (fileCheckResult?.exists && fileCheckResult?.sizeMatch) {
          debugLog('文件已存在且大小匹配，直接标记为完成')
          // 文件已完成，直接标记成功，清理映射和同步锁
          folderDownloadMap.value.delete(subFileDownloadId)
          subFileProcessingLock.delete(subFileDownloadId)
          downloadStore.markFolderSubFileCompleted(task.id, index, true)
          // 检查文件夹是否全部完成
          if (currentTask.subFiles) {
            const allDone = currentTask.subFiles.every(sf => sf.status === 'completed' || sf.status === 'error')
            if (allDone) {
              const allSuccess = currentTask.subFiles.every(sf => sf.status === 'completed')
              downloadStore.moveToCompleted(currentTask, allSuccess)
            } else {
              // 继续下载下一个文件
              fillFolderDownloadSlots(currentTask)
            }
          }
          processQueue()
          return
        }

        // 文件不存在或大小不匹配，清理旧的下载链接，重新获取
        debugLog('文件不存在或大小不匹配，需要重新下载')
        subFile.downloadUrl = undefined
        subFile.localPath = undefined
        // 需要重新获取下载链接，不要直接恢复
        // 继续执行下面获取下载链接的逻辑
      }

      // 如果走到这里，说明 aria2 有状态但不是 complete，在恢复前先检查文件是否已完成
      if (statusResult?.success && statusResult.status) {
        // 先检查本地文件是否已存在且大小匹配（可能下载已完成但 aria2 状态延迟）
        let fileCheckBeforeResume: { exists: boolean; size?: number; sizeMatch?: boolean } | undefined
        if (subFile.localPath) {
          fileCheckBeforeResume = await window.electronAPI?.checkFileExists(
            subFile.localPath,
            subFile.file.size
          )
        }
        debugLog('恢复前文件检查结果', fileCheckBeforeResume)

        if (fileCheckBeforeResume?.exists && fileCheckBeforeResume?.sizeMatch) {
          debugLog('文件已存在且大小匹配，直接标记为完成，不恢复下载')
          // 清理 aria2 记录、映射和同步锁
          await window.electronAPI?.cleanupDownload(subFileDownloadId)
          folderDownloadMap.value.delete(subFileDownloadId)
          subFileProcessingLock.delete(subFileDownloadId)
          downloadStore.markFolderSubFileCompleted(task.id, index, true)
          // 检查文件夹是否全部完成
          if (currentTask.subFiles) {
            const allDone = currentTask.subFiles.every(sf => sf.status === 'completed' || sf.status === 'error')
            if (allDone) {
              const allSuccess = currentTask.subFiles.every(sf => sf.status === 'completed')
              downloadStore.moveToCompleted(currentTask, allSuccess)
            } else {
              fillFolderDownloadSlots(currentTask)
            }
          }
          processQueue()
          return
        }

        debugLog('准备恢复下载', { subFileDownloadId })
        downloadStore.updateFolderSubFileStatus(task.id, index, 'downloading')
        if (currentTask.status !== 'downloading') {
          downloadStore.updateTaskStatus(task.id, 'downloading')
        }
        // 恢复下载
        const resumeResult = await window.electronAPI?.resumeDownload(subFileDownloadId)
        debugLog('恢复下载结果', resumeResult)
        return
      }
    }

    debugLog('子文件无下载链接，需要获取新链接')

    // 使用任务自身的会话数据，避免被新下载编码覆盖
    const session = task.sessionData
    if (!session) {
      // 清理映射和同步锁
      folderDownloadMap.value.delete(subFileDownloadId)
      subFileProcessingLock.delete(subFileDownloadId)
      downloadStore.markFolderSubFileCompleted(task.id, index, false, '会话数据丢失，请重新添加下载任务')
      processQueue()
      return
    }

    try {
      // 再次检查任务状态（异步操作前）
      const taskBeforeApi = downloadStore.downloadTasks.find(t => t.id === task.id)
      if (!taskBeforeApi || taskBeforeApi.status === 'paused' || taskBeforeApi.status === 'error') {
        // 清理映射、同步锁并恢复子文件状态，以便下次恢复时能找到
        folderDownloadMap.value.delete(subFileDownloadId)
        subFileProcessingLock.delete(subFileDownloadId)
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
        // 清理映射、同步锁并恢复子文件状态，以便下次恢复时能找到
        folderDownloadMap.value.delete(subFileDownloadId)
        subFileProcessingLock.delete(subFileDownloadId)
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
        // 清理映射和同步锁
        folderDownloadMap.value.delete(subFileDownloadId)
        subFileProcessingLock.delete(subFileDownloadId)
        // 标记子文件失败，整个文件夹停止
        const folderStopped = downloadStore.markFolderSubFileCompleted(task.id, index, false, error.message || '获取下载链接失败')
        errorCount.value++

        if (folderStopped) {
          cancelFolderDownloads(task.id)
          processQueue()
        }
      } else {
        // 清理映射和同步锁，等待后重试当前文件
        folderDownloadMap.value.delete(subFileDownloadId)
        subFileProcessingLock.delete(subFileDownloadId)
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

  // 清理文件夹任务的下载映射和同步锁（删除任务时调用）
  function cleanupFolderDownloadMap(taskId: string) {
    const toDelete: string[] = []
    folderDownloadMap.value.forEach((info, downloadId) => {
      if (info.taskId === taskId) {
        toDelete.push(downloadId)
      }
    })
    toDelete.forEach(downloadId => {
      folderDownloadMap.value.delete(downloadId)
      subFileProcessingLock.delete(downloadId)
    })
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
    fillFolderDownloadSlots,
    cleanupFolderDownloadMap
  }
}
