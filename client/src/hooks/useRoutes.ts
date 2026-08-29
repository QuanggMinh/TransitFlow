import { useState, useEffect } from 'react'
import { routeApi } from '@/services/api'
import type { Route } from '@/types'

export function useRoutes() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    routeApi
      .getAll()
      .then((res) => setRoutes(res.data.data))
      .catch(() => setError('Không thể tải danh sách tuyến xe'))
      .finally(() => setLoading(false))
  }, [])

  return { routes, loading, error }
}
