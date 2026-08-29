import { useState, useEffect, useRef, useCallback } from 'react'
import { routeApi } from '@/services/api'
import type { TrafficSegment } from '@/types'

const REFRESH_MS = 3 * 60 * 1000  // làm mới mỗi 3 phút

export function useTrafficSegments(routeId: string | null) {
  const [segments, setSegments]         = useState<TrafficSegment[]>([])
  const [loading, setLoading]           = useState(false)
  const [trafficSource, setSource]      = useState<'tomtom' | 'simulation' | null>(null)
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSegments = useCallback(async (id: string) => {
    try {
      const res = await routeApi.getSegments(id)
      setSegments(res.data.data)
      setSource(res.data.meta?.source ?? 'simulation')
      setLastUpdated(new Date())
    } catch {
      // Giữ nguyên dữ liệu cũ khi lỗi
    }
  }, [])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!routeId) { setSegments([]); setSource(null); return }

    setLoading(true)
    fetchSegments(routeId).finally(() => setLoading(false))

    // Tự động làm mới mỗi 3 phút
    timerRef.current = setInterval(() => fetchSegments(routeId), REFRESH_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [routeId, fetchSegments])

  return { segments, loading, trafficSource, lastUpdated }
}
