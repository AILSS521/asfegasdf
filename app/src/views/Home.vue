<template>
  <div class="home-page">
    <!-- 加载中 -->
    <div class="loading-state" v-if="loading">
      <div class="loading-content">
        <div class="loading-icon">
          <svg class="cloud-icon" viewBox="0 0 24 24" width="64" height="64">
            <path fill="#1a73e8" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          <div class="loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
        <p class="loading-text">正在获取文件列表</p>
        <p class="loading-hint">请稍候...</p>
      </div>
    </div>

    <!-- 文件列表区域 -->
    <div class="file-list-area" v-else-if="fileList.length > 0">
      <!-- 头部信息 -->
      <div class="list-header">
        <div class="breadcrumb">
          <span
            v-for="(item, index) in breadcrumbs"
            :key="index"
            class="breadcrumb-item"
            @click="navigateTo(item.path)"
          >
            {{ item.name }}
            <span v-if="index < breadcrumbs.length - 1" class="separator">/</span>
          </span>
        </div>
        <div class="file-count">
          已全部加载，共 {{ fileList.length }} 个
        </div>
      </div>

      <!-- 文件表格 -->
      <div class="file-table">
        <div class="table-header">
          <div class="col-checkbox header-checkbox">
            <input
              type="checkbox"
              :checked="isAllSelected"
              @change="toggleSelectAll"
            />
          </div>
          <div class="col-name">文件名</div>
          <div class="col-size">大小</div>
          <div class="col-time">修改时间</div>
        </div>
        <div class="table-body">
          <div
            v-for="file in fileList"
            :key="file.fs_id"
            class="table-row"
            :class="{ selected: selectedIds.has(file.fs_id) }"
            @mouseenter="hoverFileId = file.fs_id"
            @mouseleave="hoverFileId = null"
          >
            <div class="col-checkbox" :class="{ visible: selectedIds.has(file.fs_id) }">
              <input
                type="checkbox"
                :checked="selectedIds.has(file.fs_id)"
                @change="toggleSelect(file)"
              />
            </div>
            <div class="col-name">
              <div class="file-icon">
                <svg v-if="file.isdir === 1" viewBox="0 0 24 24" width="24" height="24">
                  <path fill="#ffc107" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
                <svg v-else viewBox="0 0 24 24" width="24" height="24">
                  <path fill="#90caf9" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                </svg>
              </div>
              <span
                class="file-name"
                :class="{ clickable: file.isdir === 1 }"
                @click="file.isdir === 1 && navigateTo(file.path)"
              >
                {{ file.server_filename }}
              </span>
              <button
                v-if="hoverFileId === file.fs_id && file.isdir !== 1"
                class="download-btn-inline"
                @click.stop="downloadSingle(file)"
                title="下载"
              >
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
              </button>
              <button
                v-if="hoverFileId === file.fs_id && file.isdir === 1"
                class="download-btn-inline"
                @click.stop="downloadFolder(file)"
                title="下载文件夹"
              >
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
              </button>
            </div>
            <div class="col-size">{{ file.isdir === 1 ? '--' : formatSize(file.size) }}</div>
            <div class="col-time">{{ formatTime(file.server_mtime) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-else>
      <svg viewBox="0 0 24 24" width="64" height="64">
        <path fill="#9aa0a6" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
      </svg>
      <p>输入下载编码获取文件列表</p>
    </div>

    <!-- 底部操作栏 -->
    <div class="bottom-bar">
      <div class="input-wrapper">
        <input
          v-model="code"
          type="text"
          placeholder="输入下载编码"
          @keyup.enter="handleFetch"
        />
        <button class="btn-fetch" @click="handleFetch" :disabled="loading || !code.trim()">
          获取
        </button>
        <button
          class="btn-download"
          @click="downloadSelected"
          :disabled="selectedIds.size === 0"
        >
          下载 {{ selectedIds.size > 0 ? `(${selectedIds.size})` : '' }}
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div class="error-toast" v-if="errorMessage">
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useApi } from '@/composables/useApi'
import { useDownloadStore } from '@/stores/download'
import { useDownloadManager } from '@/composables/useDownloadManager'
import type { FileItem } from '@/types'
import dayjs from 'dayjs'

const api = useApi()
const downloadStore = useDownloadStore()
const downloadManager = useDownloadManager()

// 使用 store 中的状态（切换页面后保留）
const code = computed({
  get: () => downloadStore.currentCode,
  set: (val: string) => downloadStore.setCurrentCode(val)
})
const fileList = computed({
  get: () => downloadStore.currentFileList,
  set: (val: FileItem[]) => downloadStore.setCurrentFileList(val)
})
const currentPath = computed({
  get: () => downloadStore.currentPath,
  set: (val: string) => downloadStore.setCurrentPath(val)
})
const basePath = computed({
  get: () => downloadStore.basePath,
  set: (val: string) => downloadStore.setBasePath(val)
})

// 组件本地状态（不需要保留）
const loading = ref(false)
const errorMessage = ref('')
const hoverFileId = ref<number | string | null>(null)
const selectedIds = ref<Set<number | string>>(new Set())

// 获取相对于基础路径的显示路径
function getRelativePath(fullPath: string): string {
  if (fullPath === basePath.value || fullPath === '/') return '/'
  if (fullPath.startsWith(basePath.value)) {
    const relativePath = fullPath.slice(basePath.value.length)
    return relativePath.startsWith('/') ? relativePath : '/' + relativePath
  }
  return fullPath
}

// 面包屑导航
const breadcrumbs = computed(() => {
  const relativePath = getRelativePath(currentPath.value)
  const parts = relativePath.split('/').filter(Boolean)

  // 根目录用特殊标记 'ROOT'，实际导航时会转换为 basePath
  const items = [{ name: '根目录', path: 'ROOT' }]

  // 构建面包屑，path 存储的是完整网盘路径
  let fullPath = basePath.value
  for (const part of parts) {
    fullPath = fullPath === '/' ? '/' + part : fullPath + '/' + part
    items.push({ name: part, path: fullPath })
  }

  return items
})

// 是否全选
const isAllSelected = computed(() => {
  if (fileList.value.length === 0) return false
  return fileList.value.every(f => selectedIds.value.has(f.fs_id))
})

// 获取用于API请求的路径
function getApiPath(fullPath: string): string {
  // 如果是根目录（basePath），API 需要用 '/'
  if (fullPath === basePath.value || fullPath === 'ROOT') {
    return '/'
  }
  return fullPath
}

// 获取文件列表
async function fetchFileList(isInitial: boolean = false) {
  if (!code.value.trim()) return

  loading.value = true
  errorMessage.value = ''
  selectedIds.value.clear()

  try {
    // 转换为 API 路径
    const apiPath = getApiPath(currentPath.value)
    const data = await api.getFileList(code.value.trim(), apiPath)
    fileList.value = data.list

    // 首次获取时，根据返回的文件路径自动确定基础路径
    if (isInitial && data.list.length > 0) {
      const firstFilePath = data.list[0].path
      // 获取文件的父目录作为基础路径（用于显示转换）
      const parentDir = firstFilePath.substring(0, firstFilePath.lastIndexOf('/')) || '/'
      basePath.value = parentDir
      currentPath.value = parentDir
    }

    // 保存会话数据到 store
    downloadStore.setSessionData({
      uk: data.uk,
      shareid: data.shareid,
      randsk: data.randsk,
      surl: data.surl,
      pwd: data.pwd
    })
  } catch (error: any) {
    errorMessage.value = error.message || '获取文件列表失败'
    setTimeout(() => {
      errorMessage.value = ''
    }, 3000)
  } finally {
    loading.value = false
  }
}

// 首次获取文件列表
async function handleFetch() {
  // 重置路径为根目录
  currentPath.value = '/'
  basePath.value = '/'
  await fetchFileList(true)
}

// 导航到目录
async function navigateTo(path: string) {
  // ROOT 是特殊标记，表示根目录
  if (path === 'ROOT') {
    currentPath.value = basePath.value
  } else {
    currentPath.value = path
  }
  await fetchFileList(false)
}

// 切换选择
function toggleSelect(file: FileItem) {
  if (selectedIds.value.has(file.fs_id)) {
    selectedIds.value.delete(file.fs_id)
  } else {
    selectedIds.value.add(file.fs_id)
  }
}

// 全选/取消全选
function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value.clear()
  } else {
    fileList.value.forEach(f => selectedIds.value.add(f.fs_id))
  }
}

