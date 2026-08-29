import { useState } from 'react'
import { etaApi, classifyAxiosError } from '@/services/api'
import type { ETAResult } from '@/types'

const ETA_ERRORS: Record<ReturnType<typeof classifyAxiosError>, string> = {
  timeout: 'ETA timeout — xe có thể đang ngoài vùng phủ sóng.',
  network: 'Mất kết nối, không thể tải ETA.',
  server:  'Lỗi server khi tính ETA. Thử lại sau.',
  client:  'Trạm không hợp lệ.',
  unknown: 'Không thể tính ETA.',
}

export function useETA() {
  const [results, setResults] = useState<ETAResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchETA(routeId: string, targetStopIndex: number) {
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const res = await etaApi.getETA(routeId, targetStopIndex)
      setResults(res.data.data)
    } catch (err) {
      setError(ETA_ERRORS[classifyAxiosError(err)])
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setResults([])
    setError(null)
  }

  return { results, loading, error, fetchETA, reset }
}
