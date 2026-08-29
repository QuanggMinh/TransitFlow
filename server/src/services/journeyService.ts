import RouteStop from '../models/RouteStop'
import { getLiveTraffic } from './liveTrafficService'

const EARTH_RADIUS_M  = 6371000
const MAX_WALK_METERS = 2000
const TRANSFER_WALK_M = 500
const MAX_DIRECT           = 3
const MAX_PER_LEVEL        = [0, 3, 2]  // index = transferCount (tối đa 2 lần đổi)
const RAW_CAP              = 3000
const TRANSFER_PENALTY_MIN = 8
const WALK_PENALTY_M       = 250
const PRICE_PENALTY_VND    = 3000
const DIRECT_EXACT_BONUS   = 120
const DIRECT_NEAR_BONUS    = 40
const LONG_TRIP_METERS     = 15000      // ngưỡng "chuyến dài" để cho phép đổi tuyến 2 lần

// ─── Haversine ────────────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface StopNode {
  _id: string; name: string; lat: number; lng: number; address: string; order: number
}

interface RouteNode {
  _id: string; name: string; color: string; frequency: number; price: number; stops: StopNode[]
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface StopInfo {
  _id: string; name: string; lat: number; lng: number; address: string; order: number
}

interface RouteRef {
  _id: string; name: string; color: string; frequency: number; price: number
}

export interface JourneySegment {
  route: RouteRef
  boardStop: StopInfo
  alightStop: StopInfo
  stopsCount: number
  intermediateStops: string[]
}

export interface JourneyScoreBreakdown {
  totalScore: number
  etaScore: number
  walkScore: number
  transferScore: number
  priceScore: number
  directnessScore: number
  totalWalkMeters: number
  transferCount: number
  totalPrice: number
  routeCount: number
  reasons: string[]
}

export interface DirectJourney {
  type: 'direct'
  route: RouteRef
  boardStop: StopInfo
  alightStop: StopInfo
  intermediateStops: string[]
  walkToBoard: number
  walkFromAlight: number
  stopsCount: number
  etaMin: number
  etaMax: number
  scoreBreakdown?: JourneyScoreBreakdown
}

export interface MultiJourney {
  type: 'multi'
  transferCount: number
  segments: JourneySegment[]
  walkToBoard: number
  walkFromAlight: number
  transferWalks: number[]
  etaMin: number
  etaMax: number
  scoreBreakdown?: JourneyScoreBreakdown
}

export type JourneyOption = DirectJourney | MultiJourney

// ─── Load & group data ────────────────────────────────────────────────────────

async function loadRoutes(): Promise<RouteNode[]> {
  const all = await RouteStop.find().populate('stopId').populate('routeId').lean()

  const byRoute = new Map<string, RouteNode>()
  for (const rs of all) {
    const route = rs.routeId as any
    const stop  = rs.stopId  as any
    if (!route?._id || !stop?.lat) continue

    const rid = route._id.toString()
    if (!byRoute.has(rid)) {
      byRoute.set(rid, {
        _id: rid, name: route.name, color: route.color,
        frequency: route.frequency, price: route.price ?? 7000,
        stops: [],
      })
    }
    byRoute.get(rid)!.stops.push({
      _id: stop._id.toString(), name: stop.name,
      lat: stop.lat, lng: stop.lng, address: stop.address, order: rs.order,
    })
  }

  for (const r of byRoute.values()) r.stops.sort((a, b) => a.order - b.order)
  return [...byRoute.values()]
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function toStopInfo(s: StopNode): StopInfo {
  return { _id: s._id, name: s.name, lat: s.lat, lng: s.lng, address: s.address, order: s.order }
}

function toRouteRef(r: RouteNode): RouteRef {
  return { _id: r._id, name: r.name, color: r.color, frequency: r.frequency, price: r.price }
}

function totalWalkMulti(j: MultiJourney): number {
  return j.walkToBoard + j.walkFromAlight + j.transferWalks.reduce((s, v) => s + v, 0)
}

function journeyTransferCount(j: JourneyOption): number {
  return j.type === 'direct' ? 0 : j.transferCount
}

function totalWalkJourney(j: JourneyOption): number {
  return j.type === 'direct'
    ? j.walkToBoard + j.walkFromAlight
    : totalWalkMulti(j)
}

function totalPriceJourney(j: JourneyOption): number {
  return j.type === 'direct'
    ? j.route.price
    : j.segments.reduce((sum, seg) => sum + seg.route.price, 0)
}

function routeCount(j: JourneyOption): number {
  return j.type === 'direct' ? 1 : j.segments.length
}

function buildScoreBreakdown(j: JourneyOption): JourneyScoreBreakdown {
  const etaScore = (j.etaMin + j.etaMax) / 2
  const totalWalkMeters = totalWalkJourney(j)
  const transferCount = journeyTransferCount(j)
  const totalPrice = totalPriceJourney(j)
  const walkScore = totalWalkMeters / WALK_PENALTY_M
  const transferScore = transferCount * TRANSFER_PENALTY_MIN
  const priceScore = totalPrice / PRICE_PENALTY_VND
  const directnessScore = j.type === 'direct' && totalWalkMeters <= 250
    ? -DIRECT_EXACT_BONUS
    : j.type === 'direct' && totalWalkMeters <= 800
      ? -DIRECT_NEAR_BONUS
      : 0
  const totalScore = etaScore + walkScore + transferScore + priceScore + directnessScore

  return {
    totalScore: Math.round(totalScore * 10) / 10,
    etaScore: Math.round(etaScore * 10) / 10,
    walkScore: Math.round(walkScore * 10) / 10,
    transferScore: Math.round(transferScore * 10) / 10,
    priceScore: Math.round(priceScore * 10) / 10,
    directnessScore: Math.round(directnessScore * 10) / 10,
    totalWalkMeters: Math.round(totalWalkMeters),
    transferCount,
    totalPrice,
    routeCount: routeCount(j),
    reasons: [
      `${Math.round(etaScore)} min estimated travel`,
      `${Math.round(totalWalkMeters)} m walking`,
      `${transferCount} transfer${transferCount === 1 ? '' : 's'}`,
      `${totalPrice.toLocaleString('vi-VN')} VND fare`,
      directnessScore < 0 ? 'direct route bonus applied' : 'no direct route bonus',
    ],
  }
}

// Tổng khoảng cách thực tế (haversine) dọc theo đoạn tuyến từ fromIdx đến toIdx
function segmentPathDist(route: RouteNode, fromIdx: number, toIdx: number): number {
  let total = 0
  for (let i = fromIdx; i < toIdx; i++) {
    total += haversine(route.stops[i].lat, route.stops[i].lng, route.stops[i + 1].lat, route.stops[i + 1].lng)
  }
  return total
}

// Tỷ lệ tối đa giữa quãng đường bus thực tế và khoảng cách thẳng board→alight
// Tuyến zigzag hợp lệ (08A qua các phố): ratio ≈ 3–5
// Tuyến đi vòng bất thường (38 qua Hà Đông): ratio ≈ 11 → bị lọc
const MAX_DETOUR_RATIO = 5.0

// ─── Direct journeys ──────────────────────────────────────────────────────────

function findDirect(
  routes: RouteNode[],
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): DirectJourney[] {
  const results: DirectJourney[] = []

  for (const route of routes) {
    let best: DirectJourney | null = null
    let bestWalk = Infinity

    for (let b = 0; b < route.stops.length; b++) {
      const dFrom = haversine(fromLat, fromLng, route.stops[b].lat, route.stops[b].lng)
      if (dFrom > MAX_WALK_METERS) continue

      for (let a = b + 1; a < route.stops.length; a++) {
        const dTo = haversine(toLat, toLng, route.stops[a].lat, route.stops[a].lng)
        if (dTo > MAX_WALK_METERS) continue

        // Lọc tuyến đi vòng quá xa: bus phải đi vòng hơn MAX_DETOUR_RATIO lần khoảng cách thẳng
        const directBA = haversine(route.stops[b].lat, route.stops[b].lng, route.stops[a].lat, route.stops[a].lng)
        if (directBA > 0 && segmentPathDist(route, b, a) > directBA * MAX_DETOUR_RATIO) continue

        const totalWalk = dFrom + dTo
        if (totalWalk < bestWalk) {
          bestWalk = totalWalk
          best = {
            type: 'direct',
            route: toRouteRef(route),
            boardStop:  toStopInfo(route.stops[b]),
            alightStop: toStopInfo(route.stops[a]),
            intermediateStops: route.stops.slice(b + 1, a).map(s => s.name),
            walkToBoard:    Math.round(dFrom),
            walkFromAlight: Math.round(dTo),
            stopsCount: a - b,
            etaMin: 0, etaMax: 0,  // placeholder — gán lại trong findJourneys
          }
        }
      }
    }

    if (best) results.push(best)
  }

  return results.sort((a, b) =>
    (a.walkToBoard + a.walkFromAlight) - (b.walkToBoard + b.walkFromAlight)
  )
}

// ─── Multi-transfer journeys (DFS, tối đa 3 lần đổi tuyến) ──────────────────

function findMultiTransfer(
  routes: RouteNode[],
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  maxTransfers: number,
): MultiJourney[] {

  interface SegState {
    route: RouteNode; boardIdx: number; alightIdx: number; walkToBoard: number
  }

  const rawResults: MultiJourney[] = []
  const totalDistStartEnd = haversine(fromLat, fromLng, toLat, toLng)

  function buildJourney(segs: SegState[], walkFromAlight: number): MultiJourney {
    return {
      type: 'multi',
      transferCount: segs.length - 1,
      segments: segs.map(s => ({
        route: toRouteRef(s.route),
        boardStop:  toStopInfo(s.route.stops[s.boardIdx]),
        alightStop: toStopInfo(s.route.stops[s.alightIdx]),
        stopsCount: s.alightIdx - s.boardIdx,
        intermediateStops: s.route.stops.slice(s.boardIdx + 1, s.alightIdx).map(st => st.name),
      })),
      walkToBoard:    Math.round(segs[0].walkToBoard),
      walkFromAlight: Math.round(walkFromAlight),
      transferWalks:  segs.slice(1).map(s => Math.round(s.walkToBoard)),
      etaMin: 0, etaMax: 0,
    }
  }

  function dfs(prevLat: number, prevLng: number, segs: SegState[]) {
    if (rawResults.length >= RAW_CAP) return

    const prevDistToGoal = haversine(prevLat, prevLng, toLat, toLng)
    const maxWalkToNext  = segs.length === 0 ? MAX_WALK_METERS : TRANSFER_WALK_M
    const usedIds        = new Set(segs.map(s => s.route._id))

    for (const r of routes) {
      if (usedIds.has(r._id)) continue

      for (let bi = 0; bi < r.stops.length; bi++) {
        const walkToBoard = haversine(prevLat, prevLng, r.stops[bi].lat, r.stops[bi].lng)
        if (walkToBoard > maxWalkToNext) continue

        for (let ai = bi + 1; ai < r.stops.length; ai++) {
          const alight = r.stops[ai]
          const alightDistToGoal = haversine(alight.lat, alight.lng, toLat, toLng)

          if (alightDistToGoal >= prevDistToGoal) continue
          if (alightDistToGoal >= totalDistStartEnd * (1 - 0.1 * (segs.length + 1))) continue

          const newSeg: SegState = { route: r, boardIdx: bi, alightIdx: ai, walkToBoard }

          // Lọc đoạn bus đi vòng quá xa (vd: Tuyến 38 qua Hà Đông)
          const baDirectDist = haversine(r.stops[bi].lat, r.stops[bi].lng, r.stops[ai].lat, r.stops[ai].lng)
          if (baDirectDist > 0 && segmentPathDist(r, bi, ai) > baDirectDist * MAX_DETOUR_RATIO) continue

          if (segs.length + 1 >= 2 && alightDistToGoal <= MAX_WALK_METERS) {
            rawResults.push(buildJourney([...segs, newSeg], alightDistToGoal))
            if (rawResults.length >= RAW_CAP) return
          }

          if (segs.length + 1 < maxTransfers + 1) {
            dfs(alight.lat, alight.lng, [...segs, newSeg])
          }
        }
      }
    }
  }

  dfs(fromLat, fromLng, [])

  const byKey = new Map<string, MultiJourney>()
  for (const j of rawResults) {
    const key  = j.segments.map(s => s.route._id).join('→')
    const cost = totalWalkMulti(j)
    const ex   = byKey.get(key)
    if (!ex || totalWalkMulti(ex) > cost) byKey.set(key, j)
  }

  return [...byKey.values()].sort((a, b) => totalWalkMulti(a) - totalWalkMulti(b))
}

// ─── ETA calculation ──────────────────────────────────────────────────────────

const WALK_MPS     = 1.4    // walking speed m/s (~5 km/h)
const BUS_MPS      = 8.33   // bus speed m/s free-flow (~30 km/h)
const ROAD_FAC     = 1.2    // straight-line → road distance multiplier
const DEFAULT_CONG = 0.15   // default congestion when traffic data missing

type CongMap = Map<string, number>  // key: `${fromOrder}_${toOrder}`

function busTravelSecs(
  route: RouteNode,
  boardIdx: number,
  alightIdx: number,
  cong: CongMap,
): number {
  let secs = 0
  for (let i = boardIdx; i < alightIdx; i++) {
    const from = route.stops[i]
    const to   = route.stops[i + 1]
    const dist = haversine(from.lat, from.lng, to.lat, to.lng) * ROAD_FAC
    const c    = cong.get(`${from.order}_${to.order}`) ?? DEFAULT_CONG
    secs += (dist / BUS_MPS) * (1 + c)
  }
  return secs
}


function etaRange(totalSecs: number): { etaMin: number; etaMax: number } {
  const base = Math.round(totalSecs / 60)
  return { etaMin: Math.max(base - 2, 1), etaMax: base + 5 }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function findJourneys(
  fromLat: number, fromLng: number,
  toLat: number,   toLng: number,
  departureTime?: Date,
): Promise<JourneyOption[]> {
  const routes = await loadRoutes()
  const routeMap = new Map(routes.map(r => [r._id, r]))

  const tripDist   = haversine(fromLat, fromLng, toLat, toLng)
  const direct = findDirect(routes, fromLat, fromLng, toLat, toLng)
  const hasGoodDirect = direct.some(
    journey => journey.walkToBoard + journey.walkFromAlight <= 800,
  )
  // A two-transfer DFS grows quickly with dense physical-stop data. When a
  // good direct route already exists, one-transfer alternatives are enough.
  const maxTransfers = tripDist >= LONG_TRIP_METERS && !hasGoodDirect ? 2 : 1
  const multi  = findMultiTransfer(routes, fromLat, fromLng, toLat, toLng, maxTransfers)

  const directRouteIds = new Set(direct.map(d => d.route._id))

  const by1 = multi
    .filter(j => j.transferCount === 1 && j.segments.some(s => !directRouteIds.has(s.route._id)))
    .slice(0, MAX_PER_LEVEL[1])

  const by2 = maxTransfers >= 2
    ? multi.filter(j => j.transferCount === 2).slice(0, MAX_PER_LEVEL[2])
    : []

  const allJourneys: JourneyOption[] = [
    ...direct.slice(0, MAX_DIRECT),
    ...by1, ...by2,
  ]

  // ── Fetch live traffic for all unique routes in parallel ───────────────────
  const usedRouteIds = new Set<string>()
  for (const j of allJourneys) {
    if (j.type === 'direct') usedRouteIds.add(j.route._id)
    else j.segments.forEach(s => usedRouteIds.add(s.route._id))
  }

  const trafficMap = new Map<string, CongMap>()
  await Promise.all([...usedRouteIds].map(async rid => {
    try {
      const segs = await getLiveTraffic(rid, departureTime)
      trafficMap.set(rid, new Map(segs.map(s => [`${s.fromOrder}_${s.toOrder}`, s.congestionLevel])))
    } catch {
      trafficMap.set(rid, new Map())
    }
  }))

  // ── Attach ETA to each journey ─────────────────────────────────────────────
  for (const j of allJourneys) {
    let busSecs  = 0
    let walkSecs = 0

    if (j.type === 'direct') {
      const route  = routeMap.get(j.route._id)
      const cong   = trafficMap.get(j.route._id) ?? new Map()
      if (route) {
        const bi = route.stops.findIndex(s => s._id === j.boardStop._id)
        const ai = route.stops.findIndex(s => s._id === j.alightStop._id)
        if (bi >= 0 && ai > bi) {
          busSecs = busTravelSecs(route, bi, ai, cong)
        } else {
          console.warn(`[ETA] direct: stop lookup failed for route ${j.route._id} (bi=${bi} ai=${ai}), using stopsCount×108 fallback`)
          busSecs = j.stopsCount * 108
        }
      } else {
        console.warn(`[ETA] direct: route ${j.route._id} not found in routeMap, using stopsCount×108 fallback`)
        busSecs = j.stopsCount * 108
      }
      walkSecs = (j.walkToBoard + j.walkFromAlight) / WALK_MPS

      const { etaMin, etaMax } = etaRange(busSecs + walkSecs)
      j.etaMin = etaMin
      j.etaMax = etaMax
    } else {
      for (const seg of j.segments) {
        const route = routeMap.get(seg.route._id)
        const cong  = trafficMap.get(seg.route._id) ?? new Map()
        if (route) {
          const bi = route.stops.findIndex(s => s._id === seg.boardStop._id)
          const ai = route.stops.findIndex(s => s._id === seg.alightStop._id)
          if (bi >= 0 && ai > bi) {
            busSecs += busTravelSecs(route, bi, ai, cong)
          } else {
            console.warn(`[ETA] multi seg: stop lookup failed for route ${seg.route._id} (bi=${bi} ai=${ai}), using stopsCount×108 fallback`)
            busSecs += seg.stopsCount * 108
          }
        } else {
          console.warn(`[ETA] multi seg: route ${seg.route._id} not found in routeMap, using stopsCount×108 fallback`)
          busSecs += seg.stopsCount * 108
        }
      }
      const totalWalk = j.walkToBoard + j.walkFromAlight + j.transferWalks.reduce((s, v) => s + v, 0)
      walkSecs = totalWalk / WALK_MPS
      const { etaMin, etaMax } = etaRange(busSecs + walkSecs)
      j.etaMin = etaMin
      j.etaMax = etaMax
    }
  }

  for (const j of allJourneys) {
    j.scoreBreakdown = buildScoreBreakdown(j)
  }

  return allJourneys.sort((a, b) => {
    const aScore = a.scoreBreakdown?.totalScore ?? Number.POSITIVE_INFINITY
    const bScore = b.scoreBreakdown?.totalScore ?? Number.POSITIVE_INFINITY
    if (aScore !== bScore) return aScore - bScore
    return totalWalkJourney(a) - totalWalkJourney(b)
  })
}
