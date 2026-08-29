import mongoose, { Schema, Document } from 'mongoose'

export interface IRoute extends Document {
  code?: string
  name: string
  color: string
  status: 'active' | 'inactive'
  startTime: string
  endTime: string
  frequency: number
  price: number  // giá vé một lượt (VNĐ)
  lastSyncedAt?: Date
}

const RouteSchema = new Schema<IRoute>({
  code:      { type: String, trim: true, uppercase: true },
  name:      { type: String, required: true, unique: true },
  color:     { type: String, required: true, default: '#3B82F6' },
  status:    { type: String, enum: ['active', 'inactive'], default: 'active' },
  startTime: { type: String, required: true },
  endTime:   { type: String, required: true },
  frequency: { type: Number, required: true },
  price:     { type: Number, required: true, default: 7000 },
  lastSyncedAt: { type: Date },
}, { timestamps: true })

RouteSchema.index({ code: 1 }, { unique: true, sparse: true })

export default mongoose.model<IRoute>('Route', RouteSchema)
