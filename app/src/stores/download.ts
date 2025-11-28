import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FileItem, DownloadTask, TaskStatus } from '@/types'

export const useDownloadStore = defineStore('download', () => {
  // 状态 - 合并等待和下载中为一个列表
  const downloadTasks = ref<DownloadTask[]>([])
  const completedTasks = ref<DownloadTask[]>([])

  // 当前会话数据
  const currentCode = ref('')
  const currentFileList = ref<FileItem[]>([])
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

  // 活跃下载数（正在下载或暂停的，不包括等待中的）
  const activeDownloadCount = computed(() =>
    downloadTasks.value.filter(t =>
      t.status === 'downloading' ||
      t.status === 'paused' ||
      t.status === 'creating'
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

  // 添加任务到下载列表
  function addToDownload(files: FileItem[], downloadBasePath: string | null = null) {
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
      downloadBasePath
    }))
    downloadTasks.value.push(...newTasks)
  }

  // 从下载列表移除任务
  function removeFromDownload(taskIds: string[]) {
    downloadTasks.value = downloadTasks.value.filter(t => !taskIds.includes(t.id))
  }

  // 移动到已完成
  function moveToCompleted(task: DownloadTask, success: boolean = true) {
    const index = downloadTasks.value.findIndex(t => t.id === task.id)
    if (index > -1) {
      downloadTasks.value.splice(index, 1)
      task.status = success ? 'completed' : 'error'
      task.completedAt = Date.now()
      completedTasks.value.unshift(task)
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

  // 暂停任务
  function pauseTask(taskId: string) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && (task.status === 'downloading' || task.status === 'waiting' || task.status === 'processing' || task.status === 'creating')) {
      // 只有正在下载的任务需要调用 electron API
      if (task.status === 'downloading') {
        window.electronAPI?.pauseDownload(taskId)
      }
      task.status = 'paused'
    }
  }

  // 恢复任务
  function resumeTask(taskId: string) {
    const task = downloadTasks.value.find(t => t.id === taskId)
    if (task && task.status === 'paused') {
      // 如果任务已经开始下载过，调用恢复API
      if (task.downloadUrl) {
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
      if (task.status === 'downloading') {
        window.electronAPI?.pauseDownload(task.id)
      }
      if (task.status === 'downloading' || task.status === 'waiting' || task.status === 'processing') {
        task.status = 'paused'
      }
    })
  }

  // 恢复所有任务
  function resumeAll() {
    downloadTasks.value.forEach(task => {
      if (task.status === 'paused') {
        if (task.downloadUrl) {
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

  return {
    // 状态
    downloadTasks,
    completedTasks,
    currentCode,
    currentFileList,
    basePath,
    sessionData,

    // 计算属性
    downloadCount,
    completedCount,
    activeDownloadCount,

    // 方法
    setCurrentCode,
    setCurrentFileList,
    setBasePath,
    setSessionData,
    addToDownload,
    removeFromDownload,
    moveToCompleted,
    updateTaskStatus,
    updateTaskProgress,
    pauseTask,
    resumeTask,
    pauseAll,
    resumeAll,
    clearCompleted,
    removeCompleted,
    getNextWaitingTask
  }
})
