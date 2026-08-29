import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { performance } from 'perf_hooks'
import './models/Route'
import './models/Stop'
import { findJourneys, JourneyOption } from './services/journeyService'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/transitflow'

interface Point {
  name: string
  lat: number
  lng: number
}

interface BenchmarkCase {
  name: string
  from: Point
  to: Point
  expected: {
    maxTransfers?: number
    maxWalkMeters?: number
    maxEtaMax?: number
    routeHints?: string[]
  }
}

const departureAt = new Date('2026-07-07T08:00:00+07:00')

const cases: BenchmarkCase[] = [
  {
    name: 'Direct east-west trunk: Gia Lam -> Yen Nghia',
    from: { name: 'Ben xe Gia Lam', lat: 21.048159, lng: 105.878495 },
    to: { name: 'Ben xe Yen Nghia', lat: 20.949808, lng: 105.747402 },
    expected: { routeHints: ['[01]'], maxTransfers: 0, maxWalkMeters: 250, maxEtaMax: 240 },
  },
  {
    name: 'Airport corridor: Cau Giay -> Noi Bai T1',
    from: { name: 'Diem cuoi Cau Giay tuyen 20A', lat: 21.028882, lng: 105.804057 },
    to: { name: 'Noi Bai', lat: 21.214417, lng: 105.801263 },
    expected: { routeHints: ['[07]'], maxTransfers: 0, maxWalkMeters: 250, maxEtaMax: 175 },
  },
  {
    name: 'Crosstown direct: My Dinh -> Gia Lam',
    from: { name: 'Ben xe My Dinh', lat: 21.02851, lng: 105.77826 },
    to: { name: 'Ben xe Gia Lam', lat: 21.0482, lng: 105.878467 },
    expected: { routeHints: ['[34]'], maxTransfers: 0, maxWalkMeters: 250, maxEtaMax: 310 },
  },
  {
    name: 'Central urban trip: Hoan Kiem -> Bach Khoa',
    from: { name: 'Ho Hoan Kiem', lat: 21.0285, lng: 105.8542 },
    to: { name: 'DH Bach Khoa', lat: 21.0045, lng: 105.8443 },
    expected: { maxTransfers: 1, maxWalkMeters: 2200, maxEtaMax: 45 },
  },
  {
    name: 'Long suburban trip: Yen Nghia -> VNEC',
    from: { name: 'Ben xe Yen Nghia', lat: 20.949979, lng: 105.747619 },
    to: { name: 'Trung tam trien lam Quoc gia', lat: 21.0919998, lng: 105.862691 },
    expected: { routeHints: ['[02TC]'], maxTransfers: 0, maxWalkMeters: 250, maxEtaMax: 350 },
  },
]

function routeNames(journey: JourneyOption): string[] {
  return journey.type === 'direct'
    ? [journey.route.name]
    : journey.segments.map((segment) => segment.route.name)
}

function routeLabel(journey: JourneyOption): string {
  return routeNames(journey).map((name) => name.split(' - ')[0]).join(' -> ')
}

function transferCount(journey: JourneyOption): number {
  return journey.type === 'direct' ? 0 : journey.transferCount
}

function totalWalk(journey: JourneyOption): number {
  return journey.scoreBreakdown?.totalWalkMeters ??
    (journey.type === 'direct'
      ? journey.walkToBoard + journey.walkFromAlight
      : journey.walkToBoard + journey.walkFromAlight + journey.transferWalks.reduce((sum, value) => sum + value, 0))
}

function evaluate(item: BenchmarkCase, top: JourneyOption | undefined): string[] {
  if (!top) return ['No journey found']

  const issues: string[] = []
  const names = routeNames(top)
  const transfers = transferCount(top)
  const walk = totalWalk(top)

  if (item.expected.maxTransfers !== undefined && transfers > item.expected.maxTransfers) {
    issues.push(`transfers ${transfers} > ${item.expected.maxTransfers}`)
  }
  if (item.expected.maxWalkMeters !== undefined && walk > item.expected.maxWalkMeters) {
    issues.push(`walk ${walk}m > ${item.expected.maxWalkMeters}m`)
  }
  if (item.expected.maxEtaMax !== undefined && top.etaMax > item.expected.maxEtaMax) {
    issues.push(`etaMax ${top.etaMax}m > ${item.expected.maxEtaMax}m`)
  }
  for (const hint of item.expected.routeHints ?? []) {
    if (!names.some((name) => name.includes(hint))) {
      issues.push(`missing route ${hint}`)
    }
  }

  return issues
}

async function run() {
  await mongoose.connect(MONGODB_URI)

  const rows = []
  let passed = 0

  for (const item of cases) {
    const started = performance.now()
    const results = await findJourneys(item.from.lat, item.from.lng, item.to.lat, item.to.lng, departureAt)
    const runtimeMs = Math.round(performance.now() - started)
    const top = results[0]
    const issues = evaluate(item, top)
    if (issues.length === 0) passed++

    rows.push({
      case: item.name,
      status: issues.length === 0 ? 'PASS' : 'FAIL',
      results: results.length,
      topRoute: top ? routeLabel(top) : '-',
      transfers: top ? transferCount(top) : '-',
      walkM: top ? totalWalk(top) : '-',
      eta: top ? `${top.etaMin}-${top.etaMax}` : '-',
      score: top?.scoreBreakdown?.totalScore ?? '-',
      runtimeMs,
      issues: issues.join('; '),
    })
  }

  console.table(rows)
  console.log(`Journey benchmark: ${passed}/${cases.length} cases passed`)

  await mongoose.disconnect()
  if (passed !== cases.length) process.exit(1)
}

run().catch(async (err) => {
  console.error('Journey benchmark failed:', err)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
