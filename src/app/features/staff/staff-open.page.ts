import { HttpClient } from "@angular/common/http";
import { Component, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { environment } from "../../../environments/environment";
import { StaffAppService, StaffUser } from "../../core/staff-app.service";

type DemoStaffSession = {
  success?: boolean;
  data?: { accessToken: string; user: StaffUser };
  accessToken?: string;
  user?: StaffUser;
};

@Component({
  standalone: true,
  template: `<main class="staff-open-state"><div class="staff-open-mark">AS</div><p class="eyebrow">Aura Shine Staff</p><h1>Opening your workspace</h1><p>Connecting your branch, permissions and live staff data…</p></main>`, styles: [` .staff-open-state { min-height: 100dvh; display: grid; place-content: center; justify-items: center; gap: 16px; padding: 24px; color: var(--staff-text); text-align: center; background: var(--staff-background); } .staff-open-state p, .staff-open-state h1 { margin: 0; } .staff-open-state .eyebrow { color: var(--staff-primary); font-size: .72rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; } .staff-open-state h1 { font-size: clamp(2rem, 7vw, 3.8rem); line-height: 1; letter-spacing: -.04em; } .staff-open-state p:last-child { color: var(--staff-text-secondary); font-weight: 600; } .staff-open-mark { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 20px; color: var(--staff-on-primary); background: var(--staff-primary); font-weight: 800; box-shadow: var(--staff-shadow); animation: open-enter 220ms ease-out both; } @keyframes open-enter { from { transform: translateY(8px) scale(.97); opacity: 0; } } `]
})
export class StaffOpenPage implements OnInit {
  constructor(private readonly http: HttpClient, private readonly staff: StaffAppService, private readonly router: Router) {}

  async ngOnInit() {
    if (environment.production) {
      await this.router.navigateByUrl("/staff/login");
      return;
    }
    try {
      const baseUrl = environment.apiBaseUrl.replace(/\/$/, "");
      const response = await firstValueFrom(this.http.get<DemoStaffSession>(`${baseUrl}/auth/demo-staff-session`, { withCredentials: true }));
      const session = response.data || response;
      if (!session.accessToken || !session.user) throw new Error("Demo staff session was not issued.");
      this.staff.openSession({ accessToken: session.accessToken, user: session.user });
      await this.router.navigateByUrl("/staff/dashboard");
    } catch {
      await this.router.navigateByUrl("/staff/login");
    }
  }
}
