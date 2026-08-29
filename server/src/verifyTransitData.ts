import mongoose from 'mongoose'
import './config/env'
import Route from './models/Route'
import Stop from './models/Stop'
import RouteStop from './models/RouteStop'

export interface VerificationResult {
  routes: number
  stops: number
  routeStops: number
  duplicateStopKeys: number
  duplicateRouteCodes: number
  duplicateRouteOrders: number
  orphanRouteReferences: number
  orphanStopReferences: number
  invalidDistances: number
}

export async function verifyTransitData(): Promise<VerificationResult> {
  const database = mongoose.connection.db
  if (!database) throw new Error('Database unavailable')

  const [
    routeCount,
    stopCount,
    routeStopCount,
    duplicateStopKeys,
    duplicateRouteCodes,
    duplicateOrders,
    orphanRoutes,
    orphanStops,
    invalidDistances,
  ] = await Promise.all([
    Route.countDocuments(),
    Stop.countDocuments(),
    RouteStop.countDocuments(),
    Stop.aggregate([
      { $match: { sourceKey: { $type: 'string' } } },
      { $group: { _id: '$sourceKey', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]),
    Route.aggregate([
      { $match: { code: { $type: 'string' } } },
      { $group: { _id: '$code', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]),
    RouteStop.aggregate([
      { $group: { _id: { routeId: '$routeId', order: '$order' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]),
    database.collection('routestops').aggregate([
      {
        $lookup: {
          from: 'routes',
          localField: 'routeId',
          foreignField: '_id',
          as: 'route',
        },
      },
      { $match: { route: { $size: 0 } } },
      { $count: 'count' },
    ]).toArray(),
    database.collection('routestops').aggregate([
      {
        $lookup: {
          from: 'stops',
          localField: 'stopId',
          foreignField: '_id',
          as: 'stop',
        },
      },
      { $match: { stop: { $size: 0 } } },
      { $count: 'count' },
    ]).toArray(),
    RouteStop.countDocuments({
      $or: [
        { distanceFromPrev: { $lt: 0 } },
        { distanceFromPrev: { $not: { $type: 'number' } } },
      ],
    }),
  ])

  const result: VerificationResult = {
    routes: routeCount,
    stops: stopCount,
    routeStops: routeStopCount,
    duplicateStopKeys: duplicateStopKeys.length,
    duplicateRouteCodes: duplicateRouteCodes.length,
    duplicateRouteOrders: duplicateOrders.length,
    orphanRouteReferences: Number(orphanRoutes[0]?.count ?? 0),
    orphanStopReferences: Number(orphanStops[0]?.count ?? 0),
    invalidDistances,
  }
  const errors = Object.entries(result)
    .filter(([key, value]) => !['routes', 'stops', 'routeStops'].includes(key) && value !== 0)
  if (errors.length > 0) {
    throw new Error(`Transit data verification failed: ${errors.map(([key]) => key).join(', ')}`)
  }
  return result
}

export async function runVerifyCli() {
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/transitflow')
  const result = await verifyTransitData()
  console.table(result)
  await mongoose.disconnect()
  console.log('Transit data verification passed.')
}

if (require.main === module) {
  runVerifyCli().catch(async (error) => {
    console.error(error)
    await mongoose.disconnect().catch(() => undefined)
    process.exit(1)
  })
}
