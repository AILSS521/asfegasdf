<template>
  <div class="completed-page">
    <!-- 顶部操作栏 -->
    <div class="action-bar">
      <template v-if="selectedIds.size > 0">
        <button class="action-btn" @click="clearSelected">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          清除记录
        </button>
      </template>
      <template v-else>
        <button class="action-btn" @click="clearAll">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          清空全部记录
        </button>
      </template>
    </div>

    <!-- 任务列表 -->
    <div class="task-list" v-if="tasks.length > 0">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="task-item"
        @mouseenter="hoverTaskId = task.id"
        @mouseleave="hoverTaskId = null"
      >
        <div class="task-checkbox">
          <input
            type="checkbox"
            :checked="selectedIds.has(task.id)"
            @change="toggleSelect(task.id)"
          />
        </div>
        <div class="task-icon">
          <svg v-if="task.file.isdir === 1" viewBox="0 0 24 24" width="24" height="24">
            <path fill="#ffc107" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="24" height="24">
            <path fill="#90caf9" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
          </svg>
        </div>
        <div class="task-info">
          <div class="task-name">{{ task.file.server_filename }}</div>
          <div class="task-status" :class="task.status">
            <template v-if="task.status === 'completed'">
              {{ formatTime(task.completedAt) }}
              <template v-if="task.isFolder && task.totalCount"> · 共 {{ task.totalCount }} 个文件</template>
            </template>
            <template v-else>
              {{ task.error || '下载失败' }}
              <template v-if="task.isFolder && task.completedCount !== undefined && task.totalCount">
                · 已完成 {{ task.completedCount }}/{{ task.totalCount }} 个文件
                <span class="view-failed" @click.stop="showFailedFiles(task)">查看失败详情</span>
              </template>
            </template>
          </div>
        </div>
        <div class="task-size" v-if="hoverTaskId !== task.id">
          {{ task.isFolder ? '--' : formatSize(task.file.size) }}
        </div>
        <div class="task-actions" v-else>
          <!-- 重新下载按钮（异常任务显示） -->
          <button
            v-if="task.status === 'error'"
            class="icon-btn primary"
            @click="retryTask(task)"
            title="重新下载"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>
          <!-- 重试失败文件按钮（文件夹部分失败时显示） -->
          <button
            v-if="task.status === 'error' && task.isFolder && hasFailedSubFiles(task)"
            class="icon-btn warning"
            @click="retryFailedFiles(task)"
            title="仅重试失败文件"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          </button>
          <!-- 删除记录按钮 -->
          <button
            class="icon-btn"
            @click="clearTask(task.id)"
            title="删除记录"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
          <!-- 打开文件位置（成功任务显示） -->
          <button
            v-if="task.status === 'completed' && getTaskPath(task)"
            class="icon-btn"
            @click="showInFolder(getTaskPath(task)!)"
            title="打开文件位置"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
            </svg>
          </button>
          <!-- 打开文件（成功任务且非文件夹显示） -->
          <button
            v-if="task.status === 'completed' && task.localPath && !task.isFolder"
            class="icon-btn"
            @click="openFile(task.localPath)"
            title="打开文件"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-else>
      <svg viewBox="0 0 24 24" width="48" height="48">
        <path fill="#5f6368" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
      <p>没有已完成的任务</p>
    </div>

    <!-- 失败文件详情弹窗 -->
    <div class="modal-overlay" v-if="showFailedModal" @click="closeFailedModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>失败文件详情</h3>
          <button class="close-btn" @click="closeFailedModal">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="failed-summary">
            共 {{ failedFiles.length }} 个文件下载失败
          </div>
          <div class="failed-list">
            <div class="failed-item" v-for="(file, index) in failedFiles" :key="index">
              <div class="failed-file-icon">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path fill="#90caf9" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                </svg>
              </div>
              <div class="failed-file-info">
                <div class="failed-file-name">{{ file.file.server_filename }}</div>
                <div class="failed-file-error">{{ file.error || '下载失败' }}</div>
              </div>
              <div class="failed-file-size">{{ formatSize(file.file.size) }}</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-btn secondary" @click="closeFailedModal">关闭</button>
          <button class="modal-btn primary" @click="retryFailedFromModal">重试失败文件</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDownloadStore } from '@/stores/download'
