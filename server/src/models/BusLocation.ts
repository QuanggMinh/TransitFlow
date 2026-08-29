import mongoose, { Schema, Document } from 'mongoose'

export interface IBusLocation extends Document {
  busId: mongoose.Types.ObjectId
  lat: number
  lng: number
  currentStopIndex: number
  timestamp: Date
}

const BusLocationSchema = new Schema<IBusLocation>({
  busId:            { type: Schema.Types.ObjectId, ref: 'Bus', required: true },
  lat:              { type: Number, required: true },
  lng:              { type: Number, required: true },
  currentStopIndex: { type: Number, required: true, default: 0 },
  timestamp:        { type: Date, default: Date.now },
}, { timestamps: false })

BusLocationSchema.index({ busId: 1, timestamp: -1 })

export default mongoose.model<IBusLocation>('BusLocation', BusLocationSchema)
