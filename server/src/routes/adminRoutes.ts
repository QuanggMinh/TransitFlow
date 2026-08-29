import { NextFunction, Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import mongoose from 'mongoose'
import Route from '../models/Route'
import Stop from '../models/Stop'
import RouteStop from '../models/RouteStop'
import Bus from '../models/Bus'
import BusLocation from '../models/BusLocation'
import TrafficSegment from '../models/TrafficSegment'
import {
  adminAuthConfigured,
  clearSession,
  createAdminSession,
  requireAdmin,
  sessionCookie,
} from '../middleware/adminAuth'
import { clearTrafficCache } from '../services/liveTrafficService'
import {
  addStopToRoute,
  getOrderedRouteStops,
  normalizeRouteStopSequence,
  removeStopFromRoute,
  replaceRouteStops,
  reorderRouteStops,
} from '../services/routeStopAdminService'

const router = Router()

function asyncHandler(
  handler: (req: Request, res: Response) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next)
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again later' },
})

function objectId(value: string): boolean {
  return mongoose.isValidObjectId(value)
}

function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length >= min && normalized.length <= max ? normalized : null
}

function numeric(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

router.post('/auth/login', loginLimiter, (req: Request, res: Response) => {
  if (!adminAuthConfigured()) {
    res.status(503).json({
      success: false,
      message: 'Admin login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD.',
    })
    return
  }

  const username = typeof req.body?.username === 'string' ? req.body.username : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const token = createAdminSession(username, password)
  if (!token) {
    res.status(401).json({ success: false, message: 'Invalid administrator credentials' })
    return
  }

  res.setHeader('Set-Cookie', sessionCookie(token))
  res.json({ success: true, data: { username } })
})

router.post('/auth/logout', (req: Request, res: Response) => {
  res.setHeader('Set-Cookie', clearSession(req))
  res.json({ success: true })
})

router.get('/auth/session', requireAdmin, (req: Request, res: Response) => {
  res.json({ success: true, data: { username: res.locals.adminUsername } })
})

router.use(requireAdmin)

router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const [routes, activeRoutes, stops, routeStops] = await Promise.all([
    Route.countDocuments(),
    Route.countDocuments({ status: 'active' }),
    Stop.countDocuments(),
    RouteStop.countDocuments(),
  ])
  res.json({ success: true, data: { routes, activeRoutes, stops, routeStops } })
}))

router.get('/routes', asyncHandler(async (req: Request, res: Response) => {
  const routes = await Route.find().sort({ name: 1 }).lean()
  res.json({ success: true, data: routes })
}))

router.post('/routes', asyncHandler(async (req: Request, res: Response) => {
  const name = text(req.body.name, 2, 200)
  const color = typeof req.body.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(req.body.color)
    ? req.body.color.toUpperCase()
    : null
  const status = req.body.status === 'active' || req.body.status === 'inactive'
    ? req.body.status
    : null
  const frequency = numeric(req.body.frequency, 1, 360)
  const price = numeric(req.body.price, 0, 1_000_000)

  if (!name || !color || !status || !validTime(req.body.startTime) || !validTime(req.body.endTime) ||
      frequency === null || price === null) {
    res.status(400).json({ success: false, message: 'Route information is invalid or incomplete' })
    return
  }

  try {
    const route = await Route.create({
      name,
      color,
      status,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      frequency,
      price,
    })
    res.status(201).json({ success: true, data: route })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return res.status(409).json({ success: false, message: 'Route name already exists' })
    }
    throw error
  }
}))

