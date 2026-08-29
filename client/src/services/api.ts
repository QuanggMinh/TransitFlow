import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  withCredentials: true,
})

// ── Typed API errors ──────────────────────────────────────────────────────────

export class GeoError extends Error {
  constructor(
    public readonly code: 'timeout' | 'network' | 'http' | 'parse',
    message: string,
  ) {
    super(message)
    this.name = 'GeoError'
  }
}

export function classifyAxiosError(err: unknown): 'timeout' | 'network' | 'server' | 'client' | 'unknown' {
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED' || err.code === 'ERR_CANCELED') return 'timeout'
    if (!err.response) return 'network'
    if (err.response.status >= 500) return 'server'
    return 'client'
  }
  return 'unknown'
}

export const routeApi = {
  getAll: () => api.get('/routes'),
  getById: (id: string) => api.get(`/routes/${id}`),
  getStops: (id: string) => api.get(`/routes/${id}/stops`),
  getSegments: (id: string) => api.get(`/routes/${id}/segments`),
  getGeometry: (id: string) => api.get(`/routes/${id}/geometry`),
}

export const stopApi = {
  getAll: () => api.get('/stops'),
  getById: (id: string) => api.get(`/stops/${id}`),
}

export const etaApi = {
  getETA: (routeId: string, targetStopIndex: number) =>
    api.get('/eta', { params: { routeId, targetStopIndex } }),
}

export const journeyApi = {
  find: (fromLat: number, fromLng: number, toLat: number, toLng: number, departureAt?: string) =>
    api.get('/journey', { params: { fromLat, fromLng, toLat, toLng, ...(departureAt ? { departureAt } : {}) } }),
}

export const geoProxyApi = {
  search: (query: string) => api.get('/geo/search', { params: { q: query } }),
  reverse: (lat: number, lng: number) => api.get('/geo/reverse', { params: { lat, lng } }),
  route: (
    profile: 'driving' | 'foot',
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
  ) => api.get('/geo/route', { params: { profile, fromLat, fromLng, toLat, toLng } }),
}

export const adminApi = {
  login: (username: string, password: string) =>
    api.post('/admin/auth/login', { username, password }),
  logout: () => api.post('/admin/auth/logout'),
  session: () => api.get('/admin/auth/session'),
  stats: () => api.get('/admin/stats'),
  routes: () => api.get('/admin/routes'),
  createRoute: (data: Record<string, string | number>) =>
    api.post('/admin/routes', data),
  updateRoute: (id: string, data: Record<string, string | number>) =>
    api.patch(`/admin/routes/${id}`, data),
  deleteRoute: (id: string) => api.delete(`/admin/routes/${id}`),
  routeStops: (routeId: string) =>
    api.get(`/admin/routes/${routeId}/stops`),
  addRouteStop: (routeId: string, stopId: string, position: number) =>
    api.post(`/admin/routes/${routeId}/stops`, { stopId, position }),
  removeRouteStop: (routeId: string, routeStopId: string) =>
    api.delete(`/admin/routes/${routeId}/stops/${routeStopId}`),
  reorderRouteStops: (routeId: string, routeStopIds: string[]) =>
    api.put(`/admin/routes/${routeId}/stops/reorder`, { routeStopIds }),
  saveRouteStops: (routeId: string, stopIds: string[], expectedRouteStopIds: string[]) =>
    api.put(`/admin/routes/${routeId}/stops`, { stopIds, expectedRouteStopIds }),
  stops: (q = '', page = 1, limit = 30) =>
    api.get('/admin/stops', { params: { q, page, limit } }),
  createStop: (data: Record<string, string | number>) =>
    api.post('/admin/stops', data),
  updateStop: (id: string, data: Record<string, string | number>) =>
    api.patch(`/admin/stops/${id}`, data),
  deleteStop: (id: string) => api.delete(`/admin/stops/${id}`),
}

// ── Nominatim geocoding helpers ───────────────────────────────────────────────

interface NominatimItem {
  display_name: string
  lat: string
  lon: string
  type?: string
  class?: string
  address?: Record<string, string>
  namedetails?: Record<string, string>
}

const SKIP_CATEGORIES = ['country', 'state', 'county']

function parseNominatim(item: NominatimItem) {
  const parts = item.display_name.split(',').map((s) => s.trim())

  // Tên chính: bỏ số nhà đứng đầu, lấy phần đầu tiên có nghĩa
  const shortName =
    item.namedetails?.['name:vi'] ??
    item.namedetails?.name ??
    parts.find((p) => !/^\d+$/.test(p) && p.length > 1) ??
    parts[0]

  // Phụ đề: quận/huyện + thành phố (bỏ mã bưu chính & "Việt Nam")
  const subtitle = parts
    .slice(1)
    .filter((p) => !/^\d{5,}$/.test(p) && p !== 'Việt Nam' && p !== shortName)
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

// Nominatim geocoding (OpenStreetMap) - không cần API key
export const geocodeApi = {
  search: async (query: string) => {
    try {
      const res = await geoProxyApi.search(query)
      return res.data.data
    } catch (err) {
      const kind = classifyAxiosError(err)
      if (kind === 'timeout') throw new GeoError('timeout', 'Geocoding search timed out')
      if (kind === 'network') throw new GeoError('network', 'No connection to geocoding proxy')
      if (kind === 'server') throw new GeoError('http', 'Geocoding proxy unavailable')
      throw new GeoError('parse', String(err))
    }
  },
}

export default api
