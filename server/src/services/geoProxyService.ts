import https from 'https'
import Stop from '../models/Stop'

const USER_AGENT = process.env.APP_USER_AGENT ?? 'TransitFlow/1.0 (graduation project)'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 1000
const REQUEST_TIMEOUT_MS = 8000
const HANOI_VIEWBOX = '105.65,20.80,106.05,21.40'

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

interface NominatimItem {
  display_name: string
  lat: string
  lon: string
  type?: string
  class?: string
  namedetails?: Record<string, string>
}

export interface GeocodeSuggestion {
  displayName: string
  shortName: string
  subtitle: string
  lat: number
  lng: number
  category?: string
}

export interface ReverseGeocodeResult {
  displayName: string
}

export interface RouteGeometryResult {
  coordinates: [number, number][]
}

const cache = new Map<string, CacheEntry<unknown>>()
const SKIP_CATEGORIES = ['country', 'state', 'county']

function getCached<T>(key: string): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  // Refresh insertion order so the Map behaves like a small LRU cache.
  cache.delete(key)
  cache.set(key, hit)
  return hit.value as T
}

function setCached<T>(key: string, value: T): T {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T)
        } catch (err) {
          reject(err)
        }
      })
    })

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Request timeout'))
    })
    req.on('error', reject)
  })
}

async function fetchJsonCached<T>(key: string, url: string): Promise<T> {
  const hit = getCached<T>(key)
  if (hit) return hit
  return setCached(key, await fetchJson<T>(url))
}

function parseNominatim(item: NominatimItem): GeocodeSuggestion {
  const parts = item.display_name.split(',').map((part) => part.trim())
  const shortName =
    item.namedetails?.['name:vi'] ??
    item.namedetails?.name ??
    parts.find((part) => !/^\d+$/.test(part) && part.length > 1) ??
    parts[0]
  const subtitle = parts
    .slice(1)
    .filter((part) => !/^\d{5,}$/.test(part) && part !== 'Việt Nam' && part !== shortName)
    .slice(0, 3)
    .join(', ')

  return {
    displayName: item.display_name,
    shortName,
    subtitle,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    category: item.class ?? item.type,
  }
}

export async function searchPlaces(query: string): Promise<GeocodeSuggestion[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '6',
    countrycodes: 'vn',
    'accept-language': 'vi',
    addressdetails: '1',
    namedetails: '1',
    bounded: '1',
    viewbox: HANOI_VIEWBOX,
  })
  const key = `nominatim:search:${params.toString()}`
  const url = `https://nominatim.openstreetmap.org/search?${params}`
  const data = await fetchJsonCached<NominatimItem[]>(key, url)
  return data
    .filter((item) => !SKIP_CATEGORIES.includes(item.class ?? ''))
    .map(parseNominatim)
}

export async function searchLocalStops(query: string): Promise<GeocodeSuggestion[]> {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  if (tokens.length === 0) return []

  const stops = await Stop.find({
    $and: tokens.map((token) => ({
      $or: [
        { name: { $regex: token, $options: 'i' } },
        { address: { $regex: token, $options: 'i' } },
      ],
    })),
  })
    .sort({ name: 1 })
    .limit(6)
    .select('name address lat lng')
    .lean()

  return stops.map((stop) => ({
    displayName: [stop.name, stop.address].filter(Boolean).join(', '),
    shortName: stop.name,
    subtitle: stop.address,
    lat: stop.lat,
    lng: stop.lng,
    category: 'bus_stop',
  }))
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'json',
    'accept-language': 'vi',
  })
  const key = `nominatim:reverse:${lat.toFixed(6)},${lng.toFixed(6)}`
  const url = `https://nominatim.openstreetmap.org/reverse?${params}`
  const data = await fetchJsonCached<{ display_name?: string }>(key, url)
  return { displayName: data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}` }
}

export async function reverseGeocodeLocal(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const candidates = await Stop.find({
    lat: { $gte: lat - 0.02, $lte: lat + 0.02 },
    lng: { $gte: lng - 0.02, $lte: lng + 0.02 },
  })
    .select('name address lat lng')
    .lean()

  const toRadians = (value: number) => value * Math.PI / 180
  const distance = (stopLat: number, stopLng: number) => {
    const dLat = toRadians(stopLat - lat)
    const dLng = toRadians(stopLng - lng)
    const value =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRadians(lat)) * Math.cos(toRadians(stopLat)) * Math.sin(dLng / 2) ** 2
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
  }

  const nearest = candidates
    .map((stop) => ({ stop, distance: distance(stop.lat, stop.lng) }))
    .sort((left, right) => left.distance - right.distance)[0]

  if (nearest && nearest.distance <= 500) {
    return {
      displayName: [nearest.stop.name, nearest.stop.address].filter(Boolean).join(', '),
    }
  }
  return { displayName: `${lat.toFixed(5)}, ${lng.toFixed(5)}` }
}

export async function routeGeometry(
  profile: 'driving' | 'foot',
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<RouteGeometryResult> {
  const coords = `${fromLng},${fromLat};${toLng},${toLat}`
  const key = `osrm:route:${profile}:${coords}`
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?geometries=geojson&overview=full`
  const data = await fetchJsonCached<{ routes?: Array<{ geometry?: { coordinates?: [number, number][] } }> }>(key, url)
  const raw = data.routes?.[0]?.geometry?.coordinates
  if (!raw?.length) return { coordinates: [[fromLat, fromLng], [toLat, toLng]] }
  return {
    coordinates: raw.map(([lng, lat]) => [lat, lng] as [number, number]),
  }
}

export async function osrmJson<T>(key: string, url: string): Promise<T> {
  return fetchJsonCached<T>(`osrm:${key}`, url)
}
