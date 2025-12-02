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
      <div class="file-table" ref="fileTableRef" @scroll="handleScroll">
        <div class="table-header">
          <div class="col-checkbox header-checkbox">
            <input
              type="checkbox"
              :checked="isAllSelected"
              @change="toggleSelectAll"
            />
          </div>
          <div
            class="col-name sortable"
            :style="{ width: columnWidths.name + '%' }"
            @click="toggleSort('name')"
          >
            <span>文件名</span>
            <span class="sort-icon" v-if="sortKey === 'name'">
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </span>
            <div class="resize-handle" @mousedown.stop="startResize($event, 'name')"></div>
          </div>
          <div
            class="col-size sortable"
            :style="{ width: columnWidths.size + '%' }"
            @click="toggleSort('size')"
          >
            <span>大小</span>
            <span class="sort-icon" v-if="sortKey === 'size'">
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </span>
            <div class="resize-handle" @mousedown.stop="startResize($event, 'size')"></div>
          </div>
          <div
            class="col-type sortable"
            :style="{ width: columnWidths.type + '%' }"
            @click="toggleSort('type')"
          >
            <span>类型</span>
            <span class="sort-icon" v-if="sortKey === 'type'">
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </span>
            <div class="resize-handle" @mousedown.stop="startResize($event, 'type')"></div>
          </div>
          <div
            class="col-time sortable"
            :style="{ width: columnWidths.time + '%' }"
            @click="toggleSort('time')"
          >
            <span>修改时间</span>
            <span class="sort-icon" v-if="sortKey === 'time'">
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </span>
          </div>
        </div>
        <div class="table-body">
          <div
            v-for="file in sortedFileList"
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
            <div class="col-name" :style="{ width: columnWidths.name + '%' }">
              <div class="file-icon">
                <FileIcon :filename="file.server_filename" :is-folder="file.isdir === 1" />
              </div>
              <span
                class="file-name"
                :class="{ clickable: file.isdir === 1 }"
                :title="file.server_filename"
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
            <div class="col-size" :style="{ width: columnWidths.size + '%' }">
              {{ file.isdir === 1 ? '--' : formatSize(file.size) }}
            </div>
            <div class="col-type" :style="{ width: columnWidths.type + '%' }">
              {{ getFileType(file) }}
            </div>
            <div class="col-time" :style="{ width: columnWidths.time + '%' }">
              {{ formatTime(file.server_mtime) }}
            </div>
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

    <!-- 底部悬浮操作栏 -->
    <div class="bottom-float-bar" :class="{ collapsed: isFloatBarCollapsed }">
      <!-- 展开状态的输入框 -->
      <div class="float-card">
        <div class="input-wrapper">
          <input
            v-model="code"
            type="text"
            inputmode="numeric"
            placeholder="输入下载编码"
            @input="filterNonNumeric"
            @keyup.enter="handleFetch"
          />
          <div class="input-buttons">
            <button class="btn-fetch" @click="handleFetch" :disabled="loading || !code.trim()">
              获取
            </button>
            <button
              class="btn-download"
              @click="downloadSelected"
              :disabled="selectedIds.size === 0"
            >
              下载{{ selectedIds.size > 0 ? ` (${selectedIds.size})` : '' }}
            </button>
            <!-- 收起按钮 -->
            <button class="btn-collapse" @click="collapseFloatBar" title="收起">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M19 13H5v-2h14v2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 收起状态的圆形按钮（独立定位） -->
    <div
      class="collapsed-download-btn"
      :class="{ visible: isFloatBarCollapsed }"
      @click="expandFloatBar"
    >
      <span class="code-display">{{ code || '?' }}</span>
      <span class="badge" v-if="selectedIds.size > 0">{{ selectedIds.size > 99 ? '99+' : selectedIds.size }}</span>
    </div>

    <!-- 错误提示 -->
    <div class="error-toast" v-if="errorMessage">
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onUnmounted, nextTick, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { useDownloadStore } from '@/stores/download'
import { useDownloadManager } from '@/composables/useDownloadManager'
import FileIcon from '@/components/FileIcon.vue'
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

// 滚动相关状态
const fileTableRef = ref<HTMLElement | null>(null)
const isScrolledToBottom = ref(false)
const isFloatBarCollapsed = ref(false)

