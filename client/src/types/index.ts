export interface Route {
  _id: string
  name: string
  color: string
  status: 'active' | 'inactive'
  startTime: string
  endTime: string
  frequency: number
  price: number
}

export interface Stop {
  _id: string
  name: string
  lat: number
  lng: number
  address: string
}

export interface RouteStop {
  _id: string
  routeId: string
  stopId: Stop
  order: number
  distanceFromPrev: number
}

export interface ETAResult {
  busId: string
  licensePlate: string
  currentStopIndex: number
  etaSeconds: number
  etaMinutes: number
  segments: number
  source?: 'live' | 'schedule'
  scheduledDeparture?: string
}

export interface TrafficSegment {
  fromOrder: number
  toOrder: number
  fromStop: Stop
  toStop: Stop
  congestionLevel: number
  baseTime: number
}

export interface SegmentGeometry {
  fromOrder: number
  toOrder: number
  coordinates: [number, number][] // [lat, lng]
  source?: 'stored' | 'osrm' | 'straight-line-fallback'
}

export interface JourneyStop {
  _id: string
  name: string
  lat: number
  lng: number
  address: string
  order: number
}

interface RouteRef {
  _id: string
  name: string
  color: string
  frequency: number
  price: number
}

export interface DirectJourney {
  type: 'direct'
  route: RouteRef
  boardStop: JourneyStop
  alightStop: JourneyStop
  intermediateStops: string[]
  walkToBoard: number
  walkFromAlight: number
  stopsCount: number
  etaMin: number
  etaMax: number
  scoreBreakdown?: JourneyScoreBreakdown
}

export interface JourneySegment {
  route: RouteRef
  boardStop: JourneyStop
  alightStop: JourneyStop
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

export interface GeocodeSuggestion {
  displayName: string
  shortName: string    // tên chính (không bao gồm số nhà, mã bưu chính)
  subtitle: string     // quận/huyện + thành phố
  lat: number
  lng: number
  category?: string    // amenity, highway, ...
}
