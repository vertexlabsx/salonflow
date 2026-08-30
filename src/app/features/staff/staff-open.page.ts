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
  template: `<main class="staff-open-state"><div class="staff-open-mark">S</div><p class="eyebrow">Solastio Staff</p><h1>Opening your workspace</h1><p>Connecting your branch, permissions and live staff data...</p></main>`, styles: [` .staff-open-state { min-height: 100dvh; display: grid; place-content: center; justify-items: center; gap: 16px; padding: 24px; color: var(--staff-text); text-align: center; background: radial-gradient(circle at 15% 6%,color-mix(in srgb,var(--staff-primary) 16%,transparent),transparent 30%),radial-gradient(circle at 86% 12%,color-mix(in srgb,var(--staff-border-accent) 42%,transparent),transparent 26%),var(--staff-background); } .staff-open-state p, .staff-open-state h1 { margin: 0; } .staff-open-state .eyebrow { color: var(--staff-primary); font-size: .72rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; } .staff-open-state h1 { max-width:12ch;font-family:Georgia,"Times New Roman",serif;font-size: clamp(2.2rem, 7vw, 4rem);font-weight:500; line-height: .98; letter-spacing: -.055em; } .staff-open-state p:last-child { color: var(--staff-text-secondary); font-weight: 650; } .staff-open-mark { display: grid; place-items: center; width: 72px; height: 72px; border-radius: 24px; color: var(--staff-on-primary); background: linear-gradient(135deg,var(--staff-primary),var(--staff-primary-hover)); font-family:Georgia,serif;font-size:1.8rem;font-weight: 600; box-shadow: var(--staff-shadow-elevated); animation: open-enter 420ms cubic-bezier(.2,.8,.2,1) both; } @keyframes open-enter { from { transform: translateY(10px) scale(.94); opacity: 0; } } `]
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
