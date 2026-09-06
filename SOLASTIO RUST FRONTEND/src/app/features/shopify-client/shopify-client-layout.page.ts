import { Component, inject } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { ShopfiyClientService } from "../../core/shopify-client.service";

@Component({
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <section class="shopify-client-shell">
      <header class="topbar">
        <span class="brand">Shopify Dashboard</span>
        <div class="topbar-right">
          <span class="shop-name">{{ client.user()?.shopDomain }}</span>
          <button type="button" (click)="logout()">Logout</button>
        </div>
      </header>
      <main><router-outlet /></main>
    </section>
  `,
  styles: [`
    .shopify-client-shell { display:grid; grid-template-rows:auto 1fr; min-height:100vh; background:#f8f9ff; }
    .topbar { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid #e2e8f0; background:#fff; }
    .brand { font-weight:800; color:#6366f1; letter-spacing:.05em; text-transform:uppercase; font-size:.8rem; }
    .topbar-right { display:flex; align-items:center; gap:12px; }
    .shop-name { font-size:.75rem; color:#718096; font-weight:600; }
    button { min-height:44px; border:1px solid #e2e8f0; border-radius:12px; padding:6px 16px; background:#fff; color:#718096; font-weight:700; cursor:pointer; }
    main { padding:20px; overflow-y:auto; max-width:960px; margin:0 auto; width:100%; }
    @media (max-width: 640px) { .shopify-client-shell { min-height:100dvh; } .topbar { align-items:flex-start; gap:10px; padding:calc(10px + env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 10px max(12px, env(safe-area-inset-left)); } .brand { min-width:0; font-size:.72rem; line-height:1.25; } .topbar-right { min-width:0; gap:8px; } .shop-name { max-width:34vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } button { min-width:72px; padding-inline:12px; } main { padding:14px max(12px, env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); overflow-x:clip; } }
    @media (max-width: 380px) { .shop-name { display:none; } .topbar { align-items:center; } }
  `]
})
export class ShopifyClientLayoutPage {
  readonly client = inject(ShopfiyClientService);
  private readonly router = inject(Router);

  async logout() {
    await this.client.logout();
    this.router.navigate(["/shopify/login"]);
  }
}
