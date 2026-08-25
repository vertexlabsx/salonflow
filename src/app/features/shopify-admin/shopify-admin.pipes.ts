import { Pipe, PipeTransform } from "@angular/core";

@Pipe({ name: "dateText", standalone: true })
export class DateTextPipe implements PipeTransform {
  transform(value: string): string {
    return value ? new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
  }
}

@Pipe({ name: "jsonText", standalone: true })
export class JsonTextPipe implements PipeTransform {
  transform(value: unknown): string {
    return JSON.stringify(value || {});
  }
}
