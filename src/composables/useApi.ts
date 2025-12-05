import axios from 'axios'
import type { ApiResponse, FileListResponse, DownloadLinkResponse } from '@/types'

const API_BASE = 'https://download.linglong521.cn'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json'
  }
})

export function useApi() {
  // 获取文件列表（通用接口）
  async function getFileList(code: string, path: string = '/', session: string = ''): Promise<FileListResponse> {
    const response = await api.post<ApiResponse<FileListResponse>>('/getFileList.php', {
      code,
      path,
      session
    })

    if (response.data.code !== 200) {
      throw new Error(response.data.message)
    }

    return response.data.data!
  }

  // 获取下载链接（通用接口）
  async function getDownloadLink(params: {
    code: string
    session: string
    file_id: string
    path: string
  }): Promise<DownloadLinkResponse> {
    const response = await api.post<ApiResponse<DownloadLinkResponse>>('/getDownloadLink.php', params)

    if (response.data.code !== 200) {
      throw new Error(response.data.message)
    }

    return response.data.data!
  }

  return {
    getFileList,
    getDownloadLink
  }
}
