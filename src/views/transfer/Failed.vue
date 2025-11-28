<template>
  <div class="failed-page">
    <!-- 顶部操作栏 -->
    <div class="action-bar">
      <div class="action-group" v-if="selectedIds.size > 0">
        <button class="action-btn" @click="retrySelected">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
          重试选中
        </button>
        <span class="action-divider"></span>
        <button class="action-btn" @click="clearSelected">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          删除选中
        </button>
      </div>
      <div class="action-group" v-else>
        <button class="action-btn" @click="retryAll" :disabled="tasks.length === 0">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
          全部重试
        </button>
        <span class="action-divider"></span>
        <button class="action-btn" @click="clearAll" :disabled="tasks.length === 0">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          清空全部
        </button>
      </div>
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
        <div class="task-checkbox" :class="{ checked: selectedIds.has(task.id) }">
          <input
            type="checkbox"
            :checked="selectedIds.has(task.id)"
            @change="toggleSelect(task.id)"
          />
        </div>
        <div class="task-icon">
          <FileIcon :filename="task.file.server_filename" :is-folder="task.isFolder" />
        </div>
        <div class="task-info">
          <div class="task-name" :title="task.file.server_filename">{{ task.file.server_filename }}</div>
          <div class="task-status error">
            {{ getErrorMessage(task) }}
          </div>
        </div>
        <div class="task-size">
          {{ task.isFolder ? '--' : formatSize(task.file.size) }}
        </div>
        <div class="task-actions" v-if="hoverTaskId === task.id">
          <!-- 重试按钮 -->
          <button class="icon-btn" @click.stop="retryTask(task.id)" title="重试下载">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>
          <!-- 查看失败详情 -->
          <button
            v-if="task.isFolder && hasFailedSubFiles(task)"
            class="icon-btn"
            @click.stop="showFailedFiles(task)"
            title="查看失败详情"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
            </svg>
          </button>
          <!-- 删除按钮 -->
          <button class="icon-btn danger" @click.stop="removeTask(task.id)" title="删除记录">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-else>
      <svg viewBox="0 0 24 24" width="48" height="48">
        <path fill="#4CAF50" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
      <p>没有失败的任务</p>
    </div>

    <!-- 失败文件详情弹窗 -->
    <div class="modal-overlay" v-if="showFailedModal" @click="showFailedModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>失败文件详情</h3>
          <button class="close-btn" @click="showFailedModal = false">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="failed-summary">
            共 {{ currentFailedFiles.length }} 个文件下载失败
          </div>
          <div class="failed-list">
            <div class="failed-item" v-for="(subFile, index) in currentFailedFiles" :key="index">
              <div class="failed-file-icon">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path fill="#90caf9" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                </svg>
              </div>
              <div class="failed-file-info">
                <div class="failed-file-name" :title="subFile.file.server_filename">{{ subFile.file.server_filename }}</div>
                <div class="failed-file-error">{{ subFile.error || '下载失败' }}</div>
              </div>
              <div class="failed-file-size">{{ formatSize(subFile.file.size) }}</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-btn secondary" @click="showFailedModal = false">关闭</button>
          <button class="modal-btn primary" @click="retryCurrentTask">重试失败文件</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useDownloadManager } from '@/composables/useDownloadManager'
import FileIcon from '@/components/FileIcon.vue'
import type { DownloadTask, SubFileTask } from '@/types'

const downloadStore = useDownloadStore()
const downloadManager = useDownloadManager()

const selectedIds = ref<Set<string>>(new Set())
const hoverTaskId = ref<string | null>(null)
const showFailedModal = ref(false)
const currentFailedFiles = ref<SubFileTask[]>([])
const currentFailedTaskId = ref<string | null>(null)

const tasks = computed(() => downloadStore.failedTasks)

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function getErrorMessage(task: DownloadTask): string {
  if (task.error) return task.error
  if (task.isFolder && task.subFiles) {
    const failedCount = task.subFiles.filter(sf => sf.status === 'error').length
    if (failedCount > 0) {
      return `${failedCount} 个文件下载失败`
    }
  }
  return '下载失败'
}

function hasFailedSubFiles(task: DownloadTask): boolean {
  if (!task.isFolder || !task.subFiles) return false
  return task.subFiles.some(sf => sf.status === 'error')
}

function toggleSelect(taskId: string) {
  if (selectedIds.value.has(taskId)) {
    selectedIds.value.delete(taskId)
  } else {
    selectedIds.value.add(taskId)
  }
}

function retryTask(taskId: string) {
  downloadStore.retryFailedSubFilesFromFailed(taskId)
  downloadManager.processQueue()
}

function showFailedFiles(task: DownloadTask) {
  currentFailedFiles.value = downloadStore.getFailedSubFilesFromFailed(task.id)
  currentFailedTaskId.value = task.id
  showFailedModal.value = true
}

function retryCurrentTask() {
  if (currentFailedTaskId.value) {
    downloadStore.retryFailedSubFilesFromFailed(currentFailedTaskId.value)
    downloadManager.processQueue()
    showFailedModal.value = false
  }
}

function removeTask(taskId: string) {
  downloadStore.removeFromFailed([taskId])
  selectedIds.value.delete(taskId)
}

function retrySelected() {
  const ids = Array.from(selectedIds.value)
  ids.forEach(id => downloadStore.retryFromFailed(id))
  selectedIds.value.clear()
  downloadManager.processQueue()
}

function clearSelected() {
  const ids = Array.from(selectedIds.value)
  downloadStore.removeFromFailed(ids)
  selectedIds.value.clear()
}

function retryAll() {
  downloadStore.retryAllFailed()
  downloadManager.processQueue()
}

function clearAll() {
  downloadStore.clearFailed()
  selectedIds.value.clear()
}
</script>

<style lang="scss" scoped>
.failed-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.action-bar {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid $border-color;
}

.action-group {
  display: flex;
  align-items: center;
  border: 1px solid $border-color;
  border-radius: 6px;
  overflow: hidden;
}

.action-divider {
  width: 1px;
  height: 20px;
  background: $border-color;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: $primary-color;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: rgba($primary-color, 0.08);
  }

  &:disabled {
    color: $text-muted;
    cursor: not-allowed;
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

    .task-checkbox {
      opacity: 1;
    }
  }
}

.task-checkbox {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;

  &.checked {
    opacity: 1;
  }

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
  margin-bottom: 4px;
}

.task-status {
  font-size: 12px;

  &.error {
    color: $danger-color;
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

  &.danger:hover {
    background: rgba($danger-color, 0.1);
    color: $danger-color;
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
  background: $bg-tertiary;
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
      opacity: 0.9;
    }
  }
}
</style>
