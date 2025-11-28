<template>
  <div class="downloading-page">
    <!-- 顶部操作栏 -->
    <div class="action-bar">
      <template v-if="selectedIds.size > 0">
        <button class="action-btn" @click="pauseSelected">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
          暂停
        </button>
        <button class="action-btn" @click="startSelected">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M8 5v14l11-7z"/>
          </svg>
          开始
        </button>
        <button class="action-btn danger" @click="deleteSelected">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          删除
        </button>
      </template>
      <template v-else>
        <button class="action-btn" @click="pauseAll">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
          全部暂停
        </button>
        <button class="action-btn" @click="startAll">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M8 5v14l11-7z"/>
          </svg>
          全部开始
        </button>
        <button class="action-btn danger" @click="deleteAll">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
          全部删除
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
          <!-- 下载中显示进度条 -->
          <template v-if="task.status === 'downloading' || (task.status === 'paused' && task.progress > 0)">
            <div class="task-progress">
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: task.progress + '%' }"></div>
              </div>
              <div class="progress-text">
                <template v-if="task.status === 'paused'">
                  已暂停 · {{ task.progress.toFixed(1) }}%
                </template>
                <template v-else>
                  {{ formatSpeed(task.speed) }} · {{ task.progress.toFixed(1) }}%
                </template>
              </div>
            </div>
          </template>
          <!-- 其他状态显示文字 -->
          <template v-else>
            <div class="task-status" :class="task.status">
              {{ getStatusText(task.status) }}
              <span v-if="task.error" class="error-text">: {{ task.error }}</span>
            </div>
          </template>
        </div>
        <div class="task-size">
          <template v-if="task.status === 'downloading' || (task.status === 'paused' && task.progress > 0)">
            {{ formatSize(task.downloadedSize) }} / {{ formatSize(task.totalSize) }}
          </template>
          <template v-else>
            {{ task.file.isdir === 1 ? '--' : formatSize(task.file.size) }}
          </template>
        </div>
        <div class="task-actions" v-if="hoverTaskId === task.id">
          <!-- 正在下载 - 显示暂停按钮 -->
          <button
            v-if="task.status === 'downloading'"
            class="icon-btn"
            @click="pauseTask(task.id)"
            title="暂停"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          </button>
          <!-- 等待中/处理中 - 显示暂停按钮 -->
          <button
            v-if="task.status === 'waiting' || task.status === 'processing' || task.status === 'creating'"
            class="icon-btn"
            @click="pauseTask(task.id)"
            title="暂停"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          </button>
          <!-- 已暂停/异常 - 显示开始按钮 -->
          <button
            v-if="task.status === 'paused' || task.status === 'error'"
            class="icon-btn"
            @click="resumeTask(task.id)"
            title="开始"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="currentColor" d="M8 5v14l11-7z"/>
            </svg>
          </button>
          <!-- 删除按钮 -->
          <button
            class="icon-btn danger"
            @click="deleteTask(task.id)"
            title="删除"
          >
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
        <path fill="#5f6368" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
      <p>没有下载任务</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDownloadStore } from '@/stores/download'
import { useDownloadManager } from '@/composables/useDownloadManager'
import type { TaskStatus } from '@/types'

const downloadStore = useDownloadStore()
const downloadManager = useDownloadManager()

const tasks = computed(() => downloadStore.downloadTasks)
const selectedIds = ref<Set<string>>(new Set())
const hoverTaskId = ref<string | null>(null)

function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

function getStatusText(status: TaskStatus): string {
  const statusMap: Record<TaskStatus, string> = {
    waiting: '等待中',
    processing: '处理中',
    creating: '创建文件中',
    downloading: '下载中',
    paused: '已暂停',
    completed: '已完成',
    error: '异常'
  }
  return statusMap[status] || status
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatSpeed(bytesPerSecond: number): string {
  return formatSize(bytesPerSecond) + '/s'
}

function pauseTask(id: string) {
  downloadStore.pauseTask(id)
}

function resumeTask(id: string) {
  const task = tasks.value.find(t => t.id === id)
  if (task) {
    if (task.status === 'error') {
      // 异常任务重置状态重新下载
      task.status = 'waiting'
      task.error = undefined
      task.retryCount = 0
      downloadManager.processQueue()
    } else {
      downloadStore.resumeTask(id)
      downloadManager.processQueue()
    }
  }
}

async function deleteTask(id: string) {
  const task = tasks.value.find(t => t.id === id)
  if (task) {
    // 如果正在下载，先取消
    if (task.status === 'downloading' || task.status === 'paused') {
      try {
        await window.electronAPI?.cancelDownload(id)
      } catch (e) {
        // ignore
      }
      task.error = '已取消'
      downloadStore.moveToCompleted(task, false)
    } else {
      // 等待中的直接删除
      downloadStore.removeFromDownload([id])
    }
  }
  selectedIds.value.delete(id)
}

function pauseSelected() {
  selectedIds.value.forEach(id => pauseTask(id))
}

function startSelected() {
  selectedIds.value.forEach(id => resumeTask(id))
}

async function deleteSelected() {
  for (const id of selectedIds.value) {
    await deleteTask(id)
  }
  selectedIds.value.clear()
}

function pauseAll() {
  downloadStore.pauseAll()
}

function startAll() {
  downloadStore.resumeAll()
  downloadManager.processQueue()
}

async function deleteAll() {
  for (const task of [...tasks.value]) {
    await deleteTask(task.id)
  }
  selectedIds.value.clear()
}

onMounted(() => {
  downloadManager.startDownload()
})
</script>

<style lang="scss" scoped>
.downloading-page {
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

  &.danger:hover {
    background: rgba($danger-color, 0.1);
    border-color: $danger-color;
    color: $danger-color;
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
  margin-bottom: 6px;
}

.task-status {
  font-size: 12px;

  &.waiting { color: $text-secondary; }
  &.processing { color: $primary-color; }
  &.creating { color: $primary-color; }
  &.paused { color: $warning-color; }
  &.error { color: $danger-color; }

  .error-text {
    color: $danger-color;
  }
}

.task-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-bar {
  height: 4px;
  background: $bg-tertiary;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: $primary-color;
  border-radius: 2px;
  transition: width 0.3s;
}

.progress-text {
  font-size: 12px;
  color: $text-secondary;
}

.task-size {
  flex-shrink: 0;
  width: 140px;
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
</style>