// 下载单个文件（不创建子目录）
function downloadSingle(file: FileItem) {
  // 单个文件下载，downloadBasePath 为 null 表示直接放在下载目录
  downloadStore.addToDownload([file], null)
  downloadManager.startDownload()
}

// 下载文件夹（作为整体任务）
async function downloadFolder(folder: FileItem) {
  // 获取文件夹内所有文件（递归）
  try {
    loading.value = true
    const allFiles = await getAllFilesInFolder(folder.path)
    if (allFiles.length > 0) {
      // 以被下载文件夹的父目录为基础路径，这样下载目录中会创建文件夹本身
      // 例如：点击下载 /网盘/A 文件夹，basePath 设为 /网盘
      // 文件 /网盘/A/B/1.txt 的相对路径就是 A/B/1.txt
      const folderParentPath = folder.path.substring(0, folder.path.lastIndexOf('/')) || '/'
      // 添加文件夹任务（作为整体显示）
      downloadStore.addFolderToDownload(folder, allFiles, folderParentPath)
      downloadManager.startDownload()
    } else {
      errorMessage.value = '文件夹内没有可下载的文件'
      setTimeout(() => {
        errorMessage.value = ''
      }, 3000)
    }
  } catch (error: any) {
    errorMessage.value = error.message || '获取文件夹内容失败'
    setTimeout(() => {
      errorMessage.value = ''
    }, 3000)
  } finally {
    loading.value = false
  }
}