router.get('/routes/:id/stops', asyncHandler(async (req: Request, res: Response) => {
  if (!objectId(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid route ID' })
    return
  }
  const routeExists = await Route.exists({ _id: req.params.id })
  if (!routeExists) {
    res.status(404).json({ success: false, message: 'Route not found' })
    return
  }
  const routeStops = await getOrderedRouteStops(req.params.id)
  res.json({ success: true, data: routeStops })
}))

router.post('/routes/:id/stops', asyncHandler(async (req: Request, res: Response) => {
  if (!objectId(req.params.id) || !objectId(String(req.body.stopId ?? ''))) {
    res.status(400).json({ success: false, message: 'Route ID or stop ID is invalid' })
    return
  }
  const [routeExists, stopExists] = await Promise.all([
    Route.exists({ _id: req.params.id }),
    Stop.exists({ _id: req.body.stopId }),
  ])
  if (!routeExists || !stopExists) {
    res.status(404).json({ success: false, message: 'Route or stop not found' })
    return
  }

  const position = req.body.position === undefined
    ? undefined
    : numeric(req.body.position, 0, 10_000)
  if (req.body.position !== undefined && (position === null || !Number.isInteger(position))) {
    res.status(400).json({ success: false, message: 'Insertion position is invalid' })
    return
  }

  try {
    const routeStops = await addStopToRoute(req.params.id, req.body.stopId, position ?? undefined)
    clearTrafficCache([req.params.id])
    res.status(201).json({ success: true, data: routeStops })
  } catch (error) {
    if ((error as Error).message === 'STOP_ALREADY_ASSIGNED' || (error as { code?: number }).code === 11000) {
      return res.status(409).json({ success: false, message: 'Stop is already assigned to this route' })
    }
    throw error
  }
}))

router.delete('/routes/:id/stops/:routeStopId', asyncHandler(async (req: Request, res: Response) => {
  if (!objectId(req.params.id) || !objectId(req.params.routeStopId)) {
    res.status(400).json({ success: false, message: 'Route ID or route-stop ID is invalid' })
    return
  }
  const routeStops = await removeStopFromRoute(req.params.id, req.params.routeStopId)
  if (!routeStops) {
    res.status(404).json({ success: false, message: 'Route-stop relationship not found' })
    return
  }
  clearTrafficCache([req.params.id])
  res.json({ success: true, data: routeStops })
}))

router.put('/routes/:id/stops/reorder', asyncHandler(async (req: Request, res: Response) => {
  if (!objectId(req.params.id) || !Array.isArray(req.body.routeStopIds)) {
    res.status(400).json({ success: false, message: 'Route ID or route-stop sequence is invalid' })
    return
  }
  const routeStopIds = req.body.routeStopIds.map(String)
  if (routeStopIds.some((id: string) => !objectId(id))) {
    res.status(400).json({ success: false, message: 'Route-stop sequence contains an invalid ID' })
    return
  }
  try {
    const routeStops = await reorderRouteStops(req.params.id, routeStopIds)
    clearTrafficCache([req.params.id])
    res.json({ success: true, data: routeStops })
  } catch (error) {
    if ((error as Error).message === 'INVALID_ROUTE_STOP_SEQUENCE') {
      return res.status(400).json({ success: false, message: 'Route-stop sequence must contain every current stop exactly once' })
    }
    throw error
  }
}))

router.put('/routes/:id/stops', asyncHandler(async (req: Request, res: Response) => {
  if (
    !objectId(req.params.id) ||
    !Array.isArray(req.body.stopIds) ||
    !Array.isArray(req.body.expectedRouteStopIds) ||
    req.body.stopIds.length > 1_000
  ) {
    res.status(400).json({ success: false, message: 'Route-stop draft is invalid' })
    return
  }
  const stopIds = req.body.stopIds.map(String)
  const expectedRouteStopIds = req.body.expectedRouteStopIds.map(String)
  if (
    stopIds.some((id: string) => !objectId(id)) ||
    expectedRouteStopIds.some((id: string) => !objectId(id))
  ) {
    res.status(400).json({ success: false, message: 'Route-stop draft contains an invalid ID' })
    return
  }
  if (!await Route.exists({ _id: req.params.id })) {
    res.status(404).json({ success: false, message: 'Route not found' })
    return
  }

  try {
    const routeStops = await replaceRouteStops(
      req.params.id,
      stopIds,
      expectedRouteStopIds,
    )
    clearTrafficCache([req.params.id])
    res.json({ success: true, data: routeStops })
  } catch (error) {
    if ((error as Error).message === 'ROUTE_STOP_SEQUENCE_CHANGED') {
      return res.status(409).json({
        success: false,
        message: 'Route stops changed elsewhere. Reload the route before saving.',
      })
    }
    if ((error as Error).message === 'STOP_NOT_FOUND') {
      return res.status(400).json({ success: false, message: 'A selected stop no longer exists' })
    }
    throw error
  }
}))

router.patch('/routes/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!objectId(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid route ID' })
    return
  }

  const update: Record<string, string | number> = {}

  if (req.body.name !== undefined) {
    const value = text(req.body.name, 2, 200)
    if (!value) return res.status(400).json({ success: false, message: 'Route name is invalid' })
    update.name = value
  }
  if (req.body.color !== undefined) {
    if (typeof req.body.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(req.body.color)) {
      return res.status(400).json({ success: false, message: 'Route color must be a hex color' })
    }
    update.color = req.body.color.toUpperCase()
  }
  if (req.body.status !== undefined) {
    if (req.body.status !== 'active' && req.body.status !== 'inactive') {
      return res.status(400).json({ success: false, message: 'Route status is invalid' })
    }
    update.status = req.body.status
  }
  if (req.body.startTime !== undefined) {
    if (!validTime(req.body.startTime)) {
      return res.status(400).json({ success: false, message: 'Start time is invalid' })
    }
    update.startTime = req.body.startTime
  }
  if (req.body.endTime !== undefined) {
    if (!validTime(req.body.endTime)) {
      return res.status(400).json({ success: false, message: 'End time is invalid' })
    }
    update.endTime = req.body.endTime
  }
  if (req.body.frequency !== undefined) {
    const value = numeric(req.body.frequency, 1, 360)
    if (value === null) return res.status(400).json({ success: false, message: 'Frequency is invalid' })
    update.frequency = value
  }
  if (req.body.price !== undefined) {
    const value = numeric(req.body.price, 0, 1_000_000)
    if (value === null) return res.status(400).json({ success: false, message: 'Price is invalid' })
    update.price = value
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ success: false, message: 'No valid route fields were provided' })
    return
  }

  try {
    const route = await Route.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    })
    if (!route) return res.status(404).json({ success: false, message: 'Route not found' })
    res.json({ success: true, data: route })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return res.status(409).json({ success: false, message: 'Route name already exists' })
    }
    res.status(500).json({ success: false, message: 'Unable to update route' })
  }
}))