// 排序状态
const sortKey = ref<'name' | 'size' | 'type' | 'time' | null>(null)
const sortOrder = ref<'asc' | 'desc'>('asc')

// 列宽比例状态（百分比，总和为100）
const columnWidths = reactive({
  name: 46,  // 46%
  size: 15,  // 15%
  type: 15,  // 15%
  time: 24   // 24%
})

// 列宽拖动状态
const resizing = ref(false)
const resizeColumn = ref<string | null>(null)
const resizeStartX = ref(0)
const resizeStartWidth = ref(0)
const tableWidth = ref(0)

// 排序后的文件列表
const sortedFileList = computed(() => {
  if (!sortKey.value) return fileList.value

  return [...fileList.value].sort((a, b) => {
    let comparison = 0

    // 文件夹始终排在前面
    if (a.isdir !== b.isdir) {
      return b.isdir - a.isdir
    }

    switch (sortKey.value) {
      case 'name':
        comparison = a.server_filename.localeCompare(b.server_filename, 'zh-CN')
        break
      case 'size':
        comparison = (a.size || 0) - (b.size || 0)
        break
      case 'type':
        comparison = getFileType(a).localeCompare(getFileType(b), 'zh-CN')
        break
      case 'time':
        comparison = a.server_mtime - b.server_mtime
        break
    }

    return sortOrder.value === 'asc' ? comparison : -comparison
  })
})

// 是否刚刚完成拖动（用于阻止误触排序）
const justResized = ref(false)

// 切换排序
function toggleSort(key: 'name' | 'size' | 'type' | 'time') {
  // 如果刚完成拖动，不触发排序
  if (justResized.value) {
    justResized.value = false
    return
  }

  if (sortKey.value === key) {
    if (sortOrder.value === 'asc') {
      sortOrder.value = 'desc'
    } else {
      // 第三次点击取消排序
      sortKey.value = null
      sortOrder.value = 'asc'
    }
  } else {
    sortKey.value = key
    sortOrder.value = 'asc'
  }
}

