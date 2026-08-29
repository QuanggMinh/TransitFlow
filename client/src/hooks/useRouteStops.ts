import { useState, useEffect } from 'react'
import { routeApi } from '@/services/api'
import type { RouteStop } from '@/types'

export function useRouteStops(routeId: string | null) {
  const [stops, setStops] = useState<RouteStop[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!routeId) {
      setStops([])
      return
    }
    setLoading(true)
    setError(null)
    routeApi
      .getStops(routeId)
      .then((res) => setStops(res.data.data))
      .catch(() => setError('Không thể tải danh sách trạm'))
      .finally(() => setLoading(false))
  }, [routeId])

  return { stops, loading, error }
}
