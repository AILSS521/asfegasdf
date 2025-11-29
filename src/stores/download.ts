import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FileItem, DownloadTask, TaskStatus, SubFileTask, TaskSessionData } from '@/types'

export const useDownloadStore = defineStore('download', () => {
  // 状态 - 合并等待和下载中为一个列表
  const downloadTasks = ref<DownloadTask[]>([])
  const completedTasks = ref<DownloadTask[]>([])
  const failedTasks = ref<DownloadTask[]>([])

  // 当前会话数据
  const currentCode = ref('')
  const currentFileList = ref<FileItem[]>([])
  const currentPath = ref('/') // 当前浏览的完整网盘路径
  const basePath = ref('/') // 分享链接的基础路径（虚拟根目录）
  const sessionData = ref<{
    uk: string
    shareid: string
    randsk: string
    surl: string
    pwd: string
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

  // 添加单个文件任务到下载列表
  function addToDownload(files: FileItem[], downloadBasePath: string | null = null) {
    // 保存当前会话数据到任务中，避免被新下载编码覆盖
    const taskSession: TaskSessionData | undefined = sessionData.value ? {
      code: currentCode.value,
      uk: sessionData.value.uk,
      shareid: sessionData.value.shareid,
      randsk: sessionData.value.randsk,
      surl: sessionData.value.surl,
      pwd: sessionData.value.pwd
    } : undefined

    const newTasks: DownloadTask[] = files.map(file => ({
      id: `${Date.now()}-${file.fs_id}`,
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
    // 保存当前会话数据到任务中，避免被新下载编码覆盖
    const taskSession: TaskSessionData | undefined = sessionData.value ? {
      code: currentCode.value,
      uk: sessionData.value.uk,
      shareid: sessionData.value.shareid,
      randsk: sessionData.value.randsk,
      surl: sessionData.value.surl,
      pwd: sessionData.value.pwd
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
      id: `${Date.now()}-folder-${folder.fs_id}`,
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

      // 更新文件夹总体进度
      task.speed = speed
      task.downloadedSize = task.subFiles.reduce((sum, sf) => sum + sf.downloadedSize, 0)
      task.progress = task.totalSize > 0 ? (task.downloadedSize / task.totalSize) * 100 : 0
      task.currentFileIndex = fileIndex

      if (task.status !== 'downloading') {
        task.status = 'downloading'
      }
    }
  }

  // 标记文件夹中的子文件完成
  // 返回 true 表示整个文件夹任务已结束（成功或失败）
  function markFolderSubFileCompleted(taskId: string, fileIndex: number, success: boolean, error?: string): boolean {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && task.isFolder && task.subFiles && task.subFiles[fileIndex]) {
      const subFile = task.subFiles[fileIndex]
      subFile.status = success ? 'completed' : 'error'
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
        task.error = `文件 "${subFile.file.server_filename}" 下载失败: ${error || '未知错误'}`
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
    }
  }

  // 暂停任务
  function pauseTask(taskId: string) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && (task.status === 'downloading' || task.status === 'waiting' || task.status === 'processing' || task.status === 'creating')) {
      // 对于文件夹任务，需要暂停当前正在下载的子文件
      if (task.isFolder && task.subFiles && task.currentFileIndex !== undefined) {
        const subFileDownloadId = `${task.id}-sub-${task.currentFileIndex}`
        window.electronAPI?.pauseDownload(subFileDownloadId)
        // 标记当前子文件为暂停
        const subFile = task.subFiles[task.currentFileIndex]
        if (subFile && (subFile.status === 'downloading' || subFile.status === 'processing' || subFile.status === 'creating')) {
          subFile.status = 'paused'
        }
      } else if (task.status === 'downloading') {
        // 普通文件任务
        window.electronAPI?.pauseDownload(taskId)
      }
      task.status = 'paused'
    }
  }

  // 恢复任务
  function resumeTask(taskId: string) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && task.status === 'paused') {
      if (task.isFolder && task.subFiles) {
        // 文件夹任务：统一设为等待状态，由 processQueue 处理
        // 因为需要在 useDownloadManager 中设置 folderDownloadMap
        task.status = 'waiting'
        // 恢复暂停的子文件为等待状态（只恢复 paused 状态的，已完成的保留）
        task.subFiles.forEach(sf => {
          if (sf.status === 'paused') {
            sf.status = 'waiting'
          }
        })
      } else if (task.downloadUrl) {
        // 普通文件任务：如果已经开始下载过，调用恢复API
        task.status = 'downloading'
        window.electronAPI?.resumeDownload(taskId)
      } else {
        // 还没开始下载，改为等待状态
        task.status = 'waiting'
      }
    }
  }

  // 暂停所有任务
  function pauseAll() {
    downloadTasks.value.forEach(task => {
      if (task.status === 'downloading' || task.status === 'waiting' || task.status === 'processing' || task.status === 'creating') {
        // 对于文件夹任务，需要暂停当前正在下载的子文件
        if (task.isFolder && task.subFiles && task.currentFileIndex !== undefined) {
          const subFileDownloadId = `${task.id}-sub-${task.currentFileIndex}`
          window.electronAPI?.pauseDownload(subFileDownloadId)
          const subFile = task.subFiles[task.currentFileIndex]
          if (subFile && (subFile.status === 'downloading' || subFile.status === 'processing' || subFile.status === 'creating')) {
            subFile.status = 'paused'
          }
        } else if (task.status === 'downloading') {
          window.electronAPI?.pauseDownload(task.id)
        }
        task.status = 'paused'
      }
    })
  }

  // 恢复所有任务
  function resumeAll() {
    downloadTasks.value.forEach(task => {
      if (task.status === 'paused') {
        if (task.isFolder && task.subFiles) {
          // 文件夹任务：统一设为等待状态，由 processQueue 处理
          task.status = 'waiting'
          task.subFiles.forEach(sf => {
            if (sf.status === 'paused') {
              sf.status = 'waiting'
            }
          })
        } else if (task.downloadUrl) {
          // 普通文件任务：如果已经开始下载过，调用恢复API
          task.status = 'downloading'
          window.electronAPI?.resumeDownload(task.id)
        } else {
          task.status = 'waiting'
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
    task.ua = undefined

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
        sf.ua = undefined
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
          sf.ua = undefined
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
      task.ua = undefined
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
            sf.ua = undefined
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
        task.ua = undefined
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
    task.ua = undefined

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
        sf.ua = undefined
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
        sf.ua = undefined
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
    retryAllFailed
  }
})
