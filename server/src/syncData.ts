import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import mongoose from 'mongoose'
import './config/env'
import Route from './models/Route'
import Stop from './models/Stop'
import RouteStop from './models/RouteStop'
import { isValidStopSourceKey, stopSourceKey } from './sync/keyUtils'

export interface SourceStop {
  sourceKey: string
  name: string
  address: string
  lat: number
  lng: number
}

export interface SourceRoute {
  code: string
  name: string
  color: string
  status: 'active' | 'inactive'
  startTime: string
  endTime: string
  frequency: number
  price: number
  stops: SourceStop[]
}

export interface TransitSource {
  version: number
  routes: SourceRoute[]
}

interface TransitManifest {
  sourceVersion: number
  sha256: string
  routes: number
  uniqueStops: number
  routeStops: number
}

export interface SyncSummary {
  routesCreated: number
  routesUpdated: number
  stopsCreated: number
  stopsUpdated: number
  stopsDeleted: number
  duplicateStopsMerged: number
  routeStopsCreated: number
  routeStopsUpdated: number
  routeStopsDeleted: number
  routeStopsPreserved: number
  legacyUniqueIndexRemoved: boolean
}

export const defaultSourcePath = path.resolve(__dirname, '..', 'data', 'transit-data.json')
export const defaultManifestPath = path.resolve(
  __dirname,
  '..',
  'data',
  'transit-data.manifest.json',
)

export function readTransitSource(sourcePath = defaultSourcePath): TransitSource {
  const sourceBuffer = fs.readFileSync(sourcePath)
  const source = JSON.parse(sourceBuffer.toString('utf8')) as TransitSource
  if (source.version !== 1 || !Array.isArray(source.routes)) {
    throw new Error('Unsupported or invalid transit data file')
  }
  if (source.routes.length === 0) throw new Error('Transit data contains no routes')

  const routeCodes = new Set<string>()
  const stops = new Map<string, { lat: number; lng: number }>()
  for (const route of source.routes) {
    if (!route.code || routeCodes.has(route.code)) {
      throw new Error(`Duplicate or missing route code: ${route.code}`)
    }
    routeCodes.add(route.code)

    for (const stop of route.stops) {
      if (!isValidStopSourceKey(stop.sourceKey, stop.name, stop.lat, stop.lng)) {
        throw new Error(`Invalid sourceKey for stop "${stop.name}": ${stop.sourceKey}`)
      }
      const previous = stops.get(stop.sourceKey)
      if (previous && (previous.lat !== stop.lat || previous.lng !== stop.lng)) {
        throw new Error(`Conflicting stop data for sourceKey: ${stop.sourceKey}`)
      }
      stops.set(stop.sourceKey, { lat: stop.lat, lng: stop.lng })
    }
  }

  const manifestPath =
    sourcePath === defaultSourcePath
      ? defaultManifestPath
      : path.join(path.dirname(sourcePath), 'transit-data.manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing transit data manifest: ${manifestPath}`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as TransitManifest
  const checksum = crypto.createHash('sha256').update(sourceBuffer).digest('hex')
  const routeStopCount = source.routes.reduce((total, route) => total + route.stops.length, 0)
  if (
    manifest.sourceVersion !== source.version ||
    manifest.sha256 !== checksum ||
    manifest.routes !== source.routes.length ||
    manifest.uniqueStops !== stops.size ||
    manifest.routeStops !== routeStopCount
  ) {
    throw new Error('Transit data does not match its committed manifest')
  }
  return source
}

function uniqueSourceStops(source: TransitSource): SourceStop[] {
  const byKey = new Map<string, SourceStop>()
  for (const route of source.routes) {
    for (const stop of route.stops) {
      if (!byKey.has(stop.sourceKey)) byKey.set(stop.sourceKey, stop)
    }
  }
  return [...byKey.values()]
}

function objectId(value: unknown): mongoose.Types.ObjectId {
  if (value instanceof mongoose.Types.ObjectId) return value
  if (value && typeof value === 'object' && '_id' in value) {
    return objectId((value as { _id: unknown })._id)
  }
  return new mongoose.Types.ObjectId(String(value))
}

function haversineMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const radiusMeters = 6_371_000
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDelta = radians(to.lat - from.lat)
  const longitudeDelta = radians(to.lng - from.lng)
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.lat)) *
      Math.cos(radians(to.lat)) *
      Math.sin(longitudeDelta / 2) ** 2
  return Math.round(
    radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
  )
}

