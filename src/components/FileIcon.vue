<template>
  <svg viewBox="0 0 24 24" :width="size" :height="size">
    <!-- 文件夹 -->
    <template v-if="isFolder">
      <path fill="#ffc107" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </template>

    <!-- 图片 -->
    <template v-else-if="fileType === 'image'">
      <path fill="#4caf50" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
    </template>

    <!-- 视频 -->
    <template v-else-if="fileType === 'video'">
      <path fill="#f44336" d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
    </template>

    <!-- 音频 -->
    <template v-else-if="fileType === 'audio'">
      <path fill="#9c27b0" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
    </template>

    <!-- 压缩包 -->
    <template v-else-if="fileType === 'archive'">
      <path fill="#ff9800" d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2 6h-2v2h2v2h-2v2h-2v-2h2v-2h-2v-2h2v-2h-2V8h2v2h2v2z"/>
    </template>

    <!-- PDF -->
    <template v-else-if="fileType === 'pdf'">
      <path fill="#f44336" d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/>
    </template>

    <!-- Word文档 -->
    <template v-else-if="fileType === 'word'">
      <path fill="#2196f3" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
    </template>

    <!-- Excel表格 -->
    <template v-else-if="fileType === 'excel'">
      <path fill="#4caf50" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm1 10h-4v4H9v-4H5v-2h4V6h2v4h4v2zm-2-5V3.5L18.5 9H13z"/>
    </template>

    <!-- PPT -->
    <template v-else-if="fileType === 'ppt'">
      <path fill="#ff5722" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7h-2v2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-2 6v-2h2c1.66 0 3-1.34 3-3s-1.34-3-3-3H9v8h2zm2-11.5L18.5 9H13V3.5z"/>
    </template>

    <!-- 文本文件 -->
    <template v-else-if="fileType === 'text'">
      <path fill="#607d8b" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
    </template>

    <!-- 代码文件 -->
    <template v-else-if="fileType === 'code'">
      <path fill="#00bcd4" d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
    </template>

    <!-- 可执行文件 -->
    <template v-else-if="fileType === 'exe'">
      <path fill="#795548" d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6 10H8v-2h6v2zm4-4H8v-2h10v2z"/>
    </template>

    <!-- 字体文件 -->
    <template v-else-if="fileType === 'font'">
      <path fill="#9e9e9e" d="M9.93 13.5h4.14L12 7.98 9.93 13.5zM20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-4.05 16.5l-1.14-3H9.17l-1.12 3H5.96l5.11-13h1.86l5.11 13h-2.09z"/>
    </template>

    <!-- 安装包 -->
    <template v-else-if="fileType === 'installer'">
      <path fill="#3f51b5" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l4.59-4.58L18 11l-6 6z"/>
    </template>

    <!-- 默认文件 -->
    <template v-else>
      <path fill="#90caf9" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
    </template>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  filename: string
  isFolder?: boolean
  size?: number
}>()

const size = computed(() => props.size || 24)

// 获取文件扩展名
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1) return ''
  return filename.slice(lastDot + 1).toLowerCase()
}

// 根据扩展名判断文件类型
const fileType = computed(() => {
  if (props.isFolder) return 'folder'

  const ext = getExtension(props.filename)

  // 图片
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'psd', 'raw', 'heic', 'heif'].includes(ext)) {
    return 'image'
  }

  // 视频
  if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'mpeg', 'mpg', 'm4v', '3gp', 'rmvb', 'rm', 'ts'].includes(ext)) {
    return 'video'
  }

  // 音频
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'ape', 'aiff', 'mid', 'midi'].includes(ext)) {
    return 'audio'
  }

  // 压缩包
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'cab', 'lzh', 'arj', 'z'].includes(ext)) {
    return 'archive'
  }

  // PDF
  if (ext === 'pdf') {
    return 'pdf'
  }

  // Word文档
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) {
    return 'word'
  }

  // Excel表格
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) {
    return 'excel'
  }

  // PPT
  if (['ppt', 'pptx', 'odp'].includes(ext)) {
    return 'ppt'
  }

  // 文本文件
  if (['txt', 'log', 'md', 'markdown', 'ini', 'cfg', 'conf', 'yml', 'yaml', 'toml'].includes(ext)) {
    return 'text'
  }

  // 代码文件
  if (['js', 'ts', 'jsx', 'tsx', 'vue', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'json', 'xml', 'java', 'py', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'sh', 'bat', 'ps1', 'sql'].includes(ext)) {
    return 'code'
  }

  // 可执行文件
  if (['exe', 'dll', 'sys', 'com', 'bat', 'cmd', 'vbs', 'app'].includes(ext)) {
    return 'exe'
  }

  // 字体文件
  if (['ttf', 'otf', 'woff', 'woff2', 'eot', 'fon'].includes(ext)) {
    return 'font'
  }

  // 安装包
  if (['msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'ipa'].includes(ext)) {
    return 'installer'
  }

  return 'default'
})
</script>
