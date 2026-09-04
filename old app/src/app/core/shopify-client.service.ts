import { HttpClient, HttpErrorResponse, HttpHeaders } from "@angular/common/http";
import { Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { environment } from "../../environments/environment";

type ApiEnvelope<T> = { success?: boolean; data?: T; error?: { message?: string } | string; message?: string };
type ShopifyClientUser = { id: string; email: string; name: string; role: "client"; shopDomain: string };
type ShopifyClientSession = { accessToken: string; user: ShopifyClientUser };
type ClientOverview = { store: { shop: string; storeName: string; status: string } | null; stats: { activeFlows: number; totalFlows: number; sentToday: number; delivered: number; failed: number } };
type ClientFlow = { name: string; description: string; trigger: string; status: string; metrics: Record<string, number> };
type ClientActivity = { phone: string; status: string; time: string }[];
const SESSION_KEY = "shopifyClientSession";

@Injectable({ providedIn: "root" })
export class ShopfiyClientService {
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, "") + "/shopify-api";
  private accessToken = "";
  private refreshPromise?: Promise<void>;
  readonly user = signal<ShopifyClientUser | null>(null);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly overview = signal<ClientOverview | null>(null);
  readonly flows = signal<ClientFlow[]>([]);
  readonly activity = signal<ClientActivity>([]);

  constructor(private readonly http: HttpClient) {}

  isAuthenticated(): boolean {
    return !!this.accessToken && this.user()?.role === "client";
  }

  async restore(): Promise<boolean> {
    if (this.isAuthenticated()) return true;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const session: ShopifyClientSession = JSON.parse(raw);
      if (session?.accessToken && session?.user?.role === "client") {
        this.accessToken = session.accessToken;
        this.user.set(session.user);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  async login(email: string, password: string): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      const response = await firstValueFrom(this.http.post<ShopifyClientSession | ApiEnvelope<ShopifyClientSession>>(`${this.baseUrl}/auth/login`, { email, password }, { withCredentials: true }));
      const session = this.unwrap(response);
      if (session.user?.role !== "client") throw new Error("Client access required.");
      this.accessToken = session.accessToken;
      this.user.set(session.user);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      this.clear();
      this.error.set(this.errorMessage(error, "Unable to sign in."));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async logout(): Promise<void> {
    try { await firstValueFrom(this.http.post(`${this.baseUrl}/auth/logout`, {}, { withCredentials: true })); } catch { /* best effort */ }
    this.clear();
    localStorage.removeItem(SESSION_KEY);
  }

  async loadDashboard(): Promise<void> {
    const [overview, flows, activity] = await Promise.all([this.get<ClientOverview>("/overview"), this.get<ClientFlow[]>("/flows"), this.get<ClientActivity>("/activity")]);
    this.overview.set(overview);
    this.flows.set(flows);
    this.activity.set(activity);
  }

  private async get<T>(path: string): Promise<T> {
    try {
      if (!this.accessToken) await this.refresh();
      return await this.request<T>("GET", path);
    } catch (error) {
      if (!this.isSessionRejected(error)) throw error;
      await this.refresh();
      return this.request<T>("GET", path);
    }
  }

  private async request<T>(method: string, path: string): Promise<T> {
    const headers = new HttpHeaders({ "x-auth-token": this.accessToken });
    const response = await firstValueFrom(this.http.get<T | ApiEnvelope<T>>(`${this.baseUrl}/client${path}`, { headers, withCredentials: true }));
    return this.unwrap(response);
  }

  private async refresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().catch((error) => { this.clear(); throw error; }).finally(() => { this.refreshPromise = undefined; });
    }
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<void> {
    const response = await firstValueFrom(this.http.post<ShopifyClientSession | ApiEnvelope<ShopifyClientSession>>(`${this.baseUrl}/auth/refresh`, {}, { withCredentials: true }));
    const session = this.unwrap(response);
    if (session.user?.role !== "client") throw new Error("Client access required.");
    this.accessToken = session.accessToken;
    this.user.set(session.user);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  private clear(): void {
    this.accessToken = "";
    this.user.set(null);
    this.overview.set(null);
    this.flows.set([]);
    this.activity.set([]);
  }

  private isSessionRejected(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 401;
  }

  private unwrap<T>(response: T | ApiEnvelope<T>): T {
    if (response && typeof response === "object" && "data" in response) {
      const envelope = response as ApiEnvelope<T>;
      if (envelope.data !== undefined) return envelope.data;
      const error = envelope.error;
      throw new Error((typeof error === "string" ? error : error?.message) || envelope.message || "Unexpected API response.");
    }
    return response as T;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as ApiEnvelope<unknown> | { message?: string } | string | undefined;
      if (typeof body === "string" && body.trim()) return body;
      if (body && typeof body === "object") {
        const nested = "error" in body ? body.error : undefined;
        const message = typeof nested === "string" ? nested : nested?.message || body.message;
        if (message) return message;
      }
    }
    return error instanceof Error ? error.message : fallback;
  }
}
