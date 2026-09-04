import "dotenv/config";
import mongoose from "mongoose";
import { createApp } from "./src/app";

async function sendMsg(app: ReturnType<typeof createApp>, body: string) {
  const payload = JSON.stringify({
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "1300632959798442" },
          contacts: [{ profile: { name: "Garv Test" }, wa_id: "919082864488" }],
          messages: [{
            id: "wamid.test_" + Date.now() + Math.random().toString(36).slice(2, 6),
            from: "919082864488",
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "text",
            text: { body }
          }]
        }
      }]
    }]
  });
  const res = await fetch("http://127.0.0.1:4000/api/v1/whatsapp/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-webhook": "true" },
    body: payload
  });
  const data = await res.json();
  console.log(`\n>>> "${body}"`);
  console.log(`Reply: ${JSON.stringify(data.data?.reply || data)}`);
  return data;
}

async function main() {
  const app = createApp();
  await mongoose.connect(process.env.MONGODB_URI!);
  const server = app.listen(4000, "127.0.0.1", () => console.log("Server on http://127.0.0.1:4000"));
  await new Promise((r) => setTimeout(r, 1000));

  await sendMsg(app, "Hi");
  await sendMsg(app, "Book appointment");
  await sendMsg(app, "Main Branch");
  await sendMsg(app, "Hair");
  await sendMsg(app, "Haircut");
  await sendMsg(app, "2026-08-26");
  await sendMsg(app, "10:00");
  await sendMsg(app, "Hold");
  await sendMsg(app, "Confirm");

  server.close();
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