function differs(current: unknown, desired: Record<string, unknown>): boolean {
  return Object.entries(desired).some(([key, value]) => {
    const currentValue = (current as Record<string, unknown>)[key]
    if (currentValue instanceof mongoose.Types.ObjectId) {
      return !currentValue.equals(objectId(value))
    }
    return currentValue !== value
  })
}

async function findStopCandidates(stop: SourceStop) {
  const [keyed, sameCoordinates] = await Promise.all([
    Stop.findOne({ sourceKey: stop.sourceKey }),
    Stop.find({ lat: stop.lat, lng: stop.lng }).sort({ _id: 1 }),
  ])
  const legacy = sameCoordinates.filter(
    (candidate) => stopSourceKey(candidate.name, candidate.lat, candidate.lng) === stop.sourceKey,
  )
  const candidates = new Map<string, (typeof legacy)[number]>()
  if (keyed) candidates.set(keyed._id.toString(), keyed)
  for (const item of legacy) candidates.set(item._id.toString(), item)
  return { keyed, candidates: [...candidates.values()] }
}

async function hasLegacyRouteStopUniqueIndex(): Promise<boolean> {
  const database = mongoose.connection.db
  if (!database) return false
  const collection = database.collection('routestops')
  const exists = await collection.listIndexes().toArray().catch(() => [])
  return exists.some((index) => {
    const keys = Object.entries(index.key)
    return Boolean(index.unique) &&
      keys.length === 2 &&
      keys[0][0] === 'routeId' &&
      keys[0][1] === 1 &&
      keys[1][0] === 'stopId' &&
      keys[1][1] === 1
  })
}

async function removeLegacyRouteStopUniqueIndex(): Promise<boolean> {
  const database = mongoose.connection.db
  if (!database) return false
  const collection = database.collection('routestops')
  const indexes = await collection.listIndexes().toArray().catch(() => [])
  const legacyIndex = indexes.find((index) => {
    const keys = Object.entries(index.key)
    return Boolean(index.unique) &&
      keys.length === 2 &&
      keys[0][0] === 'routeId' &&
      keys[0][1] === 1 &&
      keys[1][0] === 'stopId' &&
      keys[1][1] === 1
  })
  if (!legacyIndex?.name) return false
  await collection.dropIndex(legacyIndex.name)
  return true
}

