import { Router, Request, Response } from 'express'
import Bus from '../models/Bus'
import BusLocation from '../models/BusLocation'
import Route from '../models/Route'
import { calcETAToStop } from '../services/etaService'

const router = Router()

function upcomingDepartures(
  startTime: string,
  endTime: string,
  frequency: number,
  now = new Date(),
  count = 2,
): Date[] {
  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)
  const startMinutes = startHour * 60 + startMinute
  const endMinutes = endHour * 60 + endMinute
  if (
    !Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) ||
    !Number.isFinite(frequency) || frequency <= 0
  ) return []

  const departures: Date[] = []
  for (let dayOffset = 0; dayOffset < 3 && departures.length < count; dayOffset += 1) {
    const day = new Date(now)
    day.setDate(now.getDate() + dayOffset)
    day.setHours(0, 0, 0, 0)

    for (let minute = startMinutes; minute <= endMinutes; minute += frequency) {
      const departure = new Date(day.getTime() + minute * 60_000)
      if (departure >= now) departures.push(departure)
      if (departures.length >= count) break
    }
  }
  return departures
}

/**
 * GET /api/eta?routeId=xxx&targetStopIndex=5
 * Tính ETA cho tất cả xe trong tuyến đến trạm đích
 */
router.get('/', async (req: Request, res: Response) => {
  const { routeId, targetStopIndex } = req.query

  if (!routeId || targetStopIndex === undefined) {
    return res.status(400).json({ success: false, message: 'Missing routeId or targetStopIndex' })
  }

  const parsedIdx = Number(targetStopIndex)
  if (!Number.isFinite(parsedIdx) || !Number.isInteger(parsedIdx) || parsedIdx < 0) {
    return res.status(400).json({ success: false, message: 'targetStopIndex must be a non-negative integer' })
  }

  try {
    const [route, buses] = await Promise.all([
      Route.findById(routeId),
      Bus.find({ routeId, status: 'running' }),
    ])
    if (!route) {
      return res.status(404).json({ success: false, message: 'Route not found' })
    }

    const results = await Promise.all(
      buses.map(async (bus) => {
        // Lấy vị trí mới nhất của xe
        const loc = await BusLocation.findOne({ busId: bus._id }).sort({ timestamp: -1 })
        if (!loc) return null

        const eta = await calcETAToStop(
          routeId as string,
          loc.currentStopIndex,
          parsedIdx
        )

        return {
          busId: bus._id,
          licensePlate: bus.licensePlate,
          currentStopIndex: loc.currentStopIndex,
          source: 'live' as const,
          ...eta,
        }
      })
    )

    const validResults = results
      .filter(Boolean)
      .sort((a, b) => (a?.etaSeconds ?? 0) - (b?.etaSeconds ?? 0))

    if (validResults.length === 0) {
      const travel = await calcETAToStop(routeId as string, 0, parsedIdx)
      const now = new Date()
      const scheduledResults = upcomingDepartures(
        route.startTime,
        route.endTime,
        route.frequency,
        now,
      ).map((departure) => {
        const waitSeconds = Math.max(0, Math.round((departure.getTime() - now.getTime()) / 1000))
        const etaSeconds = waitSeconds + travel.etaSeconds
        return {
          busId: `schedule:${route.id}:${departure.getTime()}`,
          licensePlate: 'Ước tính theo lịch',
          currentStopIndex: -1,
          source: 'schedule' as const,
          scheduledDeparture: departure.toISOString(),
          etaSeconds,
          etaMinutes: Math.ceil(etaSeconds / 60),
          etaHours: Math.ceil(etaSeconds / 3600),
          segments: travel.segments,
        }
      })

      return res.json({ success: true, data: scheduledResults })
    }

    res.json({ success: true, data: validResults })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

export default router