// 递归获取文件夹内所有文件
async function getAllFilesInFolder(folderPath: string): Promise<FileItem[]> {
  const data = await api.getFileList(code.value.trim(), folderPath)
  const files: FileItem[] = []

  for (const item of data.list) {
    if (item.isdir === 1) {
      // 递归获取子文件夹内的文件
      const subFiles = await getAllFilesInFolder(item.path)
      files.push(...subFiles)
    } else {
      files.push(item)
    }
  }

  return files
}

// 下载选中的文件和文件夹
async function downloadSelected() {
  const selectedItems = fileList.value.filter(f => selectedIds.value.has(f.fs_id))
  if (selectedItems.length === 0) return

  // 分离文件和文件夹
  const files = selectedItems.filter(f => f.isdir !== 1)
  const folders = selectedItems.filter(f => f.isdir === 1)

  // 先添加普通文件任务
  if (files.length > 0) {
    // 选中的文件，如果只有一个且没有文件夹就不创建子目录
    const downloadBasePath = (files.length === 1 && folders.length === 0) ? null : currentPath.value
    downloadStore.addToDownload(files, downloadBasePath)
  }

  // 处理文件夹（需要异步获取内部文件）
  if (folders.length > 0) {
    loading.value = true
    try {
      for (const folder of folders) {
        const allFiles = await getAllFilesInFolder(folder.path)
        if (allFiles.length > 0) {
          const folderParentPath = folder.path.substring(0, folder.path.lastIndexOf('/')) || '/'
          downloadStore.addFolderToDownload(folder, allFiles, folderParentPath)
        }
      }
    } catch (error: any) {
      errorMessage.value = error.message || '获取文件夹内容失败'
      setTimeout(() => {
        errorMessage.value = ''
      }, 3000)
    } finally {
      loading.value = false
    }
  }

  // 有任务添加则开始下载
  if (files.length > 0 || folders.length > 0) {
    downloadManager.startDownload()
  }
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 格式化时间
function formatTime(timestamp: number): string {
  return dayjs(timestamp * 1000).format('YYYY-MM-DD HH:mm')
}
</script>

<style lang="scss" scoped>
.home-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.file-list-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid $border-color;
  margin-bottom: 8px;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
}

