import mongoose from 'mongoose'
import RouteStop from '../models/RouteStop'
import Stop from '../models/Stop'

interface PopulatedRouteStop {
  _id: mongoose.Types.ObjectId
  routeId: mongoose.Types.ObjectId
  stopId: {
    _id: mongoose.Types.ObjectId
    lat: number
    lng: number
  }
  order: number
  distanceFromPrev: number
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius = 6_371_000
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

async function populatedRouteStops(routeId: string): Promise<PopulatedRouteStop[]> {
  return RouteStop.find({ routeId })
    .sort({ order: 1, _id: 1 })
    .populate('stopId')
    .lean() as unknown as Promise<PopulatedRouteStop[]>
}

async function persistSequence(routeStops: PopulatedRouteStop[]) {
  if (routeStops.length === 0) return

  await RouteStop.bulkWrite(routeStops.map((routeStop, index) => {
    const previous = routeStops[index - 1]?.stopId
    const current = routeStop.stopId
    const distanceFromPrev = previous
      ? haversineMeters(previous.lat, previous.lng, current.lat, current.lng)
      : 0

    return {
      updateOne: {
        filter: { _id: routeStop._id },
        update: { $set: { order: index, distanceFromPrev } },
      },
    }
  }))
}

export async function normalizeRouteStopSequence(routeId: string) {
  const routeStops = await populatedRouteStops(routeId)
  await persistSequence(routeStops)
  return getOrderedRouteStops(routeId)
}

export async function getOrderedRouteStops(routeId: string) {
  return RouteStop.find({ routeId })
    .sort({ order: 1, _id: 1 })
    .populate('stopId')
    .lean()
}

export async function addStopToRoute(routeId: string, stopId: string, position?: number) {
  const existing = await populatedRouteStops(routeId)
  const duplicate = existing.some((item) => String(item.stopId._id) === stopId)
  if (duplicate) throw new Error('STOP_ALREADY_ASSIGNED')

  const created = await RouteStop.create({
    routeId,
    stopId,
    order: existing.length,
    distanceFromPrev: 0,
    managedBy: 'admin',
  })
  const withStop = await RouteStop.findById(created._id).populate('stopId').lean()
  if (!withStop) throw new Error('ROUTE_STOP_CREATE_FAILED')

  const insertAt = Number.isInteger(position)
    ? Math.max(0, Math.min(position as number, existing.length))
    : existing.length
  existing.splice(insertAt, 0, withStop as unknown as PopulatedRouteStop)
  await persistSequence(existing)
  return getOrderedRouteStops(routeId)
}

export async function removeStopFromRoute(routeId: string, routeStopId: string) {
  const removed = await RouteStop.findOneAndDelete({ _id: routeStopId, routeId })
  if (!removed) return null
  const remaining = await populatedRouteStops(routeId)
  await persistSequence(remaining)
  return getOrderedRouteStops(routeId)
}

export async function reorderRouteStops(routeId: string, orderedIds: string[]) {
  const current = await populatedRouteStops(routeId)
  if (
    orderedIds.length !== current.length ||
    new Set(orderedIds).size !== current.length
  ) {
    throw new Error('INVALID_ROUTE_STOP_SEQUENCE')
  }

  const byId = new Map(current.map((item) => [String(item._id), item]))
  const ordered = orderedIds.map((id) => byId.get(id))
  if (ordered.some((item) => !item)) throw new Error('INVALID_ROUTE_STOP_SEQUENCE')

  await persistSequence(ordered as PopulatedRouteStop[])
  return getOrderedRouteStops(routeId)
}

export async function replaceRouteStops(
  routeId: string,
  orderedStopIds: string[],
  expectedRouteStopIds: string[],
) {
  const current = await populatedRouteStops(routeId)
  const currentIds = current.map((item) => String(item._id))
  if (
    currentIds.length !== expectedRouteStopIds.length ||
    currentIds.some((id, index) => id !== expectedRouteStopIds[index])
  ) {
    throw new Error('ROUTE_STOP_SEQUENCE_CHANGED')
  }

  const uniqueStopIds = [...new Set(orderedStopIds)]
  const existingStops = await Stop.find({
    _id: { $in: uniqueStopIds },
  }).select('_id lat lng').lean()
  if (existingStops.length !== uniqueStopIds.length) {
    throw new Error('STOP_NOT_FOUND')
  }

  const stopById = new Map(existingStops.map((stop) => [String(stop._id), stop]))
  const availableByStop = new Map<string, PopulatedRouteStop[]>()
  for (const routeStop of current) {
    const stopId = String(routeStop.stopId._id)
    const available = availableByStop.get(stopId) ?? []
    available.push(routeStop)
    availableByStop.set(stopId, available)
  }

  const reusedIds = new Set<string>()
  const sequence = orderedStopIds.map((stopId, index) => {
    const available = availableByStop.get(stopId)
    const reused = available?.shift()
    if (reused) reusedIds.add(String(reused._id))
    return { stopId, index, reused }
  })
  const removedIds = current
    .filter((item) => !reusedIds.has(String(item._id)))
    .map((item) => item._id)

  const operations = sequence.map(({ stopId, index, reused }) => {
    const previous = index > 0 ? stopById.get(orderedStopIds[index - 1]) : undefined
    const stop = stopById.get(stopId)
    if (!stop) throw new Error('STOP_NOT_FOUND')
    const distanceFromPrev = previous
      ? haversineMeters(previous.lat, previous.lng, stop.lat, stop.lng)
      : 0

    if (reused) {
      return {
        updateOne: {
          filter: { _id: reused._id, routeId },
          update: { $set: { order: index, distanceFromPrev } },
        },
      }
    }
    return {
      insertOne: {
        document: {
          routeId: new mongoose.Types.ObjectId(routeId),
          stopId: new mongoose.Types.ObjectId(stopId),
          order: index,
          distanceFromPrev,
          managedBy: 'admin',
        },
      },
    }
  })

  if (operations.length > 0) await RouteStop.bulkWrite(operations)
  if (removedIds.length > 0) {
    await RouteStop.deleteMany({ routeId, _id: { $in: removedIds } })
  }
  return getOrderedRouteStops(routeId)
}