import { useDownloadManager } from '@/composables/useDownloadManager'
import type { DownloadTask, SubFileTask } from '@/types'
import dayjs from 'dayjs'
import path from 'path-browserify'

const router = useRouter()
const downloadStore = useDownloadStore()
const downloadManager = useDownloadManager()

const tasks = computed(() => downloadStore.completedTasks)
const selectedIds = ref<Set<string>>(new Set())
const hoverTaskId = ref<string | null>(null)

// 失败详情弹窗
const showFailedModal = ref(false)
const failedFiles = ref<SubFileTask[]>([])
const currentFailedTaskId = ref<string | null>(null)

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return ''
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm')
}

function clearTask(id: string) {
  downloadStore.removeCompleted([id])
  selectedIds.value.delete(id)
}

function clearSelected() {
  downloadStore.removeCompleted([...selectedIds.value])
  selectedIds.value.clear()
}

function clearAll() {
  downloadStore.clearCompleted()
  selectedIds.value.clear()
}

function showInFolder(path: string) {
  window.electronAPI?.showItemInFolder(path)
}

function openFile(path: string) {
  window.electronAPI?.openPath(path)
}

// 检查文件夹是否有失败的子文件
function hasFailedSubFiles(task: DownloadTask): boolean {
  if (!task.isFolder || !task.subFiles) return false
  return task.subFiles.some(sf => sf.status === 'error')
}

// 重新下载整个任务
function retryTask(task: DownloadTask) {
  downloadStore.retryFromCompleted(task.id)
  downloadManager.processQueue()
  router.push('/transfer/downloading')
}

// 仅重试失败的文件
function retryFailedFiles(task: DownloadTask) {
  downloadStore.retryFailedSubFiles(task.id)
  downloadManager.processQueue()
  router.push('/transfer/downloading')
}

// 显示失败文件详情
function showFailedFiles(task: DownloadTask) {
  if (!task.isFolder || !task.subFiles) return
  currentFailedTaskId.value = task.id
  failedFiles.value = downloadStore.getFailedSubFiles(task.id)
  showFailedModal.value = true
}

// 关闭失败详情弹窗
function closeFailedModal() {
  showFailedModal.value = false
  failedFiles.value = []
  currentFailedTaskId.value = null
}

// 从弹窗中重试失败文件
function retryFailedFromModal() {
  if (currentFailedTaskId.value) {
    downloadStore.retryFailedSubFiles(currentFailedTaskId.value)
    downloadManager.processQueue()
    closeFailedModal()
    router.push('/transfer/downloading')
  }
}

