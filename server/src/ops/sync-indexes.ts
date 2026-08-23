import { connectMongo, disconnectMongo } from "../config/mongo";
import { loadEnv } from "../config/env";
import { AppointmentModel } from "../models/appointment.model";
import { AppointmentSlotLockModel } from "../models/appointment-slot-lock.model";
import { AuditLogModel } from "../models/audit-log.model";
import { AttendanceModel } from "../models/attendance.model";
import { BranchModel } from "../models/branch.model";
import { ChatMessageModel } from "../models/chat-message.model";
import { ChatThreadModel } from "../models/chat-thread.model";
import { ConversationMessageModel } from "../models/conversation-message.model";
import { ConversationModel } from "../models/conversation.model";
import { CustomerModel } from "../models/customer.model";
import { IdempotencyModel } from "../models/idempotency.model";
import { InvoiceModel } from "../models/invoice.model";
import { LeaveModel } from "../models/leave.model";
import { NotificationModel } from "../models/notification.model";
import { PayrollItemModel } from "../models/payroll-item.model";
import { PayrollRunModel } from "../models/payroll-run.model";
import { OwnerSettingsModel } from "../models/owner-settings.model";
import { PushDeviceModel } from "../models/push-device.model";
import { SalonModel } from "../models/salon.model";
import { ScheduleModel } from "../models/schedule.model";
import { ServiceModel } from "../models/service.model";
import { ShiftSwapModel } from "../models/shift-swap.model";
import { TargetModel } from "../models/target.model";
import { TaskModel } from "../models/task.model";
import { UserModel } from "../models/user.model";
import { WhatsAppBookingSessionModel } from "../models/whatsapp-booking-session.model";
import { WhatsAppConnectionModel } from "../models/whatsapp-connection.model";
import { WhatsAppInboundModel } from "../models/whatsapp-inbound.model";
import { WhatsAppOutboundModel } from "../models/whatsapp-outbound.model";
import { WhatsAppOAuthStateModel } from "../models/whatsapp-oauth-state.model";
import { WhatsAppTemplateModel } from "../models/whatsapp-template.model";
import { WhatsAppWebhookEventModel } from "../models/whatsapp-webhook-event.model";
import { logger } from "../shared/logger";

const models = [
  AppointmentModel,
  AppointmentSlotLockModel,
  AuditLogModel,
  AttendanceModel,
  BranchModel,
  ChatMessageModel,
  ChatThreadModel,
  ConversationMessageModel,
  ConversationModel,
  CustomerModel,
  IdempotencyModel,
  InvoiceModel,
  LeaveModel,
  NotificationModel,
  OwnerSettingsModel,
  PayrollItemModel,
  PayrollRunModel,
  PushDeviceModel,
  SalonModel,
  ScheduleModel,
  ServiceModel,
  ShiftSwapModel,
  TargetModel,
  TaskModel,
  UserModel,
  WhatsAppBookingSessionModel,
  WhatsAppConnectionModel,
  WhatsAppInboundModel,
  WhatsAppOutboundModel,
  WhatsAppOAuthStateModel,
  WhatsAppTemplateModel,
  WhatsAppWebhookEventModel
];

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  for (const model of models) {
    await model.syncIndexes();
    logger.info(`Indexes synced: ${model.modelName}`);
  }
  await disconnectMongo();
}

main().catch((error) => {
  logger.error("Index sync failed", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
