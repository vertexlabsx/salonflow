import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { ShopfiyClientService } from "./shopify-client.service";

export const shopifyClientAuthGuard: CanActivateFn = async () => {
  const client = inject(ShopfiyClientService);
  const router = inject(Router);
  return await client.restore() ? true : router.createUrlTree(["/shopify/login"]);
};

export const shopifyClientGuestGuard: CanActivateFn = async () => {
  const client = inject(ShopfiyClientService);
  const router = inject(Router);
  return await client.restore() ? router.createUrlTree(["/shopify/dashboard"]) : true;
};
