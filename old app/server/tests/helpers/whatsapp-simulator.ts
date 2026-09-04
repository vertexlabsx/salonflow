import type { Express } from "express";
import supertest from "supertest";

export interface WhatsAppSimMessage {
  phoneNumberId?: string;
  from?: string;
  profileName?: string;
  text: string;
  messageId?: string;
}

export async function sendWhatsAppSimMessage(app: Express, input: WhatsAppSimMessage): Promise<supertest.Response> {
  const id = input.messageId || `wamid.sim.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: input.phoneNumberId || "phone_sim" },
              contacts: [{ profile: { name: input.profileName || "Sim Customer" }, wa_id: input.from || "919999000000" }],
              messages: [{ id, from: input.from || "919999000000", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: input.text } }]
            }
          }
        ]
      }
    ]
  };
  return supertest(app).post("/api/v1/whatsapp/webhook").set("x-test-webhook", "true").send(payload);
}
