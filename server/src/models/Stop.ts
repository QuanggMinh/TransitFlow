import mongoose, { Schema, Document } from 'mongoose'

export interface IStop extends Document {
  sourceKey?: string
  name: string
  lat: number
  lng: number
  address: string
  lastSyncedAt?: Date
}

const StopSchema = new Schema<IStop>({
  sourceKey: { type: String, trim: true },
  name:    { type: String, required: true },
  lat:     { type: Number, required: true },
  lng:     { type: Number, required: true },
  address: { type: String, default: '' },
  lastSyncedAt: { type: Date },
}, { timestamps: true })

StopSchema.index({ lat: 1, lng: 1 })
StopSchema.index({ sourceKey: 1 }, { unique: true, sparse: true })

export default mongoose.model<IStop>('Stop', StopSchema)