export async function analyzeTransitData(source: TransitSource): Promise<SyncSummary> {
  const summary: SyncSummary = {
    routesCreated: 0,
    routesUpdated: 0,
    stopsCreated: 0,
    stopsUpdated: 0,
    stopsDeleted: 0,
    duplicateStopsMerged: 0,
    routeStopsCreated: 0,
    routeStopsUpdated: 0,
    routeStopsDeleted: 0,
    routeStopsPreserved: 0,
    legacyUniqueIndexRemoved: await hasLegacyRouteStopUniqueIndex(),
  }

  const sourceStops = uniqueSourceStops(source)
  const stopIds = new Map<string, string[]>()
  for (const stop of sourceStops) {
    const { keyed, candidates } = await findStopCandidates(stop)
    if (candidates.length === 0) {
      summary.stopsCreated += 1
    } else {
      const canonical = keyed ?? candidates[0]
      if (differs(canonical, {
        sourceKey: stop.sourceKey,
        name: stop.name,
        address: stop.address,
        lat: stop.lat,
        lng: stop.lng,
      })) {
        summary.stopsUpdated += 1
      }
    }
    summary.duplicateStopsMerged += Math.max(0, candidates.length - 1)
    stopIds.set(stop.sourceKey, candidates.map((candidate) => candidate._id.toString()))
  }

  for (const route of source.routes) {
    const existingRoute = await Route.findOne({
      $or: [{ code: route.code }, { name: route.name }],
    })
    if (!existingRoute) {
      summary.routesCreated += 1
      summary.routeStopsCreated += route.stops.length
      continue
    }
    if (differs(existingRoute, {
      code: route.code,
      name: route.name,
      color: route.color,
      status: route.status,
      startTime: route.startTime,
      endTime: route.endTime,
      frequency: route.frequency,
      price: route.price,
    })) {
      summary.routesUpdated += 1
    }

    const existingLinks = await RouteStop.find({ routeId: existingRoute._id })
      .sort({ order: 1, _id: 1 })
      .lean()
    const unused = new Set(existingLinks.map((link) => link._id.toString()))
    const bySyncKey = new Map(
      existingLinks
        .filter((link) => link.syncKey)
        .map((link) => [link.syncKey as string, link]),
    )
    const occurrences = new Map<string, number>()

    for (const stop of route.stops) {
      const occurrence = (occurrences.get(stop.sourceKey) ?? 0) + 1
      occurrences.set(stop.sourceKey, occurrence)
      const syncKey = `${route.code}:${stop.sourceKey}:${occurrence}`
      let matched = bySyncKey.get(syncKey)
      if (!matched) {
        const possibleIds = new Set(stopIds.get(stop.sourceKey) ?? [])
        matched = existingLinks.find(
          (link) =>
            unused.has(link._id.toString()) &&
            possibleIds.has(objectId(link.stopId).toString()),
        )
      }
      if (matched) {
        unused.delete(matched._id.toString())
        const canonicalStopId = stopIds.get(stop.sourceKey)?.[0]
        if (
          matched.syncKey !== syncKey ||
          matched.managedBy !== 'sync' ||
          (canonicalStopId &&
            objectId(matched.stopId).toString() !== canonicalStopId)
        ) {
          summary.routeStopsUpdated += 1
        }
      } else {
        summary.routeStopsCreated += 1
      }
    }
    const unusedLinks = existingLinks.filter((link) => unused.has(link._id.toString()))
    summary.routeStopsDeleted += unusedLinks.filter((link) => link.managedBy === 'sync').length
    summary.routeStopsPreserved += unusedLinks.filter((link) => link.managedBy !== 'sync').length
  }

  const desiredSourceKeys = new Set(sourceStops.map((stop) => stop.sourceKey))
  const staleStops = await Stop.find({
    sourceKey: { $exists: true, $nin: [...desiredSourceKeys] },
  }).select('_id')
  for (const stop of staleStops) {
    const hasManualReference = await RouteStop.exists({
      stopId: stop._id,
      managedBy: { $ne: 'sync' },
    })
    if (!hasManualReference) summary.stopsDeleted += 1
  }
  return summary
}