.breadcrumb-item {
  color: $text-secondary;
  cursor: pointer;
  transition: color 0.2s;

  &:hover {
    color: $primary-color;
  }

  &:last-child {
    color: $text-primary;
    cursor: default;
  }

  .separator {
    margin-left: 4px;
    color: $text-muted;
  }
}

.file-count {
  color: $text-secondary;
  font-size: 13px;
}

.file-table {
  flex: 1;
  overflow: auto;
}

.table-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: $bg-tertiary;
  border-radius: 4px;
  font-size: 13px;
  color: $text-secondary;
  position: sticky;
  top: 0;
  z-index: 1;
}

.table-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 4px;
  transition: background 0.15s;

  &:hover {
    background: $bg-hover;

    .col-checkbox {
      opacity: 1;
    }
  }

  &.selected {
    background: rgba($primary-color, 0.15);
  }
}

.col-checkbox {
  width: 32px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;

  &.visible,
  &.header-checkbox {
    opacity: 1;
  }

  input[type="checkbox"] {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
}

.col-name {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.file-icon {
  flex-shrink: 0;
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.clickable {
    cursor: pointer;
    &:hover {
      color: $primary-color;
    }
  }
}

.download-btn-inline {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  background: $primary-color;
  color: white;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;

  &:hover {
    background: $primary-hover;
  }
}

.col-size {
  width: 100px;
  flex-shrink: 0;
  text-align: right;
  color: $text-secondary;
  font-size: 13px;
}

.col-time {
  width: 140px;
  flex-shrink: 0;
  text-align: right;
  color: $text-secondary;
  font-size: 13px;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: $text-secondary;
}

.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $bg-primary;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.loading-icon {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;

  .cloud-icon {
    animation: cloudFloat 2s ease-in-out infinite;
  }
}

.loading-dots {
  display: flex;
  gap: 6px;
  margin-top: 8px;

  span {
    width: 8px;
    height: 8px;
    background: $primary-color;
    border-radius: 50%;
    animation: dotBounce 1.4s ease-in-out infinite;

    &:nth-child(1) {
      animation-delay: 0s;
    }
    &:nth-child(2) {
      animation-delay: 0.2s;
    }
    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
}

.loading-text {
  font-size: 16px;
  font-weight: 500;
  color: $text-primary;
  margin: 0;
}

.loading-hint {
  font-size: 13px;
  color: $text-muted;
  margin: 0;
}

@keyframes cloudFloat {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

@keyframes dotBounce {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.bottom-bar {
  padding: 16px;
  background: $bg-secondary;
  border-top: 1px solid $border-color;
}

.input-wrapper {
  display: flex;
  gap: 8px;
  max-width: 600px;
  margin: 0 auto;

  input {
    flex: 1;
    height: 40px;
    padding: 0 16px;
    border: 1px solid $border-color;
    border-radius: 8px;
    background: $bg-tertiary;
    color: $text-primary;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s;

    &:focus {
      border-color: $primary-color;
    }

    &::placeholder {
      color: $text-muted;
    }
  }

  button {
    height: 40px;
    padding: 0 20px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .btn-fetch {
    background: $bg-tertiary;
    color: $text-primary;
    border: 1px solid $border-color;

    &:hover:not(:disabled) {
      background: $bg-hover;
    }
  }

  .btn-download {
    background: $primary-color;
    color: white;

    &:hover:not(:disabled) {
      background: $primary-hover;
    }
  }
}

.error-toast {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background: $danger-color;
  color: white;
  border-radius: 8px;
  font-size: 14px;
  animation: fadeIn 0.2s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>
