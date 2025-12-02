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
          <div class="app-version">版本 1.0.5</div>
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

function selectDownloadPath() {
  settingsStore.selectDownloadPath()
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
