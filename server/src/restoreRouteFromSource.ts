import fs from 'fs'
import path from 'path'
import mongoose from 'mongoose'
import './config/env'
import Route from './models/Route'
import Stop from './models/Stop'
import RouteStop from './models/RouteStop'
import { readTransitSource } from './syncData'
import { replaceRouteStops } from './services/routeStopAdminService'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const code = argument('--code')?.trim().toUpperCase()
  if (!code) throw new Error('Provide a route code with --code')
  if (!process.argv.includes('--confirm')) {
    throw new Error('Refusing to restore a route without --confirm')
  }

  const sourceRoute = readTransitSource().routes.find((route) => route.code === code)
  if (!sourceRoute) throw new Error(`Route ${code} is missing from canonical data`)

  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/transitflow')
  const route = await Route.findOne({ code })
  if (!route) throw new Error(`Route ${code} is missing from the database`)

  const current = await RouteStop.find({ routeId: route._id })
    .sort({ order: 1, _id: 1 })
    .populate('stopId')
    .lean()
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
  const backupDirectory = path.resolve(
    __dirname,
    '..',
    '..',
    '.undo',
    `${stamp}-before-route-${code}-restore`,
  )
  fs.mkdirSync(backupDirectory, { recursive: true })
  fs.writeFileSync(
    path.join(backupDirectory, 'route.json'),
    `${JSON.stringify({ route: route.toObject(), routeStops: current }, null, 2)}\n`,
    'utf8',
  )

  const desiredStops = await Promise.all(sourceRoute.stops.map(async (sourceStop) => {
    const stop = await Stop.findOne({ sourceKey: sourceStop.sourceKey }).select('_id')
    if (!stop) throw new Error(`Missing canonical stop: ${sourceStop.sourceKey}`)
    return String(stop._id)
  }))
  const restored = await replaceRouteStops(
    String(route._id),
    desiredStops,
    current.map((item) => String(item._id)),
  )

  const restoredKeys = restored.map((item) => {
    const stop = item.stopId as unknown as { sourceKey?: string }
    return stop.sourceKey
  })
  const expectedKeys = sourceRoute.stops.map((stop) => stop.sourceKey)
  if (
    restoredKeys.length !== expectedKeys.length ||
    restoredKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`Route ${code} failed post-restore verification`)
  }

  console.log(`Route ${code} restored with ${restored.length} stops.`)
  console.log(`Undo snapshot: ${backupDirectory}`)
  await mongoose.disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
