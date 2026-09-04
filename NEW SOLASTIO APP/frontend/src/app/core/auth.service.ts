import { Injectable, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { ApiService } from "./api.service";

export type Role = "staff" | "owner";
export interface SessionUser { id?: string; name: string; role: Role; permissions: string[]; salonId?: string; branchId?: string; }

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly storageKey = "solastio.new.session";
  readonly user = signal<SessionUser | null>(this.readSession());
  readonly busy = signal(false);
  readonly authenticated = computed(() => !!this.user());

  async login(loginId: string, password: string, role: Role) {
    this.busy.set(true);
    try {
      const response = await this.api.post<{ user?: Partial<SessionUser>; accessToken?: string; permissions?: string[] }>("/auth/login", { loginId, password, role });
      const user: SessionUser = {
        id: response.user?.id,
        name: response.user?.name || loginId,
        role,
        permissions: response.permissions || response.user?.permissions || [],
        salonId: response.user?.salonId,
        branchId: response.user?.branchId
      };
      this.user.set(user);
      localStorage.setItem(this.storageKey, JSON.stringify(user));
      await this.router.navigateByUrl(role === "owner" ? "/owner" : "/staff");
    } finally {
      this.busy.set(false);
    }
  }

  async logout() {
    try { await this.api.post("/auth/logout", {}); } catch { /* local logout still completes */ }
    this.user.set(null);
    localStorage.removeItem(this.storageKey);
    await this.router.navigateByUrl("/login");
  }

  private readSession(): SessionUser | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) as SessionUser : null;
    } catch {
      return null;
    }
  }
}
