import { Component, inject } from "@angular/core";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { AuthService } from "../../core/auth.service";

@Component({
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <section class="shell owner-shell">
      <aside class="sidebar"><a class="brand" routerLink="/owner"><span class="mark">S</span><div><strong>Solastio</strong><small>Owner cockpit</small></div></a><nav class="nav"><a routerLink="/owner/overview" routerLinkActive="active">Overview</a><a routerLink="/owner/appointments" routerLinkActive="active">Appointments</a><a routerLink="/owner/people" routerLinkActive="active">People</a></nav></aside>
      <main class="main"><header class="topbar"><strong>{{ auth.user()?.name || 'Owner' }}</strong><div class="actions"><a class="btn" routerLink="/staff">Staff</a><button class="btn" (click)="auth.logout()">Logout</button></div></header><router-outlet /></main>
      <nav class="bottom-nav"><a routerLink="/owner/overview" routerLinkActive="active">Home</a><a routerLink="/owner/appointments" routerLinkActive="active">Work</a><a routerLink="/owner/people" routerLinkActive="active">People</a></nav>
    </section>
  `
})
export class OwnerShellPage { readonly auth = inject(AuthService); }
