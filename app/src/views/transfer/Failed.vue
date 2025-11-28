<template>
  <div class="failed-page">
    <!-- 顶部操作栏 -->
    <div class="action-bar">
      <template v-if="selectedIds.size > 0">
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
      </template>
      <template v-else>
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
        <!-- 勾选框 -->
        <div class="checkbox" @click.stop="toggleSelect(task.id)">
          <div class="checkbox-inner" :class="{ checked: selectedIds.has(task.id) }">
            <svg v-if="selectedIds.has(task.id)" viewBox="0 0 24 24" width="14" height="14">
              <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </div>
        </div>

        <!-- 文件图标 -->
        <div class="file-icon">
          <svg v-if="task.isFolder" viewBox="0 0 24 24" width="24" height="24">
            <path fill="#FFB74D" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="24" height="24">
            <path fill="#90CAF9" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
          </svg>
        </div>

        <!-- 文件信息 -->
        <div class="file-info">
          <div class="file-name" :title="task.file.server_filename">
            {{ task.file.server_filename }}
          </div>
          <div class="file-meta">
            <span class="file-size">{{ formatSize(task.isFolder ? task.totalSize : task.file.size) }}</span>
            <span class="separator">|</span>
            <span class="error-msg" :title="getErrorMessage(task)">{{ getErrorMessage(task) }}</span>
          </div>
        </div>

        <!-- 悬浮操作按钮 -->
        <div class="hover-actions" v-show="hoverTaskId === task.id">
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
          <button class="icon-btn" @click.stop="removeTask(task.id)" title="删除记录">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-else>
      <svg viewBox="0 0 24 24" width="64" height="64">
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
          <div class="failed-file-list">
            <div v-for="(subFile, index) in currentFailedFiles" :key="index" class="failed-file-item">
              <div class="failed-file-icon">
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path fill="#f44336" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
              </div>
              <div class="failed-file-info">
                <div class="failed-file-name" :title="subFile.file.server_filename">
                  {{ subFile.file.server_filename }}
                </div>
                <div class="failed-file-path" :title="subFile.file.path">
                  {{ subFile.file.path }}
                </div>
                <div class="failed-file-error">
                  {{ subFile.error || '下载失败' }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" @click="retryCurrentTask">
            重试下载
          </button>
          <button class="btn" @click="showFailedModal = false">
            关闭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useDownloadManager } from '@/composables/useDownloadManager'
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
  // 统一使用 retryFailedSubFilesFromFailed，会自动跳过已完成的文件
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
@import "@/styles/variables.scss";

.failed-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.action-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 16px;
}

.action-divider {
  width: 1px;
  height: 14px;
  background: $border-color;
  margin: 0 4px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: $primary-color;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: rgba($primary-color, 0.08);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.task-list {
  flex: 1;
  overflow-y: auto;
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

.checkbox {
  cursor: pointer;
}

.checkbox-inner {
  width: 18px;
  height: 18px;
  border: 2px solid $border-color;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;

  &.checked {
    background: $primary-color;
    border-color: $primary-color;
  }
}

.file-icon {
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-size: 14px;
  color: $text-primary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
  color: $text-muted;
}

.error-msg {
  color: #f44336;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

.separator {
  color: $border-color;
}

.hover-actions {
  display: flex;
  gap: 4px;
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
    color: $primary-color;
  }
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: $text-muted;

  svg {
    margin-bottom: 16px;
    opacity: 0.5;
  }

  p {
    font-size: 14px;
  }
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
  max-width: 90%;
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
    }
  }
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.failed-file-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.failed-file-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: $bg-secondary;
  border-radius: 8px;
}

.failed-file-icon {
  flex-shrink: 0;
  padding-top: 2px;
}

.failed-file-info {
  flex: 1;
  min-width: 0;
}

.failed-file-name {
  font-size: 14px;
  color: $text-primary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.failed-file-path {
  font-size: 12px;
  color: $text-muted;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.failed-file-error {
  font-size: 12px;
  color: #f44336;
  margin-top: 4px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid $border-color;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
  background: $bg-tertiary;
  color: $text-secondary;

  &:hover {
    background: $bg-hover;
  }

  &.btn-primary {
    background: $primary-color;
    color: white;

    &:hover {
      background: darken($primary-color, 10%);
    }
  }
}
</style>
