import { useState, useEffect } from 'react'

export interface GeoPosition {
  lat: number
  lng: number
  accuracy: number // mét
}

export function useGeolocation() {
  const [position, setPosition] = useState<GeoPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!window.isSecureContext) {
      setError('GPS bị trình duyệt chặn vì trang đang dùng HTTP qua mạng LAN. Hãy mở ứng dụng bằng HTTPS.')
      return
    }

    if (!navigator.geolocation) {
      setError('Trình duyệt không hỗ trợ GPS')
      return
    }

    setLoading(true)

    // watchPosition cập nhật liên tục khi người dùng di chuyển
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
        setLoading(false)
        setError(null)
      },
      (err) => {
        setLoading(false)
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError('Bạn đã từ chối quyền truy cập vị trí')
            break
          case err.POSITION_UNAVAILABLE:
            setError('Không xác định được vị trí')
            break
          default:
            setError('Lỗi GPS')
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  return { position, error, loading }
}
