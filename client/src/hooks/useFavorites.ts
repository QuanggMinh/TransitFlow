import { useState, useCallback } from 'react'

export interface FavoritePlace {
  id: string
  label: string
  name: string
  lat: number
  lng: number
}

const STORAGE_KEY = 'transitflow_favorites'

function load(): FavoritePlace[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoritePlace[]>(load)

  const addFavorite = useCallback((place: Omit<FavoritePlace, 'id'>) => {
    setFavorites(prev => {
      const next: FavoritePlace[] = [...prev, { ...place, id: String(Date.now()) }]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const removeFavorite = useCallback((id: string) => {
    setFavorites(prev => {
      const next = prev.filter(f => f.id !== id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { favorites, addFavorite, removeFavorite }
}