// 开始拖动调整列宽
function startResize(event: MouseEvent, column: string) {
  // 获取表格容器宽度（去掉checkbox列的宽度）
  const tableHeader = (event.target as HTMLElement).closest('.table-header')
  if (tableHeader) {
    tableWidth.value = tableHeader.clientWidth - 32 // 减去checkbox列宽度
  }

  resizing.value = true
  resizeColumn.value = column
  resizeStartX.value = event.clientX
  resizeStartWidth.value = columnWidths[column as keyof typeof columnWidths]

  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// 处理拖动 - 调整当前列和下一列的比例
function handleResize(event: MouseEvent) {
  if (!resizing.value || !resizeColumn.value || tableWidth.value === 0) return

  const diff = event.clientX - resizeStartX.value
  // 将像素差转换为百分比差
  const diffPercent = (diff / tableWidth.value) * 100

  // 定义列的顺序和对应的最小像素宽度
  const columns = ['name', 'size', 'type', 'time'] as const
  const minWidthsPx: Record<typeof columns[number], number> = {
    name: 100,
    size: 60,
    type: 60,
    time: 80
  }

  // 根据容器宽度动态计算最小百分比
  const getMinPercent = (column: typeof columns[number]) => {
    return (minWidthsPx[column] / tableWidth.value) * 100
  }

  const currentIndex = columns.indexOf(resizeColumn.value as typeof columns[number])
  const currentColumn = resizeColumn.value as typeof columns[number]
  const currentMinPercent = getMinPercent(currentColumn)

  // 计算新的列宽百分比，确保不小于最小百分比
  const newWidth = Math.max(currentMinPercent, Math.min(80, resizeStartWidth.value + diffPercent))
  const widthDiff = newWidth - columnWidths[currentColumn]

  // 如果有下一列，从下一列扣除相同的宽度
  if (currentIndex < columns.length - 1) {
    const nextColumn = columns[currentIndex + 1]
    const nextMinPercent = getMinPercent(nextColumn)
    const nextWidth = columnWidths[nextColumn] - widthDiff

    // 确保下一列也不会小于其最小百分比
    if (nextWidth >= nextMinPercent) {
      columnWidths[currentColumn] = newWidth
      columnWidths[nextColumn] = nextWidth
    }
  } else {
    // 最后一列，从前一列调整
    if (currentIndex > 0) {
      const prevColumn = columns[currentIndex - 1]
      const prevMinPercent = getMinPercent(prevColumn)
      const prevWidth = columnWidths[prevColumn] - widthDiff

      if (prevWidth >= prevMinPercent) {
        columnWidths[currentColumn] = newWidth
        columnWidths[prevColumn] = prevWidth
      }
    }
  }
}

// 停止拖动
function stopResize() {
  resizing.value = false
  resizeColumn.value = null
  // 标记刚完成拖动，阻止 click 事件触发排序
  justResized.value = true

  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// 获取文件类型
function getFileType(file: FileItem): string {
  if (file.isdir === 1) return '文件夹'

  const ext = file.server_filename.split('.').pop()?.toLowerCase() || ''

  const typeMap: Record<string, string> = {
    // 文档
    'doc': 'Word文档',
    'docx': 'Word文档',
    'xls': 'Excel文件',
    'xlsx': 'Excel文件',
    'ppt': 'PPT文件',
    'pptx': 'PPT文件',
    'pdf': 'PDF文件',
    'txt': '文本文件',
    'md': 'Markdown',
    // 图片
    'jpg': '图片文件',
    'jpeg': '图片文件',
    'png': '图片文件',
    'gif': '图片文件',
    'bmp': '图片文件',
    'webp': '图片文件',
    'svg': 'SVG图片',
    'ico': '图标文件',
    'psd': 'PSD文件',
    // 视频
    'mp4': '视频文件',
    'avi': '视频文件',
    'mkv': '视频文件',
    'mov': '视频文件',
    'wmv': '视频文件',
    'flv': '视频文件',
    'webm': '视频文件',
    // 音频
    'mp3': '音频文件',
    'wav': '音频文件',
    'flac': '音频文件',
    'aac': '音频文件',
    'ogg': '音频文件',
    'wma': '音频文件',
    // 压缩包
    'zip': 'ZIP压缩包',
    'rar': 'RAR压缩包',
    '7z': '7z压缩包',
    'tar': 'TAR压缩包',
    'gz': 'GZ压缩包',
    // 程序
    'exe': 'exe文件',
    'msi': '安装程序',
    'dmg': 'DMG镜像',
    'apk': 'APK安装包',
    'app': '应用程序',
    // 代码
    'js': 'JavaScript',
    'ts': 'TypeScript',
    'vue': 'Vue组件',
    'jsx': 'React组件',
    'tsx': 'React组件',
    'html': 'HTML文件',
    'css': 'CSS文件',
    'scss': 'SCSS文件',
    'json': 'JSON文件',
    'xml': 'XML文件',
    'py': 'Python文件',
    'java': 'Java文件',
    'c': 'C文件',
    'cpp': 'C++文件',
    'h': '头文件',
    'php': 'PHP文件',
    'sql': 'SQL文件',
    // 其他
    'iso': '光盘镜像',
    'torrent': '种子文件'
  }

  return typeMap[ext] || (ext ? ext.toUpperCase() + '文件' : '未知类型')
}

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
    // 清除勾选状态
    selectedIds.value.clear()
  }
}

// 过滤非数字输入
function filterNonNumeric(event: Event) {
  const input = event.target as HTMLInputElement
  const filtered = input.value.replace(/\D/g, '')
  if (filtered !== input.value) {
    code.value = filtered
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
  return dayjs(timestamp * 1000).format('YYYY.MM.DD HH:mm')
}

// 滚动检测 - 检测是否滚动到底部
function handleScroll(event: Event) {
  const target = event.target as HTMLElement
  if (!target) return

  const { scrollTop, scrollHeight, clientHeight } = target
  // 判断是否滚动到底部（留10px的容差）
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10
  // 判断是否离开底部区域（向上滚动超过50px）
  const hasLeftBottom = scrollTop + clientHeight < scrollHeight - 50

  if (isAtBottom && !isScrolledToBottom.value) {
    isScrolledToBottom.value = true
    // 滚动到底部时收起悬浮框
    isFloatBarCollapsed.value = true
  } else if (hasLeftBottom && isScrolledToBottom.value) {
    isScrolledToBottom.value = false
    // 离开底部区域时自动展开悬浮框
    isFloatBarCollapsed.value = false
  }
}

// 展开悬浮框
function expandFloatBar() {
  isFloatBarCollapsed.value = false
}

// 收起悬浮框
function collapseFloatBar() {
  isFloatBarCollapsed.value = true
}

// 点击收起状态的按钮时下载选中文件
function handleCollapsedDownload() {
  if (selectedIds.value.size > 0) {
    downloadSelected()
  } else {
    // 没有选中文件时展开悬浮框
    expandFloatBar()
  }
}

// 监听文件列表变化，重置滚动状态
watch(() => fileList.value.length, async () => {
  await nextTick()
  // 文件列表变化时重置滚动状态
  isScrolledToBottom.value = false
  isFloatBarCollapsed.value = false
})

// 组件卸载时清理事件监听
onUnmounted(() => {
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
})
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
  padding-bottom: 0; // 文件列表延伸到底部
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
  overflow-y: auto;
  overflow-x: hidden;
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
  user-select: none;
  border-bottom: 1px solid $border-color;
  width: 100%;
  box-sizing: border-box;
}

