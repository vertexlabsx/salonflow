import { WhatsAppConnectionModel, type WhatsAppConnection } from "../../../models/whatsapp-connection.model";
import { SalonModel } from "../../../models/salon.model";
import { encryptSecret } from "../../../shared/secret-box";
import { ApiError } from "../../../shared/http";

export function safeConnection(connection: WhatsAppConnection & { _id?: unknown }) {
  return {
    id: String(connection._id || ""),
    salonId: connection.salonId,
    provider: connection.provider,
    wabaId: connection.wabaId,
    phoneNumberId: connection.phoneNumberId,
    businessId: connection.businessId,
    displayPhoneNumber: connection.displayPhoneNumber.replace(/\d(?=\d{4})/g, "X"),
    verifiedName: connection.verifiedName,
    status: connection.status,
    webhookSubscribed: connection.webhookSubscribed,
    connectedAt: connection.connectedAt?.toISOString() || null,
    disconnectedAt: connection.disconnectedAt?.toISOString() || null,
    updatedAt: connection.updatedAt?.toISOString() || null
  };
}

export async function upsertMetaConnection(input: {
  salonId: string;
  userId: string;
  provider: "meta_test" | "meta_production";
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  accessToken: string;
  tokenExpiresAt?: Date | null;
  webhookSubscribed: boolean;
}) {
  const existingOtherSalon = await WhatsAppConnectionModel.findOne({ phoneNumberId: input.phoneNumberId, salonId: { $ne: input.salonId } });
  if (existingOtherSalon) throw ApiError.conflict("This WhatsApp phone number is already connected to another Solastio workspace.");
  const doc = await WhatsAppConnectionModel.findOneAndUpdate(
    { salonId: input.salonId, phoneNumberId: input.phoneNumberId },
    {
      $set: {
        provider: input.provider,
        wabaId: input.wabaId,
        businessId: input.businessId || "",
        displayPhoneNumber: input.displayPhoneNumber || "",
        verifiedName: input.verifiedName || "",
        encryptedAccessToken: encryptSecret(input.accessToken),
        tokenExpiresAt: input.tokenExpiresAt || null,
        status: "connected",
        webhookSubscribed: input.webhookSubscribed,
        connectedAt: new Date(),
        disconnectedAt: null,
        lastError: ""
      },
      $setOnInsert: { salonId: input.salonId, phoneNumberId: input.phoneNumberId, createdBy: input.userId, scopes: [] }
    },
    { upsert: true, new: true }
  );
  await SalonModel.updateOne({ _id: input.salonId }, { $addToSet: { whatsappPhoneNumberIds: input.phoneNumberId } });
  return doc;
}

export async function disconnectConnection(salonId: string, phoneNumberId?: string) {
  const filter: Record<string, unknown> = { salonId, status: { $ne: "disconnected" } };
  if (phoneNumberId) filter.phoneNumberId = phoneNumberId;
  const doc = await WhatsAppConnectionModel.findOneAndUpdate(filter, { $set: { status: "disconnected", disconnectedAt: new Date(), webhookSubscribed: false } }, { new: true });
  if (!doc) throw ApiError.notFound("WhatsApp connection not found.");
  await SalonModel.updateOne({ _id: salonId }, { $pull: { whatsappPhoneNumberIds: doc.phoneNumberId } });
  return doc;
}