router.delete('/routes/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!objectId(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid route ID' })
    return
  }

  const route = await Route.findById(req.params.id).select('_id code').lean()
  if (!route) {
    res.status(404).json({ success: false, message: 'Route not found' })
    return
  }

  const buses = await Bus.find({ routeId: route._id }).select('_id').lean()
  const busIds = buses.map((bus) => bus._id)
  const [busLocationsResult, routeStopsResult, busesResult] = await Promise.all([
    busIds.length > 0
      ? BusLocation.deleteMany({ busId: { $in: busIds } })
      : Promise.resolve({ deletedCount: 0 }),
    RouteStop.deleteMany({ routeId: route._id }),
    Bus.deleteMany({ routeId: route._id }),
  ])
  await Route.deleteOne({ _id: route._id })
  clearTrafficCache([req.params.id])

  res.json({
    success: true,
    data: {
      id: req.params.id,
      sourceManaged: Boolean(route.code),
      deleted: {
        routeStops: routeStopsResult.deletedCount,
        buses: busesResult.deletedCount,
        busLocations: busLocationsResult.deletedCount,
      },
    },
  })
}))

router.get('/stops', asyncHandler(async (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '30'), 10) || 30))
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const filter = query
    ? { $or: [{ name: { $regex: escaped, $options: 'i' } }, { address: { $regex: escaped, $options: 'i' } }] }
    : {}

  const [stops, total] = await Promise.all([
    Stop.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Stop.countDocuments(filter),
  ])

  res.json({
    success: true,
    data: stops,
    meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  })
}))

router.post('/stops', asyncHandler(async (req: Request, res: Response) => {
  const name = text(req.body.name, 2, 200)
  const address = text(req.body.address ?? '', 0, 300)
  const lat = numeric(req.body.lat, -90, 90)
  const lng = numeric(req.body.lng, -180, 180)

  if (!name || address === null || lat === null || lng === null) {
    res.status(400).json({ success: false, message: 'Stop information is invalid or incomplete' })
    return
  }

  const stop = await Stop.create({ name, address, lat, lng })
  res.status(201).json({ success: true, data: stop })
}))

router.patch('/stops/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!objectId(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid stop ID' })
    return
  }

  const update: Record<string, string | number> = {}
  if (req.body.name !== undefined) {
    const value = text(req.body.name, 2, 200)
    if (!value) return res.status(400).json({ success: false, message: 'Stop name is invalid' })
    update.name = value
  }
  if (req.body.address !== undefined) {
    const value = text(req.body.address, 0, 300)
    if (value === null) return res.status(400).json({ success: false, message: 'Address is invalid' })
    update.address = value
  }
  if (req.body.lat !== undefined) {
    const value = numeric(req.body.lat, -90, 90)
    if (value === null) return res.status(400).json({ success: false, message: 'Latitude is invalid' })
    update.lat = value
  }
  if (req.body.lng !== undefined) {
    const value = numeric(req.body.lng, -180, 180)
    if (value === null) return res.status(400).json({ success: false, message: 'Longitude is invalid' })
    update.lng = value
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ success: false, message: 'No valid stop fields were provided' })
    return
  }

  const stop = await Stop.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  })
  if (!stop) {
    res.status(404).json({ success: false, message: 'Stop not found' })
    return
  }

  if (update.lat !== undefined || update.lng !== undefined) {
    const affected = await RouteStop.find({ stopId: stop._id }).select('routeId').lean()
    clearTrafficCache(affected.map((item) => String(item.routeId)))
  }

  res.json({ success: true, data: stop })
}))

router.delete('/stops/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!objectId(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid stop ID' })
    return
  }

  const stop = await Stop.findById(req.params.id).select('_id sourceKey').lean()
  if (!stop) {
    res.status(404).json({ success: false, message: 'Stop not found' })
    return
  }

  const assignments = await RouteStop.find({ stopId: stop._id }).select('routeId').lean()
  const affectedRouteIds = [...new Set(assignments.map((item) => String(item.routeId)))]
  const [routeStopsResult, trafficSegmentsResult] = await Promise.all([
    RouteStop.deleteMany({ stopId: stop._id }),
    TrafficSegment.deleteMany({
      $or: [{ fromStopId: stop._id }, { toStopId: stop._id }],
    }),
  ])
  await Stop.deleteOne({ _id: stop._id })
  await Promise.all(affectedRouteIds.map((routeId) => normalizeRouteStopSequence(routeId)))
  clearTrafficCache(affectedRouteIds)

  res.json({
    success: true,
    data: {
      id: req.params.id,
      sourceManaged: Boolean(stop.sourceKey),
      affectedRoutes: affectedRouteIds.length,
      deleted: {
        routeStops: routeStopsResult.deletedCount,
        trafficSegments: trafficSegmentsResult.deletedCount,
      },
    },
  })
}))

export default router