// 获取任务的本地路径（用于打开文件所在位置）
function getTaskPath(task: DownloadTask): string | null {
  // 普通文件直接返回 localPath
  if (!task.isFolder) {
    return task.localPath || null
  }

  // 文件夹任务：需要获取文件夹本身的路径（不是子文件的路径）
  // 从子文件的路径推断出文件夹的路径
  if (task.subFiles && task.subFiles.length > 0) {
    // 找到第一个有 localPath 的子文件
    const subFileWithPath = task.subFiles.find(sf => sf.localPath)
    if (subFileWithPath?.localPath) {
      // 获取子文件的目录路径
      const subFileDir = path.dirname(subFileWithPath.localPath)
      // 根据 downloadBasePath 计算文件夹的实际路径
      // 文件夹名称就是 task.file.server_filename
      // 需要找到这个文件夹在本地的位置

      // 子文件的相对路径（相对于 downloadBasePath）
      const subFilePath = subFileWithPath.file.path
      const basePath = task.downloadBasePath || ''

      // 计算子文件相对于文件夹的深度
      let relativePath = ''
      if (basePath && subFilePath.startsWith(basePath)) {
        relativePath = subFilePath.slice(basePath.length)
        if (relativePath.startsWith('/')) {
          relativePath = relativePath.slice(1)
        }
      }

      // relativePath 现在是类似 "文件夹名/子文件夹/文件.txt" 的格式
      // 我们需要的是 "文件夹名" 这一级的本地路径
      const relativeDir = path.dirname(relativePath)  // "文件夹名/子文件夹" 或 "文件夹名"

      // 从 subFileDir 往上找，直到找到文件夹名对应的目录
      // subFileDir 对应的是 relativeDir，所以需要去掉多余的层级
      const extraLevels = relativeDir.split('/').filter(Boolean).length - 1
      let folderPath = subFileDir
      for (let i = 0; i < extraLevels; i++) {
        folderPath = path.dirname(folderPath)
      }

      return folderPath
    }
  }

  // 如果文件夹本身有 localPath，返回它
  return task.localPath || null
}
</script>

<style lang="scss" scoped>
@import "@/styles/variables.scss";
.completed-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.action-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid $border-color;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid $border-color;
  border-radius: 6px;
  background: transparent;
  color: $text-secondary;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: $bg-hover;
    color: $text-primary;
  }
}

.task-list {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  transition: background 0.15s;

  &:hover {
    background: $bg-hover;
  }
}

.task-checkbox {
  flex-shrink: 0;
  input[type="checkbox"] {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
}

.task-icon {
  flex-shrink: 0;
}

.task-info {
  flex: 1;
  min-width: 0;
}

.task-name {
  font-size: 14px;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-status {
  font-size: 12px;
  margin-top: 4px;
  color: $text-secondary;

  &.completed { color: $success-color; }
  &.error { color: $danger-color; }

  .view-failed {
    color: $primary-color;
    cursor: pointer;
    margin-left: 8px;
    &:hover {
      text-decoration: underline;
    }
  }
}

.task-size {
  flex-shrink: 0;
  width: 80px;
  text-align: right;
  font-size: 13px;
  color: $text-secondary;
}

.task-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: $text-secondary;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;

  &:hover {
    background: $bg-tertiary;
    color: $text-primary;
  }

  &.primary {
    color: $primary-color;
    &:hover {
      background: rgba($primary-color, 0.1);
    }
  }

  &.warning {
    color: $warning-color;
    &:hover {
      background: rgba($warning-color, 0.1);
    }
  }
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: $text-secondary;
}

// 弹窗样式
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: $bg-secondary;
  border-radius: 12px;
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: $shadow-lg;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid $border-color;

  h3 {
    margin: 0;
    font-size: 16px;
    color: $text-primary;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: $text-secondary;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background: $bg-hover;
      color: $text-primary;
    }
  }
}

.modal-body {
  flex: 1;
  overflow: auto;
  padding: 16px 20px;
}

.failed-summary {
  font-size: 14px;
  color: $danger-color;
  margin-bottom: 16px;
}

.failed-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.failed-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: $bg-secondary;
  border-radius: 8px;
}

.failed-file-icon {
  flex-shrink: 0;
}

.failed-file-info {
  flex: 1;
  min-width: 0;
}

.failed-file-name {
  font-size: 13px;
  color: $text-primary;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.failed-file-error {
  font-size: 12px;
  color: $danger-color;
  margin-top: 2px;
}

.failed-file-size {
  flex-shrink: 0;
  font-size: 12px;
  color: $text-secondary;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid $border-color;
}

.modal-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;

  &.secondary {
    background: transparent;
    border: 1px solid $border-color;
    color: $text-secondary;

    &:hover {
      background: $bg-hover;
      color: $text-primary;
    }
  }

  &.primary {
    background: $primary-color;
    border: none;
    color: #fff;

    &:hover {
      background: darken($primary-color, 10%);
    }
  }
}
</style>
