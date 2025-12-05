import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FileItem, DownloadTask, TaskStatus, SubFileTask, TaskSessionData } from '@/types'

export const useDownloadStore = defineStore('download', () => {
  // 状态 - 合并等待和下载中为一个列表
  const downloadTasks = ref<DownloadTask[]>([])
  const completedTasks = ref<DownloadTask[]>([])
  const failedTasks = ref<DownloadTask[]>([])

  // 当前会话数据（通用格式，加密的 session）
  const currentCode = ref('')
  const currentFileList = ref<FileItem[]>([])
  const currentPath = ref('/') // 当前浏览的完整网盘路径
  const basePath = ref('/') // 分享链接的基础路径（虚拟根目录）
  const sessionData = ref<{
    session: string  // 加密的会话数据，客户端透传
  } | null>(null)

  // 计算属性
  const downloadCount = computed(() => downloadTasks.value.length)
  const completedCount = computed(() => completedTasks.value.length)
  const failedCount = computed(() => failedTasks.value.length)

  // 活跃下载数（处理中、正在下载、暂停或创建中的任务）
  const activeDownloadCount = computed(() =>
    downloadTasks.value.filter(t =>
      t.status === 'processing' || t.status === 'downloading' || t.status === 'paused' || t.status === 'creating'
    ).length
  )

  // 方法
  function setCurrentCode(code: string) {
    currentCode.value = code
  }

  function setCurrentFileList(list: FileItem[]) {
    currentFileList.value = list
  }

  function setSessionData(data: typeof sessionData.value) {
    sessionData.value = data
  }

  function setBasePath(path: string) {
    basePath.value = path
  }

  function setCurrentPath(path: string) {
    currentPath.value = path
  }

  // 获取队列中所有文件的 id（包括文件夹中的子文件）
  function getQueuedFileIds(): Set<string> {
    const fileIds = new Set<string>()
    downloadTasks.value.forEach(task => {
      // 添加任务本身的 id
      fileIds.add(task.file.id)
      // 如果是文件夹，添加所有子文件的 id
      if (task.isFolder && task.subFiles) {
        task.subFiles.forEach(sf => fileIds.add(sf.file.id))
      }
    })
    return fileIds
  }

  // 添加单个文件任务到下载列表
  function addToDownload(files: FileItem[], downloadBasePath: string | null = null) {
    // 过滤掉已在队列中的文件
    const queuedFileIds = getQueuedFileIds()
    const newFiles = files.filter(f => !queuedFileIds.has(f.id))
    if (newFiles.length === 0) return

    // 保存当前会话数据到任务中，避免被新下载编码覆盖
    const taskSession: TaskSessionData | undefined = sessionData.value ? {
      code: currentCode.value,
      session: sessionData.value.session, // 加密的会话数据，客户端透传
      basePath: basePath.value // 保存分享根目录路径
    } : undefined

    const newTasks: DownloadTask[] = newFiles.map(file => ({
      id: `${Date.now()}-${file.id}`,
      file,
      status: 'waiting' as TaskStatus,
      progress: 0,
      speed: 0,
      downloadedSize: 0,
      totalSize: file.size,
      createdAt: Date.now(),
      retryCount: 0,
      downloadBasePath,
      isFolder: false,
      sessionData: taskSession
    }))
    downloadTasks.value.push(...newTasks)
  }

  // 添加文件夹任务到下载列表
  function addFolderToDownload(folder: FileItem, files: FileItem[], downloadBasePath: string) {
    // 检查文件夹是否已在队列中
    const queuedFileIds = getQueuedFileIds()
    if (queuedFileIds.has(folder.id)) return

    // 保存当前会话数据到任务中，避免被新下载编码覆盖
    const taskSession: TaskSessionData | undefined = sessionData.value ? {
      code: currentCode.value,
      session: sessionData.value.session, // 加密的会话数据，客户端透传
      basePath: basePath.value // 保存分享根目录路径
    } : undefined

    // 计算总大小
    const totalSize = files.reduce((sum, f) => sum + f.size, 0)

    // 创建子文件任务列表
    const subFiles: SubFileTask[] = files.map(file => ({
      file,
      status: 'waiting' as TaskStatus,
      progress: 0,
      speed: 0,
      downloadedSize: 0,
      totalSize: file.size,
      retryCount: 0
    }))

    const folderTask: DownloadTask = {
      id: `${Date.now()}-folder-${folder.id}`,
      file: folder,
      status: 'waiting' as TaskStatus,
      progress: 0,
      speed: 0,
      downloadedSize: 0,
      totalSize,
      createdAt: Date.now(),
      retryCount: 0,
      downloadBasePath,
      isFolder: true,
      subFiles,
      completedCount: 0,
      totalCount: files.length,
      currentFileIndex: 0,
      sessionData: taskSession
    }

    downloadTasks.value.push(folderTask)
  }

  // 从下载列表移除任务
  function removeFromDownload(taskIds: string[]) {
    downloadTasks.value = downloadTasks.value.filter(t => !taskIds.includes(t.id))
  }

  // 移动到已完成或失败列表
  function moveToCompleted(task: DownloadTask, success: boolean = true) {
    const index = downloadTasks.value.findIndex(t => t.id === task.id)
    if (index > -1) {
      downloadTasks.value.splice(index, 1)
      task.status = success ? 'completed' : 'error'
      task.completedAt = Date.now()
      if (success) {
        completedTasks.value.unshift(task)
      } else {
        failedTasks.value.unshift(task)
      }
    }
  }

  // 更新任务状态
  function updateTaskStatus(taskId: string, status: TaskStatus) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task) {
      task.status = status
    }
  }

  // 更新任务进度
  function updateTaskProgress(taskId: string, progress: number, speed: number, downloadedSize: number) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task) {
      task.progress = progress
      task.speed = speed
      task.downloadedSize = downloadedSize
      if (task.status !== 'downloading') {
        task.status = 'downloading'
      }
    }
  }

  // 更新文件夹任务中子文件的进度
  function updateFolderSubFileProgress(taskId: string, fileIndex: number, progress: number, speed: number, downloadedSize: number) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && task.isFolder && task.subFiles && task.subFiles[fileIndex]) {
      const subFile = task.subFiles[fileIndex]
      subFile.progress = progress
      subFile.speed = speed
      subFile.downloadedSize = downloadedSize
      subFile.status = 'downloading'

      // 更新文件夹总体进度（不更新速度，速度由独立定时器计算）
      task.downloadedSize = task.subFiles.reduce((sum, sf) => sum + sf.downloadedSize, 0)
      task.progress = task.totalSize > 0 ? (task.downloadedSize / task.totalSize) * 100 : 0
      task.currentFileIndex = fileIndex

      if (task.status !== 'downloading') {
        task.status = 'downloading'
      }
    }
  }

  // 更新所有文件夹任务的总速度（由定时器调用，每秒一次）
  function updateAllFolderSpeeds() {
    downloadTasks.value.forEach(task => {
      if (task.isFolder && task.subFiles && task.status === 'downloading') {
        task.speed = task.subFiles.reduce((sum, sf) => {
          return sum + (sf.status === 'downloading' ? sf.speed : 0)
        }, 0)
      }
    })
  }

  // 标记文件夹中的子文件完成
  // 返回 true 表示整个文件夹任务已结束（成功或失败）
  function markFolderSubFileCompleted(taskId: string, fileIndex: number, success: boolean, error?: string): boolean {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && task.isFolder && task.subFiles && task.subFiles[fileIndex]) {
      const subFile = task.subFiles[fileIndex]
      subFile.status = success ? 'completed' : 'error'
      subFile.speed = 0 // 完成后重置子文件速度
      if (error) subFile.error = error
      if (success) {
        subFile.progress = 100
        subFile.downloadedSize = subFile.totalSize
      }

      // 更新已完成数量
      task.completedCount = task.subFiles.filter(sf => sf.status === 'completed').length

      // 更新文件夹总体下载量
      task.downloadedSize = task.subFiles.reduce((sum, sf) => sum + sf.downloadedSize, 0)
      task.progress = task.totalSize > 0 ? (task.downloadedSize / task.totalSize) * 100 : 0

      // 如果有子文件失败，立即停止整个文件夹下载
      if (!success) {
        task.error = `文件 "${subFile.file.name}" 下载失败: ${error || '未知错误'}`
        moveToCompleted(task, false)
        return true // 文件夹任务已结束
      }

      // 检查是否所有文件都完成了
      const allCompleted = task.subFiles.every(sf => sf.status === 'completed' || sf.status === 'error')
      if (allCompleted) {
        const allSuccess = task.subFiles.every(sf => sf.status === 'completed')
        moveToCompleted(task, allSuccess)
        return true // 文件夹任务已结束
      }
    }
    return false // 文件夹任务继续
  }

  // 获取文件夹中下一个等待的子文件
  function getNextWaitingSubFile(taskId: string): { index: number; subFile: SubFileTask } | undefined {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && task.isFolder && task.subFiles) {
      const index = task.subFiles.findIndex(sf => sf.status === 'waiting')
      if (index !== -1) {
        return { index, subFile: task.subFiles[index] }
      }
    }
    return undefined
  }

  // 更新文件夹子文件状态
  function updateFolderSubFileStatus(taskId: string, fileIndex: number, status: TaskStatus) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && task.isFolder && task.subFiles && task.subFiles[fileIndex]) {
      task.subFiles[fileIndex].status = status
      // 非下载状态时重置子文件速度
      if (status !== 'downloading') {
        task.subFiles[fileIndex].speed = 0
      }
    }
  }

  // 暂停任务
  function pauseTask(taskId: string) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && (task.status === 'downloading' || task.status === 'waiting' || task.status === 'processing' || task.status === 'creating')) {
      // 对于文件夹任务，需要暂停所有正在下载的子文件
      if (task.isFolder && task.subFiles) {
        task.subFiles.forEach((subFile, index) => {
          if (subFile.status === 'downloading' || subFile.status === 'processing' || subFile.status === 'creating') {
            const subFileDownloadId = `${task.id}-sub-${index}`
            window.electronAPI?.pauseDownload(subFileDownloadId)
            subFile.status = 'paused'
            subFile.speed = 0 // 重置子文件速度
          }
        })
      } else if (task.status === 'downloading' || task.status === 'creating') {
        // 普通文件任务（下载中或创建文件中）
        window.electronAPI?.pauseDownload(taskId)
      }
      task.status = 'paused'
      task.speed = 0 // 重置速度，避免恢复时显示错误数值
    }
  }

  // 恢复任务
  function resumeTask(taskId: string) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && task.status === 'paused') {
      // 重置速度，等待实际下载进度更新
      task.speed = 0
      // 统一设为等待状态，由 processQueue 处理并发限制
      task.status = 'waiting'
      if (task.isFolder && task.subFiles) {
        // 恢复暂停的子文件为等待状态（只恢复 paused 状态的，已完成的保留）
        task.subFiles.forEach(sf => {
          if (sf.status === 'paused') {
            sf.status = 'waiting'
            sf.speed = 0 // 重置子文件速度
          }
        })
      }
    }
  }

  // 暂停所有任务
  function pauseAll() {
    downloadTasks.value.forEach(task => {
      if (task.status === 'downloading' || task.status === 'waiting' || task.status === 'processing' || task.status === 'creating') {
        // 对于文件夹任务，需要暂停所有正在下载的子文件
        if (task.isFolder && task.subFiles) {
          task.subFiles.forEach((subFile, index) => {
            if (subFile.status === 'downloading' || subFile.status === 'processing' || subFile.status === 'creating') {
              const subFileDownloadId = `${task.id}-sub-${index}`
              window.electronAPI?.pauseDownload(subFileDownloadId)
              subFile.status = 'paused'
              subFile.speed = 0 // 重置子文件速度
            }
          })
        } else if (task.status === 'downloading' || task.status === 'creating') {
          window.electronAPI?.pauseDownload(task.id)
        }
        task.status = 'paused'
        task.speed = 0 // 重置速度
      }
    })
  }

  // 恢复所有任务
  function resumeAll() {
    downloadTasks.value.forEach(task => {
      if (task.status === 'paused') {
        // 重置速度，等待实际下载进度更新
        task.speed = 0
        // 统一设为等待状态，由 processQueue 处理并发限制
        task.status = 'waiting'
        if (task.isFolder && task.subFiles) {
          // 恢复暂停的子文件为等待状态
          task.subFiles.forEach(sf => {
            if (sf.status === 'paused') {
              sf.status = 'waiting'
              sf.speed = 0 // 重置子文件速度
            }
          })
        }
      }
    })
  }

  // 清空已完成
  function clearCompleted() {
    completedTasks.value = []
  }

  // 移除已完成的任务
  function removeCompleted(taskIds: string[]) {
    completedTasks.value = completedTasks.value.filter(t => !taskIds.includes(t.id))
  }

  // 获取下一个等待中的任务
  function getNextWaitingTask(): DownloadTask | undefined {
    return downloadTasks.value.find(t => t.status === 'waiting')
  }

  // 从失败列表中重新下载任务
  function retryFromFailed(taskId: string) {
    const taskIndex = failedTasks.value.findIndex(t => t.id === taskId)
    if (taskIndex === -1) return

    const task = failedTasks.value[taskIndex]
    // 从失败列表移除
    failedTasks.value.splice(taskIndex, 1)

    // 重置任务状态
    task.status = 'waiting'
    task.error = undefined
    task.retryCount = 0
    task.progress = 0
    task.speed = 0
    task.downloadedSize = 0
    task.completedAt = undefined
    task.downloadUrl = undefined
    task.headers = undefined

    // 如果是文件夹，重置所有子文件状态
    if (task.isFolder && task.subFiles) {
      task.subFiles.forEach(sf => {
        sf.status = 'waiting'
        sf.error = undefined
        sf.retryCount = 0
        sf.progress = 0
        sf.speed = 0
        sf.downloadedSize = 0
        sf.downloadUrl = undefined
        sf.headers = undefined
      })
      task.completedCount = 0
    }

    // 添加到下载列表
    downloadTasks.value.push(task)
  }

  // 重试失败任务（统一入口，文件夹只重试失败的子文件，单文件直接重试）
  function retryFailedSubFilesFromFailed(taskId: string) {
    const taskIndex = failedTasks.value.findIndex(t => t.id === taskId)
    if (taskIndex === -1) return

    const task = failedTasks.value[taskIndex]

    // 从失败列表移除
    failedTasks.value.splice(taskIndex, 1)

    // 重置任务状态
    task.status = 'waiting'
    task.error = undefined
    task.retryCount = 0

    if (task.isFolder && task.subFiles) {
      // 文件夹任务：只重置失败和未下载的子文件，已完成的保留
      task.subFiles.forEach(sf => {
        if (sf.status === 'error' || sf.status === 'waiting') {
          sf.status = 'waiting'
          sf.error = undefined
          sf.retryCount = 0
          sf.progress = 0
          sf.speed = 0
          sf.downloadedSize = 0
          sf.downloadUrl = undefined
          sf.headers = undefined
        }
      })

      // 重新计算进度（保留已完成文件的进度）
      task.completedCount = task.subFiles.filter(sf => sf.status === 'completed').length
      task.downloadedSize = task.subFiles.reduce((sum, sf) => sum + sf.downloadedSize, 0)
      task.progress = task.totalSize > 0 ? (task.downloadedSize / task.totalSize) * 100 : 0
    } else {
      // 单文件任务：直接重置
      task.progress = 0
      task.speed = 0
      task.downloadedSize = 0
      task.completedAt = undefined
      task.downloadUrl = undefined
      task.headers = undefined
    }

    // 添加到下载列表
    downloadTasks.value.push(task)
  }

  // 获取失败列表中文件夹的失败子文件
  function getFailedSubFilesFromFailed(taskId: string): SubFileTask[] {
    const task = failedTasks.value.find(t => t.id === taskId)
    if (!task || !task.isFolder || !task.subFiles) return []
    return task.subFiles.filter(sf => sf.status === 'error')
  }

  // 移除失败任务
  function removeFromFailed(taskIds: string[]) {
    failedTasks.value = failedTasks.value.filter(t => !taskIds.includes(t.id))
  }

  // 清空失败列表
  function clearFailed() {
    failedTasks.value = []
  }

  // 重试所有失败任务（文件夹只重试未完成的子文件）
  function retryAllFailed() {
    const tasks = [...failedTasks.value]
    failedTasks.value = []

    tasks.forEach(task => {
      // 重置任务状态
      task.status = 'waiting'
      task.error = undefined
      task.retryCount = 0

      if (task.isFolder && task.subFiles) {
        // 文件夹任务：只重置失败和未下载的子文件，已完成的保留
        task.subFiles.forEach(sf => {
          if (sf.status === 'error' || sf.status === 'waiting') {
            sf.status = 'waiting'
            sf.error = undefined
            sf.retryCount = 0
            sf.progress = 0
            sf.speed = 0
            sf.downloadedSize = 0
            sf.downloadUrl = undefined
            sf.headers = undefined
          }
        })

        // 重新计算进度（保留已完成文件的进度）
        task.completedCount = task.subFiles.filter(sf => sf.status === 'completed').length
        task.downloadedSize = task.subFiles.reduce((sum, sf) => sum + sf.downloadedSize, 0)
        task.progress = task.totalSize > 0 ? (task.downloadedSize / task.totalSize) * 100 : 0
      } else {
        // 单文件任务：直接重置
        task.progress = 0
        task.speed = 0
        task.downloadedSize = 0
        task.completedAt = undefined
        task.downloadUrl = undefined
        task.headers = undefined
      }

      // 添加到下载列表
      downloadTasks.value.push(task)
    })
  }

  // 从已完成列表中重新下载任务（保留兼容）
  function retryFromCompleted(taskId: string) {
    const taskIndex = completedTasks.value.findIndex(t => t.id === taskId)
    if (taskIndex === -1) return

    const task = completedTasks.value[taskIndex]
    // 从已完成列表移除
    completedTasks.value.splice(taskIndex, 1)

    // 重置任务状态
    task.status = 'waiting'
    task.error = undefined
    task.retryCount = 0
    task.progress = 0
    task.speed = 0
    task.downloadedSize = 0
    task.completedAt = undefined
    task.downloadUrl = undefined
    task.headers = undefined

    // 如果是文件夹，重置所有子文件状态
    if (task.isFolder && task.subFiles) {
      task.subFiles.forEach(sf => {
        sf.status = 'waiting'
        sf.error = undefined
        sf.retryCount = 0
        sf.progress = 0
        sf.speed = 0
        sf.downloadedSize = 0
        sf.downloadUrl = undefined
        sf.headers = undefined
      })
      task.completedCount = 0
    }

    // 添加到下载列表
    downloadTasks.value.push(task)
  }

  // 重试文件夹中失败的文件
  function retryFailedSubFiles(taskId: string) {
    const taskIndex = completedTasks.value.findIndex(t => t.id === taskId)
    if (taskIndex === -1) return

    const task = completedTasks.value[taskIndex]
    if (!task.isFolder || !task.subFiles) return

    // 检查是否有失败的文件
    const hasFailedFiles = task.subFiles.some(sf => sf.status === 'error')
    if (!hasFailedFiles) return

    // 从已完成列表移除
    completedTasks.value.splice(taskIndex, 1)

    // 重置任务状态
    task.status = 'waiting'
    task.error = undefined

    // 只重置失败的子文件
    task.subFiles.forEach(sf => {
      if (sf.status === 'error') {
        sf.status = 'waiting'
        sf.error = undefined
        sf.retryCount = 0
        sf.progress = 0
        sf.speed = 0
        sf.downloadedSize = 0
        sf.downloadUrl = undefined
        sf.headers = undefined
      }
    })

    // 重新计算进度
    task.completedCount = task.subFiles.filter(sf => sf.status === 'completed').length
    task.downloadedSize = task.subFiles.reduce((sum, sf) => sum + sf.downloadedSize, 0)
    task.progress = task.totalSize > 0 ? (task.downloadedSize / task.totalSize) * 100 : 0

    // 添加到下载列表
    downloadTasks.value.push(task)
  }

  // 获取文件夹中失败的文件列表
  function getFailedSubFiles(taskId: string): SubFileTask[] {
    const task = completedTasks.value.find(t => t.id === taskId)
    if (!task || !task.isFolder || !task.subFiles) return []
    return task.subFiles.filter(sf => sf.status === 'error')
  }

  return {
    // 状态
    downloadTasks,
    completedTasks,
    failedTasks,
    currentCode,
    currentFileList,
    currentPath,
    basePath,
    sessionData,

    // 计算属性
    downloadCount,
    completedCount,
    failedCount,
    activeDownloadCount,

    // 方法
    setCurrentCode,
    setCurrentFileList,
    setCurrentPath,
    setBasePath,
    setSessionData,
    addToDownload,
    addFolderToDownload,
    removeFromDownload,
    moveToCompleted,
    updateTaskStatus,
    updateTaskProgress,
    updateFolderSubFileProgress,
    markFolderSubFileCompleted,
    getNextWaitingSubFile,
    updateFolderSubFileStatus,
    pauseTask,
    resumeTask,
    pauseAll,
    resumeAll,
    clearCompleted,
    removeCompleted,
    getNextWaitingTask,
    retryFromCompleted,
    retryFailedSubFiles,
    getFailedSubFiles,
    // 失败任务相关
    retryFromFailed,
    retryFailedSubFilesFromFailed,
    getFailedSubFilesFromFailed,
    removeFromFailed,
    clearFailed,
    retryAllFailed,
    updateAllFolderSpeeds
  }
})
