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
    button { min-height:36px; border:1px solid var(--staff-border); border-radius:12px; padding:6px 16px; background:var(--staff-surface); color:var(--staff-text-secondary); font-weight:700; cursor:pointer; }
    main { padding:20px; overflow-y:auto; }
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
