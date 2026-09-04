export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

const BUSINESS_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function businessDate(value = new Date()): string {
  if (Number.isNaN(value.getTime())) return "";
  const parts = Object.fromEntries(BUSINESS_DATE_FORMATTER.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

export function addBusinessDays(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function businessDateOffset(days: number, value = businessDate()): string {
  return addBusinessDays(value, days);
}
