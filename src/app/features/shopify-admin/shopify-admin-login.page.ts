import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { ShopfiyAdminService } from "../../core/shopify-admin.service";

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="login-page">
      <div class="login-card">
        <h1>Shopify Admin</h1>
        <p>Sign in with your admin credentials.</p>
        @if (error()) { <p class="error">{{ error() }}</p> }
        <input [(ngModel)]="email" type="email" placeholder="Email" autocomplete="email" />
        <input [(ngModel)]="password" type="password" placeholder="Password" autocomplete="current-password" />
        <button type="button" (click)="login()" [disabled]="loading()">{{ loading() ? 'Signing in...' : 'Sign In' }}</button>
      </div>
    </section>
  `,
  styles: [`
    .login-page { display:flex; align-items:center; justify-content:center; min-height:100vh; background:var(--staff-surface); }
    .login-card { display:grid; gap:12px; width:100%; max-width:380px; padding:32px; border:1px solid var(--staff-border); border-radius:24px; background:var(--staff-surface); box-shadow:var(--staff-shadow-card); }
    h1 { margin:0; font-size:1.5rem; color:var(--staff-text); } p { margin:0; color:var(--staff-text-secondary); font-weight:650; }
    input { min-height:44px; border:1px solid var(--staff-border); border-radius:14px; padding:9px 12px; background:var(--staff-surface-secondary); color:var(--staff-text); font-weight:700; width:100%; box-sizing:border-box; }
    button { min-height:44px; border:none; border-radius:14px; padding:9px 12px; background:var(--staff-primary); color:var(--staff-on-primary); font-weight:700; cursor:pointer; }
    button:disabled { opacity:.6; cursor:not-allowed; }
    .error { color:var(--staff-error-text); background:var(--staff-error-surface); padding:8px 12px; border-radius:12px; font-weight:700; }
  `]
})
export class ShopifyAdminLoginPage {
  private readonly admin = inject(ShopfiyAdminService);
  private readonly router = inject(Router);
  email = "";
  password = "";
  readonly loading = this.admin.loading;
  readonly error = this.admin.error;

  async login() {
    try {
      await this.admin.login(this.email, this.password);
      await this.router.navigate(["/shopify-admin/dashboard"]);
    } catch { /* error is set in service */ }
  }
}
