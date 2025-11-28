<template>
  <div class="app-container">
    <!-- 标题栏 -->
    <div class="title-bar">
      <div class="title-bar-drag">
        <span class="app-title">图片下载器</span>
      </div>
      <div class="window-controls">
        <button class="control-btn minimize" @click="handleMinimize" title="最小化">
          <svg viewBox="0 0 24 24" width="12" height="12">
            <path fill="currentColor" d="M20 14H4v-2h16" />
          </svg>
        </button>
        <button class="control-btn maximize" @click="handleMaximize" title="最大化">
          <svg viewBox="0 0 24 24" width="12" height="12">
            <path fill="currentColor" d="M4 4h16v16H4V4m2 2v12h12V6H6z" />
          </svg>
        </button>
        <button class="control-btn close" @click="handleClose" title="关闭">
          <svg viewBox="0 0 24 24" width="12" height="12">
            <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 侧边栏 -->
      <aside class="sidebar">
        <nav class="nav-menu">
          <router-link to="/" class="nav-item" active-class="active">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
            </svg>
            <span>首页</span>
          </router-link>
          <router-link to="/transfer" class="nav-item" :class="{ 'has-download': hasActiveDownload }" active-class="active">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
            </svg>
            <span>传输</span>
          </router-link>
          <router-link to="/settings" class="nav-item" active-class="active">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
            <span>设置</span>
          </router-link>
        </nav>
      </aside>

      <!-- 页面内容 -->
      <main class="page-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useDownloadStore } from '@/stores/download'
import { useDownloadManager } from '@/composables/useDownloadManager'

const settingsStore = useSettingsStore()
const downloadStore = useDownloadStore()
const downloadManager = useDownloadManager()

// 是否有活跃的下载任务（正在下载或等待中）
const hasActiveDownload = computed(() => {
  return downloadStore.downloadTasks.some(t =>
    t.status === 'downloading' || t.status === 'waiting' || t.status === 'processing' || t.status === 'creating'
  )
})

onMounted(() => {
  // 初始化设置
  settingsStore.init()
  // 设置下载进度监听
  downloadManager.setupProgressListener()
})

onUnmounted(() => {
  // 移除下载进度监听
  downloadManager.removeProgressListener()
})

const handleMinimize = () => {
  window.electronAPI?.minimize()
}

const handleMaximize = () => {
  window.electronAPI?.maximize()
}

const handleClose = () => {
  window.electronAPI?.close()
}
</script>

<style lang="scss" scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $bg-primary;
  color: $text-primary;
}

.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  background: $bg-secondary;
  border-bottom: 1px solid $border-color;
  -webkit-app-region: drag;
  user-select: none;
}

.title-bar-drag {
  flex: 1;
  display: flex;
  align-items: center;
  padding-left: 16px;
}

.app-title {
  font-size: 13px;
  font-weight: 500;
  color: $text-secondary;
}

.window-controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.control-btn {
  width: 46px;
  height: 32px;
  border: none;
  background: transparent;
  color: $text-secondary;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;

  &:hover {
    background: $bg-hover;
  }

  &.close:hover {
    background: #e81123;
    color: white;
  }
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar {
  width: 72px;
  background: $bg-secondary;
  border-right: 1px solid $border-color;
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.nav-menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 0 8px;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 56px;
  height: 56px;
  border-radius: 12px;
  color: $text-muted;
  text-decoration: none;
  transition: all 0.2s;
  position: relative;

  svg {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
  }

  span {
    font-size: 11px;
    font-weight: 500;
  }

  &:hover {
    background: $bg-hover;
    color: $text-secondary;
  }

  &.active {
    background: $primary-light;
    color: $primary-color;

    svg {
      color: $primary-color;
    }
  }

  // 有下载任务时显示角标
  &.has-download:not(.active) {
    svg {
      color: $success-color;
    }

    &::after {
      content: '';
      position: absolute;
      top: 8px;
      right: 10px;
      width: 8px;
      height: 8px;
      background: $success-color;
      border-radius: 50%;
      border: 2px solid $bg-secondary;
    }
  }
}

.page-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: $bg-primary;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
