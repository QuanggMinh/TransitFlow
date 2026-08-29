import fs from 'fs'
import path from 'path'
import Route from '../models/Route'
import RouteStop from '../models/RouteStop'
import { routeGeometry } from './geoProxyService'

export interface SegmentGeometry {
  fromOrder: number
  toOrder: number
  // [lat, lng] — Leaflet order
  coordinates: [number, number][]
  source: 'stored' | 'osrm' | 'straight-line-fallback'
}

interface StoredSegment {
  fromSourceKey: string
  toSourceKey: string
  coordinates: [number, number][]
}

interface GeometrySource {
  routes: Array<{
    code: string
    segments: StoredSegment[]
  }>
}

const geometryPath = path.resolve(__dirname, '..', '..', 'data', 'route-geometries.json')
const geometrySource = JSON.parse(fs.readFileSync(geometryPath, 'utf8')) as GeometrySource
const storedByRoute = new Map(
  geometrySource.routes.map((route) => [
    route.code,
    new Map(route.segments.map((segment) => [
      `${segment.fromSourceKey}->${segment.toSourceKey}`,
      segment.coordinates,
    ])),
  ]),
)

interface GeometryStop {
  sourceKey?: string
  lat: number
  lng: number
}

function haversineMeters(from: [number, number], to: [number, number]): number {
  const earthRadius = 6_371_000
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const dLat = toRadians(to[0] - from[0])
  const dLng = toRadians(to[1] - from[1])
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from[0])) * Math.cos(toRadians(to[0])) * Math.sin(dLng / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function storedGeometryStillMatches(
  coordinates: [number, number][],
  from: GeometryStop,
  to: GeometryStop,
): boolean {
  if (coordinates.length < 2) return false
  const first = coordinates[0]
  const last = coordinates[coordinates.length - 1]
  return (
    haversineMeters(first, [from.lat, from.lng]) <= 150 &&
    haversineMeters(last, [to.lat, to.lng]) <= 150
  )
}

async function resolveSegmentGeometry(
  storedSegments: Map<string, [number, number][]> | undefined,
  from: GeometryStop,
  to: GeometryStop,
): Promise<Pick<SegmentGeometry, 'coordinates' | 'source'>> {
  const key = from.sourceKey && to.sourceKey
    ? `${from.sourceKey}->${to.sourceKey}`
    : null
  const stored = key ? storedSegments?.get(key) : undefined
  if (stored && storedGeometryStillMatches(stored, from, to)) {
    return { coordinates: stored, source: 'stored' }
  }

  try {
    const calculated = await routeGeometry('driving', from.lat, from.lng, to.lat, to.lng)
    if (calculated.coordinates.length >= 2) {
      return { coordinates: calculated.coordinates, source: 'osrm' }
    }
  } catch {
    // Keep the route visible if the public routing service is temporarily unavailable.
  }

  return {
    coordinates: [[from.lat, from.lng], [to.lat, to.lng]],
    source: 'straight-line-fallback',
  }
}

export async function getRouteGeometry(routeId: string): Promise<SegmentGeometry[]> {
  const [route, routeStops] = await Promise.all([
    Route.findById(routeId).select('code').lean(),
    RouteStop.find({ routeId })
      .sort({ order: 1 })
      .populate('stopId')
      .lean(),
  ])

  if (!route || routeStops.length < 2) return []
  const storedSegments = storedByRoute.get(route.code ?? '')

  return Promise.all(routeStops.slice(0, -1).map(async (routeStop, index) => {
    const nextRouteStop = routeStops[index + 1]
    const from = routeStop.stopId as unknown as GeometryStop
    const to = nextRouteStop.stopId as unknown as GeometryStop
    const geometry = await resolveSegmentGeometry(storedSegments, from, to)

    return {
      fromOrder: routeStop.order,
      toOrder: nextRouteStop.order,
      ...geometry,
    }
  }))
}