.sortable {
  cursor: pointer;
  display: flex;
  align-items: center;
  position: relative;
  padding-right: 8px;

  &::after {
    content: '';
    position: absolute;
    right: 0;
    top: 4px;
    bottom: 4px;
    width: 1px;
    background: $border-color;
  }

  &:last-child::after {
    display: none;
  }

  &:hover {
    color: $primary-color;
  }

  .sort-icon {
    margin-left: 4px;
    font-size: 12px;
    color: $primary-color;
  }
}

.resize-handle {
  position: absolute;
  right: -3px;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: col-resize;
  z-index: 2;

  &:hover {
    background: rgba($primary-color, 0.3);
  }
}

.table-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 4px;
  transition: background 0.15s;
  width: 100%;
  box-sizing: border-box;

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
  flex-shrink: 0;
  min-width: 100px;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
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
  flex-shrink: 0;
  min-width: 60px;
  text-align: left;
  color: $text-secondary;
  font-size: 13px;
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-type {
  flex-shrink: 0;
  min-width: 60px;
  text-align: left;
  color: $text-secondary;
  font-size: 13px;
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-time {
  flex-shrink: 0;
  min-width: 80px;
  text-align: left;
  color: $text-secondary;
  font-size: 13px;
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.bottom-float-bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  pointer-events: none; // 让底层内容可点击
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);

  &.collapsed {
    .float-card {
      opacity: 0;
      transform: scale(0.8) translateX(100px);
      pointer-events: none;
    }
  }
}

.float-card {
  background: $bg-secondary;
  border: 1px solid $border-color;
  border-radius: 24px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
  padding: 4px;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  opacity: 1;
  transform: scale(1) translateX(0);
}

.collapsed-download-btn {
  position: absolute;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: $primary-color;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  opacity: 0;
  transform: scale(0) translateX(20px);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 10;

  &:hover {
    background: $primary-hover;
    transform: scale(1.1) translateX(0);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
  }

  &:active {
    transform: scale(0.95) translateX(0);
  }

  &.visible {
    opacity: 1;
    transform: scale(1) translateX(0);
    pointer-events: auto;
  }

  .code-display {
    font-size: 14px;
    font-weight: 600;
    max-width: 40px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    background: #ff4757;
    color: white;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(255, 71, 87, 0.4);
    animation: badgePop 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
}

@keyframes badgePop {
  0% {
    transform: scale(0);
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}

.input-wrapper {
  display: flex;
  align-items: center;
  background: $bg-tertiary;
  border: 1px solid $border-color;
  border-radius: 20px;
  padding: 4px 4px 4px 16px;
  transition: border-color 0.2s;

  &:focus-within {
    border-color: $primary-color;
  }

  input {
    width: 120px;
    height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: $text-primary;
    font-size: 14px;
    outline: none;

    &::placeholder {
      color: $text-muted;
    }
  }
}

.input-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;

  button {
    height: 32px;
    padding: 0 14px;
    border: none;
    border-radius: 16px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .btn-fetch {
    background: $bg-secondary;
    color: $text-primary;

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

  .btn-collapse {
    width: 32px;
    height: 32px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: $text-secondary;
    border-radius: 50%;

    &:hover {
      background: $bg-hover;
      color: $text-primary;
    }
  }
}

.error-toast {
  position: absolute;
  bottom: 110px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  background: $danger-color;
  color: white;
  border-radius: 8px;
  font-size: 14px;
  animation: fadeIn 0.2s;
  z-index: 11;
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
