import { Component, inject } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { ShopfiyAdminService } from "../../core/shopify-admin.service";

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <section class="shopify-admin-shell">
      <header class="topbar">
        <span class="brand">Shopify Automation — Admin</span>
        <button type="button" (click)="logout()">Logout</button>
      </header>
      <main><router-outlet /></main>
    </section>
  `,
  styles: [`
    .shopify-admin-shell { display:grid; grid-template-rows:auto 1fr; min-height:100vh; }
    .topbar { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--staff-border); background:var(--staff-surface); }
    .brand { font-weight:800; color:var(--staff-primary-hover); letter-spacing:.05em; text-transform:uppercase; font-size:.8rem; }
    button { min-height:44px; border:1px solid var(--staff-border); border-radius:12px; padding:6px 16px; background:var(--staff-surface); color:var(--staff-text-secondary); font-weight:700; cursor:pointer; }
    main { padding:20px; overflow-y:auto; }
    @media (max-width: 640px) { .shopify-admin-shell { min-height:100dvh; } .topbar { gap:10px; padding:calc(10px + env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left)); } .brand { min-width:0; font-size:.7rem; line-height:1.25; } button { flex:0 0 auto; min-width:72px; padding-inline:12px; } main { padding:14px max(12px, env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); overflow-x:clip; } }
  `]
})
export class ShopifyAdminLayoutPage {
  private readonly admin = inject(ShopfiyAdminService);
  private readonly router = inject(Router);

  async logout() {
    await this.admin.logout();
    this.router.navigate(["/shopify-admin/login"]);
  }
}