export async function synchronizeTransitData(source: TransitSource): Promise<SyncSummary> {
  const now = new Date()
  const summary: SyncSummary = {
    routesCreated: 0,
    routesUpdated: 0,
    stopsCreated: 0,
    stopsUpdated: 0,
    stopsDeleted: 0,
    duplicateStopsMerged: 0,
    routeStopsCreated: 0,
    routeStopsUpdated: 0,
    routeStopsDeleted: 0,
    routeStopsPreserved: 0,
    legacyUniqueIndexRemoved: await removeLegacyRouteStopUniqueIndex(),
  }

  const stopByKey = new Map<string, InstanceType<typeof Stop>>()
  for (const sourceStop of uniqueSourceStops(source)) {
    const { keyed, candidates } = await findStopCandidates(sourceStop)
    let canonical = keyed ?? candidates[0]
    const isNew = !canonical
    if (isNew) {
      canonical = new Stop()
      summary.stopsCreated += 1
    }
    const stopValues = {
      sourceKey: sourceStop.sourceKey,
      name: sourceStop.name,
      address: sourceStop.address,
      lat: sourceStop.lat,
      lng: sourceStop.lng,
    }
    if (!isNew && differs(canonical, stopValues)) {
      summary.stopsUpdated += 1
    }

    if (isNew || differs(canonical, stopValues)) {
      canonical.set({ ...stopValues, lastSyncedAt: now })
      await canonical.save()
    }

    const duplicates = candidates.filter(
      (candidate) => candidate._id.toString() !== canonical._id.toString(),
    )
    for (const duplicate of duplicates) {
      await RouteStop.updateMany(
        { stopId: duplicate._id },
        { $set: { stopId: canonical._id } },
      )
      await duplicate.deleteOne()
      summary.duplicateStopsMerged += 1
    }
    stopByKey.set(sourceStop.sourceKey, canonical)
  }

  const routeByCode = new Map<string, InstanceType<typeof Route>>()
  for (const sourceRoute of source.routes) {
    let route = await Route.findOne({
      $or: [{ code: sourceRoute.code }, { name: sourceRoute.name }],
    })
    const isNew = route === null
    if (!route) {
      route = new Route()
      summary.routesCreated += 1
    }
    const routeValues = {
      code: sourceRoute.code,
      name: sourceRoute.name,
      color: sourceRoute.color,
      status: sourceRoute.status,
      startTime: sourceRoute.startTime,
      endTime: sourceRoute.endTime,
      frequency: sourceRoute.frequency,
      price: sourceRoute.price,
    }
    if (!isNew && differs(route, routeValues)) {
      summary.routesUpdated += 1
    }
    if (isNew || differs(route, routeValues)) {
      route.set({ ...routeValues, lastSyncedAt: now })
      await route.save()
    }
    routeByCode.set(sourceRoute.code, route)
  }

  for (const sourceRoute of source.routes) {
    const route = routeByCode.get(sourceRoute.code)
    if (!route) throw new Error(`Route was not synchronized: ${sourceRoute.code}`)

    const originalLinks = await RouteStop.find({ routeId: route._id }).sort({
      order: 1,
      _id: 1,
    })
    const unused = new Set(originalLinks.map((link) => link._id.toString()))
    const matchedDesiredKeyById = new Map<string, string>()
    const bySyncKey = new Map(
      originalLinks
        .filter((link) => link.syncKey)
        .map((link) => [link.syncKey as string, link]),
    )
    const occurrences = new Map<string, number>()
    const desiredLinks: Array<InstanceType<typeof RouteStop>> = []
    const updatedLinkIds = new Set<string>()
    const createdLinkIds = new Set<string>()

    for (const sourceStop of sourceRoute.stops) {
      const stop = stopByKey.get(sourceStop.sourceKey)
      if (!stop) throw new Error(`Stop was not synchronized: ${sourceStop.sourceKey}`)
      const occurrence = (occurrences.get(sourceStop.sourceKey) ?? 0) + 1
      occurrences.set(sourceStop.sourceKey, occurrence)
      const syncKey = `${sourceRoute.code}:${sourceStop.sourceKey}:${occurrence}`

      let link = bySyncKey.get(syncKey)
      if (!link) {
        link = originalLinks.find(
          (candidate) =>
            unused.has(candidate._id.toString()) &&
            objectId(candidate.stopId).equals(stop._id),
        )
      }
      if (!link) {
        link = new RouteStop({
          routeId: route._id,
          stopId: stop._id,
          order: originalLinks.length + desiredLinks.length,
        })
        summary.routeStopsCreated += 1
        createdLinkIds.add(link._id.toString())
      } else {
        unused.delete(link._id.toString())
      }

      const linkValues = {
        routeId: route._id,
        stopId: stop._id,
        syncKey,
        managedBy: 'sync',
      } as const
      if (link.isNew || differs(link, linkValues)) {
        link.set({ ...linkValues, lastSyncedAt: now })
        await link.save()
        if (
          !createdLinkIds.has(link._id.toString()) &&
          !updatedLinkIds.has(link._id.toString())
        ) {
          summary.routeStopsUpdated += 1
          updatedLinkIds.add(link._id.toString())
        }
      }
      desiredLinks.push(link)
      matchedDesiredKeyById.set(link._id.toString(), syncKey)
    }

    const staleManagedLinks = originalLinks.filter(
      (link) => unused.has(link._id.toString()) && link.managedBy === 'sync',
    )
    if (staleManagedLinks.length > 0) {
      await RouteStop.deleteMany({
        _id: { $in: staleManagedLinks.map((link) => link._id) },
      })
      summary.routeStopsDeleted += staleManagedLinks.length
      for (const link of staleManagedLinks) unused.delete(link._id.toString())
    }

    const manualExtras = originalLinks.filter((link) => unused.has(link._id.toString()))
    const extrasByAnchor = new Map<string, Array<InstanceType<typeof RouteStop>>>()
    let anchor = 'START'
    for (const link of originalLinks) {
      const matchedKey = matchedDesiredKeyById.get(link._id.toString())
      if (matchedKey) {
        anchor = matchedKey
      } else if (unused.has(link._id.toString())) {
        const extras = extrasByAnchor.get(anchor) ?? []
        extras.push(link)
        extrasByAnchor.set(anchor, extras)
      }
    }

    let finalLinks: Array<InstanceType<typeof RouteStop>>
    if (matchedDesiredKeyById.size === 0) {
      finalLinks = [...desiredLinks]
      for (const extra of manualExtras.sort((a, b) => a.order - b.order)) {
        finalLinks.splice(Math.min(extra.order, finalLinks.length), 0, extra)
      }
    } else {
      finalLinks = [...(extrasByAnchor.get('START') ?? [])]
      for (const link of desiredLinks) {
        finalLinks.push(link, ...(extrasByAnchor.get(link.syncKey as string) ?? []))
      }
    }
    summary.routeStopsPreserved += unused.size

    const allStopIds = [...new Set(finalLinks.map((link) => objectId(link.stopId).toString()))]
    const stopDocuments = await Stop.find({ _id: { $in: allStopIds } }).lean()
    const coordinates = new Map(
      stopDocuments.map((stop) => [
        stop._id.toString(),
        { lat: stop.lat, lng: stop.lng },
      ]),
    )

    for (let index = 0; index < finalLinks.length; index += 1) {
      const link = finalLinks[index]
      const current = coordinates.get(objectId(link.stopId).toString())
      const previous =
        index > 0
          ? coordinates.get(objectId(finalLinks[index - 1].stopId).toString())
          : undefined
      if (!current) throw new Error(`Missing stop for RouteStop ${link._id}`)
      const distanceFromPrev = previous ? haversineMeters(previous, current) : 0
      const orderingChanged =
        link.order !== index ||
        Math.abs(link.distanceFromPrev - distanceFromPrev) > 0.000001
      if (orderingChanged) {
        link.order = index
        link.distanceFromPrev = distanceFromPrev
        await link.save()
        if (
          !createdLinkIds.has(link._id.toString()) &&
          !updatedLinkIds.has(link._id.toString())
        ) {
          summary.routeStopsUpdated += 1
          updatedLinkIds.add(link._id.toString())
        }
      }
    }
  }

  const desiredSourceKeys = [...stopByKey.keys()]
  const staleStops = await Stop.find({
    sourceKey: { $exists: true, $nin: desiredSourceKeys },
  }).select('_id')
  for (const stop of staleStops) {
    if (!(await RouteStop.exists({ stopId: stop._id }))) {
      await stop.deleteOne()
      summary.stopsDeleted += 1
    }
  }

  await Route.createIndexes()
  await Stop.createIndexes()
  await RouteStop.createIndexes()
  return summary
}

