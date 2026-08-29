import mongoose, { Schema, Document } from 'mongoose'

export interface ITrafficSegment extends Document {
  fromStopId: mongoose.Types.ObjectId
  toStopId: mongoose.Types.ObjectId
  congestionLevel: number // 0.0 (thông thoáng) -> 1.0 (tắc hoàn toàn)
  baseTime: number        // giây khi không tắc
}

const TrafficSegmentSchema = new Schema<ITrafficSegment>({
  fromStopId:      { type: Schema.Types.ObjectId, ref: 'Stop', required: true },
  toStopId:        { type: Schema.Types.ObjectId, ref: 'Stop', required: true },
  congestionLevel: { type: Number, min: 0, max: 1, default: 0 },
  baseTime:        { type: Number, required: true },
}, { timestamps: true })

TrafficSegmentSchema.index({ fromStopId: 1, toStopId: 1 }, { unique: true })

export default mongoose.model<ITrafficSegment>('TrafficSegment', TrafficSegmentSchema)
