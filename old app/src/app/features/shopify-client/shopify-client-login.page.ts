import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { ShopfiyClientService } from "../../core/shopify-client.service";

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="login-page">
      <div class="login-card">
        <h1>Shopify Dashboard</h1>
        <p>Sign in to view your automation status.</p>
        @if (error()) { <p class="error">{{ error() }}</p> }
        <input [(ngModel)]="email" type="email" placeholder="Email" autocomplete="email" />
        <input [(ngModel)]="password" type="password" placeholder="Password" autocomplete="current-password" />
        <button type="button" (click)="login()" [disabled]="loading()">{{ loading() ? 'Signing in...' : 'Sign In' }}</button>
      </div>
    </section>
  `,
  styles: [`
    .login-page { display:flex; align-items:center; justify-content:center; min-height:100vh; background:linear-gradient(135deg,#f8f9ff,#eef1ff); }
    .login-card { display:grid; gap:12px; width:100%; max-width:380px; padding:32px; border:1px solid #e2e8f0; border-radius:24px; background:#fff; box-shadow:0 4px 24px rgba(0,0,0,.06); }
    h1 { margin:0; font-size:1.5rem; color:#1a202c; } p { margin:0; color:#718096; font-weight:600; }
    input { min-height:44px; border:1px solid #e2e8f0; border-radius:14px; padding:9px 12px; background:#f7fafc; color:#1a202c; font-weight:600; width:100%; box-sizing:border-box; }
    button { min-height:44px; border:none; border-radius:14px; padding:9px 12px; background:#6366f1; color:#fff; font-weight:700; cursor:pointer; }
    button:disabled { opacity:.6; cursor:not-allowed; }
    .error { color:#e53e3e; background:#fff5f5; padding:8px 12px; border-radius:12px; font-weight:700; }
  `]
})
export class ShopifyClientLoginPage {
  private readonly client = inject(ShopfiyClientService);
  private readonly router = inject(Router);
  email = "";
  password = "";
  readonly loading = this.client.loading;
  readonly error = this.client.error;

  async login() {
    try {
      await this.client.login(this.email, this.password);
      await this.router.navigate(["/shopify/dashboard"]);
    } catch { /* error is set in service */ }
  }
}
