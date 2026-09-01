import { HttpClient, HttpBackend } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { environment } from "../../../environments/environment";

export interface PublicBranch { id: string; name: string; timezone: string; }
export interface PublicService { id: string; name: string; description: string; durationMinutes: number; pricePaise: number; eligibleStaffIds: string[]; }
export interface PublicStaff { staffId: string; name: string; }
export interface PublicSlot { startAt: string; staffId: string; endAt: string; }
export interface PublicDate { date: string; slotCount: number; }

@Injectable({ providedIn: "root" })
export class SelfBookingService {
  private readonly http: HttpClient;
  constructor(backend: HttpBackend) {
    this.http = new HttpClient(backend);
  }

  private url(path: string): string {
    return `${environment.apiBaseUrl}/self-booking${path}`;
  }

  branches(salonId: string): Promise<{ branches: PublicBranch[] }> {
    return firstValueFrom(this.http.get<{ branches: PublicBranch[] }>(this.url("/branches"), { params: { salonId } }));
  }

  services(salonId: string, branchId: string): Promise<{ services: PublicService[] }> {
    return firstValueFrom(this.http.get<{ services: PublicService[] }>(this.url("/services"), { params: { salonId, branchId } }));
  }

  staff(salonId: string, branchId: string, serviceId?: string): Promise<{ staff: PublicStaff[] }> {
    return firstValueFrom(this.http.get<{ staff: PublicStaff[] }>(this.url("/staff"), { params: { salonId, branchId, ...(serviceId ? { serviceId } : {}) } }));
  }

  slots(salonId: string, branchId: string, serviceId: string, date: string, staffId?: string, maxSlots?: number): Promise<{ date: string; slots: PublicSlot[] }> {
    const params: Record<string, string> = { salonId, branchId, serviceId, date };
    if (staffId) params["staffId"] = staffId;
    if (maxSlots) params["maxSlots"] = String(maxSlots);
    return firstValueFrom(this.http.get<{ date: string; slots: PublicSlot[] }>(this.url("/slots"), { params }));
  }

  availableDates(salonId: string, branchId: string, serviceId: string, fromDate?: string, count?: number): Promise<{ dates: PublicDate[] }> {
    const params: Record<string, string> = { salonId, branchId, serviceId };
    if (fromDate) params["fromDate"] = fromDate;
    if (count) params["count"] = String(count);
    return firstValueFrom(this.http.get<{ dates: PublicDate[] }>(this.url("/available-dates"), { params }));
  }

  book(payload: {
    salonId: string; branchId: string; serviceId: string; startAt: string;
    customerName: string; phone: string; preferredStaffId?: string;
  }): Promise<{
    bookingId: string; staffId: string; serviceId: string; startAt: string; endAt: string;
    status: string; depositApplied: boolean; paymentLink: string; timezone: string; branchName: string;
  }> {
    return firstValueFrom(this.http.post<{
      bookingId: string; staffId: string; serviceId: string; startAt: string; endAt: string;
      status: string; depositApplied: boolean; paymentLink: string; timezone: string; branchName: string;
    }>(this.url("/book"), payload));
  }

  cancel(salonId: string, appointmentId: string, phone: string): Promise<{ bookingId: string; status: string; previousStartAt: string }> {
    return firstValueFrom(this.http.post<{ bookingId: string; status: string; previousStartAt: string }>(this.url("/cancel"), { salonId, appointmentId, phone }));
  }

  reschedule(salonId: string, appointmentId: string, phone: string, newStartAt: string, branchId?: string): Promise<{ bookingId: string; status: string; newStartAt: string; timezone: string }> {
    const body: { salonId: string; appointmentId: string; phone: string; newStartAt: string; branchId?: string } = { salonId, appointmentId, phone, newStartAt };
    if (branchId) body.branchId = branchId;
    return firstValueFrom(this.http.post<{ bookingId: string; status: string; newStartAt: string; timezone: string }>(this.url("/reschedule"), body));
  }
}
