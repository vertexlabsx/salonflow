import { Routes } from "@angular/router";
import { authGuard, guestGuard } from "./core/auth.guard";

export const routes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "book" },
  { path: "book", loadComponent: () => import("./features/public/booking.page").then((m) => m.BookingPage) },
  { path: "login", canActivate: [guestGuard], loadComponent: () => import("./features/auth/login.page").then((m) => m.LoginPage) },
  {
    path: "staff",
    canActivate: [authGuard],
    loadComponent: () => import("./features/staff/staff-shell.page").then((m) => m.StaffShellPage),
    children: [
      { path: "", pathMatch: "full", redirectTo: "today" },
      { path: "today", loadComponent: () => import("./features/staff/staff-today.page").then((m) => m.StaffTodayPage) },
      { path: "appointments", loadComponent: () => import("./features/staff/staff-appointments.page").then((m) => m.StaffAppointmentsPage) },
      { path: "clients", loadComponent: () => import("./features/staff/staff-clients.page").then((m) => m.StaffClientsPage) }
    ]
  },
  {
    path: "owner",
    canActivate: [authGuard],
    loadComponent: () => import("./features/owner/owner-shell.page").then((m) => m.OwnerShellPage),
    children: [
      { path: "", pathMatch: "full", redirectTo: "overview" },
      { path: "overview", loadComponent: () => import("./features/owner/owner-overview.page").then((m) => m.OwnerOverviewPage) },
      { path: "appointments", loadComponent: () => import("./features/owner/owner-appointments.page").then((m) => m.OwnerAppointmentsPage) },
      { path: "people", loadComponent: () => import("./features/owner/owner-people.page").then((m) => m.OwnerPeoplePage) }
    ]
  },
  { path: "**", redirectTo: "book" }
];
