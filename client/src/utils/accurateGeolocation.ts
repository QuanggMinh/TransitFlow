export interface AccurateGeoPosition {
  lat: number
  lng: number
  accuracy: number
  initialAccuracy: number
  sampleCount: number
  elapsedMs: number
  improvementPercent: number
}

interface AccuratePositionOptions {
  targetAccuracy?: number
  excellentAccuracy?: number
  minimumSamples?: number
  timeoutMs?: number
}

/**
 * Warms up the device GPS and returns the best reading instead of accepting
 * the first Wi-Fi/cell-based reading produced by getCurrentPosition().
 */
export function getAccurateCurrentPosition({
  targetAccuracy = 25,
  excellentAccuracy = 12,
  minimumSamples = 2,
  timeoutMs = 15_000,
}: AccuratePositionOptions = {}): Promise<AccurateGeoPosition> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    let watchId: number | null = null
    let timerId: number | null = null
    let best: GeolocationPosition | null = null
    let initialAccuracy: number | null = null
    let sampleCount = 0
    let settled = false
    let lastError: GeolocationPositionError | null = null

    const cleanup = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      if (timerId !== null) window.clearTimeout(timerId)
    }

    const finish = () => {
      if (settled || !best || initialAccuracy === null) return
      settled = true
      cleanup()

      const accuracy = best.coords.accuracy
      resolve({
        lat: best.coords.latitude,
        lng: best.coords.longitude,
        accuracy,
        initialAccuracy,
        sampleCount,
        elapsedMs: Math.round(performance.now() - startedAt),
        improvementPercent: initialAccuracy > 0
          ? Math.max(0, Math.round((1 - accuracy / initialAccuracy) * 100))
          : 0,
      })
    }

    watchId = navigator.geolocation.watchPosition(
      position => {
        const { latitude, longitude, accuracy } = position.coords
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) return

        sampleCount++
        if (initialAccuracy === null) initialAccuracy = accuracy
        if (!best || accuracy < best.coords.accuracy) best = position

        const excellent = best.coords.accuracy <= excellentAccuracy
        const targetReached = best.coords.accuracy <= targetAccuracy && sampleCount >= minimumSamples
        if (excellent || targetReached) finish()
      },
      error => {
        lastError = error
        if (error.code === error.PERMISSION_DENIED) {
          settled = true
          cleanup()
          reject(error)
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )

    timerId = window.setTimeout(() => {
      if (best) {
        finish()
      } else {
        settled = true
        cleanup()
        reject(lastError ?? new DOMException('Không nhận được mẫu vị trí GPS.', 'TimeoutError'))
      }
    }, timeoutMs)
  })
}
