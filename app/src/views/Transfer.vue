<template>
  <div class="transfer-page">
    <!-- 侧边导航 -->
    <div class="transfer-sidebar">
      <router-link
        to="/transfer/downloading"
        class="sidebar-item"
        active-class="active"
      >
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
        </svg>
        <span>下载中</span>
        <span class="badge" v-if="downloadCount > 0">{{ downloadCount }}</span>
      </router-link>
      <router-link
        to="/transfer/completed"
        class="sidebar-item"
        active-class="active"
      >
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
        <span>已完成</span>
        <span class="badge" v-if="completedCount > 0">{{ completedCount }}</span>
      </router-link>
    </div>

    <!-- 内容区域 -->
    <div class="transfer-content">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDownloadStore } from '@/stores/download'

const downloadStore = useDownloadStore()

const downloadCount = computed(() => downloadStore.downloadCount)
const completedCount = computed(() => downloadStore.completedCount)
</script>

<style lang="scss" scoped>
.transfer-page {
  display: flex;
  height: 100%;
}

.transfer-sidebar {
  width: 160px;
  background: $bg-tertiary;
  border-right: 1px solid $border-color;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  color: $text-secondary;
  text-decoration: none;
  transition: all 0.15s;

  svg {
    flex-shrink: 0;
  }

  span:not(.badge) {
    flex: 1;
    font-size: 13px;
  }

  .badge {
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    background: $primary-color;
    color: white;
    border-radius: 10px;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &:hover {
    background: $bg-hover;
    color: $text-primary;
  }

  &.active {
    background: rgba($primary-color, 0.2);
    color: $primary-color;
  }
}

.transfer-content {
  flex: 1;
  overflow: hidden;
}
</style>
