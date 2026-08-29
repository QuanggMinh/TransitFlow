import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import mongoose from 'mongoose'
import { runMigrations } from './database/migrations'

const serverRoot = path.resolve(__dirname, '..')
const envPath = path.join(serverRoot, '.env')
const localEnvPath = path.join(serverRoot, '.env.local')
const exampleEnvPath = path.join(serverRoot, '.env.example')
const lockId = 'local-bootstrap'
const lockOwner = crypto.randomUUID()

function ensureSupportedNode(): void {
  const [major, minor] = process.versions.node.split('.').map(Number)
  const supported =
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 12) ||
    major > 22
  if (!supported) {
    throw new Error(
      `Node.js 20.19+ or 22.12+ is required; found ${process.versions.node}`,
    )
  }
}

function ensureLocalEnvironment(): void {
  if (fs.existsSync(localEnvPath) || fs.existsSync(envPath)) return
  if (!fs.existsSync(exampleEnvPath)) {
    throw new Error(`Missing environment template: ${exampleEnvPath}`)
  }
  fs.copyFileSync(exampleEnvPath, localEnvPath)
  console.log('Created server/.env.local from server/.env.example')
}

function validateConfiguration(): void {
  const username = process.env.ADMIN_USERNAME?.trim()
  const password = process.env.ADMIN_PASSWORD ?? ''
  if (!username) throw new Error('ADMIN_USERNAME is required in server/.env.local')
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD must contain at least 8 characters')
  }
}

async function acquireLock(database: NonNullable<typeof mongoose.connection.db>) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
  try {
    const result = await database.collection<{
      _id: string
      owner: string
      acquiredAt: Date
      expiresAt: Date
    }>('_transitflow_locks').updateOne(
      {
        _id: lockId,
        $or: [
          { expiresAt: { $lte: now } },
          { owner: lockOwner },
        ],
      },
      {
        $set: {
          owner: lockOwner,
          acquiredAt: now,
          expiresAt,
        },
      },
      { upsert: true },
    )
    if (result.matchedCount === 0 && result.upsertedCount === 0) {
      throw new Error('No lock was acquired')
    }
  } catch (error) {
    const duplicateKey =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: number }).code === 11000
    if (duplicateKey) {
      throw new Error('Another TransitFlow bootstrap is already running')
    }
    throw error
  }
}

async function releaseLock(database: NonNullable<typeof mongoose.connection.db>) {
  await database.collection<{ _id: string; owner: string }>(
    '_transitflow_locks',
  ).deleteOne({
    _id: lockId,
    owner: lockOwner,
  })
}

async function main() {
  ensureSupportedNode()
  ensureLocalEnvironment()
  await import('./config/env')
  validateConfiguration()

  const {
    defaultSourcePath,
    printSyncSummary,
    readTransitSource,
    synchronizeTransitData,
  } = await import('./syncData')
  const { verifyTransitData } = await import('./verifyTransitData')

  const mongoUri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/transitflow'
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  } catch {
    throw new Error(
      'Cannot connect to MongoDB. Start MongoDB locally or run "npm run db:start".',
    )
  }

  const database = mongoose.connection.db
  if (!database) throw new Error('Database unavailable')
  await acquireLock(database)

  try {
    console.log('1/3 Running database migrations...')
    const migrationResult = await runMigrations(database)
    console.log(
      `Migrations: ${migrationResult.applied.length} applied, ` +
      `${migrationResult.skipped.length} already current`,
    )

    console.log('2/3 Synchronizing canonical transit data...')
    const source = readTransitSource()
    const syncSummary = await synchronizeTransitData(source)
    printSyncSummary(syncSummary)

    console.log('3/3 Verifying database integrity...')
    const verification = await verifyTransitData()
    console.table(verification)

    const checksum = crypto
      .createHash('sha256')
      .update(fs.readFileSync(defaultSourcePath))
      .digest('hex')
    await database.collection<{
      _id: string
      sourceVersion: number
      sourceChecksum: string
      routes: number
      stops: number
      routeStops: number
      synchronizedAt: Date
    }>('_transitflow_state').updateOne(
      { _id: 'canonical-dataset' },
      {
        $set: {
          sourceVersion: source.version,
          sourceChecksum: checksum,
          routes: verification.routes,
          stops: verification.stops,
          routeStops: verification.routeStops,
          synchronizedAt: new Date(),
        },
      },
      { upsert: true },
    )

    console.log('Local TransitFlow database is ready.')
  } finally {
    await releaseLock(database)
    await mongoose.disconnect()
  }
}

main().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
