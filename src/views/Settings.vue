<template>
  <div class="settings-page">
    <h2 class="page-title">设置</h2>

    <div class="settings-section">
      <div class="setting-item">
        <div class="setting-label">
          <span class="label-text">下载位置</span>
          <span class="label-desc">文件将保存到此目录</span>
        </div>
        <div class="setting-control">
          <div class="path-input">
            <input type="text" :value="downloadPath" readonly />
            <button class="btn-browse" @click="selectDownloadPath">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
              </svg>
              浏览
            </button>
          </div>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span class="label-text">同时下载任务数</span>
          <span class="label-desc">最多同时下载的文件数量（1-3）</span>
        </div>
        <div class="setting-control">
          <div class="number-select">
            <button
              v-for="n in 3"
              :key="n"
              :class="['num-btn', { active: maxConcurrentDownloads === n }]"
              @click="setMaxConcurrentDownloads(n)"
            >
              {{ n }}
            </button>
          </div>
        </div>
      </div>

      <div class="setting-item">
        <div class="setting-label">
          <span class="label-text">当前下载线路</span>
          <span class="label-desc">自动选择延迟最低的下载服务器</span>
        </div>
        <div class="setting-control">
          <div class="route-info" v-if="currentRoute">
            <span class="route-name">{{ currentRoute.name }}</span>
            <span
              class="route-latency"
              :class="{ testing: isTestingRoute }"
              @click="testRoute"
              :title="isTestingRoute ? '测试中...' : '点击重新测试'"
            >
              <template v-if="isTestingRoute">
                <span class="loading-spinner"></span>
                测试中...
              </template>
              <template v-else>
                {{ currentRoute.latency }}ms
              </template>
            </span>
          </div>
          <div class="route-info route-loading" v-else>
            <span class="loading-spinner"></span>
            <span>正在选择最优线路...</span>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <h3 class="section-title">关于</h3>
      <div class="about-info">
        <div class="app-logo">
          <svg viewBox="0 0 24 24" width="48" height="48">
            <path fill="#1a73e8" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
          </svg>
        </div>
        <div class="app-info">
          <div class="app-name">图片下载器</div>
          <div class="app-version">版本 1.0.6</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()

const downloadPath = computed(() => settingsStore.downloadPath)
const maxConcurrentDownloads = computed(() => settingsStore.maxConcurrentDownloads)
const currentRoute = computed(() => settingsStore.currentRoute)
const isTestingRoute = computed(() => settingsStore.isTestingRoute)

function selectDownloadPath() {
  settingsStore.selectDownloadPath()
}

function setMaxConcurrentDownloads(value: number) {
  settingsStore.setMaxConcurrentDownloads(value)
}

function testRoute() {
  settingsStore.testCurrentRoute()
}

onMounted(() => {
  settingsStore.init()
})
</script>

<style lang="scss" scoped>
.settings-page {
  padding: 24px;
  max-width: 600px;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 24px;
  color: $text-primary;
}

.settings-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: $text-secondary;
  margin-bottom: 16px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.label-text {
  font-size: 14px;
  color: $text-primary;
}

.label-desc {
  font-size: 12px;
  color: $text-secondary;
}

.setting-control {
  margin-top: 4px;
}

.path-input {
  display: flex;
  gap: 8px;

  input {
    flex: 1;
    height: 36px;
    padding: 0 12px;
    border: 1px solid $border-color;
    border-radius: 6px;
    background: $bg-tertiary;
    color: $text-primary;
    font-size: 13px;
    outline: none;

    &:focus {
      border-color: $primary-color;
    }
  }

  .btn-browse {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 36px;
    border: 1px solid $border-color;
    border-radius: 6px;
    background: $bg-tertiary;
    color: $text-primary;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      background: $bg-hover;
    }
  }
}

.number-select {
  display: flex;
  gap: 8px;

  .num-btn {
    width: 40px;
    height: 36px;
    border: 1px solid $border-color;
    border-radius: 6px;
    background: $bg-tertiary;
    color: $text-primary;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      background: $bg-hover;
    }

    &.active {
      background: $primary-color;
      border-color: $primary-color;
      color: #fff;
    }
  }
}

.route-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: $bg-tertiary;
  border: 1px solid $border-color;
  border-radius: 6px;
  font-size: 14px;

  &.route-loading {
    color: $text-secondary;
  }
}

.route-name {
  color: $text-primary;
  font-weight: 500;
}

.route-latency {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #10b981;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.15s;

  &:hover:not(.testing) {
    background: rgba(16, 185, 129, 0.1);
  }

  &.testing {
    color: $text-secondary;
    cursor: default;
  }
}

.loading-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid $border-color;
  border-top-color: $primary-color;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.about-info {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: $bg-tertiary;
  border-radius: 8px;
}

.app-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.app-name {
  font-size: 16px;
  font-weight: 600;
  color: $text-primary;
}

.app-version {
  font-size: 13px;
  color: $text-secondary;
}
</style>
