import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { StaffAppService } from "./staff-app.service";

export const rootRedirectGuard: CanActivateFn = async () => {
  const staff = inject(StaffAppService);
  const router = inject(Router);
  if (staff.hasSavedSession() || await staff.tryRestoreSession()) {
    const user = staff.user();
    const isOwner = String(user?.role || "").trim().toLowerCase() === "owner";
    return router.createUrlTree([isOwner ? "/owner/dashboard" : "/staff/dashboard"]);
  }
  return router.createUrlTree(["/staff/login"]);
};

export const staffGuestGuard: CanActivateFn = async () => {
  const staff = inject(StaffAppService);
  const router = inject(Router);
  if (staff.hasSavedSession() || await staff.tryRestoreSession()) {
    const user = staff.user();
    const isOwner = String(user?.role || "").trim().toLowerCase() === "owner";
    return router.createUrlTree([isOwner ? "/owner/dashboard" : "/staff/dashboard"]);
  }
  return true;
};

export const staffAuthGuard: CanActivateFn = async () => {
  const staff = inject(StaffAppService);
  const router = inject(Router);
  if (staff.isAuthenticated()) return true;
  if (await staff.tryRestoreSession()) return true;
  return router.createUrlTree(["/staff/login"]);
};

export const staffPermissionGuard: CanActivateFn = async (route) => {
  const staff = inject(StaffAppService);
  const router = inject(Router);
  if (!staff.isAuthenticated()) await staff.tryRestoreSession();
  if (!staff.isAuthenticated()) return router.createUrlTree(["/staff/login"]);
  const required = route.data?.["permissions"];
  const anyRequired = route.data?.["anyPermissions"];
  const permissions = Array.isArray(required) ? required : required ? [required] : [];
  const anyPermissions = Array.isArray(anyRequired) ? anyRequired : anyRequired ? [anyRequired] : [];
  const allowed = permissions.length ? staff.hasEveryPermission(permissions) : true;
  const anyAllowed = anyPermissions.length ? staff.hasAnyPermission(anyPermissions) : true;
  return allowed && anyAllowed ? true : router.createUrlTree(["/staff/permission-denied"], { queryParams: { required: [...permissions, ...anyPermissions].join(",") } });
};
