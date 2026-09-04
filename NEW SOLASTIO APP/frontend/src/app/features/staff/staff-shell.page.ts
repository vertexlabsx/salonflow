import { Component, inject } from "@angular/core";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { AuthService } from "../../core/auth.service";

@Component({
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <section class="shell">
      <aside class="sidebar"><a class="brand" routerLink="/staff"><span class="mark">S</span><div><strong>Solastio</strong><small>Staff workspace</small></div></a><nav class="nav"><a routerLink="/staff/today" routerLinkActive="active">Today</a><a routerLink="/staff/appointments" routerLinkActive="active">Appointments</a><a routerLink="/staff/clients" routerLinkActive="active">Clients</a></nav></aside>
      <main class="main"><header class="topbar"><strong>{{ auth.user()?.name || 'Staff' }}</strong><div class="actions"><a class="btn" routerLink="/book">Booking</a><button class="btn" (click)="auth.logout()">Logout</button></div></header><router-outlet /></main>
      <nav class="bottom-nav"><a routerLink="/staff/today" routerLinkActive="active">Today</a><a routerLink="/staff/appointments" routerLinkActive="active">Work</a><a routerLink="/staff/clients" routerLinkActive="active">Clients</a></nav>
    </section>
  `
})
export class StaffShellPage { readonly auth = inject(AuthService); }
