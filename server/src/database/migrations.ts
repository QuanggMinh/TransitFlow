import type { Db } from 'mongodb'

interface Migration {
  id: string
  description: string
  up: (database: Db) => Promise<void>
}

export interface MigrationRunResult {
  applied: string[]
  skipped: string[]
}

const migrations: Migration[] = [
  {
    id: '001-drop-route-stop-pair-unique-index',
    description: 'Allow one physical stop to occur more than once in a route',
    async up(database) {
      const exists = await database
        .listCollections({ name: 'routestops' }, { nameOnly: true })
        .hasNext()
      if (!exists) return

      const collection = database.collection('routestops')
      const indexes = await collection.listIndexes().toArray()
      const legacyIndex = indexes.find((index) => {
        const keys = Object.entries(index.key)
        return Boolean(index.unique) &&
          keys.length === 2 &&
          keys[0][0] === 'routeId' &&
          keys[0][1] === 1 &&
          keys[1][0] === 'stopId' &&
          keys[1][1] === 1
      })
      if (legacyIndex?.name) await collection.dropIndex(legacyIndex.name)
    },
  },
  {
    id: '002-classify-legacy-route-stops',
    description: 'Mark legacy route-stop rows as administrator-managed',
    async up(database) {
      const exists = await database
        .listCollections({ name: 'routestops' }, { nameOnly: true })
        .hasNext()
      if (!exists) return
      await database.collection('routestops').updateMany(
        { managedBy: { $exists: false } },
        { $set: { managedBy: 'admin' } },
      )
    },
  },
]

export async function runMigrations(database: Db): Promise<MigrationRunResult> {
  const collection = database.collection<{
    _id: string
    description: string
    appliedAt: Date
  }>('_transitflow_migrations')
  const appliedDocuments = await collection
    .find({}, { projection: { _id: 1 } })
    .toArray()
  const alreadyApplied = new Set(appliedDocuments.map((item) => String(item._id)))
  const result: MigrationRunResult = { applied: [], skipped: [] }

  for (const migration of migrations) {
    if (alreadyApplied.has(migration.id)) {
      result.skipped.push(migration.id)
      continue
    }

    await migration.up(database)
    await collection.updateOne(
      { _id: migration.id },
      {
        $setOnInsert: {
          description: migration.description,
          appliedAt: new Date(),
        },
      },
      { upsert: true },
    )
    result.applied.push(migration.id)
  }
  return result
}

export function expectedMigrationIds(): string[] {
  return migrations.map((migration) => migration.id)
}
