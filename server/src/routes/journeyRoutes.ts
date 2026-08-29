import { Router, Request, Response } from 'express'
import { findJourneys } from '../services/journeyService'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  const { fromLat, fromLng, toLat, toLng, departureAt } = req.query

  if (!fromLat || !fromLng || !toLat || !toLng) {
    res.status(400).json({ success: false, message: 'Thiếu tham số: fromLat, fromLng, toLat, toLng' })
    return
  }

  const coords = [fromLat, fromLng, toLat, toLng].map(Number)
  if (coords.some(isNaN)) {
    res.status(400).json({ success: false, message: 'Tọa độ không hợp lệ' })
    return
  }

  let departureTime: Date | undefined
  if (typeof departureAt === 'string' && /^\d{2}:\d{2}$/.test(departureAt)) {
    const [h, m] = departureAt.split(':').map(Number)
    departureTime = new Date()
    departureTime.setHours(h, m, 0, 0)
  }

  try {
    const journeys = await findJourneys(coords[0], coords[1], coords[2], coords[3], departureTime)
    res.json({ success: true, data: journeys })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi server khi tìm hành trình' })
  }
})

export default router
