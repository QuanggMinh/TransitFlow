import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import dotenv from 'dotenv'
import mongoose from 'mongoose'

dotenv.config({ path: 'server/.env.local' })
dotenv.config({ path: 'server/.env' })
process.env.TOMTOM_API_KEY = ''

const baseUri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/transitflow'
const source = JSON.parse(await readFile('server/data/transit-data.json', 'utf8'))
const sizes = [21, 50, 100]
const departureAt = new Date('2026-07-07T08:00:00+07:00')

const [routeModule, stopModule, routeStopModule, journeyModule, trafficModule] = await Promise.all([
  import('./server/dist/models/Route.js'),
  import('./server/dist/models/Stop.js'),
  import('./server/dist/models/RouteStop.js'),
  import('./server/dist/services/journeyService.js'),
  import('./server/dist/services/liveTrafficService.js'),
])

const Route = routeModule.default.default
const Stop = stopModule.default.default
const RouteStop = routeStopModule.default.default
const { findJourneys } = journeyModule
const { clearTrafficCache } = trafficModule

const cases = [
  [21.048159, 105.878495, 20.949808, 105.747402],
  [21.028882, 105.804057, 21.214417, 105.801263],
  [21.02851, 105.77826, 21.0482, 105.878467],
  [21.0285, 105.8542, 21.0045, 105.8443],
  [20.949979, 105.747619, 21.0919998, 105.862691],
]

function databaseUri(databaseName) {
  const parsed = new URL(baseUri)
  parsed.pathname = `/${databaseName}`
  return parsed.toString()
}

function sourceStopKey(stop) {
  return stop.sourceKey ?? `${stop.name}:${stop.lat.toFixed(6)}:${stop.lng.toFixed(6)}`
}

function buildFixture(targetRoutes) {
  const routeDocs = []
  const stopDocs = []
  const routeStopDocs = []
  const stopsByLayerAndSource = new Map()

  for (let routeIndex = 0; routeIndex < targetRoutes; routeIndex += 1) {
    const template = source.routes[routeIndex % source.routes.length]
    const layer = Math.floor(routeIndex / source.routes.length)
    const routeId = new mongoose.Types.ObjectId()
    routeDocs.push({
      _id: routeId,
      code: `PERF_${targetRoutes}_${routeIndex}`,
      name: `[PERF ${targetRoutes}/${routeIndex}] ${template.name}`,
      color: template.color,
      status: template.status,
      startTime: template.startTime,
      endTime: template.endTime,
      frequency: template.frequency,
      price: template.price,
    })

    template.stops.forEach((templateStop, order) => {
      const key = `${layer}:${sourceStopKey(templateStop)}`
      let stopId = stopsByLayerAndSource.get(key)
      if (!stopId) {
        stopId = new mongoose.Types.ObjectId()
        stopsByLayerAndSource.set(key, stopId)
        // Each layer represents another nearby part of the expanded network.
        const coordinateOffset = layer * 0.02
        stopDocs.push({
          _id: stopId,
          sourceKey: `perf:${targetRoutes}:${key}`,
          name: layer === 0 ? templateStop.name : `${templateStop.name} (vùng ${layer + 1})`,
          address: templateStop.address ?? '',
          lat: templateStop.lat + coordinateOffset,
          lng: templateStop.lng + coordinateOffset,
        })
      }
      routeStopDocs.push({
        routeId,
        stopId,
        order,
        distanceFromPrev: 0,
        managedBy: 'sync',
        syncKey: `perf:${targetRoutes}:${routeIndex}:${order}`,
      })
    })
  }

  return { routeDocs, stopDocs, routeStopDocs }
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

async function runSearch(index) {
  const [fromLat, fromLng, toLat, toLng] = cases[index % cases.length]
  const started = performance.now()
  try {
    const journeys = await findJourneys(fromLat, fromLng, toLat, toLng, departureAt)
    return { ok: true, latencyMs: performance.now() - started, journeys: journeys.length }
  } catch (error) {
    return { ok: false, latencyMs: performance.now() - started, journeys: 0, error: error?.message }
  }
}

async function benchmark(concurrency, totalRequests) {
  const results = []
  let nextIndex = 0
  const started = performance.now()

  async function worker() {
    while (true) {
      const index = nextIndex++
      if (index >= totalRequests) return
      results.push(await runSearch(index))
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const elapsedSeconds = (performance.now() - started) / 1000
  const latencies = results.map((item) => item.latencyMs).sort((a, b) => a - b)
  const failures = results.filter((item) => !item.ok)

  return {
    concurrency,
    samples: results.length,
    averageMs: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
    requestsPerSecond: Number((results.length / elapsedSeconds).toFixed(2)),
    errorRatePercent: Number(((failures.length / results.length) * 100).toFixed(2)),
    averageOptions: Number((results.reduce((sum, item) => sum + item.journeys, 0) / results.length).toFixed(2)),
  }
}

const report = []
for (const targetRoutes of sizes) {
  const databaseName = `transitflow_perf_${process.pid}_${targetRoutes}`
  assert.match(databaseName, /^transitflow_perf_\d+_(21|50|100)$/)
  const fixture = buildFixture(targetRoutes)
  const buildStarted = performance.now()

  try {
    await mongoose.connect(databaseUri(databaseName), { autoIndex: false })
    assert.equal(mongoose.connection.name, databaseName)
    await Route.insertMany(fixture.routeDocs, { ordered: false })
    await Stop.insertMany(fixture.stopDocs, { ordered: false })
    await RouteStop.insertMany(fixture.routeStopDocs, { ordered: false })
    await Promise.all([
      Route.collection.createIndex({ code: 1 }, { unique: true, sparse: true }),
      Stop.collection.createIndex({ sourceKey: 1 }, { unique: true, sparse: true }),
      RouteStop.collection.createIndex({ routeId: 1, order: 1 }),
      RouteStop.collection.createIndex({ syncKey: 1 }, { unique: true, sparse: true }),
    ])
    const buildMs = performance.now() - buildStarted
    clearTrafficCache()

    // Warm Mongoose population, query plans, and application code paths.
    await runSearch(0)
    const singleUser = await benchmark(1, 10)
    const tenUsers = await benchmark(10, 20)
    const counts = {
      routes: await Route.countDocuments(),
      stops: await Stop.countDocuments(),
      routeStops: await RouteStop.countDocuments(),
    }

    const row = {
      dataset: targetRoutes === 21 ? 'repository-source' : `synthetic-${targetRoutes}`,
      ...counts,
      buildMs: Number(buildMs.toFixed(2)),
      singleUser,
      tenUsers,
    }
    report.push(row)
    console.log(JSON.stringify(row))
  } finally {
    if (mongoose.connection.readyState !== 0) {
      assert.match(mongoose.connection.name, /^transitflow_perf_/)
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  }
}

console.log(JSON.stringify({ sourceVersion: source.version, report }, null, 2))
