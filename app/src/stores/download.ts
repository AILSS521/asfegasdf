import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { FileItem, DownloadTask, TaskStatus } from '@/types'

export const useDownloadStore = defineStore('download', () => {
  // 状态
  const waitingTasks = ref<DownloadTask[]>([])
  const downloadingTasks = ref<DownloadTask[]>([])
  const completedTasks = ref<DownloadTask[]>([])

  // 当前会话数据
  const currentCode = ref('')
  const currentFileList = ref<FileItem[]>([])
  const sessionData = ref<{
    uk: string
    shareid: string
    randsk: string
    surl: string
    pwd: string
  } | null>(null)

  // 计算属性
  const waitingCount = computed(() => waitingTasks.value.length)
  const downloadingCount = computed(() => downloadingTasks.value.length)
  const completedCount = computed(() => completedTasks.value.length)

  // 下载中任务数（包括暂停的）
  const activeDownloadCount = computed(() =>
    downloadingTasks.value.filter(t => t.status === 'downloading' || t.status === 'paused').length
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

  function addToWaiting(files: FileItem[]) {
    const newTasks: DownloadTask[] = files.map(file => ({
      id: `${Date.now()}-${file.fs_id}`,
      file,
      status: 'waiting' as TaskStatus,
      progress: 0,
      speed: 0,
      downloadedSize: 0,
      totalSize: file.size,
      createdAt: Date.now(),
      retryCount: 0
    }))
    waitingTasks.value.push(...newTasks)
  }

  function removeFromWaiting(taskIds: string[]) {
    waitingTasks.value = waitingTasks.value.filter(t => !taskIds.includes(t.id))
  }

  function moveToDownloading(task: DownloadTask) {
    const index = waitingTasks.value.findIndex(t => t.id === task.id)
    if (index > -1) {
      waitingTasks.value.splice(index, 1)
      task.status = 'downloading'
      downloadingTasks.value.push(task)
    }
  }

  function moveToCompleted(task: DownloadTask, success: boolean = true) {
    const index = downloadingTasks.value.findIndex(t => t.id === task.id)
    if (index > -1) {
      downloadingTasks.value.splice(index, 1)
      task.status = success ? 'completed' : 'error'
      task.completedAt = Date.now()
      completedTasks.value.unshift(task)
    }
  }

  function updateTaskProgress(taskId: string, progress: number, speed: number, downloadedSize: number) {
    const task = downloadingTasks.value.find(t => t.id === taskId)
    if (task) {
      task.progress = progress
      task.speed = speed
      task.downloadedSize = downloadedSize
    }
  }

  function pauseTask(taskId: string) {
    const task = downloadingTasks.value.find(t => t.id === taskId)
    if (task) {
      task.status = 'paused'
      window.electronAPI?.pauseDownload(taskId)
    }
  }

  function resumeTask(taskId: string) {
    const task = downloadingTasks.value.find(t => t.id === taskId)
    if (task && task.status === 'paused') {
      task.status = 'downloading'
      window.electronAPI?.resumeDownload(taskId)
    }
  }

  function pauseAllDownloading() {
    downloadingTasks.value.forEach(task => {
      if (task.status === 'downloading') {
        pauseTask(task.id)
      }
    })
  }

  function resumeAllDownloading() {
    downloadingTasks.value.forEach(task => {
      if (task.status === 'paused') {
        resumeTask(task.id)
      }
    })
  }

  function clearCompleted() {
    completedTasks.value = []
  }

  function removeCompleted(taskIds: string[]) {
    completedTasks.value = completedTasks.value.filter(t => !taskIds.includes(t.id))
  }

  // 等待任务状态更新
  function updateWaitingTaskStatus(taskId: string, status: TaskStatus) {
    const task = waitingTasks.value.find(t => t.id === taskId)
    if (task) {
      task.status = status
    }
  }

  function pauseAllWaiting() {
    waitingTasks.value.forEach(task => {
      if (task.status === 'waiting' || task.status === 'processing') {
        task.status = 'paused'
      }
    })
  }

  function resumeAllWaiting() {
    waitingTasks.value.forEach(task => {
      if (task.status === 'paused') {
        task.status = 'waiting'
      }
    })
  }

  return {
    // 状态
    waitingTasks,
    downloadingTasks,
    completedTasks,
    currentCode,
    currentFileList,
    sessionData,

    // 计算属性
    waitingCount,
    downloadingCount,
    completedCount,
    activeDownloadCount,

    // 方法
    setCurrentCode,
    setCurrentFileList,
    setSessionData,
    addToWaiting,
    removeFromWaiting,
    moveToDownloading,
    moveToCompleted,
    updateTaskProgress,
    pauseTask,
    resumeTask,
    pauseAllDownloading,
    resumeAllDownloading,
    clearCompleted,
    removeCompleted,
    updateWaitingTaskStatus,
    pauseAllWaiting,
    resumeAllWaiting
  }
})
