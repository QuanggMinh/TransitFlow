import { Router, Request, Response } from 'express'
import Route from '../models/Route'
import RouteStop from '../models/RouteStop'
import { getRouteGeometry } from '../services/geometryService'
import { getLiveTraffic, getTrafficSource } from '../services/liveTrafficService'

const router = Router()

// GET /api/routes
router.get('/', async (req: Request, res: Response) => {
  try {
    const routes = await Route.find()
    res.json({ success: true, data: routes })
  } catch {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// GET /api/routes/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const route = await Route.findById(req.params.id)
    if (!route) return res.status(404).json({ success: false, message: 'Route not found' })
    res.json({ success: true, data: route })
  } catch {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// GET /api/routes/:id/stops
router.get('/:id/stops', async (req: Request, res: Response) => {
  try {
    const stops = await RouteStop.find({ routeId: req.params.id })
      .sort({ order: 1 })
      .populate('stopId')
    res.json({ success: true, data: stops })
  } catch {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// GET /api/routes/:id/segments — live traffic congestion per segment
router.get('/:id/segments', async (req: Request, res: Response) => {
  try {
    const routeStops = await RouteStop.find({ routeId: req.params.id })
      .sort({ order: 1 })
      .populate('stopId')

    const liveSegments = await getLiveTraffic(req.params.id)
    const liveMap = new Map(liveSegments.map((s) => [`${s.fromOrder}-${s.toOrder}`, s]))

    const segments = routeStops.slice(0, -1).map((rs, i) => {
      const next = routeStops[i + 1]
      const live = liveMap.get(`${rs.order}-${next.order}`)
      return {
        fromOrder:      rs.order,
        toOrder:        next.order,
        fromStop:       rs.stopId,
        toStop:         next.stopId,
        congestionLevel: live?.congestionLevel ?? 0.2,
        source:         live?.source ?? 'simulation',
        baseTime:       0,
      }
    })

    res.json({
      success: true,
      data: segments,
      meta: {
        source:     getTrafficSource(),
        cachedSecs: 300,
        updatedAt:  new Date().toISOString(),
      },
    })
  } catch {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// GET /api/routes/:id/geometry
router.get('/:id/geometry', async (req: Request, res: Response) => {
  try {
    const segs = await getRouteGeometry(req.params.id)
    res.json({ success: true, data: segs })
  } catch {
    res.status(500).json({ success: false, message: 'Không thể lấy geometry tuyến đường' })
  }
})

export default router
