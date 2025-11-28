import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue')
  },
  {
    path: '/transfer',
    name: 'Transfer',
    component: () => import('@/views/Transfer.vue'),
    children: [
      {
        path: '',
        redirect: '/transfer/downloading'
      },
      {
        path: 'downloading',
        name: 'Downloading',
        component: () => import('@/views/transfer/Downloading.vue')
      },
      {
        path: 'completed',
        name: 'Completed',
        component: () => import('@/views/transfer/Completed.vue')
      }
    ]
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/Settings.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
