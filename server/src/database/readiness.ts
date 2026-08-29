import crypto from 'crypto'
import fs from 'fs'
import type { Db } from 'mongodb'
import Route from '../models/Route'
import Stop from '../models/Stop'
import RouteStop from '../models/RouteStop'
import { defaultSourcePath, readTransitSource } from '../syncData'
import { verifyTransitData } from '../verifyTransitData'
import { expectedMigrationIds } from './migrations'

export async function assertDatabaseReady(database: Db): Promise<void> {
  const source = readTransitSource()
  const sourceChecksum = crypto
    .createHash('sha256')
    .update(fs.readFileSync(defaultSourcePath))
    .digest('hex')

  const migrationIds = expectedMigrationIds()
  const appliedMigrations = await database
    .collection<{ _id: string }>('_transitflow_migrations')
    .find({ _id: { $in: migrationIds } })
    .toArray()
  if (appliedMigrations.length !== migrationIds.length) {
    throw new Error('Database migrations are missing')
  }

  const state = await database.collection<{
    _id: string
    sourceVersion: number
    sourceChecksum: string
  }>('_transitflow_state').findOne({ _id: 'canonical-dataset' })
  if (
    !state ||
    state.sourceVersion !== source.version ||
    state.sourceChecksum !== sourceChecksum
  ) {
    throw new Error('Canonical transit data has not been synchronized')
  }

  const sourceKeys = [...new Set(
    source.routes.flatMap((route) => route.stops.map((stop) => stop.sourceKey)),
  )]
  const syncKeys = source.routes.flatMap((route) => {
    const occurrences = new Map<string, number>()
    return route.stops.map((stop) => {
      const occurrence = (occurrences.get(stop.sourceKey) ?? 0) + 1
      occurrences.set(stop.sourceKey, occurrence)
      return `${route.code}:${stop.sourceKey}:${occurrence}`
    })
  })
  const [routeCount, stopCount, routeStopCount] = await Promise.all([
    Route.countDocuments({ code: { $in: source.routes.map((route) => route.code) } }),
    Stop.countDocuments({ sourceKey: { $in: sourceKeys } }),
    RouteStop.countDocuments({ syncKey: { $in: syncKeys } }),
  ])
  if (
    routeCount !== source.routes.length ||
    stopCount !== sourceKeys.length ||
    routeStopCount !== syncKeys.length
  ) {
    throw new Error('Canonical transit records are missing from the database')
  }

  await verifyTransitData()
}
