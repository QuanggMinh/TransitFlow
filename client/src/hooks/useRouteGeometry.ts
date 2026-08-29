import { useState, useEffect } from 'react'
import { routeApi } from '@/services/api'
import type { SegmentGeometry } from '@/types'

export function useRouteGeometry(routeId: string | null) {
  const [geometry, setGeometry] = useState<SegmentGeometry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!routeId) { setGeometry([]); return }

    let cancelled = false
    setLoading(true)
    setGeometry([])

    routeApi
      .getGeometry(routeId)
      .then((res) => {
        if (!cancelled) setGeometry(res.data.data)
      })
      .catch(() => {
        if (!cancelled) setGeometry([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [routeId])

  return { geometry, loading }
}
