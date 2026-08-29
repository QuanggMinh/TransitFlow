import './config/env'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import mongoose from 'mongoose'

import routeRoutes from './routes/routeRoutes'
import stopRoutes from './routes/stopRoutes'
import etaRoutes from './routes/etaRoutes'
import journeyRoutes from './routes/journeyRoutes'
import geoRoutes from './routes/geoRoutes'
import adminRoutes from './routes/adminRoutes'
import mapTileRoutes from './routes/mapTileRoutes'
import { notFound, errorHandler } from './middleware/errorHandler'
import { assertDatabaseReady } from './database/readiness'

const app = express()
const PORT = process.env.PORT || 5000
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/transitflow'
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
)

// Middleware
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(helmet())
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    // Requests from server-side tools do not include Origin.
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true)
      return
    }
    const error = new Error('Origin is not allowed by CORS') as Error & { status?: number }
    error.status = 403
    callback(error)
  },
}))
app.use(express.json({ limit: '50kb' }))
// Map tiles are proxied separately so normal API rate limits do not break Leaflet rendering.
app.use('/map-tiles', mapTileRoutes)
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
}))
app.use('/api/geo', rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many geocoding requests, please try again later' },
}))

// Health check
app.get('/health', (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'ok' : 'degraded',
    database: databaseReady ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  })
})

// Routes
app.use('/api/routes', routeRoutes)
app.use('/api/stops', stopRoutes)
app.use('/api/eta', etaRoutes)
app.use('/api/journey', journeyRoutes)
app.use('/api/geo', geoRoutes)
app.use('/api/admin', adminRoutes)

// Error handlers
app.use(notFound)
app.use(errorHandler)

// Connect to MongoDB & start server
mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    const database = mongoose.connection.db
    if (!database) throw new Error('Database unavailable')
    await assertDatabaseReady(database)
    console.log('✅ Connected to MongoDB')
    app.listen(PORT, () => {
      console.log(`🚌 TransitFlow server running on http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('TransitFlow startup failed:', err)
    console.error('Run "npm run setup:local" and start the server again.')
    process.exit(1)
  })

export default app
