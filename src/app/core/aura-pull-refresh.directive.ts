import { Directive, ElementRef, Input, OnDestroy } from "@angular/core";

const THRESHOLD = 64;
const MAX_PULL = 120;
const COOLDOWN_MS = 800;

@Directive({ selector: "[auraPullRefresh]" })
export class AuraPullRefresh implements OnDestroy {
  @Input() auraPullRefresh: (() => void | Promise<unknown>) | null = null;

  private touchStartY = 0;
  private cooldown = false;
  private pulling = false;
  private pullDistance = 0;
  private refreshing = false;
  private indicator: HTMLElement | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly el: ElementRef<HTMLElement>) {
    const node = el.nativeElement;
    const opts: AddEventListenerOptions = { passive: false };
    const start = (e: TouchEvent) => this.onStart(e);
    const move = (e: TouchEvent) => this.onMove(e);
    const end = () => this.onEnd();
    node.addEventListener("touchstart", start, { passive: true });
    node.addEventListener("touchmove", move, opts);
    node.addEventListener("touchend", end, { passive: true });
    node.addEventListener("touchcancel", end, { passive: true });
    this.cleanups.push(
      () => node.removeEventListener("touchstart", start),
      () => node.removeEventListener("touchmove", move, opts),
      () => node.removeEventListener("touchend", end),
      () => node.removeEventListener("touchcancel", end)
    );
  }

  ngOnDestroy(): void { this.cleanups.forEach((fn) => fn()); this.removeIndicator(); }

  private onStart(e: TouchEvent): void {
    if (this.refreshing || this.cooldown) return;
    if (this.el.nativeElement.scrollTop > 5) return;
    this.touchStartY = e.touches[0]?.clientY ?? 0;
  }

  private onMove(e: TouchEvent): void {
    if (this.refreshing || this.cooldown || !this.touchStartY) return;
    const node = this.el.nativeElement;
    if (node.scrollTop > 5) { this.reset(); return; }
    const y = e.touches[0]?.clientY ?? 0;
    const delta = y - this.touchStartY;
    if (delta <= 0) { this.reset(); return; }
    if (delta > 6 && node.scrollTop <= 5) {
      e.preventDefault();
      this.pullDistance = Math.min(delta * 0.5, MAX_PULL);
      this.pulling = true;
      this.showIndicator();
    }
  }

  private onEnd(): void {
    if (!this.pulling && !this.touchStartY) return;
    if (this.pullDistance >= THRESHOLD && !this.refreshing && !this.cooldown) {
      this.doRefresh();
    } else {
      this.reset();
    }
  }

  private async doRefresh(): Promise<void> {
    this.refreshing = true;
    this.pulling = false;
    this.pullDistance = THRESHOLD;
    this.updateIndicator(true);
    this.cooldown = true;
    try { await this.auraPullRefresh?.(); } catch { /* swallow */ }
    this.reset();
    window.setTimeout(() => { this.cooldown = false; }, COOLDOWN_MS);
  }

  private reset(): void {
    this.pulling = false;
    this.pullDistance = 0;
    this.touchStartY = 0;
    this.removeIndicator();
  }

  private showIndicator(): void {
    if (!this.indicator) {
      this.indicator = document.createElement("div");
      this.indicator.className = "aura-pull-refresh";
      this.indicator.innerHTML = '<i></i><small>Pull to refresh</small>';
      this.el.nativeElement.prepend(this.indicator);
    }
    const pct = Math.min(this.pullDistance / THRESHOLD, 1);
    this.indicator.style.height = `${this.pullDistance}px`;
    this.indicator.style.opacity = String(pct);
    this.indicator.classList.add("visible");
    const label = this.indicator.querySelector("small");
    if (label) label.textContent = pct >= 1 ? "Release to refresh" : "Pull to refresh";
    const spinner = this.indicator.querySelector("i");
    if (spinner) spinner.style.transform = `rotate(${pct * 360}deg)`;
  }

  private updateIndicator(refreshing: boolean): void {
    if (!this.indicator) return;
    this.indicator.classList.toggle("spinning", refreshing);
    const label = this.indicator.querySelector("small");
    if (label) label.textContent = refreshing ? "Refreshing…" : "Release to refresh";
    if (refreshing) { this.indicator.style.height = `${THRESHOLD}px`; this.indicator.style.opacity = "1"; }
  }

  private removeIndicator(): void {
    if (this.indicator) { this.indicator.remove(); this.indicator = null; }
  }
}
