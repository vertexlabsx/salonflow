import { Pipe, PipeTransform } from "@angular/core";

const INR_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

export function formatPaiseInr(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const paise = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(paise)) return "-";
  return INR_FORMATTER.format(paise / 100);
}

@Pipe({ name: "paiseInr", standalone: true })
export class PaiseInrPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    return formatPaiseInr(value);
  }
}
