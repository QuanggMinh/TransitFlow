import TrafficSegment from '../models/TrafficSegment'
import RouteStop from '../models/RouteStop'
import mongoose from 'mongoose'

/**
 * Công thức ETA:
 * eta = baseTime × (1 + congestionLevel)
 *
 * congestionLevel = 0.0 → eta = baseTime (thông thoáng)
 * congestionLevel = 0.5 → eta = baseTime × 1.5
 * congestionLevel = 1.0 → eta = baseTime × 2 (tắc nặng)
 */
export function calcSegmentETA(baseTime: number, congestionLevel: number): number {
  return Math.round(baseTime * (1 + congestionLevel))
}

/**
 * Tính tổng ETA từ stopIndex hiện tại của xe đến một trạm đích
 */
export async function calcETAToStop(
  routeId: string,
  fromStopIndex: number,
  toStopIndex: number
): Promise<{ etaSeconds: number; etaMinutes: number; etaHours: number; segments: number }> {
  if (fromStopIndex >= toStopIndex) {
    return { etaSeconds: 0, etaMinutes: 0, etaHours: 0, segments: 0 }
  }

  // Lấy danh sách các trạm trong tuyến theo thứ tự
  const routeStops = await RouteStop.find({ routeId })
    .sort({ order: 1 })
    .populate('stopId')

  let totalSeconds = 0
  let segmentCount = 0

  for (let i = fromStopIndex; i < toStopIndex && i < routeStops.length - 1; i++) {
    const currentStop = routeStops[i]
    const nextStop = routeStops[i + 1]

    if (!currentStop || !nextStop) continue

    // Tìm traffic segment giữa 2 trạm
    const traffic = await TrafficSegment.findOne({
      fromStopId: currentStop.stopId,
      toStopId: nextStop.stopId,
    })

    const baseTime = traffic?.baseTime ?? nextStop.distanceFromPrev / 5 // fallback: 5 m/s
    const congestion = traffic?.congestionLevel ?? 0

    totalSeconds += calcSegmentETA(baseTime, congestion)
    segmentCount++
  }

  return {
    etaSeconds: totalSeconds,
    etaMinutes: Math.ceil(totalSeconds / 60),
    etaHours: Math.ceil(totalSeconds / 3600),
    segments: segmentCount,
  }
}
