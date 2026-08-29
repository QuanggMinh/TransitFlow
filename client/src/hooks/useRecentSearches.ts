import { useState, useCallback } from 'react'

export interface RecentSearch {
  fromName: string
  fromLat: number
  fromLng: number
  toName: string
  toLat: number
  toLng: number
}

const STORAGE_KEY = 'transitflow_recent'
const MAX = 5

function load(): RecentSearch[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}

export function useRecentSearches() {
  const [recents, setRecents] = useState<RecentSearch[]>(load)

  const pushRecent = useCallback((item: RecentSearch) => {
    setRecents(prev => {
      const filtered = prev.filter(r =>
        !(r.fromName === item.fromName && r.toName === item.toName)
      )
      const next = [item, ...filtered].slice(0, MAX)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { recents, pushRecent }
}
