import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { isValidStopSourceKey } from './sync/keyUtils'

interface RawStop {
  sourceKey: string
  name: string
  lat: number
  lng: number
}

interface RawRoute {
  code: string
  stops: RawStop[]
}

interface RawSource {
  version: number
  routes: RawRoute[]
}

const dataPath = path.resolve(__dirname, '..', 'data', 'transit-data.json')
const manifestPath = path.resolve(
  __dirname,
  '..',
  'data',
  'transit-data.manifest.json',
)

function main() {
  const buffer = fs.readFileSync(dataPath)
  const source = JSON.parse(buffer.toString('utf8')) as RawSource
  if (!Number.isInteger(source.version) || !Array.isArray(source.routes) || source.routes.length === 0) {
    throw new Error('Invalid transit data')
  }

  const routeCodes = new Set<string>()
  const stopKeys = new Set<string>()
  let routeStops = 0
  for (const route of source.routes) {
    if (!route.code || routeCodes.has(route.code) || !Array.isArray(route.stops)) {
      throw new Error(`Duplicate or invalid route code: ${route.code}`)
    }
    routeCodes.add(route.code)
    for (const stop of route.stops) {
      if (!isValidStopSourceKey(stop.sourceKey, stop.name, stop.lat, stop.lng)) {
        throw new Error(`Invalid sourceKey for stop: ${stop.name}`)
      }
      stopKeys.add(stop.sourceKey)
      routeStops += 1
    }
  }

  const manifest = {
    sourceVersion: source.version,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    routes: routeCodes.size,
    uniqueStops: stopKeys.size,
    routeStops,
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.table(manifest)
  console.log(`Updated ${manifestPath}`)
}

main()
