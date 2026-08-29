import mongoose, { Schema, Document } from 'mongoose'

export interface IBus extends Document {
  routeId: mongoose.Types.ObjectId
  licensePlate: string
  status: 'running' | 'idle' | 'maintenance'
}

const BusSchema = new Schema<IBus>({
  routeId:      { type: Schema.Types.ObjectId, ref: 'Route', required: true },
  licensePlate: { type: String, required: true, unique: true },
  status:       { type: String, enum: ['running', 'idle', 'maintenance'], default: 'idle' },
}, { timestamps: true })

export default mongoose.model<IBus>('Bus', BusSchema)
