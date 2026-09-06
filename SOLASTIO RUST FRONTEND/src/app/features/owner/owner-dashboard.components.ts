import { Component, computed, inject, input, output } from "@angular/core";
import { DecimalPipe } from "@angular/common";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { OwnerDashboardKpi, OwnerDashboardSparkPoint, OwnerDashboardTrend, OwnerRevenuePoint } from "./owner-dashboard.models";
import { OwnerContextService } from "./owner-context.service";

@Component({
  selector: "owner-status-badge",
  standalone: true,
  template: `<span class="badge" [attr.data-tone]="tone()"><span aria-hidden="true"></span>{{ label() }}</span>`,
  styles: [`
    :host{display:inline-flex}.badge{display:inline-flex;align-items:center;gap:6px;min-height:26px;border:1px solid var(--owner-line);border-radius:999px;padding:3px 8px;color:var(--owner-muted);font-size:.62rem;font-weight:750;line-height:1.2;text-transform:capitalize}.badge span{width:6px;height:6px;border-radius:50%;background:currentColor}.badge[data-tone="positive"],.badge[data-tone="clockedIn"]{color:var(--owner-success)}.badge[data-tone="negative"],.badge[data-tone="critical"]{color:var(--owner-danger)}.badge[data-tone="attention"],.badge[data-tone="warning"],.badge[data-tone="scheduledWithAppointments"]{color:var(--owner-warning)}.badge[data-tone="scheduled"]{color:var(--owner-accent-strong)}
  `]
})
export class OwnerStatusBadgeComponent {
  readonly label = input.required<string>();
  readonly tone = input<string>("neutral");
}

@Component({
  selector: "owner-kpi-card",
  standalone: true,
  imports: [DecimalPipe, PaiseInrPipe],
  template: `
    <button type="button" class="card" [attr.data-trend]="metric().trend" [disabled]="!metric().availability.available" (click)="activate.emit()" [attr.aria-label]="label() + ', ' + valueLabel() + (metric().availability.available ? '. Open details' : '')">
      <span class="top"><span class="label">{{ label() }}</span></span>
      @if (metric().availability.available && metric().current !== null) {
        <strong>{{ metric().unit === 'paise' ? (metric().current | paiseInr) : (metric().current | number:'1.0-0') }}</strong>
        <span class="comparison">
          @if (metric().comparisonAvailable && metric().previous !== null) {
            <b>{{ trendSymbol(metric().trend) }} {{ metric().percentDelta === null ? 'Changed' : ((absolute(metric().percentDelta) | number:'1.0-1') + '%') }}</b>
            <span>vs {{ metric().unit === 'paise' ? (metric().previous | paiseInr) : (metric().previous | number:'1.0-0') }}</span>
          } @else { <span>Previous comparison unavailable</span> }
        </span>
        @if (metric().sparkline?.length) { <svg class="spark" viewBox="0 0 120 28" role="img" [attr.aria-label]="sparkLabel()"><path [attr.d]="sparkPath()"></path></svg> }
      } @else {
        <strong class="unavailable">Unavailable</strong><span class="comparison"><span>{{ metric().availability.reason || 'This metric is not supported.' }}</span></span>
      }
    </button>
  `,
  styles: [`
    :host{display:block;min-width:0}.card{display:grid;align-content:start;width:100%;min-height:166px;border:1px solid var(--owner-line);border-radius:16px;padding:16px;background:var(--owner-panel);color:var(--owner-text);text-align:left;transition:border-color .35s ease,transform .35s ease,box-shadow .35s ease}.card:hover:not(:disabled){border-color:var(--owner-line-strong);transform:translateY(-2px);box-shadow:var(--owner-shadow)}.card:disabled{cursor:not-allowed;opacity:.7}.card:disabled .arrow{display:none}.top{display:flex;align-items:center;justify-content:space-between;gap:8px}.label{color:var(--owner-muted);font-size:.68rem;font-weight:760}.arrow{color:var(--owner-faint)}strong{margin-top:18px;font-family:Georgia,"Times New Roman",serif;font-size:clamp(1.45rem,2.15vw,2rem);font-weight:500;letter-spacing:-.035em}.comparison{display:flex;align-items:center;gap:7px;min-height:28px;margin-top:5px;color:var(--owner-faint);font-size:.58rem}.comparison b{color:var(--owner-muted);font-weight:800}.card[data-trend="positive"] .comparison b{color:var(--owner-success)}.card[data-trend="negative"] .comparison b{color:var(--owner-danger)}.unavailable{font-family:inherit;font-size:1rem;letter-spacing:0}.spark{width:100%;height:28px;margin-top:5px;overflow:visible}.spark path{fill:none;stroke:var(--owner-accent);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}@media(max-width:600px){.card{min-height:150px;padding:14px}}@media(prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}
  `]
})
export class OwnerKpiCardComponent {
  readonly label = input.required<string>();
  readonly metric = input.required<OwnerDashboardKpi>();
  readonly activate = output<void>();
  readonly sparkPath = computed(() => this.path(this.metric().sparkline || []));
  valueLabel(): string { const metric = this.metric(); if (!metric.availability.available || metric.current === null) return "unavailable"; return metric.unit === "paise" ? `${metric.current} paise` : `${metric.current}`; }
  sparkLabel(): string { return `${this.label()} trend across ${this.metric().sparkline?.length || 0} recorded periods`; }
  trendSymbol(trend: OwnerDashboardTrend): string { return trend === "positive" ? "↑" : trend === "negative" ? "↓" : "→"; }
  absolute(value: number | null): number { return Math.abs(value ?? 0); }
  private path(points: OwnerDashboardSparkPoint[]): string {
    if (!points.length) return "";
    const values = points.map((point) => point.valuePaise);
    const min = Math.min(...values); const span = Math.max(...values) - min || 1;
    return points.map((point, index) => `${index ? "L" : "M"} ${(index / Math.max(points.length - 1, 1)) * 120} ${26 - ((point.valuePaise - min) / span) * 24}`).join(" ");
  }
}

