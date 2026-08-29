import { Router, Request, Response } from 'express'
import Stop from '../models/Stop'

const router = Router()

// GET /api/stops - lấy tất cả trạm
router.get('/', async (req: Request, res: Response) => {
  try {
    const stops = await Stop.find()
    res.json({ success: true, data: stops })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// GET /api/stops/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const stop = await Stop.findById(req.params.id)
    if (!stop) return res.status(404).json({ success: false, message: 'Stop not found' })
    res.json({ success: true, data: stop })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

export default router
