/**
 * Device profile definitions for the test suite.
 *
 * Used by route-level tests that need to classify viewports
 * (phone / tablet / desktop) without importing Playwright internals.
 */

export interface DeviceProfile {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  hasTouch: boolean;
}

export function classifyDevice(width: number, isMobile: boolean): "phone" | "tablet" | "desktop" {
  if (isMobile) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}

export function isSmallPhone(width: number): boolean {
  return width <= 375;
}

export function isLargePhone(width: number): boolean {
  return width >= 412;
}

export function isTablet(width: number, isMobile: boolean): boolean {
  return !isMobile && width >= 768 && width < 1024;
}

export function isDesktop(width: number, isMobile: boolean): boolean {
  return !isMobile && width >= 1024;
}

/** Staff sidebar breakpoint — below this width sidebar collapses to hamburger. */
export const SIDEBAR_BREAKPOINT = 900;

/** Form stacking breakpoint — below this width forms go single-column. */
export const FORM_STACK_BREAKPOINT = 640;
