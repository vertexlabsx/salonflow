/**
 * Complete route definitions for the Aura Staff App.
 *
 * Each route specifies:
 *   path       — URL path
 *   label      — Human-readable name for reports
 *   public     — accessible without authentication
 *   requires   — minimum permission scope (null = any logged-in user)
 *   hasForm    — page contains form elements
 *   hasTable   — page contains table or list elements
 *   hasModal   — page can open modal/bottom-sheet overlays
 *   bottomNav  — appears in mobile bottom navigation
 */

export interface StaffRoute {
  path: string;
  label: string;
  public: boolean;
  requires?: string | null;
  hasForm?: boolean;
  hasTable?: boolean;
  hasModal?: boolean;
  bottomNav?: boolean;
}

export const STAFF_ROUTES: StaffRoute[] = [
  {
    path: "/staff/login",
    label: "Staff Login",
    public: true,
    hasForm: true,
  },
  {
    path: "/staff/open",
    label: "Staff Open",
    public: true,
  },
  {
    path: "/staff/dashboard",
    label: "Dashboard",
    public: false,
    requires: "read:appointments",
    hasTable: true,
    bottomNav: true,
  },
  {
    path: "/staff/appointments",
    label: "Appointments",
    public: false,
    requires: "read:appointments",
    hasTable: true,
    bottomNav: true,
  },
  {
    path: "/staff/business",
    label: "Business",
    public: false,
    requires: "read:appointments",
    hasTable: true,
    bottomNav: true,
  },
  {
    path: "/staff/queue",
    label: "Queue",
    public: false,
    requires: "read:appointments",
    hasTable: true,
  },
  {
    path: "/staff/tasks",
    label: "Tasks",
    public: false,
    requires: "read:staff",
    hasTable: true,
    bottomNav: true,
  },
  {
    path: "/staff/attendance",
    label: "Attendance",
    public: false,
    requires: "allow:staff-checkin-checkout",
    hasTable: true,
    bottomNav: true,
  },
  {
    path: "/staff/roster",
    label: "Roster",
    public: false,
    hasTable: true,
  },
  {
    path: "/staff/performance",
    label: "Performance",
    public: false,
    requires: "read:staff",
  },
  {
    path: "/staff/leaderboard",
    label: "Leaderboard",
    public: false,
    requires: "read:staff",
    hasTable: true,
  },
  {
    path: "/staff/notifications",
    label: "Notifications",
    public: false,
    hasTable: true,
  },
  {
    path: "/staff/reports",
    label: "Reports",
    public: false,
    requires: "read:staff",
    hasTable: true,
  },
  {
    path: "/staff/calendar",
    label: "Calendar",
    public: false,
    requires: "read:appointments",
  },
  {
    path: "/staff/chat",
    label: "Chat",
    public: false,
    requires: "read:staff",
  },
  {
    path: "/staff/payroll",
    label: "Payroll",
    public: false,
    requires: "read:payroll",
    hasTable: true,
  },
  {
    path: "/staff/leaves",
    label: "Leaves",
    public: false,
    hasForm: true,
  },
  {
    path: "/staff/profile",
    label: "Profile",
    public: false,
    hasForm: true,
  },
  {
    path: "/staff/settings",
    label: "Settings",
    public: false,
    hasForm: true,
  },
];

export const OWNER_ROUTES: StaffRoute[] = [
  {
    path: "/owner/login",
    label: "Owner Login",
    public: true,
    hasForm: true,
  },
  {
    path: "/owner/dashboard",
    label: "Owner Dashboard",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/appointments",
    label: "Owner Appointments",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/clients",
    label: "Owner Clients",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/staff",
    label: "Owner Staff",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/attendance",
    label: "Owner Attendance",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/leave-requests",
    label: "Owner Leaves",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/chats",
    label: "Owner Chats",
    public: false,
  },
  {
    path: "/owner/revenue",
    label: "Owner Revenue",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/reports",
    label: "Owner Reports",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/payroll",
    label: "Owner Payroll",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/inventory",
    label: "Owner Inventory",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/billing",
    label: "Owner Billing",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/marketing",
    label: "Owner Marketing",
    public: false,
  },
  {
    path: "/owner/notifications",
    label: "Owner Notifications",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/roles-permissions",
    label: "Owner Roles & Permissions",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/branches",
    label: "Owner Branches",
    public: false,
    hasTable: true,
  },
  {
    path: "/owner/settings",
    label: "Owner Settings",
    public: false,
    hasForm: true,
  },
];