@Component({
  selector: "owner-dashboard-item",
  standalone: true,
  imports: [OwnerStatusBadgeComponent],
  template: `
    <button type="button" (click)="activate.emit()">
      <span class="item-main"><strong>{{ title() }}</strong><span>{{ meta() }}</span></span>
      @if (value()) { <b>{{ value() }}</b> }
      <owner-status-badge [label]="badge()" [tone]="tone()" />
    </button>
  `,
  styles: [`
    :host{display:block;border-bottom:1px solid var(--owner-line)}:host:last-child{border-bottom:0}button{display:grid;grid-template-columns:minmax(0,1fr) auto auto 18px;align-items:center;gap:12px;width:100%;min-height:68px;border:0;padding:11px 2px;background:transparent;color:var(--owner-text);text-align:left}button:hover .item-main strong{color:var(--owner-accent-strong)}.item-main{display:grid;min-width:0;gap:4px}.item-main strong{font-size:.74rem;line-height:1.35}.item-main span{overflow:hidden;color:var(--owner-muted);font-size:.6rem;text-overflow:ellipsis;white-space:nowrap}button>b{color:var(--owner-text);font-family:Georgia,serif;font-size:.78rem;font-weight:500}.item-arrow{color:var(--owner-faint)}@media(max-width:540px){button{grid-template-columns:minmax(0,1fr) auto 16px}.item-main{grid-column:1/2}button>b{grid-column:1}owner-status-badge{grid-column:2;grid-row:1/3}.item-arrow{grid-column:3;grid-row:1/3}}
  `]
})
export class OwnerDashboardItemComponent {
  readonly title = input.required<string>();
  readonly meta = input.required<string>();
  readonly value = input("");
  readonly badge = input.required<string>();
  readonly tone = input("neutral");
  readonly activate = output<void>();
}

