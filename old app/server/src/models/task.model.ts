import mongoose, { model, Schema } from "mongoose";
import type { Model } from "mongoose";

export interface Task {
  salonId: string;
  branchId: string;
  staffId: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueAt: Date | null;
  assignedBy: string;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const taskSchema = new Schema<Task>(
  {
    salonId: { type: String, required: true },
    branchId: { type: String, required: true },
    staffId: { type: String, default: null },
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, maxlength: 1000, default: "" },
    status: { type: String, enum: ["pending", "in_progress", "completed", "cancelled"], default: "pending" },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    dueAt: { type: Date, default: null },
    assignedBy: { type: String, maxlength: 120, default: "" },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
);

taskSchema.index({ salonId: 1, staffId: 1, status: 1 });

export const TaskModel: Model<Task> = (mongoose.models.Task as Model<Task>) || model<Task>("Task", taskSchema);
