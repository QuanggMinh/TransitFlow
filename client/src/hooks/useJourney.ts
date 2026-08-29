import { useState, useCallback } from 'react'
import { journeyApi, classifyAxiosError } from '@/services/api'
import type { JourneyOption } from '@/types'

const JOURNEY_ERRORS: Record<ReturnType<typeof classifyAxiosError>, string> = {
  timeout: 'Tìm hành trình quá thời gian (>10s). Vui lòng thử lại.',
  network: 'Mất kết nối mạng. Kiểm tra internet và thử lại.',
  server:  'Lỗi server (5xx). Vui lòng thử lại sau ít phút.',
  client:  'Yêu cầu không hợp lệ. Kiểm tra điểm đi và điểm đến.',
  unknown: 'Không thể tìm hành trình. Vui lòng thử lại.',
}

export function useJourney() {
  const [results, setResults] = useState<JourneyOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const findJourney = useCallback(
    async (fromLat: number, fromLng: number, toLat: number, toLng: number, departureAt?: string) => {
      setLoading(true)
      setError(null)
      setSearched(false)
      try {
        const res = await journeyApi.find(fromLat, fromLng, toLat, toLng, departureAt)
        setResults(res.data.data)
        setSearched(true)
      } catch (err) {
        setError(JOURNEY_ERRORS[classifyAxiosError(err)])
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const reset = useCallback(() => {
    setResults([])
    setError(null)
    setSearched(false)
  }, [])

  return { results, loading, error, searched, findJourney, reset }
}