export function printSyncSummary(summary: SyncSummary): void {
  console.table({
    routes_created: summary.routesCreated,
    routes_updated: summary.routesUpdated,
    stops_created: summary.stopsCreated,
    stops_updated: summary.stopsUpdated,
    stops_deleted: summary.stopsDeleted,
    duplicate_stops_merged: summary.duplicateStopsMerged,
    route_stops_created: summary.routeStopsCreated,
    route_stops_updated: summary.routeStopsUpdated,
    route_stops_deleted: summary.routeStopsDeleted,
    route_stops_preserved: summary.routeStopsPreserved,
    legacy_unique_index_removed: summary.legacyUniqueIndexRemoved,
  })
}

export async function runSyncCli() {
  const dryRun = process.argv.includes('--dry-run')
  const source = readTransitSource()
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/transitflow')
  console.log(`${dryRun ? 'DRY RUN' : 'SYNC'}: ${defaultSourcePath}`)
  const summary = dryRun
    ? await analyzeTransitData(source)
    : await synchronizeTransitData(source)
  printSyncSummary(summary)
  if (dryRun) console.log('Dry run completed: no database changes were written.')
  await mongoose.disconnect()
}

if (require.main === module) {
  runSyncCli().catch(async (error) => {
    console.error(error)
    await mongoose.disconnect().catch(() => undefined)
    process.exit(1)
  })
}
