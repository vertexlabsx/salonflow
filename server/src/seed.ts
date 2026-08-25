import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "./config/mongo";
import { loadEnv } from "./config/env";
import { SalonModel } from "./models/salon.model";
import { UserModel } from "./models/user.model";
import { BranchModel } from "./models/branch.model";
import { ServiceModel } from "./models/service.model";
import { ScheduleModel } from "./models/schedule.model";
import { ShopifyUserModel } from "./models/shopify-user.model";
import { logger } from "./shared/logger";

/**
 * Idempotent bootstrap seed: creates the salon workspace plus owner and staff
 * logins so the app is usable immediately after first run.
 */
export async function seed(options: { disconnect?: boolean } = { disconnect: true }): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);

  const salon = await SalonModel.findByIdAndUpdate(
    env.SEED_SALON_ID,
    {
      $setOnInsert: {
        _id: env.SEED_SALON_ID,
        name: env.SEED_SALON_NAME,
        timezone: "Asia/Kolkata",
        currency: "INR",
        status: "active",
        whatsappPhoneNumberIds: []
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  logger.info(`Salon ready: ${salon?.name} (${salon?._id})`);

  const branchId = `${env.SEED_SALON_ID}_main`;
  await BranchModel.findByIdAndUpdate(
    branchId,
    {
      $setOnInsert: {
        _id: branchId,
        salonId: env.SEED_SALON_ID,
        name: "Main Branch",
        timezone: env.SALON_TIMEZONE,
        status: "active",
        slotIntervalMinutes: 30,
        hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "10:00", close: "21:00", closed: false }))
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  for (const service of [
    { name: "Haircut", description: "Classic haircut", pricePaise: 50000, durationMinutes: 30 },
    { name: "Hair Spa", description: "Relaxing hair spa treatment", pricePaise: 120000, durationMinutes: 60 },
    { name: "Hair Colour", description: "Professional hair colouring", pricePaise: 250000, durationMinutes: 120 }
  ]) {
    await ServiceModel.findOneAndUpdate(
      { salonId: env.SEED_SALON_ID, name: service.name },
      { $setOnInsert: { salonId: env.SEED_SALON_ID, branchIds: [branchId], eligibleStaffIds: ["staff_seed_reception"], status: "active", ...service } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const usersToSeed = [
    {
      loginId: env.SEED_OWNER_LOGIN,
      password: env.SEED_OWNER_PASSWORD,
      name: "Salon Owner",
      role: "owner",
      roleDisplayName: "Owner",
      staffId: undefined as string | undefined,
      staffAppPermissions: ["*"],
      crmPermissions: ["admin:*"]
    },
    {
      loginId: env.SEED_STAFF_LOGIN,
      password: env.SEED_STAFF_PASSWORD,
      name: "Front Desk Reception",
      role: "receptionist",
      roleDisplayName: "Receptionist",
      staffId: "staff_seed_reception",
      staffAppPermissions: ["read:appointments", "read:staff", "allow:staff-checkin-checkout", "create:appointments"],
      crmPermissions: ["read:appointments", "read:staff"]
    }
  ];

  for (const entry of usersToSeed) {
    const loginIdNormalized = entry.loginId.trim().toLowerCase();
    const existing = await UserModel.findOne({ salonId: env.SEED_SALON_ID, loginIdNormalized });
    if (existing) {
      logger.info(`User already exists: ${entry.loginId} (${existing.role})`);
      continue;
    }
    await UserModel.create({
      salonId: env.SEED_SALON_ID,
      loginId: entry.loginId,
      loginIdNormalized,
      name: entry.name,
      passwordHash: await bcrypt.hash(entry.password, 12),
      role: entry.role,
      roleDisplayName: entry.roleDisplayName,
      staffId: entry.staffId,
      branchId,
      branchIds: [branchId],
      staffAppPermissions: [...entry.staffAppPermissions],
      crmPermissions: [...entry.crmPermissions],
      status: "active"
    });
    logger.info(`User created: ${entry.loginId} (${entry.role})`);
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: env.SALON_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await ScheduleModel.findOneAndUpdate(
    { salonId: env.SEED_SALON_ID, staffId: "staff_seed_reception", scheduleDate: today },
    {
      $setOnInsert: {
        salonId: env.SEED_SALON_ID,
        branchId,
        staffId: "staff_seed_reception",
        scheduleDate: today,
        startTime: "10:00",
        endTime: "21:00",
        shiftType: "regular",
        status: "scheduled",
        version: 1
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const shopifyUsersToSeed: Array<{ email: string; password: string; name: string; role: "admin" | "client"; shopDomain: string }> = [
    { email: env.SHOPIFY_ADMIN_EMAIL, password: env.SHOPIFY_ADMIN_PASSWORD, name: "Shopify Admin", role: "admin", shopDomain: "admin" }
  ];
  if (env.SHOPIFY_CLIENT_EMAIL && env.SHOPIFY_CLIENT_PASSWORD) {
    shopifyUsersToSeed.push({ email: env.SHOPIFY_CLIENT_EMAIL, password: env.SHOPIFY_CLIENT_PASSWORD, name: "Shopify Client", role: "client", shopDomain: "client" });
  }
  for (const entry of shopifyUsersToSeed) {
    const loginIdNormalized = entry.email.trim().toLowerCase();
    const existing = await ShopifyUserModel.findOne({ shopDomain: entry.shopDomain, loginIdNormalized });
    if (existing) {
      logger.info(`Shopify user already exists: ${entry.email} (${entry.role})`);
      continue;
    }
    await ShopifyUserModel.create({
      shopDomain: entry.shopDomain,
      loginId: entry.email,
      loginIdNormalized,
      email: loginIdNormalized,
      name: entry.name,
      passwordHash: await bcrypt.hash(entry.password, 12),
      role: entry.role,
      status: "active"
    });
    logger.info(`Shopify user created: ${entry.email} (${entry.role})`);
  }

  if (options.disconnect !== false) await disconnectMongo();
  logger.info("Seed complete.");
}

if (require.main === module) {
  seed().catch((error) => {
    logger.error("Seed failed", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
