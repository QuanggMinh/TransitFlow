import https from 'https'
import { Router, Request, Response } from 'express'

const router = Router()
const REQUEST_TIMEOUT_MS = 5_000
const PROVIDER_RETRY_MS = 60_000
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 400
const USER_AGENT = process.env.APP_USER_AGENT ?? 'TransitFlow/1.0 (graduation project)'

interface CachedTile {
  body: Buffer
  expiresAt: number
  source: string
}

const cache = new Map<string, CachedTile>()
let providerUnavailableUntil = 0

function cachedTile(key: string): CachedTile | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function storeTile(key: string, body: Buffer, source: string): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, { body, expiresAt: Date.now() + CACHE_TTL_MS, source })
}

function downloadTile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Tile provider returned HTTP ${response.statusCode ?? 'unknown'}`))
          return
        }
        resolve(Buffer.concat(chunks))
      })
    })
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Tile request timeout')))
    request.on('error', reject)
  })
}

function fallbackTile(z: number, x: number, y: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" fill="#e5e7eb"/>
    <path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#d1d5db" stroke-width="1"/>
    <path d="M0 210L74 142L128 174L256 70" fill="none" stroke="#cbd5e1" stroke-width="9"/>
    <text x="128" y="118" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="13">TransitFlow</text>
    <text x="128" y="138" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="10">Bản đồ tạm thời ngoại tuyến · ${z}/${x}/${y}</text>
  </svg>`
}

router.get('/:z/:x/:y.png', async (req: Request, res: Response) => {
  const z = Number(req.params.z)
  const x = Number(req.params.x)
  const y = Number(req.params.y)
  const maxCoordinate = Number.isInteger(z) && z >= 0 && z <= 19 ? 2 ** z : 0
  if (
    !Number.isInteger(x) || !Number.isInteger(y) ||
    x < 0 || y < 0 || x >= maxCoordinate || y >= maxCoordinate
  ) {
    res.status(400).json({ success: false, message: 'Invalid map tile coordinates' })
    return
  }

  const key = `${z}/${x}/${y}`
  const hit = cachedTile(key)
  if (hit) {
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=604800')
    res.setHeader('X-Tile-Source', `${hit.source}-cache`)
    res.send(hit.body)
    return
  }

  if (Date.now() >= providerUnavailableUntil) {
    try {
      const body = await downloadTile(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`)
      storeTile(key, body, 'openstreetmap')
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'public, max-age=604800')
      res.setHeader('X-Tile-Source', 'openstreetmap')
      res.send(body)
      return
    } catch {
      providerUnavailableUntil = Date.now() + PROVIDER_RETRY_MS
    }
  }

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=60')
  res.setHeader('X-Tile-Source', 'offline-fallback')
  res.send(fallbackTile(z, x, y))
})

export default router
