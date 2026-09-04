import { Injectable, inject } from "@angular/core";
import { ApiService, Metric, WorkItem } from "./api.service";

@Injectable({ providedIn: "root" })
export class WorkspaceService {
  private readonly api = inject(ApiService);

  staffDashboard() { return this.api.get<{ metrics?: Metric[]; work?: WorkItem[]; timeline?: WorkItem[] }>("/staff-self/dashboard"); }
  staffToday() { return this.api.get<{ metrics?: Metric[]; work?: WorkItem[]; timeline?: WorkItem[] }>("/staff-os/mobile/today"); }
  staffAppointments() { return this.api.get<{ items?: WorkItem[]; metrics?: Metric[] }>("/appointments/"); }
  ownerDashboard() { return this.api.get<{ metrics?: Metric[]; work?: WorkItem[]; alerts?: WorkItem[] }>("/owner-console/dashboard"); }
  ownerAppointments() { return this.api.get<{ items?: WorkItem[]; metrics?: Metric[] }>("/owner-console/appointments"); }
  ownerPeople() { return this.api.get<{ items?: WorkItem[]; metrics?: Metric[] }>("/owner-console/people/staff"); }
}
