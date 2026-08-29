import mongoose, { Schema, Document } from 'mongoose'

export interface IRouteStop extends Document {
  routeId: mongoose.Types.ObjectId
  stopId: mongoose.Types.ObjectId
  order: number
  distanceFromPrev: number
  managedBy: 'sync' | 'admin'
  syncKey?: string
  lastSyncedAt?: Date
}

const RouteStopSchema = new Schema<IRouteStop>({
  routeId:          { type: Schema.Types.ObjectId, ref: 'Route', required: true },
  stopId:           { type: Schema.Types.ObjectId, ref: 'Stop', required: true },
  order:            { type: Number, required: true },
  distanceFromPrev: { type: Number, default: 0 },
  managedBy:        { type: String, enum: ['sync', 'admin'], default: 'admin' },
  syncKey:          { type: String, trim: true },
  lastSyncedAt:     { type: Date },
}, { timestamps: true })

RouteStopSchema.index({ routeId: 1, order: 1 })
RouteStopSchema.index({ syncKey: 1 }, { unique: true, sparse: true })

export default mongoose.model<IRouteStop>('RouteStop', RouteStopSchema)
