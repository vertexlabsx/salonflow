import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { OwnerAppService } from "./owner-app.service";

export const ownerAuthGuard: CanActivateFn = async () => {
  const owner = inject(OwnerAppService);
  const router = inject(Router);
  return await owner.restore() ? true : router.createUrlTree(["/owner/login"]);
};

export const ownerGuestGuard: CanActivateFn = async () => {
  const owner = inject(OwnerAppService);
  const router = inject(Router);
  return await owner.restore() ? router.createUrlTree(["/owner/dashboard"]) : true;
};
