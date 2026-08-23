import { Routes } from "@angular/router";
import { rootRedirectGuard, staffAuthGuard, staffGuestGuard, staffPermissionGuard } from "./core/staff-auth.guard";
import { ownerAuthGuard, ownerGuestGuard } from "./features/owner/owner-auth.guard";

export const routes: Routes = [
  { path: "", canActivate: [rootRedirectGuard], children: [] },
  {
    path: "staff/login",
    canActivate: [staffGuestGuard],
    loadComponent: () => import("./features/staff/staff-login.page").then((m) => m.StaffLoginPage)
  },
  {
    path: "staff/open",
    loadComponent: () => import("./features/staff/staff-open.page").then((m) => m.StaffOpenPage)
  },
  {
    path: "owner/login",
    canActivate: [ownerGuestGuard],
    loadComponent: () => import("./features/owner/owner-app.pages").then((m) => m.OwnerLoginPage)
  },
  {
    path: "owner",
    canActivate: [ownerAuthGuard],
    canActivateChild: [ownerAuthGuard],
    loadComponent: () => import("./features/owner/owner-app.pages").then((m) => m.OwnerLayoutPage),
    children: [
      { path: "", redirectTo: "dashboard", pathMatch: "full" },
      { path: "dashboard", data: { ownerModule: "dashboard", ownerPeriod: true }, loadComponent: () => import("./features/owner/owner-dashboard.page").then((m) => m.OwnerDashboardPage) },
      { path: "appointments", data: { ownerModule: "appointments" }, loadComponent: () => import("./features/owner/owner-appointments.page").then((m) => m.OwnerAppointmentsPage) },
      { path: "clients", data: { ownerModule: "clients" }, loadComponent: () => import("./features/owner/owner-clients.page").then((m) => m.OwnerClientsPage) },
      { path: "staff", data: { ownerModule: "staff" }, loadComponent: () => import("./features/owner/owner-staff.page").then((m) => m.OwnerStaffPage) },
      { path: "attendance", data: { ownerModule: "attendance" }, loadComponent: () => import("./features/owner/owner-attendance.page").then((m) => m.OwnerAttendancePage) },
      { path: "leave-requests", data: { ownerModule: "leave-requests" }, loadComponent: () => import("./features/owner/owner-leave.page").then((m) => m.OwnerLeavePage) },
      { path: "chats", data: { ownerModule: "chats", ownerPeriod: false }, loadComponent: () => import("./features/owner/owner-chats.page").then((m) => m.OwnerChatsPage) },
      { path: "revenue", data: { ownerModule: "revenue" }, loadComponent: () => import("./features/owner/owner-revenue.page").then((m) => m.OwnerRevenuePage) },
      { path: "reports", data: { ownerModule: "reports" }, loadComponent: () => import("./features/owner/owner-reports.page").then((m) => m.OwnerReportsPage) },
      { path: "payroll", data: { ownerModule: "payroll" }, loadComponent: () => import("./features/owner/owner-payroll.page").then((m) => m.OwnerPayrollPage) },
      { path: "inventory", data: { ownerModule: "inventory", ownerPeriod: false }, loadComponent: () => import("./features/owner/owner-inventory.page").then((m) => m.OwnerInventoryPage) },
      { path: "billing", data: { ownerModule: "billing-access" }, loadComponent: () => import("./features/owner/owner-billing.page").then((m) => m.OwnerBillingPage) },
      { path: "marketing", data: { ownerModule: "marketing", ownerPeriod: false, ownerBranch: false }, loadComponent: () => import("./features/owner/owner-marketing.page").then((m) => m.OwnerMarketingPage) },
      { path: "notifications", data: { ownerModule: "notifications", ownerPeriod: false }, loadComponent: () => import("./features/owner/owner-notifications.page").then((m) => m.OwnerNotificationsPage) },
      { path: "roles-permissions", data: { ownerModule: "roles-permissions", ownerPeriod: false }, loadComponent: () => import("./features/owner/owner-roles-permissions.page").then((m) => m.OwnerRolesPermissionsPage) },
      { path: "branches", data: { ownerModule: "branches", ownerPeriod: false }, loadComponent: () => import("./features/owner/owner-branches.page").then((m) => m.OwnerBranchesPage) },
      { path: "settings", data: { ownerModule: "settings", ownerPeriod: false }, canDeactivate: [(component: import("./features/owner/owner-settings.page").OwnerSettingsPage) => component.canLeave()], loadComponent: () => import("./features/owner/owner-settings.page").then((m) => m.OwnerSettingsPage) }
    ]
  },
  {
    path: "staff",
    canActivate: [staffAuthGuard],
    loadComponent: () => import("./features/staff/staff-layout.page").then((m) => m.StaffLayoutPage),
    children: [
      { path: "", redirectTo: "dashboard", pathMatch: "full" },
      { path: "dashboard", canActivate: [staffPermissionGuard], data: { permissions: "read:appointments" }, loadComponent: () => import("./features/staff/staff-dashboard.page").then((m) => m.StaffDashboardPage) },
      { path: "appointments", canActivate: [staffPermissionGuard], data: { permissions: "read:appointments" }, loadComponent: () => import("./features/staff/staff-appointments.page").then((m) => m.StaffAppointmentsPage) },
      { path: "business", canActivate: [staffPermissionGuard], data: { permissions: "read:appointments" }, loadComponent: () => import("./features/staff/staff-business.page").then((m) => m.StaffBusinessPage) },
      { path: "queue", canActivate: [staffPermissionGuard], data: { permissions: "read:appointments" }, loadComponent: () => import("./features/staff/staff-queue.page").then((m) => m.StaffQueuePage) },
      { path: "tasks", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-tasks.page").then((m) => m.StaffTasksPage) },
      { path: "attendance", canActivate: [staffPermissionGuard], data: { anyPermissions: ["allow:staff-checkin-checkout", "read:staff", "write:staff"] }, loadComponent: () => import("./features/staff/staff-attendance.page").then((m) => m.StaffAttendancePage) },
      { path: "roster", loadComponent: () => import("./features/staff/staff-roster.page").then((m) => m.StaffRosterPage) },
      { path: "performance", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-performance.page").then((m) => m.StaffPerformancePage) },
      { path: "leaderboard", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-leaderboard.page").then((m) => m.StaffLeaderboardPage) },
      { path: "notifications", loadComponent: () => import("./features/staff/staff-notifications.page").then((m) => m.StaffNotificationsPage) },
      { path: "reports", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-reports.page").then((m) => m.StaffReportsPage) },
      { path: "calendar", canActivate: [staffPermissionGuard], data: { permissions: "read:appointments" }, loadComponent: () => import("./features/staff/staff-calendar.page").then((m) => m.StaffCalendarPage) },
      { path: "chat", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-chat.page").then((m) => m.StaffChatPage) },
      { path: "payroll", canActivate: [staffPermissionGuard], data: { anyPermissions: ["read:payroll", "read:finance"] }, loadComponent: () => import("./features/staff/staff-payroll.page").then((m) => m.StaffPayrollPage) },
      { path: "leaves", loadComponent: () => import("./features/staff/staff-leaves.page").then((m) => m.StaffLeavesPage) },
      { path: "profile", loadComponent: () => import("./features/staff/staff-profile.page").then((m) => m.StaffProfilePage) },
      { path: "settings", loadComponent: () => import("./features/staff/staff-settings.page").then((m) => m.StaffSettingsPage) },
      { path: "permission-denied", loadComponent: () => import("./features/staff/staff-permission-denied.page").then((m) => m.StaffPermissionDeniedPage) }
    ]
  },
  { path: "**", canActivate: [rootRedirectGuard], children: [] }
];