@Component({
  selector: "owner-revenue-chart",
  standalone: true,
  template: `
    <figure>
      <div class="legend" aria-hidden="true"><span><i></i>Selected period</span>@if (previous().length) { <span><i></i>Previous period</span> }</div>
      @if (current().length) {
        <svg viewBox="0 0 720 260" role="img" [attr.aria-labelledby]="chartId() + '-title ' + chartId() + '-description'">
          <title [id]="chartId() + '-title'">Net revenue trend</title><desc [id]="chartId() + '-description'">{{ summary() }}</desc>
          <path class="grid" d="M44 26H704M44 126H704M44 226H704"></path>
          @if (previous().length > 1) { <path class="previous" [attr.d]="previousPath()"></path> }
          @if (current().length > 1) { <path class="current" [attr.d]="currentPath()"></path> }
          @for (point of currentDots(); track $index) { <circle class="current-dot" [attr.cx]="point.x" [attr.cy]="point.y" r="3"></circle> }
        </svg>
        <div class="axis"><span>{{ bucketLabel(current()[0].bucket) }}</span><span>{{ grouping() }} grouping</span><span>{{ bucketLabel(current()[current().length - 1].bucket) }}</span></div>
      } @else { <div class="empty"><strong>No revenue points</strong><span>No recorded series is available for this period.</span></div> }
      <figcaption>{{ summary() }}</figcaption>
    </figure>
  `,
  styles: [`
    :host{display:block;min-width:0}figure{margin:0}.legend{display:flex;justify-content:flex-end;gap:15px;margin-bottom:8px;color:var(--owner-muted);font-size:.58rem}.legend span{display:flex;align-items:center;gap:5px}.legend i{width:16px;height:2px;background:var(--owner-accent)}.legend span:nth-child(2) i{background:var(--owner-line-strong)}svg{display:block;width:100%;height:auto;max-height:280px;overflow:visible}.grid{fill:none;stroke:var(--owner-line);stroke-width:1}.current,.previous{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-width:3;vector-effect:non-scaling-stroke}.current{stroke:var(--owner-accent)}.previous{stroke:var(--owner-line-strong);stroke-dasharray:5 6}.current-dot{fill:var(--owner-panel);stroke:var(--owner-accent);stroke-width:2;vector-effect:non-scaling-stroke}.axis{display:flex;justify-content:space-between;gap:10px;color:var(--owner-faint);font-size:.55rem;text-transform:capitalize}.empty{display:grid;place-items:center;gap:5px;min-height:220px;border:1px dashed var(--owner-line);border-radius:13px;color:var(--owner-muted);font-size:.68rem}.empty strong{color:var(--owner-text)}figcaption{margin-top:14px;color:var(--owner-muted);font-size:.63rem;line-height:1.5}
  `]
})
export class OwnerRevenueChartComponent {
  readonly ctx = inject(OwnerContextService);
  readonly current = input.required<OwnerRevenuePoint[]>();
  readonly previous = input.required<OwnerRevenuePoint[]>();
  readonly grouping = input.required<string>();
  readonly chartId = input("owner-revenue-chart");
  readonly scale = computed(() => {
    const values = [...this.current(), ...this.previous()].map((point) => point.netRevenuePaise);
    return { min: Math.min(0, ...values), max: Math.max(1, ...values) };
  });
  readonly currentPath = computed(() => this.line(this.current()));
  readonly previousPath = computed(() => this.line(this.previous()));
  readonly currentDots = computed(() => this.coordinates(this.current()));
  readonly summary = computed(() => {
    const points = this.current();
    if (!points.length) return "No net revenue series was returned for the selected period.";
    const total = points.reduce((sum, point) => sum + point.netRevenuePaise, 0);
    const peak = points.reduce((highest, point) => point.netRevenuePaise > highest.netRevenuePaise ? point : highest);
    return `${points.length} recorded ${this.grouping()} ${points.length === 1 ? "point" : "points"}. Total ${this.ctx.formatCurrency(total)}. Highest recorded bucket ${this.bucketLabel(peak.bucket)} at ${this.ctx.formatCurrency(peak.netRevenuePaise)}.`;
  });
  bucketLabel(value: string): string { const date = new Date(`${value}T00:00:00Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(this.ctx.effectiveLocale(), { day: "numeric", month: "short", timeZone: "UTC" }).format(date); }
  private inr(paise: number): string { return this.ctx.formatCurrency(paise); }
  private coordinates(points: OwnerRevenuePoint[]): Array<{ x: number; y: number }> {
    const { min, max } = this.scale(); const span = max - min || 1;
    return points.map((point, index) => ({ x: 44 + (index / Math.max(points.length - 1, 1)) * 660, y: 226 - ((point.netRevenuePaise - min) / span) * 200 }));
  }
  private line(points: OwnerRevenuePoint[]): string { return this.coordinates(points).map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" "); }
}
