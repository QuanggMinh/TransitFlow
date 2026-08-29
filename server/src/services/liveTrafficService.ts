import https from 'https'
import RouteStop from '../models/RouteStop'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveSegment {
  fromOrder: number
  toOrder: number
  congestionLevel: number  // 0.0 (xanh) .. 1.0 (đỏ)
  source: 'tomtom' | 'simulation'
}

interface CacheEntry {
  segments: LiveSegment[]
  ts: number
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000          // 5 phút
const REQUEST_TIMEOUT_MS = 5000
const TOMTOM_CONCURRENCY = 4
const TOMTOM_KEY   = process.env.TOMTOM_API_KEY ?? ''
const cache        = new Map<string, CacheEntry>()

// ─── TomTom Traffic Flow API ─────────────────────────────────────────────────
// GET /traffic/services/4/flowSegmentData/absolute/10/json?key=…&point=lat,lon
// Free tier: 2,500 req/ngày
// currentSpeed / freeFlowSpeed → tỷ lệ thông thoáng
// congestionLevel = 1 - (currentSpeed / freeFlowSpeed)

async function fetchTomTomCongestion(lat: number, lon: number): Promise<number | null> {
  if (!TOMTOM_KEY) return null
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${TOMTOM_KEY}&point=${lat},${lon}&unit=KMPH`
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'TransitFlow/1.0' } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          resolve(null)
          return
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          const flow = body?.flowSegmentData
          if (!flow || !flow.currentSpeed || !flow.freeFlowSpeed) return resolve(null)
          const ratio = flow.currentSpeed / flow.freeFlowSpeed
          resolve(Math.max(0, Math.min(1, 1 - ratio)))
        } catch { resolve(null) }
      })
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

// ─── Time-based simulation ────────────────────────────────────────────────────
// Mô phỏng giờ cao điểm thực tế của Hà Nội
// - Sáng:  7h–9h   → tắc (0.70–0.80)
// - Trưa: 11h30–13h → hơi đông (0.40–0.50)
// - Chiều: 17h–19h30 → tắc (0.72–0.82)
// - Đêm:  22h–5h   → thông thoáng (0.05–0.10)
// - Cuối tuần: nhân 0.65

const HOURLY_BASE: Record<number, number> = {
  0: 0.05, 1: 0.05, 2: 0.04, 3: 0.04, 4: 0.05,
  5: 0.10, 6: 0.35, 7: 0.75, 8: 0.72, 9: 0.42,
  10: 0.28, 11: 0.40, 12: 0.48, 13: 0.44, 14: 0.26,
  15: 0.32, 16: 0.58, 17: 0.80, 18: 0.78, 19: 0.55,
  20: 0.38, 21: 0.28, 22: 0.18, 23: 0.10,
}

function deterministicNoise(lat: number, lon: number): number {
  // Deterministic offset -0.12 .. +0.12 based on position (not random each call)
  return Math.sin(lat * 1731.3 + lon * 2371.7) * 0.12
}

function simulate(lat: number, lon: number, time?: Date): number {
  const now   = time ?? new Date()
  const hour  = now.getHours()
  const min   = now.getMinutes()
  const isWE  = now.getDay() === 0 || now.getDay() === 6
  const base  = (HOURLY_BASE[hour] + HOURLY_BASE[(hour + 1) % 24] * (min / 60)) /
                (1 + min / 60)  // linear interpolation between hours
  const weekdayFactor = isWE ? 0.62 : 1.0
  return Math.max(0, Math.min(1, base * weekdayFactor + deterministicNoise(lat, lon)))
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getLiveTraffic(routeId: string, time?: Date): Promise<LiveSegment[]> {
  const isNow = !time
  if (isNow) {
    const hit = cache.get(routeId)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.segments
  }

  const stops = await RouteStop.find({ routeId })
    .sort({ order: 1 })
    .populate('stopId')

  const segmentInputs: Array<{
    fromOrder: number
    toOrder: number
    midLat: number
    midLon: number
  }> = []
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i].stopId as any
    const to   = stops[i + 1].stopId as any
    if (!from?.lat || !to?.lat) continue

    const midLat = (from.lat + to.lat) / 2
    const midLon = (from.lng + to.lng) / 2

    segmentInputs.push({
      fromOrder: stops[i].order,
      toOrder: stops[i + 1].order,
      midLat,
      midLon,
    })
  }

  const segments: LiveSegment[] = []
  for (let i = 0; i < segmentInputs.length; i += TOMTOM_CONCURRENCY) {
    const batch = segmentInputs.slice(i, i + TOMTOM_CONCURRENCY)
    const batchResults = await Promise.all(batch.map(async (input) => {
      const tomtom = isNow ? await fetchTomTomCongestion(input.midLat, input.midLon) : null
      return {
        fromOrder: input.fromOrder,
        toOrder: input.toOrder,
        congestionLevel: tomtom !== null ? tomtom : simulate(input.midLat, input.midLon, time),
        source: tomtom !== null ? 'tomtom' as const : 'simulation' as const,
      }
    }))
    segments.push(...batchResults)
  }

  if (isNow) cache.set(routeId, { segments, ts: Date.now() })
  return segments
}

export function getTrafficSource(): 'tomtom' | 'simulation' {
  return TOMTOM_KEY ? 'tomtom' : 'simulation'
}

export function clearTrafficCache(routeIds?: string[]) {
  if (!routeIds) {
    cache.clear()
    return
  }
  for (const routeId of routeIds) cache.delete(routeId)
}
