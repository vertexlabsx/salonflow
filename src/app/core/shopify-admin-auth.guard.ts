import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { ShopfiyAdminService } from "./shopify-admin.service";

export const shopifyAdminAuthGuard: CanActivateFn = async () => {
  const admin = inject(ShopfiyAdminService);
  const router = inject(Router);
  return await admin.restore() ? true : router.createUrlTree(["/shopify-admin/login"]);
};

export const shopifyAdminGuestGuard: CanActivateFn = async () => {
  const admin = inject(ShopfiyAdminService);
  const router = inject(Router);
  return await admin.restore() ? router.createUrlTree(["/shopify-admin/dashboard"]) : true;
};
