import { Router, Request, Response } from 'express'
import {
  reverseGeocode,
  reverseGeocodeLocal,
  routeGeometry,
  searchLocalStops,
  searchPlaces,
} from '../services/geoProxyService'

const router = Router()

function numberParam(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function coordinates(lat: number | null, lng: number | null): { lat: number; lng: number } | null {
  if (
    lat === null || lng === null ||
    lat < -90 || lat > 90 ||
    lng < -180 || lng > 180
  ) {
    return null
  }
  return { lat, lng }
}

router.get('/search', async (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (query.length < 2 || query.length > 120) {
    res.status(400).json({ success: false, message: 'Query must have between 2 and 120 characters' })
    return
  }

  try {
    const suggestions = await searchPlaces(query)
    res.json({ success: true, data: suggestions })
  } catch {
    try {
      const suggestions = await searchLocalStops(query)
      res.json({ success: true, data: suggestions, meta: { source: 'local-stops-fallback' } })
    } catch {
      res.status(502).json({ success: false, message: 'Unable to fetch geocoding data' })
    }
  }
})

router.get('/reverse', async (req: Request, res: Response) => {
  const point = coordinates(numberParam(req.query.lat), numberParam(req.query.lng))
  if (!point) {
    res.status(400).json({ success: false, message: 'lat and lng must be valid coordinates' })
    return
  }

  try {
    const result = await reverseGeocode(point.lat, point.lng)
    res.json({ success: true, data: result })
  } catch {
    try {
      const result = await reverseGeocodeLocal(point.lat, point.lng)
      res.json({ success: true, data: result, meta: { source: 'local-stops-fallback' } })
    } catch {
      res.status(502).json({ success: false, message: 'Unable to fetch reverse geocoding data' })
    }
  }
})

router.get('/route', async (req: Request, res: Response) => {
  const profile = req.query.profile === 'foot' ? 'foot' : 'driving'
  const from = coordinates(numberParam(req.query.fromLat), numberParam(req.query.fromLng))
  const to = coordinates(numberParam(req.query.toLat), numberParam(req.query.toLng))

  if (!from || !to) {
    res.status(400).json({ success: false, message: 'from and to must be valid coordinates' })
    return
  }

  try {
    const result = await routeGeometry(profile, from.lat, from.lng, to.lat, to.lng)
    res.json({ success: true, data: result })
  } catch {
    // Keep map rendering usable when the public OSRM service is unavailable.
    res.json({
      success: true,
      data: { coordinates: [[from.lat, from.lng], [to.lat, to.lng]] },
      meta: { source: 'straight-line-fallback' },
    })
  }
})

export default router
