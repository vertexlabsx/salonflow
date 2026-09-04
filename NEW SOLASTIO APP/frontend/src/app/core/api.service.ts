import { HttpClient } from "@angular/common/http";
import { Injectable, InjectionToken, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

export const API_BASE = new InjectionToken<string>("API base URL", { factory: () => (window as unknown as { SOLASTIO_API_BASE?: string }).SOLASTIO_API_BASE || "/api/v1" });

type ApiEnvelope<T> = { ok?: boolean; success?: boolean; data?: T; error?: unknown; message?: string };

export interface PublicBranch { id: string; name: string; city?: string; address?: string; timezone?: string; }
export interface PublicService { id: string; name: string; description?: string; durationMinutes: number; pricePaise: number; }
export interface PublicDate { date: string; slotCount: number; }
export interface PublicSlot { startAt: string; endAt: string; staffId: string; }
export interface Metric { label: string; value: string | number; hint?: string; tone?: "neutral" | "good" | "warn" | "bad"; }
export interface WorkItem { id: string; title: string; subtitle?: string; status?: string; time?: string; primaryAction?: string; }

@Injectable({ providedIn: "root" })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE);

  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return firstValueFrom(this.http.get<T | ApiEnvelope<T>>(`${this.base}${path}`, { params })).then((response) => this.unwrap(response));
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T | ApiEnvelope<T>>(`${this.base}${path}`, body)).then((response) => this.unwrap(response));
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T | ApiEnvelope<T>>(`${this.base}${path}`, body)).then((response) => this.unwrap(response));
  }

  private unwrap<T>(response: T | ApiEnvelope<T>): T {
    if (response && typeof response === "object" && "data" in response && (response as ApiEnvelope<T>).data !== undefined) {
      return (response as ApiEnvelope<T>).data as T;
    }
    return response as T;
  }
}
