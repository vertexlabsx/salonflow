import mongoose, { model, Schema } from "mongoose";
import type { Model, Types } from "mongoose";

export type AttendanceStatus = "open" | "closed";

export interface AttendanceBreak {
  breakType: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface Attendance {
  salonId: string;
  staffId: string;
  /** Salon-local calendar day (YYYY-MM-DD) the punch belongs to. */
  businessDate: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  status: AttendanceStatus;
  source: string;
  grossMinutes: number;
  breaks: AttendanceBreak[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type AttendanceDocument = mongoose.Document<Types.ObjectId> & Attendance;

const attendanceSchema = new Schema<Attendance>(
  {
    salonId: { type: String, required: true },
    staffId: { type: String, required: true },
    businessDate: { type: String, required: true },
    clockInAt: { type: Date, required: true },
    clockOutAt: { type: Date, default: null },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    source: { type: String, maxlength: 60, default: "staff-app" },
    grossMinutes: { type: Number, default: 0 },
    breaks: {
      type: [
        {
          breakType: { type: String, maxlength: 40, default: "regular" },
          startedAt: { type: Date, required: true },
          endedAt: { type: Date, default: null }
        }
      ],
      default: []
    }
  },
  { timestamps: true, minimize: false }
);

attendanceSchema.index({ salonId: 1, staffId: 1, clockInAt: -1 });
// Hard guarantee (transaction backstop): at most one open attendance per staff.
attendanceSchema.index(
  { salonId: 1, staffId: 1 },
  { unique: true, partialFilterExpression: { status: "open" } }
);

export const AttendanceModel: Model<Attendance> =
  (mongoose.models.Attendance as Model<Attendance>) || model<Attendance>("Attendance", attendanceSchema);
