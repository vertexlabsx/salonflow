import { DatePipe } from "@angular/common";
import { Component, computed, HostListener, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  StaffAppService,
  StaffBusiness,
  StaffBusinessAppointment,
  StaffBusinessInvoiceDetail,
  StaffBusinessQuery,
} from "../../core/staff-app.service";
import { businessDate } from "../../core/business-date";
import { formatPaiseInr } from "../../core/paise-inr.pipe";
import { StaffPageStateComponent } from "./staff-page-state.component";

type BusinessPreset = "today" | "1m" | "3m" | "6m" | "1y" | "custom";
type SearchSuggestion = { type: "Service" | "Invoice"; value: string };

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, StaffPageStateComponent],
  template: `
    <section class="page business-page">
      <header class="page-head">
        <div><p class="eyebrow">My business</p><h1>Work & billing</h1><p>Appointments, service time and billing across any selected period.</p></div>
      </header>

      @if (!canReadBusiness()) { <section staffPageState class="notice">You do not have permission to read staff business data.</section> }
      @if (message()) { <section staffPageState class="notice">{{ message() }}</section> }
      @if (loading()) { <section class="business-loading" role="status" aria-label="Loading business report"><span class="skeleton-line wide"></span><div><span></span><span></span><span></span><span></span></div><span class="skeleton-line"></span></section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (canReadBusiness()) {
        <section class="panel business-filter-panel">
          <div class="filter-heading"><div><p class="eyebrow">Report filter</p><h2>Selected period</h2></div><strong>{{ rangeLabel() }}</strong></div>
          <div class="filter-primary">
            <label>Period
              <select [ngModel]="preset()" (ngModelChange)="changePreset($event)">
                <option value="today">Today</option>
                <option value="1m">1 Month</option>
                <option value="3m">3 Months</option>
                <option value="6m">6 Months</option>
                <option value="1y">1 Year</option>
                <option value="custom">Custom Range</option>
              </select>
            </label>
            @if (preset() === 'custom') {
              <label>From<input type="date" [ngModel]="fromDate()" (ngModelChange)="fromDate.set($event)" /></label>
              <label>To<input type="date" [ngModel]="toDate()" (ngModelChange)="toDate.set($event)" /></label>
            }
          </div>
          <details class="advanced-filters">
            <summary><span><strong>Advanced filters</strong><small>Search, status and sort</small></span>@if (activeFilterCount()) { <b>{{ activeFilterCount() }} active</b> }<i class="expand-chevron" aria-hidden="true"></i></summary>
            <div class="form-grid compact-grid">
              <div class="search-field">
                <label for="business-search">Search</label>
                <div class="search-control">
                  <input id="business-search" type="search" autocomplete="off" role="combobox" aria-controls="business-search-suggestions" [attr.aria-expanded]="showSearchSuggestions() && searchSuggestions().length > 0" [ngModel]="search()" (ngModelChange)="search.set($event)" (focus)="showSearchSuggestions.set(true)" (blur)="closeSearchSuggestions()" (keydown.enter)="apply()" placeholder="Service or invoice" />
                  @if (showSearchSuggestions() && searchSuggestions().length) {
                    <div id="business-search-suggestions" class="search-suggestions" role="listbox">
                      @for (suggestion of searchSuggestions(); track suggestion.type + suggestion.value) {
                        <button type="button" role="option" (mousedown)="$event.preventDefault(); selectSuggestion(suggestion)" (click)="selectSuggestion(suggestion)">
                          <span>🔍 {{ suggestion.value }}</span><small>{{ suggestion.type }}</small>
                        </button>
                      }
                    </div>
                  }
                </div>
                <div class="search-chips-row">
                  @for (suggestion of searchSuggestions().slice(0, 4); track suggestion.type + suggestion.value) {
                    <button type="button" class="suggestion-chip" (mousedown)="$event.preventDefault(); selectSuggestion(suggestion)" (click)="selectSuggestion(suggestion)">
                      <span>🏷️ {{ suggestion.value }}</span>
                    </button>
                  }
                </div>
              </div>
              <label>Status
                <select [ngModel]="status()" (ngModelChange)="status.set($event)">
                  <option value="all">All Statuses</option>
                  <option value="booked">Booked</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="arrived">Arrived</option>
                  <option value="in-service">In Service</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="no-show">No-Show</option>
                </select>
              </label>
              <label>Sort
                <select [ngModel]="sort()" (ngModelChange)="sort.set($event)">
                  <option value="desc">Newest dates first</option>
                  <option value="asc">Oldest dates first</option>
                </select>
              </label>
            </div>
          </details>
          <div class="row-actions permission-actions">
            <button class="button primary" type="button" (click)="apply()">Apply</button>
            <button class="button" type="button" [disabled]="!activeFilterCount()" (click)="clearFilters()">Clear filters</button>
          </div>
        </section>
      }

      @if (canReadBusiness() && business(); as data) {
        @if (data.billingVisible) {
          <section class="dashboard-section revenue-summary-section" aria-labelledby="revenue-summary-heading">
            <header class="section-heading">
              <h2 id="revenue-summary-heading">Revenue Summary</h2>
            </header>
            <details class="panel invoice-totals-panel">
              <summary class="revenue-hero-summary"><span><small>Revenue</small><strong>{{ formatMoney(data.performance.attributedAfterDiscountPaise) }}</strong></span><span><small>Connected invoices</small><strong>{{ data.summary.bills }}</strong></span><span><small>Average bill</small><strong>{{ formatMoney(data.performance.averageBillPaise) }}</strong></span><i class="expand-chevron" aria-hidden="true"></i></summary>
              <section class="grid four invoice-totals-grid">
                <article class="kpi"><span>Bill amount</span><strong>{{ formatMoney(data.summary.subtotalPaise) }}</strong></article>
                <article class="kpi"><span>Manual discount</span><strong>{{ formatMoney(data.summary.discountPaise) }}</strong></article>
                <article class="kpi"><span>Coupon discount</span><strong>{{ formatMoney(data.summary.couponDiscountPaise) }}</strong></article>
                <article class="kpi"><span>After discount</span><strong>{{ formatMoney(data.summary.afterDiscountPaise) }}</strong></article>
                <article class="kpi"><span>GST</span><strong>{{ formatMoney(data.summary.gstPaise) }}</strong></article>
                <article class="kpi"><span>Grand total</span><strong>{{ formatMoney(data.summary.totalPaise) }}</strong></article>
                <article class="kpi"><span>Paid</span><strong>{{ formatMoney(data.summary.paidPaise) }}</strong></article>
                <article class="kpi"><span>Due</span><strong>{{ formatMoney(data.summary.duePaise) }}</strong></article>
              </section>
            </details>
          </section>
        }

        <div class="metric-overview">
          <section class="dashboard-section performance-summary-section" aria-labelledby="period-performance-heading">
            <header class="section-heading">
              <h2 id="period-performance-heading">Period Performance</h2>
            </header>
            <section class="grid four business-kpi-grid">
              <article class="kpi"><span>Appointments</span><strong>{{ data.summary.appointments }}</strong></article>
              <article class="kpi"><span>Services</span><strong>{{ data.summary.completedServices }}</strong></article>
              @if (data.billingVisible) {
                <article class="kpi"><span>My revenue</span><strong>{{ formatMoney(data.performance.attributedAfterDiscountPaise) }}</strong></article>
                <article class="kpi"><span>Avg bill</span><strong>{{ formatMoney(data.performance.averageBillPaise) }}</strong></article>
              } @else {
                <article class="kpi"><span>Billing</span><strong>Restricted</strong></article>
                <article class="kpi"><span>Services</span><strong>{{ data.summary.completedServices }}</strong></article>
              }
            </section>
          </section>

          <section class="dashboard-section kpi-section" aria-labelledby="kpi-grid-heading">
            <header class="section-heading">
              <h2 id="kpi-grid-heading">Time & Capacity</h2>
            </header>
            <section class="grid four business-kpi-grid">
              <article class="kpi"><span>Worked</span><strong>{{ formatMinutes(data.summary.workedMinutes) }}</strong></article>
              <article class="kpi"><span>Scheduled</span><strong>{{ formatMinutes(data.summary.scheduledMinutes) }}</strong></article>
              <article class="kpi"><span>Duty</span><strong>{{ formatMinutes(data.performance.dutyMinutes) }}</strong></article>
              <article class="kpi"><span>Utilization</span><strong>{{ formatPercent(data.performance.utilizationPercent) }}</strong></article>
            </section>
          </section>
        </div>

        <section class="dashboard-section ai-insights-section" aria-labelledby="period-summary-heading">
          <article class="ai-insights-card period-summary-card">
            <header class="ai-insights-head">
              <span class="ai-insights-icon" aria-hidden="true">≡</span>
              <div>
                <p>Selected period</p>
                <h2 id="period-summary-heading">Period Summary</h2>
                <small>{{ rangeLabel() }}</small>
              </div>
            </header>
            @if (data.summary.appointments || data.summary.completedServices || data.summary.workedMinutes || data.performance.utilizationPercent !== null) {
              <div class="period-summary-list">
                <p><strong>Work output</strong><span>{{ data.summary.completedServices }} services were completed across {{ data.summary.appointments }} appointments.</span></p>
                <p><strong>Time efficiency</strong><span>{{ formatMinutes(data.summary.workedMinutes) }} worked against {{ formatMinutes(data.summary.scheduledMinutes) }} scheduled, with {{ formatPercent(data.performance.utilizationPercent) }} utilization.</span></p>
                @if (data.billingVisible) { <p><strong>Commercial efficiency</strong><span>Average Bill: {{ formatMoney(data.performance.averageBillPaise) }} · Revenue per Worked Hour: {{ formatMoney(data.performance.revenuePerWorkedHourPaise) }}.</span></p> }
              </div>
            } @else {
              <p class="ai-insights-empty">A period summary will appear when work is recorded for the selected dates.</p>
            }
          </article>
        </section>

        <section class="dashboard-section charts-section" aria-labelledby="performance-charts-heading">
          <header class="section-heading">
            <h2 id="performance-charts-heading">Performance Views</h2>
          </header>
          <div class="analytics-preview-grid">
            <details class="analytics-card revenue-analytics-card">
              <summary>
                <span class="analytics-card-heading"><span>Revenue Performance</span><small>Revenue, average bill & hourly yield</small>@if (data.billingVisible) { <strong>{{ formatMoney(data.performance.attributedAfterDiscountPaise) }}</strong> }</span>
                @if (data.billingVisible) {
                  @if (data.performance.attributedAfterDiscountPaise || data.performance.averageBillPaise || data.performance.revenuePerWorkedHourPaise) {
                    <span class="mini-bars" aria-hidden="true">
                      @for (revenueItem of revenueChart(data); track revenueItem.label) { <i [style.height.%]="revenueItem.percent"></i> }
                    </span>
                  } @else { <span class="analytics-empty">No revenue data available for the selected period.</span> }
                } @else { <span class="analytics-empty">Revenue restricted</span> }
                <i class="expand-chevron" aria-hidden="true"></i>
              </summary>
              <div class="analytics-detail">
                @if (data.billingVisible) {
                  <article class="chart-card">
                    <h3>Revenue comparison</h3>
                    @for (revenueItem of revenueChart(data); track revenueItem.label) {
                      <div class="chart-row">
                        <span>{{ revenueItem.label }}</span>
                        <div class="chart-track"><i [style.width.%]="revenueItem.percent"></i></div>
                        <strong>{{ formatMoney(revenueItem.value) }}</strong>
                      </div>
                    }
                  </article>
                } @else { <p class="analytics-empty-detail">Revenue details are restricted for your role.</p> }
              </div>
            </details>

            <details class="analytics-card service-analytics-card">
              <summary>
                <span class="analytics-card-heading"><span>Capacity Utilization</span><small>Worked time utilization</small><strong>{{ formatPercent(data.performance.utilizationPercent) }}</strong></span>
                @if (data.performance.utilizationPercent !== null) {
                  <span class="mini-progress" aria-hidden="true"><i [style.width.%]="capProgress(data.performance.utilizationPercent || 0)"></i></span>
                } @else { <span class="analytics-empty">No utilization data available for the selected period.</span> }
                <i class="expand-chevron" aria-hidden="true"></i>
              </summary>
              <div class="analytics-detail">
                <article class="chart-card utilization-chart">
                  <h3>Utilization</h3>
                  <strong>{{ formatPercent(data.performance.utilizationPercent) }}</strong>
                  <div class="chart-track"><i [style.width.%]="capProgress(data.performance.utilizationPercent || 0)"></i></div>
                  <small>Worked time compared with duty time</small>
                </article>
              </div>
            </details>

            <details class="analytics-card appointment-analytics-card">
              <summary>
                <span class="analytics-card-heading"><span>Appointment Mix</span><small>Status distribution</small><strong>{{ data.summary.appointments }} appointments</strong></span>
                @if (data.summary.appointments) {
                  <span class="mini-bars" aria-hidden="true">
                    @for (statusItem of statusMetrics(data); track statusItem.label) { <i [style.height.%]="statusChartPercent(statusItem.value, data)"></i> }
                  </span>
                } @else { <span class="analytics-empty">No appointment data available for the selected period.</span> }
                <i class="expand-chevron" aria-hidden="true"></i>
              </summary>
              <div class="analytics-detail">
                <article class="chart-card">
                  <h3>Status distribution</h3>
                  @for (statusItem of statusMetrics(data); track statusItem.label) {
                    <div class="chart-row">
                      <span>{{ statusItem.label }}</span>
                      <div class="chart-track"><i [style.width.%]="statusChartPercent(statusItem.value, data)"></i></div>
                      <strong>{{ statusItem.value }}</strong>
                    </div>
                  }
                </article>
              </div>
            </details>

            <details class="analytics-card hours-analytics-card">
              <summary>
                <span class="analytics-card-heading"><span>Working Hours</span><small>Worked, scheduled & duty</small><strong>{{ formatMinutes(data.summary.workedMinutes) }}</strong></span>
                @if (data.summary.workedMinutes || data.summary.scheduledMinutes || data.performance.dutyMinutes) {
                  <span class="mini-bars" aria-hidden="true">
                    @for (timeItem of timeChart(data); track timeItem.label) { <i [style.height.%]="timeItem.percent"></i> }
                  </span>
                } @else { <span class="analytics-empty">No working-hours data available for the selected period.</span> }
                <i class="expand-chevron" aria-hidden="true"></i>
              </summary>
              <div class="analytics-detail">
                <article class="chart-card">
                  <h3>Time comparison</h3>
                  @for (timeItem of timeChart(data); track timeItem.label) {
                    <div class="chart-row">
                      <span>{{ timeItem.label }}</span>
                      <div class="chart-track"><i [style.width.%]="timeItem.percent"></i></div>
                      <strong>{{ formatMinutes(timeItem.value) }}</strong>
                    </div>
                  }
                </article>
              </div>
            </details>
          </div>
        </section>

        <section class="dashboard-section status-section" aria-labelledby="status-mix-heading">
          <header class="section-heading">
            <h2 id="status-mix-heading">Status Mix</h2>
          </header>
          <section class="panel status-mix-panel">
            <div class="status-mix-head"><span>Filtered appointment outcomes</span><strong>{{ data.summary.appointments }} total</strong></div>
            <div class="grid four status-mix-grid">
              @for (statusItem of statusMetrics(data); track statusItem.label) {
                <article class="kpi"><span>{{ statusItem.label }}</span><strong>{{ statusItem.value }}</strong><small>{{ statusPercentLabel(statusItem.value, data) }}</small><div class="status-meter" aria-hidden="true"><i [style.width.%]="statusChartPercent(statusItem.value, data)"></i></div></article>
              }
            </div>
          </section>
        </section>

        @if (data.earnings || !data.permissions.earnings || data.targets.length) {
          <section class="dashboard-section earnings-section" aria-labelledby="earnings-heading">
            <header class="section-heading">
              <h2 id="earnings-heading">Earnings</h2>
            </header>
            @if (data.earnings; as earnings) {
              <details class="earnings-financial-shell earnings-overview" aria-label="Earnings and payroll financial summary">
                <summary class="earnings-compact-summary"><span class="earnings-kpi-chip"><small>Revenue</small><strong>{{ data.billingVisible ? formatMoney(data.performance.attributedAfterDiscountPaise) : 'Restricted' }}</strong></span><span class="earnings-kpi-chip"><small>Commission</small><strong>{{ formatMoney(earnings.calculatedCommissionPaise) }}</strong></span><span class="earnings-kpi-chip"><small>Average bill</small><strong>{{ data.billingVisible ? formatMoney(data.performance.averageBillPaise) : 'Restricted' }}</strong></span><i class="expand-chevron" aria-hidden="true"></i></summary>
                <div class="earnings-summary-head">
                  <div><span>Financial summary</span><strong>{{ rangeLabel() }}</strong></div>
                  <small>Current report period</small>
                </div>
                <section class="earnings-summary-grid" aria-label="Financial metrics">
                  <article class="financial-metric revenue-metric">
                    <span>Revenue</span>
                    @if (data.billingVisible) {
                      @if (data.performance.attributedAfterDiscountPaise !== null) {
                        <strong>{{ formatMoney(data.performance.attributedAfterDiscountPaise) }}</strong><small>Attributed after discount</small>
                      } @else { <strong class="metric-state">Unavailable</strong><small>No attributed revenue reported</small> }
                    } @else { <strong class="metric-state">Restricted</strong><small>Billing access required</small> }
                  </article>
                  <article class="financial-metric">
                    <span>Commission Earned</span>
                    <strong>{{ formatMoney(earnings.calculatedCommissionPaise) }}</strong><small>Calculated commission</small>
                  </article>
                  <article class="financial-metric unavailable-metric">
                    <span>Commission Paid</span>
                    <strong class="metric-state">Unavailable</strong><small>Not reported separately</small>
                  </article>
                  <article class="financial-metric unavailable-metric">
                    <span>Pending Commission</span>
                    <strong class="metric-state">Unavailable</strong><small>Not reported separately</small>
                  </article>
                  <article class="financial-metric">
                    <span>Average Bill</span>
                    @if (data.billingVisible) {
                      @if (data.performance.averageBillPaise !== null) {
                        <strong>{{ formatMoney(data.performance.averageBillPaise) }}</strong><small>Attributed average</small>
                      } @else { <strong class="metric-state">Unavailable</strong><small>No average reported</small> }
                    } @else { <strong class="metric-state">Restricted</strong><small>Billing access required</small> }
                  </article>
                  <article class="financial-metric">
                    <span>Total Bills</span>
                    @if (data.billingVisible) {
                      <strong>{{ data.summary.bills }}</strong><small>Connected invoices</small>
                    } @else { <strong class="metric-state">Restricted</strong><small>Billing access required</small> }
                  </article>
                </section>
                <details class="earnings-breakdown">
                  <summary><span><strong>View breakdown</strong><small>Commission, tips, payroll and pay periods</small></span><i class="expand-chevron" aria-hidden="true"></i></summary>
                  <div class="earnings-breakdown-content">
                    <section class="grid four earnings-grid">
                      <article class="kpi"><span>Calculated commission</span><strong>{{ formatMoney(earnings.calculatedCommissionPaise) }}</strong><small>{{ formatMoney(earnings.approvedCommissionPaise) }} approved</small></article>
                      <article class="kpi"><span>Tips collected</span><strong>{{ formatMoney(earnings.tipsCollectedPaise) }}</strong><small>{{ formatMoney(earnings.tipsPendingPaise) }} pending payout</small></article>
                      <article class="kpi"><span>Payroll net</span><strong>{{ formatMoney(earnings.payrollNetPaise) }}</strong><small>{{ formatMoney(earnings.payrollGrossPaise) }} gross</small></article>
                      <article class="kpi"><span>Payroll paid</span><strong>{{ formatMoney(earnings.payrollPaidPaise) }}</strong><small>{{ formatMoney(earnings.payrollPendingPaise) }} pending</small></article>
                    </section>
                    @for (period of earnings.periods; track period.payrollRunId) {
                      <p>{{ dateLabel(period.periodStart) }} – {{ dateLabel(period.periodEnd) }} · {{ period.status }} · Net {{ formatMoney(period.netPaise) }}</p>
                    }
                  </div>
                </details>
              </details>
            } @else if (!data.permissions.earnings) {
              <section staffPageState class="notice">Earnings and payroll are restricted for your role.</section>
            }

            @if (data.targets.length) {
              <section class="panel targets-panel">
                <div class="panel-title"><h2>Overlapping targets</h2><span>Saved period values, not prorated</span></div>
                <div class="grid four">
                  @for (target of data.targets; track target.id) {
                    <article class="kpi">
                      <span>{{ target.type }}</span>
                      <strong>{{ formatTargetValue(target.achievedValue, target.unit) }} / {{ formatTargetValue(target.targetValue, target.unit) }}</strong>
                      <small>{{ target.progressPercent }}% · {{ dateLabel(target.periodStart) }}–{{ dateLabel(target.periodEnd) }}</small>
                      <div class="timer-track"><span [style.width.%]="capProgress(target.progressPercent)"></span></div>
                    </article>
                  }
                </div>
              </section>
            }
          </section>
        }

        <section class="dashboard-section timeline-section" aria-labelledby="work-timeline-heading">
          <header class="section-heading">
            <h2 id="work-timeline-heading">Appointment Details</h2>
          </header>
          <section class="panel detailed-work-head timeline-overview">
            <div class="panel-title">
               <h2>Appointment history</h2>
              <span>Showing {{ data.appointments.length }} of {{ data.pagination.totalItems }}</span>
            </div>
          </section>

          @for (group of appointmentGroups(); track group.date) {
            <section class="panel business-day-panel activity-day">
              <div class="panel-title business-day-title">
                <h2>{{ dateLabel(group.date) }}</h2>
                <span>{{ group.summary.appointments }} {{ group.summary.appointments === 1 ? 'appointment' : 'appointments' }}</span>
              </div>
              <div class="business-appointment-list activity-timeline">
                @for (item of group.appointments; track item.id) {
                  <details class="business-appointment-row activity-entry">
                    <summary>
                      <span class="timeline-dot" aria-hidden="true"></span>
                      <span class="activity-summary">
                        <span class="activity-primary">
                          <span class="activity-service">
                            <small>Service</small>
                            <strong>{{ item.serviceNames.join(', ') || 'Service not mapped' }}</strong>
                          </span>
                          <span class="activity-status badge" [class.red]="item.state === 'late'" [class.green]="item.state === 'active'">{{ item.status }}</span>
                        </span>
                        <span class="activity-facts">
                          <span><small>Time</small><strong>{{ item.startAt | date:'shortTime':'+0530' }}–{{ item.endAt | date:'shortTime':'+0530' }}</strong></span>
                          <span><small>Duration</small><strong>{{ formatMinutes(item.durationMinutes) }}</strong></span>
                          @if (data.billingVisible) {
                            <span><small>Invoice</small><strong>{{ item.billing ? (item.billing.invoiceNumber || item.billing.saleId) : 'Not generated' }}</strong></span>
                            <span><small>Revenue</small><strong>{{ item.attribution ? formatMoney(item.attribution.afterDiscountPaise) : 'Not available' }}</strong></span>
                          }
                        </span>
                      </span>
                      <span class="activity-expand" aria-hidden="true"><small>Details</small><span class="expand-chevron"></span></span>
                    </summary>
                    <div class="appointment-expanded">
                      <div class="appointment-detail-grid">
                        <article><span>Chair</span><strong>{{ item.chair || 'Not assigned' }}</strong></article>
                        <article><span>Work tracking</span><strong>{{ formatMinutes(liveElapsed(item)) }} / {{ formatMinutes(item.durationMinutes) }}</strong><small>{{ item.timer.timeSource === 'actual' ? 'Actual time' : 'Estimated time' }}</small></article>
                        @if (item.timer.startedAt) { <article><span>Actual time</span><strong>{{ item.timer.startedAt | date:'shortTime':'+0530' }} @if (item.timer.completedAt) { – {{ item.timer.completedAt | date:'shortTime':'+0530' }} }</strong></article> }
                        @if (item.timer.live) { <article class="wide live-progress"><span>Live progress</span><div class="timer-track"><span [style.width.%]="liveProgress(item)"></span></div><small>{{ liveElapsed(item) }} min elapsed · {{ liveRemaining(item) }} min remaining @if (liveOverrun(item)) { · {{ liveOverrun(item) }} min overrun }</small></article> }
                        @if (!item.timer.live && item.timer.overrunMinutes) { <article><span>Overrun</span><strong>{{ item.timer.overrunMinutes }} min</strong></article> }
                        @if (data.billingVisible && item.attribution; as share) { <article class="wide financial-detail"><span>Attributed revenue</span><strong>{{ formatMoney(share.afterDiscountPaise) }}</strong><small>Gross {{ formatMoney(share.grossPaise) }} · Discount {{ formatMoney(share.discountPaise) }} · GST {{ formatMoney(share.gstPaise) }} · Paid {{ formatMoney(share.paidPaise) }} · Due {{ formatMoney(share.duePaise) }}</small></article> }
                        @if (data.billingVisible && item.billing; as bill) { <article class="wide financial-detail"><span>Invoice {{ bill.invoiceNumber || bill.saleId }}</span><strong>{{ formatMoney(bill.totalPaise) }} · {{ bill.invoiceStatus || 'pending' }}</strong><small>Amount {{ formatMoney(bill.subtotalPaise) }} · Discount {{ formatMoney(bill.discountPaise) }} · Coupon {{ formatMoney(bill.couponDiscountPaise) }} · GST {{ formatMoney(bill.gstPaise) }} · Paid {{ formatMoney(bill.paidPaise) }} · Due {{ formatMoney(bill.duePaise) }}</small></article> } @else if (data.billingVisible) { <article class="wide muted-detail"><span>Invoice</span><strong>Not generated</strong></article> } @else { <article class="wide muted-detail"><span>Billing</span><strong>Restricted for your role</strong></article> }
                      </div>
                      <div class="row-actions">
                        <button class="link-button" type="button" (click)="openAppointment(item, $event)">Details</button>
                        @if (data.permissions.invoiceDetail && item.billing?.invoiceId) { <button class="link-button" type="button" (click)="openInvoice(item, $event)">Invoice</button> }
                      </div>
                    </div>
                  </details>
                }
              </div>
              <details class="business-day-summary">
                <summary><span>Day summary</span><i class="expand-chevron" aria-hidden="true"></i></summary>
                <p>{{ group.summary.completedServices }} completed · {{ formatMinutes(group.summary.workedMinutes) }} worked · {{ formatPercent(group.summary.performance.utilizationPercent) }} utilized</p>
                @if (data.billingVisible) {
                  <p>Bill {{ formatMoney(group.summary.subtotalPaise) }} · Discount {{ formatMoney(group.summary.discountPaise) }} · Coupon {{ formatMoney(group.summary.couponDiscountPaise) }} · Due {{ formatMoney(group.summary.duePaise) }}</p>
                }
              </details>
            </section>
          } @empty {
            <section class="panel business-empty"><span aria-hidden="true">—</span><strong>No appointment activity</strong><p>No staff work matches the selected period and filters.</p></section>
          }

          @if (data.pagination.hasMore) {
            <div class="row-actions permission-actions">
              <button class="button" type="button" [disabled]="loadingMore()" (click)="loadMore()">{{ loadingMore() ? 'Loading…' : 'Load More' }}</button>
            </div>
          }
        </section>
      }

      @if (selectedAppointment(); as item) {
        <div class="drawer-backdrop" (click)="dismissBackdrop($event)">
          <aside id="business-appointment-drawer" class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="business-appointment-title" tabindex="-1">
            <div class="panel-title"><h2 id="business-appointment-title">Appointment detail</h2><button class="link-button" type="button" (click)="closeDrawers()">Close</button></div>
            <section class="grid two compact-grid">
              <article class="kpi"><span>Work item</span><strong>Assigned appointment</strong></article>
              <article class="kpi"><span>Status</span><strong>{{ item.status }}</strong></article>
              <article class="kpi"><span>Worked</span><strong>{{ formatMinutes(liveElapsed(item)) }}</strong><small>{{ item.timer.timeSource }}</small></article>
              <article class="kpi"><span>Scheduled</span><strong>{{ formatMinutes(item.durationMinutes) }}</strong><small>{{ item.timer.overrunMinutes }} min overrun</small></article>
            </section>
            <div class="list">
              <div class="row"><strong>Time</strong><span>{{ item.startAt | date:'short':'+0530' }} – {{ item.endAt | date:'shortTime':'+0530' }}</span></div>
              <div class="row"><strong>Services</strong><span>{{ item.serviceNames.join(', ') || '-' }}</span></div>
              <div class="row"><strong>Chair</strong><span>{{ item.chair || '-' }}</span></div>
            </div>
          </aside>
        </div>
      }

      @if (invoiceDrawerOpen()) {
        <div class="drawer-backdrop" (click)="dismissBackdrop($event)">
          <aside id="business-invoice-drawer" class="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="business-invoice-title" tabindex="-1">
            <div class="panel-title"><h2 id="business-invoice-title">Invoice detail</h2><button class="link-button" type="button" (click)="closeDrawers()">Close</button></div>
            @if (invoiceLoading()) { <section staffPageState class="state" [loading]="true">Loading invoice...</section> }
            @if (invoiceError()) { <section staffPageState class="notice">{{ invoiceError() }}</section> }
            @if (invoiceDetail(); as invoice) {
              <section class="grid two compact-grid">
                <article class="kpi"><span>Invoice</span><strong>{{ invoice.invoiceNumber || invoice.id }}</strong><small>{{ invoice.status }}</small></article>
                <article class="kpi"><span>Total</span><strong>{{ formatMoney(invoice.totals.totalPaise) }}</strong><small>{{ formatMoney(invoice.totals.duePaise) }} due</small></article>
              </section>
              @if (invoice.clientName) { <div class="list"><div class="row"><strong>Client name</strong><span>{{ invoice.clientName }}</span></div></div> }
              <div class="list">
                @for (item of invoice.items; track item.id) {
                  <div class="row"><div><strong>{{ item.name }}</strong><small>{{ item.type }} · Qty {{ item.quantity }}</small></div><span>{{ formatMoney(item.amountPaise) }}</span></div>
                } @empty { <p class="empty">No invoice items available.</p> }
              </div>
              <h3>Payments</h3>
              <div class="list">
                @for (payment of invoice.payments; track payment.id) {
                  <div class="row"><div><strong>{{ payment.mode || 'Payment' }}</strong><small>{{ payment.createdAt | date:'short':'+0530' }}</small></div><span>{{ formatMoney(payment.amountPaise) }}</span></div>
                } @empty { <p class="empty">No payments recorded.</p> }
              </div>
            }
          </aside>
        </div>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .business-page {
      --business-line: color-mix(in srgb, var(--staff-border) 72%, transparent);
      --business-line-strong: color-mix(in srgb, var(--staff-border) 92%, transparent);
      --business-muted: color-mix(in srgb, var(--staff-text) 62%, transparent);
      --business-surface: color-mix(in srgb, var(--staff-surface) 97%, #0b0e12);
      --business-surface-raised: color-mix(in srgb, var(--staff-surface) 91%, #171c22);
      --business-accent: #75d8c1;
      --business-radius: 18px;
      min-width: 0;
      padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px));
    }
    .business-page > .page-head { padding-bottom: clamp(14px, 1.8vw, 20px); border-bottom: 1px solid var(--business-line); }
    .business-page > .page-head h1 { letter-spacing: -.045em; text-wrap: balance; }
    .business-page > .page-head p:not(.eyebrow) { max-width: 62ch; color: var(--business-muted); line-height: 1.55; }
    .business-page > :is(.state, .notice) { min-height: 58px; border: 1px solid var(--business-line-strong); border-radius: 16px; background: var(--business-surface); box-shadow: 0 8px 24px rgba(3, 6, 12, .1); }
    .business-page > .state, .detail-drawer .state { color: color-mix(in srgb, var(--staff-text) 76%, transparent); }
    .business-filter-panel { position: relative; z-index: 3; border-color: var(--business-line-strong); border-radius: var(--business-radius); background: var(--business-surface); box-shadow: 0 12px 32px rgba(3, 6, 12, .13); }
    .business-filter-panel .panel-title { padding-bottom: 11px; border-bottom: 1px solid color-mix(in srgb, var(--staff-border) 62%, transparent); }
    .business-filter-panel .panel-title h2 { letter-spacing: -.025em; }
    .business-filter-panel .panel-title span { color: var(--business-muted); font-variant-numeric: tabular-nums; }
    .business-filter-panel :is(label, .search-field) { letter-spacing: .015em; }
    .business-filter-panel :is(input, select) { border-color: color-mix(in srgb, var(--staff-border) 88%, transparent); background-color: color-mix(in srgb, var(--staff-surface) 92%, #090c10); transition: border-color var(--staff-motion-fast) var(--staff-motion-ease), background-color var(--staff-motion-fast) var(--staff-motion-ease), box-shadow var(--staff-motion-fast) var(--staff-motion-ease); }
    .business-filter-panel :is(input, select):hover { border-color: color-mix(in srgb, var(--staff-primary-hover) 26%, var(--staff-border)); }
    .business-filter-panel :is(input, select):focus-visible { border-color: color-mix(in srgb, var(--staff-primary-hover) 64%, var(--staff-border)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--staff-primary-hover) 13%, transparent); }
    .business-filter-panel .permission-actions { padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--staff-border) 56%, transparent); }
    .business-filter-panel .button { transition: border-color var(--staff-motion-fast) var(--staff-motion-ease), background-color var(--staff-motion-fast) var(--staff-motion-ease), box-shadow var(--staff-motion-fast) var(--staff-motion-ease), transform var(--staff-motion-fast) var(--staff-motion-ease); }
    .business-filter-panel .button.primary { box-shadow: 0 8px 20px color-mix(in srgb, var(--staff-primary-hover) 14%, transparent); }
    .business-filter-panel .button:disabled { cursor: not-allowed; opacity: .58; box-shadow: none; }
    .timeline-section .button:disabled { cursor: progress; opacity: .58; box-shadow: none; }
    .search-field { display: grid; gap: 7px; min-width: 0; color: var(--staff-text); font-size: .8rem; font-weight: 700; }
    .search-control { position: relative; }
    .search-control input { width: 100%; }
    .search-suggestions { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; left: 0; overflow: hidden; border: 1px solid color-mix(in srgb, var(--staff-border) 88%, transparent); border-radius: 14px; background: var(--staff-surface); box-shadow: 0 18px 42px rgba(3, 6, 12, .3), inset 0 1px rgba(255, 255, 255, .035); }
    .search-suggestions button { display: flex; width: 100%; min-height: 48px; align-items: center; justify-content: space-between; gap: 10px; border: 0; border-bottom: 1px solid var(--staff-border); border-radius: 0; padding: 10px 12px; color: var(--staff-text); background: transparent; text-align: left; }
    .search-suggestions button:last-child { border-bottom: 0; }
    .search-suggestions button:hover, .search-suggestions button:focus-visible { background: var(--staff-primary-light); }
    .search-suggestions span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .search-suggestions small { flex: 0 0 auto; color: var(--staff-primary-hover); font-size: .62rem; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .dashboard-section { display: grid; gap: 14px; min-width: 0; padding-block: clamp(14px, 2vw, 24px); }
    .dashboard-section + .dashboard-section, .metric-overview + .dashboard-section, .dashboard-section + .metric-overview { border-top: 1px solid var(--business-line); }
    .metric-overview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); min-width: 0; border-top: 1px solid var(--business-line); }
    .metric-overview > .dashboard-section { align-content: start; border-top: 0; }
    .metric-overview > .dashboard-section:first-child { padding-right: clamp(14px, 2vw, 24px); }
    .metric-overview > .dashboard-section:last-child { padding-left: clamp(14px, 2vw, 24px); border-left: 1px solid var(--business-line); }
    .section-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 4px 24px; }
    .section-heading p { grid-column: 1 / -1; margin: 0; color: var(--business-accent); font-size: .66rem; font-weight: 800; letter-spacing: .12em; line-height: 1.2; text-transform: uppercase; }
    .section-heading h2 { margin: 0; color: var(--staff-text); font-size: clamp(1.15rem, 1rem + .7vw, 1.65rem); letter-spacing: -.035em; line-height: 1.08; }
    .dashboard-section > .panel { margin: 0; }
    .dashboard-section .kpi { min-width: 0; border-color: var(--business-line); border-radius: 15px; background: var(--business-surface); box-shadow: 0 6px 18px rgba(3, 6, 12, .08); }
    .dashboard-section .kpi > span { color: var(--business-muted); font-weight: 750; letter-spacing: .04em; }
    .dashboard-section .kpi > strong { overflow-wrap: anywhere; font-variant-numeric: tabular-nums; letter-spacing: -.035em; }
    .metric-overview .business-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
    .metric-overview .kpi { min-height: 86px; padding: 14px; }
    .metric-overview .kpi > strong { margin-top: 8px; font-size: clamp(1.2rem, 1rem + .8vw, 1.65rem); line-height: 1; }
    .ai-insights-section { padding-block: clamp(12px, 2vw, 20px); }
    .ai-insights-card { position: relative; display: grid; min-width: 0; gap: 16px; overflow: hidden; padding: clamp(16px, 2.2vw, 22px); border: 1px solid rgba(126, 224, 200, .2); border-radius: var(--business-radius); color: #f5f8f7; background: #12191b; box-shadow: 0 10px 28px rgba(3, 6, 12, .14); }
    .ai-insights-card::before { position: absolute; inset: 0 auto 0 0; width: 3px; content: ""; background: var(--business-accent); }
    .ai-insights-head { position: relative; z-index: 1; display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: start; gap: 13px; }
    .ai-insights-icon { display: grid; width: 40px; height: 40px; place-items: center; border: 1px solid rgba(154, 236, 216, .24); border-radius: 12px; color: #b9f0e2; background: rgba(105, 214, 187, .1); box-shadow: inset 0 1px rgba(255, 255, 255, .06); font-size: 1rem; }
    .ai-insights-head div { display: grid; min-width: 0; gap: 4px; }
    .ai-insights-head p { margin: 0; color: #8ddfca; font-size: .6rem; font-weight: 800; letter-spacing: .12em; line-height: 1.2; text-transform: uppercase; }
    .ai-insights-head h2 { margin: 0; color: #f7faf9; font-size: clamp(1.08rem, .98rem + .55vw, 1.4rem); letter-spacing: -.035em; line-height: 1.1; }
    .ai-insights-head small { max-width: 62ch; color: #a3afb4; font-size: .68rem; line-height: 1.45; }
    .ai-insight-list { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid rgba(255, 255, 255, .09); }
    .ai-insight-list p { display: grid; min-width: 0; gap: 4px; margin: 0; padding: 14px 14px 2px; border-left: 1px solid rgba(255, 255, 255, .08); }
    .ai-insight-list p:first-child { border-left: 0; padding-left: 0; }
    .ai-insight-list span { color: #91a0a5; font-size: .61rem; font-weight: 760; letter-spacing: .07em; line-height: 1.2; text-transform: uppercase; }
    .ai-insight-list strong { overflow-wrap: anywhere; color: #e9fbf6; font-size: clamp(1.08rem, .96rem + .7vw, 1.45rem); font-variant-numeric: tabular-nums; letter-spacing: -.04em; line-height: 1.1; }
    .ai-insight-list small { color: #849297; font-size: .59rem; line-height: 1.3; }
    .ai-insights-empty { position: relative; z-index: 1; margin: 0; padding: 13px 14px; border: 1px dashed rgba(154, 236, 216, .17); border-radius: 12px; color: #a8b5b8; background: rgba(255, 255, 255, .025); font-size: .72rem; line-height: 1.45; }
    :is(.invoice-totals-panel, .status-mix-panel) { overflow: hidden; border-color: var(--business-line-strong); border-radius: var(--business-radius); background: var(--business-surface); box-shadow: 0 8px 24px rgba(3, 6, 12, .1); }
    :is(.invoice-totals-panel, .status-mix-panel) > summary { display: flex; min-height: 44px; align-items: center; color: color-mix(in srgb, var(--staff-text) 84%, transparent); font-size: .82rem; font-weight: 720; letter-spacing: -.01em; line-height: 1.3; list-style: none; cursor: pointer; transition: color var(--staff-motion-fast) var(--staff-motion-ease), background-color var(--staff-motion-fast) var(--staff-motion-ease); }
    :is(.invoice-totals-panel, .status-mix-panel) > summary::-webkit-details-marker { display: none; }
    :is(.invoice-totals-panel, .status-mix-panel) > summary::before { width: 18px; margin-right: 7px; color: var(--staff-primary-hover); content: "▶"; font-size: .58rem; line-height: 1; text-align: center; transform-origin: center; transition: transform var(--staff-motion-fast) var(--staff-motion-ease); }
    :is(.invoice-totals-panel, .status-mix-panel)[open] > summary { margin-bottom: 10px; color: var(--staff-text); }
    :is(.invoice-totals-panel, .status-mix-panel)[open] > summary::before { transform: rotate(90deg); }
    :is(.invoice-totals-panel, .status-mix-panel) > summary:focus-visible { border-radius: 10px; outline: 2px solid var(--staff-primary-hover); outline-offset: 3px; }
    .analytics-preview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .analytics-card { min-width: 0; overflow: hidden; border: 1px solid var(--business-line-strong); border-radius: var(--business-radius); color: var(--staff-text); background: var(--business-surface); box-shadow: 0 8px 24px rgba(3, 6, 12, .1); }
    .analytics-card[open] { grid-column: span 2; }
    .analytics-card > summary { display: grid; grid-template-rows: auto minmax(64px, 1fr) auto; min-height: 176px; gap: 12px; padding: 16px; list-style: none; cursor: pointer; }
    .analytics-card > summary::-webkit-details-marker { display: none; }
    .analytics-card > summary:focus-visible { outline: 2px solid var(--staff-primary-hover); outline-offset: -3px; border-radius: 17px; }
    .analytics-card-heading { display: grid; gap: 4px; }
    .analytics-card-heading > span { font-size: .98rem; font-weight: 780; letter-spacing: -.02em; line-height: 1.15; }
    .analytics-card-heading small { color: var(--business-muted); font-size: .66rem; font-weight: 650; letter-spacing: .01em; line-height: 1.35; }
    .mini-bars { display: flex; height: 66px; align-items: end; gap: clamp(4px, .8vw, 8px); padding: 9px 4px 0; border-bottom: 1px solid var(--business-line-strong); background: repeating-linear-gradient(to top, transparent 0 21px, color-mix(in srgb, var(--staff-border) 26%, transparent) 21px 22px); }
    .mini-bars i { width: 100%; min-height: 3px; border-radius: 4px 4px 1px 1px; background: var(--business-accent); opacity: .86; }
    .appointment-analytics-card .mini-bars i:nth-child(2n) { opacity: .5; }
    .hours-analytics-card .mini-bars i { background: #d6a95f; }
    .mini-progress { position: relative; display: block; height: 66px; overflow: hidden; border-radius: 10px; background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--staff-border) 22%, transparent) 0 calc(25% - 1px), color-mix(in srgb, var(--staff-border) 55%, transparent) calc(25% - 1px) 25%); }
    .mini-progress i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: color-mix(in srgb, var(--business-accent) 72%, transparent); }
    .analytics-empty { display: grid; min-height: 66px; place-items: center; border: 1px dashed var(--business-line-strong); border-radius: 10px; color: var(--business-muted); font-size: .72rem; text-align: center; }
    .analytics-action { display: flex; min-height: 28px; align-items: center; justify-content: space-between; gap: 10px; color: var(--business-accent); font-size: .7rem; font-weight: 780; letter-spacing: .025em; }
    .analytics-action i { display: inline-grid; width: 24px; height: 24px; flex: 0 0 24px; place-items: center; border: 1px solid rgba(169, 232, 216, .16); border-radius: 50%; font-size: .78rem; font-style: normal; line-height: 1; transition: border-color var(--staff-motion-fast) var(--staff-motion-ease), background-color var(--staff-motion-fast) var(--staff-motion-ease), transform var(--staff-motion-fast) var(--staff-motion-ease); }
    .analytics-card[open] .analytics-action i { transform: rotate(90deg); }
    .analytics-detail { padding: 0 12px 12px; border-top: 1px solid var(--business-line); }
    .analytics-detail .chart-card { border-color: var(--business-line); color: var(--staff-text); background: color-mix(in srgb, var(--business-surface-raised) 56%, transparent); box-shadow: none; }
    .analytics-detail .chart-row span, .analytics-detail .chart-card small { color: var(--business-muted); }
    .analytics-detail .chart-track { background: color-mix(in srgb, var(--staff-border) 58%, transparent); }
    .analytics-empty-detail { margin: 12px 0 0; padding: 16px; color: #aeb6c2; font-size: .78rem; text-align: center; }
    .charts-section .chart-row strong { font-variant-numeric: tabular-nums; }
    .targets-panel { border-color: var(--business-line-strong); border-radius: var(--business-radius); background: var(--business-surface); box-shadow: 0 8px 24px rgba(3, 6, 12, .1); }
    .targets-panel .timer-track { overflow: hidden; border: 1px solid color-mix(in srgb, var(--staff-border) 72%, transparent); }
    .earnings-section .targets-panel { margin-top: 2px; }
    .earnings-financial-shell { overflow: hidden; border: 1px solid var(--business-line-strong); border-radius: var(--business-radius); color: var(--staff-text); background: var(--business-surface); box-shadow: 0 10px 28px rgba(3, 6, 12, .13); }
    .earnings-summary-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; padding: 20px 20px 15px; border-bottom: 1px solid rgba(255, 255, 255, .075); }
    .earnings-summary-head div { display: grid; min-width: 0; gap: 5px; }
    .earnings-summary-head span { color: var(--business-accent); font-size: .62rem; font-weight: 800; letter-spacing: .12em; line-height: 1.2; text-transform: uppercase; }
    .earnings-summary-head strong { overflow-wrap: anywhere; color: var(--staff-text); font-size: 1rem; letter-spacing: -.018em; line-height: 1.25; }
    .earnings-summary-head small { flex: 0 0 auto; color: var(--business-muted); font-size: .66rem; font-weight: 650; }
    .earnings-summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 4px 20px 20px; }
    .financial-metric { position: relative; display: grid; min-width: 0; min-height: 116px; align-content: end; gap: 7px; padding: 18px; border-right: 1px solid var(--business-line); border-bottom: 1px solid var(--business-line); }
    .financial-metric:nth-child(3n) { border-right: 0; }
    .financial-metric:nth-last-child(-n + 3) { border-bottom: 0; }
    .financial-metric > span { align-self: start; color: var(--business-muted); font-size: .64rem; font-weight: 800; letter-spacing: .075em; line-height: 1.25; text-transform: uppercase; }
    .financial-metric > strong { overflow-wrap: anywhere; color: var(--staff-text); font-size: clamp(1.3rem, 1rem + 1vw, 1.9rem); font-variant-numeric: tabular-nums; letter-spacing: -.045em; line-height: 1; }
    .financial-metric > small { color: var(--business-muted); font-size: .62rem; font-weight: 650; line-height: 1.3; }
    .financial-metric.revenue-metric > strong { color: color-mix(in srgb, var(--business-accent) 88%, var(--staff-text)); }
    .financial-metric .metric-state { color: var(--business-muted); font-size: clamp(.9rem, .8rem + .45vw, 1.12rem); letter-spacing: -.02em; }
    .unavailable-metric { background: rgba(255, 255, 255, .012); }
    .earnings-breakdown { border-top: 1px solid rgba(255, 255, 255, .08); }
    .earnings-breakdown > summary { display: grid; grid-template-columns: minmax(0, 1fr) 32px; min-height: 60px; align-items: center; gap: 14px; padding: 10px 20px; list-style: none; cursor: pointer; transition: background-color .35s var(--staff-motion-ease), transform .35s var(--staff-motion-ease); }
    .earnings-breakdown > summary::-webkit-details-marker { display: none; }
    .earnings-breakdown > summary:focus-visible { border-radius: 0 0 21px 21px; outline: 2px solid #72d9c0; outline-offset: -3px; }
    .earnings-breakdown > summary span { display: grid; gap: 3px; }
    .earnings-breakdown > summary strong { color: color-mix(in srgb, var(--business-accent) 78%, var(--staff-text)); font-size: .75rem; letter-spacing: .025em; }
    .earnings-breakdown > summary small { color: var(--business-muted); font-size: .62rem; line-height: 1.3; }
    .earnings-breakdown > summary i { position: relative; width: 32px; height: 32px; border: 1px solid rgba(105, 214, 187, .2); border-radius: 50%; background: rgba(105, 214, 187, .06); }
    .earnings-breakdown > summary i::before, .earnings-breakdown > summary i::after { position: absolute; top: 15px; left: 10px; width: 10px; height: 1px; content: ""; background: #9ce4d2; transition: transform .35s var(--staff-motion-ease); }
    .earnings-breakdown > summary i::after { transform: rotate(90deg); }
    .earnings-breakdown[open] > summary i::after { transform: rotate(0); }
    .earnings-breakdown-content { display: grid; gap: 12px; padding: 4px 20px 20px; }
    .earnings-breakdown-content .kpi { border-color: var(--business-line); color: var(--staff-text); background: var(--business-surface-raised); box-shadow: none; }
    .earnings-breakdown-content .kpi span, .earnings-breakdown-content .kpi small { color: var(--business-muted); }
    .earnings-breakdown-content > p { margin: 0; padding: 11px 13px; border: 1px solid var(--business-line); border-radius: 12px; color: var(--business-muted); background: var(--business-surface-raised); font-size: .7rem; line-height: 1.4; }
    .timeline-section { gap: 10px; }
    .timeline-section .section-heading { margin-bottom: 4px; }
    .timeline-overview { border-color: var(--business-line-strong); border-radius: var(--business-radius); color: var(--staff-text); background: var(--business-surface); box-shadow: 0 8px 24px rgba(3, 6, 12, .1); }
    .timeline-overview .panel-title { margin: 0; }
    .timeline-overview .panel-title span { color: var(--business-muted); }
    .activity-day { display: grid; grid-template-columns: minmax(124px, .23fr) minmax(0, 1fr); gap: 18px; overflow: hidden; padding: 18px; border-color: var(--business-line-strong); border-radius: var(--business-radius); color: var(--staff-text); background: var(--business-surface); box-shadow: 0 8px 24px rgba(3, 6, 12, .1); }
    .activity-day .business-day-title { display: grid; align-content: start; gap: 6px; margin: 0; padding: 4px 0 0; }
    .activity-day .business-day-title h2 { color: var(--staff-text); font-size: .9rem; letter-spacing: -.015em; line-height: 1.25; }
    .activity-day .business-day-title span { color: var(--business-muted); font-size: .65rem; line-height: 1.35; }
    .activity-timeline { position: relative; display: grid; min-width: 0; padding-left: 31px; }
    .activity-timeline::before { position: absolute; top: 31px; bottom: 31px; left: 7px; width: 1px; content: ""; background: color-mix(in srgb, var(--business-accent) 44%, transparent); }
    .activity-entry { position: relative; min-width: 0; border: 0; border-bottom: 1px solid rgba(255, 255, 255, .075); background: transparent; transition: transform .45s var(--staff-motion-ease), opacity .45s var(--staff-motion-ease); }
    .activity-entry:last-child { border-bottom: 0; }
    .activity-entry > summary { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 32px; min-height: 104px; align-items: center; gap: 14px; padding: 14px 4px; list-style: none; cursor: pointer; transition: transform .35s var(--staff-motion-ease), background-color .35s var(--staff-motion-ease); }
    .activity-entry > summary::-webkit-details-marker { display: none; }
    .activity-entry > summary:focus-visible { border-radius: 12px; outline: 2px solid #72d9c0; outline-offset: 4px; }
    .timeline-dot { position: absolute; top: 27px; left: -31px; z-index: 1; width: 15px; height: 15px; border: 4px solid var(--business-surface); border-radius: 50%; background: #6bd5bc; box-shadow: 0 0 0 1px rgba(107, 213, 188, .5), 0 0 18px rgba(107, 213, 188, .2); }
    .activity-entry[open] .timeline-dot { background: #b8f3e4; box-shadow: 0 0 0 3px rgba(107, 213, 188, .13), 0 0 20px rgba(107, 213, 188, .25); }
    .activity-summary { display: grid; min-width: 0; gap: 15px; }
    .activity-primary { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 14px; }
    .activity-service { display: grid; min-width: 0; gap: 4px; }
    .activity-service small, .activity-facts small { color: var(--business-muted); font-size: .58rem; font-weight: 800; letter-spacing: .1em; line-height: 1.2; text-transform: uppercase; }
    .activity-service strong { overflow-wrap: anywhere; color: var(--staff-text); font-size: .96rem; letter-spacing: -.015em; line-height: 1.3; }
    .activity-status.badge { flex: 0 0 auto; min-height: 26px; padding: 5px 9px; border-color: rgba(171, 181, 194, .2); color: #d5dbe2; background: rgba(171, 181, 194, .09); }
    .activity-status.badge.green { border-color: rgba(105, 214, 187, .26); color: #a9eadb; background: rgba(62, 157, 135, .14); }
    .activity-status.badge.red { border-color: rgba(240, 133, 137, .25); color: #f2abad; background: rgba(184, 67, 73, .14); }
    .activity-facts { display: grid; grid-template-columns: repeat(5, minmax(74px, 1fr)); gap: 10px; }
    .activity-facts > span { display: grid; min-width: 0; gap: 5px; padding-left: 10px; border-left: 1px solid rgba(255, 255, 255, .09); }
    .activity-facts strong { overflow-wrap: anywhere; color: color-mix(in srgb, var(--staff-text) 82%, transparent); font-size: .7rem; font-weight: 700; line-height: 1.35; }
    .activity-entry .expand-indicator { border-color: rgba(255, 255, 255, .12); background: rgba(255, 255, 255, .04); }
    .activity-entry .expand-indicator::before, .activity-entry .expand-indicator::after { background: #9ce4d2; }
    .activity-entry .appointment-expanded { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; margin-left: 0; padding: 4px 4px 18px; border-top: 1px solid rgba(255, 255, 255, .07); }
    .activity-entry .appointment-expanded .row-main { padding-top: 15px; }
    .activity-entry .appointment-expanded :is(small, p) { color: var(--business-muted); }
    .activity-entry .appointment-expanded p { margin-block: 8px 0; }
    .activity-entry .appointment-expanded .row-actions { align-self: end; }
    .activity-entry .link-button { min-width: 76px; min-height: 44px; border: 1px solid rgba(105, 214, 187, .28); border-radius: 12px; color: color-mix(in srgb, var(--business-accent) 74%, var(--staff-text)); background: rgba(105, 214, 187, .07); }
    .activity-day > .business-day-summary { grid-column: 2; margin-left: 31px; border-top-color: var(--business-line); color: var(--business-muted); }
    .activity-day > .business-day-summary summary { min-height: 44px; align-content: center; color: color-mix(in srgb, var(--staff-text) 78%, transparent); }
    .timeline-section > .panel:has(> .empty) { border-style: dashed; border-color: color-mix(in srgb, var(--staff-border) 88%, transparent); background: color-mix(in srgb, var(--staff-surface) 92%, transparent); box-shadow: inset 0 1px rgba(255, 255, 255, .02); }
    .timeline-section .empty, .detail-drawer .empty { margin: 0; padding: 14px 10px; color: color-mix(in srgb, var(--staff-text) 62%, transparent); font-size: .78rem; line-height: 1.45; text-align: center; }
    .timeline-section > .permission-actions { justify-content: center; padding-top: 4px; }
    .timeline-section > .permission-actions .button { min-height: 44px; min-width: 132px; }
    .detail-drawer { padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)); border-left: 1px solid var(--business-line-strong); background: var(--business-surface); box-shadow: -24px 0 64px rgba(3, 6, 12, .34); }
    .detail-drawer > .panel-title { padding-bottom: 12px; border-bottom: 1px solid color-mix(in srgb, var(--staff-border) 72%, transparent); }
    .detail-drawer > .panel-title h2 { letter-spacing: -.03em; }
    .detail-drawer > .panel-title .link-button { min-width: 64px; min-height: 44px; }
    .detail-drawer > .state { min-height: 58px; border: 1px solid color-mix(in srgb, var(--staff-border) 72%, transparent); border-radius: 14px; background: rgba(255, 255, 255, .018); }
    .detail-drawer .list { overflow: hidden; border: 1px solid color-mix(in srgb, var(--staff-border) 76%, transparent); border-radius: 14px; background: rgba(255, 255, 255, .018); }
    .detail-drawer .list .row { min-height: 48px; border-bottom-color: color-mix(in srgb, var(--staff-border) 64%, transparent); }
    .detail-drawer .list .row > span { overflow-wrap: anywhere; color: color-mix(in srgb, var(--staff-text) 72%, transparent); text-align: right; }
    .detail-drawer > h3 { margin-bottom: 8px; font-size: .76rem; letter-spacing: .08em; text-transform: uppercase; }
    .business-page :is(button, input, select, summary):focus-visible { outline: 2px solid var(--business-accent); outline-offset: 3px; }
    .chart-row > * { min-width: 0; }
    .chart-row strong { overflow-wrap: anywhere; text-align: right; }
    .filter-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 10px; }
    .filter-heading .eyebrow { margin-bottom: 3px; font-size: .58rem; }
    .filter-heading h2 { margin: 0; color: var(--staff-text); font-size: 1rem; letter-spacing: -.025em; }
    .filter-heading > strong { max-width: 56%; overflow-wrap: anywhere; color: var(--business-accent); font-size: .72rem; text-align: right; }
    .filter-primary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .advanced-filters { margin-top: 10px; border-top: 1px solid var(--business-line); border-bottom: 1px solid var(--business-line); }
    .advanced-filters > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto 24px; min-height: 48px; align-items: center; gap: 10px; list-style: none; cursor: pointer; }
    .advanced-filters > summary::-webkit-details-marker { display: none; }
    .advanced-filters > summary > span { display: grid; gap: 2px; }
    .advanced-filters > summary strong { color: var(--staff-text); font-size: .72rem; }
    .advanced-filters > summary small { color: var(--business-muted); font-size: .58rem; }
    .advanced-filters > summary b { border-radius: 999px; padding: 4px 7px; color: var(--staff-primary-hover); background: var(--staff-primary-light); font-size: .56rem; }
    .advanced-filters > summary i { position: relative; width: 24px; height: 24px; border-radius: 50%; background: var(--staff-surface-secondary); }
    .advanced-filters > summary i::before, .advanced-filters > summary i::after { position: absolute; top: 11px; left: 7px; width: 10px; height: 2px; content: ""; background: var(--business-accent); transition: transform var(--staff-motion-fast) var(--staff-motion-ease); }
    .advanced-filters > summary i::after { transform: rotate(90deg); }
    .advanced-filters[open] > summary i::after { transform: none; }
    .advanced-filters > .form-grid { grid-template-columns: 1.4fr .8fr 1fr; gap: 8px; padding: 2px 0 10px; }
    .business-filter-panel .permission-actions { margin-top: 10px; }
    .revenue-hero-summary { display: grid !important; grid-template-columns: 1.4fr repeat(2, minmax(110px, .7fr)); min-height: 92px !important; gap: 14px; padding: 13px 16px !important; }
    .revenue-hero-summary::before { display: none; }
    .revenue-hero-summary > span { display: grid; min-width: 0; align-content: center; gap: 5px; }
    .revenue-hero-summary > span + span { padding-left: 14px; border-left: 1px solid var(--business-line); }
    .revenue-hero-summary small { color: var(--business-muted); font-size: .58rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .revenue-hero-summary strong { overflow-wrap: anywhere; color: var(--staff-text); font-size: 1.05rem; font-variant-numeric: tabular-nums; letter-spacing: -.03em; }
    .revenue-hero-summary > span:first-child strong { color: color-mix(in srgb, var(--business-accent) 88%, var(--staff-text)); font-size: clamp(1.45rem, 1.1rem + 1.2vw, 2rem); }
    .revenue-hero-summary > i, .status-summary > i, .analytics-chevron { position: relative; width: 28px; height: 28px; align-self: center; justify-self: end; border-radius: 50%; background: var(--staff-surface-secondary); }
    .revenue-hero-summary > i::before, .status-summary > i::before, .analytics-chevron::before { position: absolute; top: 9px; left: 9px; width: 8px; height: 8px; border-right: 2px solid var(--business-accent); border-bottom: 2px solid var(--business-accent); content: ""; transform: rotate(45deg); transition: transform var(--staff-motion-fast) var(--staff-motion-ease); }
    .invoice-totals-panel[open] .revenue-hero-summary > i::before, .status-mix-panel[open] .status-summary > i::before, .analytics-card[open] .analytics-chevron::before { transform: rotate(225deg); }
    .invoice-totals-panel[open] .invoice-totals-grid, .status-mix-panel[open] .status-mix-grid, .analytics-card[open] .analytics-detail { animation: business-reveal .35s var(--staff-motion-ease) both; }
    .business-kpi-grid .kpi { display: grid; min-height: 104px; align-content: center; padding: 16px; }
    .business-kpi-grid .kpi strong { font-size: clamp(1.45rem, 1.15rem + 1vw, 2rem); }
    .period-summary-card { gap: 12px; }
    .period-summary-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid rgba(255,255,255,.09); }
    .period-summary-list p { display: grid; align-content: start; gap: 5px; margin: 0; padding: 14px; border-left: 1px solid rgba(255,255,255,.08); }
    .period-summary-list p:first-child { border-left: 0; padding-left: 0; }
    .period-summary-list strong { color: #e9fbf6; font-size: .86rem; line-height: 1.3; }
    .period-summary-list span { color: #91a0a5; font-size: .64rem; line-height: 1.4; }
    .analytics-card > summary { grid-template-rows: auto minmax(76px, 1fr) 28px; }
    .analytics-chevron { display: block; }
    .analytics-empty { padding: 10px; line-height: 1.35; }
    .status-summary { display: grid !important; grid-template-columns: auto minmax(0, 1fr) 28px; min-height: 76px !important; gap: 14px; padding: 10px 14px !important; }
    .status-summary::before { display: none; }
    .status-preview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
    .status-preview b { display: grid; min-width: 0; gap: 3px; padding: 7px 8px; border-radius: 10px; color: var(--staff-text); background: var(--staff-surface-secondary); font-size: .82rem; font-variant-numeric: tabular-nums; }
    .status-preview small { overflow: hidden; color: var(--business-muted); font-size: .5rem; font-weight: 750; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
    .activity-facts { grid-template-columns: repeat(4, minmax(74px, 1fr)); }
    .business-empty { display: grid; justify-items: center; gap: 6px; padding: 28px 16px; border-style: dashed; text-align: center; }
    .business-empty > span { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 12px; color: var(--business-accent); background: color-mix(in srgb, var(--business-accent) 9%, transparent); }
    .business-empty strong { color: var(--staff-text); font-size: .84rem; }
    .business-empty p { max-width: 340px; margin: 0; color: var(--business-muted); font-size: .68rem; line-height: 1.45; }
    .business-page { gap: 10px; }
    .dashboard-section { gap: 9px; padding-block: 11px; }
    .metric-overview .kpi, .business-kpi-grid .kpi { min-height: 76px; padding: 11px 12px; }
    .business-kpi-grid .kpi strong { margin-top: 5px; font-size: clamp(1.25rem, 1.05rem + .8vw, 1.7rem); }
    .ai-insights-card { gap: 10px; padding: 14px 16px; }
    .period-summary-list p { padding-block: 10px; }
    .analytics-card > summary { position: relative; grid-template-rows: auto minmax(52px, 1fr); min-height: 128px; gap: 8px; padding: 12px; }
    .analytics-card-heading { padding-right: 30px; }
    .analytics-card-heading > strong { margin-top: 3px; overflow-wrap: anywhere; color: var(--staff-text); font-size: 1.05rem; font-variant-numeric: tabular-nums; letter-spacing: -.035em; line-height: 1.1; }
    .analytics-chevron { position: absolute; top: 11px; right: 11px; }
    .mini-bars, .mini-progress, .analytics-empty { height: 60px; min-height: 60px; }
    .mini-bars { border-bottom-color: color-mix(in srgb, var(--business-accent) 34%, var(--business-line-strong)); }
    .mini-bars i { min-width: 5px; opacity: .94; }
    .analytics-detail .chart-card { margin-top: 10px; padding: 15px; }
    .analytics-detail .chart-card h3 { margin-bottom: 14px; font-size: .82rem; }
    .analytics-detail .chart-row { min-height: 34px; margin-top: 7px; }
    .analytics-detail .chart-track { height: 10px; }
    .analytics-detail .chart-track i { background: var(--business-accent); }
    .utilization-chart > strong { font-size: 1.65rem; }
    .analytics-card[open] { border-color: color-mix(in srgb, var(--business-accent) 26%, var(--business-line-strong)); box-shadow: 0 14px 34px rgba(3, 6, 12, .18); }
    .status-summary { min-height: 66px !important; }
    .revenue-hero-summary { min-height: 76px !important; }
    .invoice-totals-grid .kpi, .status-mix-grid .kpi { min-height: 60px; padding: 9px 10px; }
    .earnings-compact-summary { display: grid; grid-template-columns: 1.2fr repeat(3, minmax(88px, .72fr)) 30px; min-height: 78px; align-items: center; gap: 10px; padding: 10px 16px; list-style: none; cursor: pointer; transition: background-color var(--staff-motion-fast) var(--staff-motion-ease); }
    .earnings-compact-summary::-webkit-details-marker { display: none; }
    .earnings-compact-summary > span { display: grid; min-width: 0; gap: 4px; }
    .earnings-compact-summary > span + span { padding-left: 12px; border-left: 1px solid var(--business-line); }
    .earnings-compact-summary small { color: var(--business-muted); font-size: .56rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    .earnings-compact-summary strong { overflow-wrap: anywhere; color: var(--staff-text); font-size: .96rem; font-variant-numeric: tabular-nums; }
    .earnings-compact-summary > span:first-child strong { color: color-mix(in srgb, var(--business-accent) 88%, var(--staff-text)); font-size: 1.25rem; }
    .earnings-compact-summary > i { position: relative; width: 28px; height: 28px; justify-self: end; border-radius: 50%; background: var(--staff-surface-secondary); }
    .earnings-compact-summary > i::before { position: absolute; top: 9px; left: 9px; width: 8px; height: 8px; border-right: 2px solid var(--business-accent); border-bottom: 2px solid var(--business-accent); content: ""; transform: rotate(45deg); transition: transform var(--staff-motion-fast) var(--staff-motion-ease); }
    .earnings-overview[open] > .earnings-compact-summary { border-bottom: 1px solid var(--business-line); }
    .earnings-overview[open] > .earnings-compact-summary i::before { transform: rotate(225deg); }
    .earnings-overview:not([open]) .earnings-summary-head, .earnings-overview:not([open]) .earnings-summary-grid, .earnings-overview:not([open]) .earnings-breakdown { display: none; }
    .earnings-overview[open] > :not(summary) { animation: business-reveal .35s var(--staff-motion-ease) both; }
    .timeline-section { gap: 7px; }
    .timeline-overview { padding-block: 10px; }
    .activity-day { gap: 10px; padding: 12px 14px; }
    .activity-entry > summary { min-height: 86px; padding-block: 9px; }
    .activity-summary { gap: 9px; }
    .activity-facts { gap: 6px; }
    .activity-entry > summary { grid-template-columns: minmax(0, 1fr) 58px; }
    .activity-expand { display: grid; justify-items: center; gap: 4px; color: var(--business-muted); }
    .activity-expand > small { font-size: .52rem; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
    .activity-expand .expand-indicator { width: 30px; height: 30px; flex-basis: 30px; }
    .activity-expand .expand-indicator::before, .activity-expand .expand-indicator::after { top: 14px; left: 10px; }
    .activity-status.badge { min-height: 30px; padding: 6px 10px; border-width: 1px; font-size: .64rem; font-weight: 820; box-shadow: inset 0 1px rgba(255,255,255,.04); }
    .appointment-detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; padding-top: 12px; }
    .appointment-detail-grid > article { display: grid; min-width: 0; align-content: start; gap: 4px; padding: 10px 11px; border: 1px solid var(--business-line); border-radius: 11px; background: var(--business-surface-raised); }
    .appointment-detail-grid > article.wide { grid-column: 1 / -1; }
    .appointment-detail-grid > article > span { color: var(--business-muted); font-size: .55rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .appointment-detail-grid > article > strong { overflow-wrap: anywhere; color: var(--staff-text); font-size: .72rem; line-height: 1.35; }
    .appointment-detail-grid > article > small { color: var(--business-muted); font-size: .6rem; line-height: 1.4; }
    .appointment-detail-grid .financial-detail { border-color: color-mix(in srgb, var(--business-accent) 20%, var(--business-line)); background: color-mix(in srgb, var(--business-accent) 4%, var(--business-surface-raised)); }
    .appointment-detail-grid .financial-detail > strong { color: color-mix(in srgb, var(--business-accent) 82%, var(--staff-text)); font-size: .82rem; }
    .appointment-detail-grid .muted-detail { opacity: .78; }
    .appointment-detail-grid .live-progress .timer-track { margin-block: 3px; }
    .revenue-hero-summary { position: relative; overflow: hidden; isolation: isolate; }
    .revenue-hero-summary::after { position: absolute; inset: 0; z-index: -1; border-radius: inherit; background: radial-gradient(circle at center, color-mix(in srgb, var(--business-accent) 15%, transparent), transparent 68%); content: ""; opacity: 0; transform: scale(.82); transition: opacity .28s var(--staff-motion-ease), transform .28s var(--staff-motion-ease); }
    .revenue-hero-summary:active::after { opacity: 1; transform: scale(1); }
    .status-mix-panel .status-mix-grid .kpi { min-height: 70px; }
    .status-mix-grid .kpi { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
    .status-mix-grid .kpi > span { grid-column: 1; }
    .status-mix-grid .kpi > strong { grid-column: 1; }
    .status-mix-grid .kpi > small { grid-column: 2; grid-row: 1 / 3; align-self: center; margin: 0; color: var(--business-accent); font-size: .58rem; font-weight: 800; }
    .status-meter { grid-column: 1 / -1; overflow: hidden; height: 4px; margin-top: 5px; border-radius: 999px; background: color-mix(in srgb, var(--staff-border) 60%, transparent); }
    .status-meter i { display: block; height: 100%; border-radius: inherit; background: var(--business-accent); transform-origin: left; animation: chart-grow .45s var(--staff-motion-ease) both; }
    .earnings-compact-summary { grid-template-columns: 1.2fr repeat(2, minmax(88px, .72fr)) 30px; }
    .earnings-kpi-chip { border-radius: 11px; padding: 8px 10px !important; background: var(--staff-surface-secondary); transition: background-color var(--staff-motion-fast) var(--staff-motion-ease), transform var(--staff-motion-fast) var(--staff-motion-ease); }
    .earnings-compact-summary > .earnings-kpi-chip + .earnings-kpi-chip { border-left: 0; }
    .earnings-compact-summary:active .earnings-kpi-chip { transform: scale(.985); }
    .appointment-chevron { width: 10px; height: 10px; border-right: 2px solid var(--business-accent); border-bottom: 2px solid var(--business-accent); transform: rotate(45deg); transition: transform var(--staff-motion-fast) var(--staff-motion-ease); }
    .activity-entry[open] .appointment-chevron { transform: rotate(225deg); }
    .dashboard-section { animation: section-enter .4s var(--staff-motion-ease) both; }
    .mini-bars i { transform-origin: bottom; animation: chart-rise .45s var(--staff-motion-ease) both; }
    .analytics-detail .chart-track i { transform-origin: left; animation: chart-grow .45s var(--staff-motion-ease) both; }
    @keyframes section-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes chart-rise { from { opacity: .25; transform: scaleY(.15); } to { opacity: .94; transform: scaleY(1); } }
    @keyframes chart-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    .business-loading { display: grid; gap: 11px; padding: 16px; border: 1px solid var(--business-line-strong); border-radius: var(--business-radius); background: var(--business-surface); }
    .business-loading > div { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .business-loading span { display: block; min-height: 62px; border-radius: 12px; background: linear-gradient(100deg, var(--business-surface-raised) 20%, color-mix(in srgb, var(--business-surface-raised) 70%, var(--business-accent)) 48%, var(--business-surface-raised) 76%); background-size: 220% 100%; animation: business-shimmer 1.2s linear infinite; }
    .business-loading .skeleton-line { width: 34%; min-height: 12px; border-radius: 999px; }
    .business-loading .skeleton-line.wide { width: 56%; min-height: 16px; }
    @keyframes business-shimmer { to { background-position: -220% 0; } }
    .expand-chevron { position: relative !important; display: block !important; width: 10px !important; height: 10px !important; flex: 0 0 10px !important; border: 0 !important; border-right: 2px solid var(--business-accent) !important; border-bottom: 2px solid var(--business-accent) !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; transform: rotate(45deg); transition: transform var(--staff-motion-fast) var(--staff-motion-ease) !important; }
    .expand-chevron::before, .expand-chevron::after { display: none !important; content: none !important; }
    :is(.advanced-filters, .invoice-totals-panel, .analytics-card, .earnings-overview, .earnings-breakdown, .activity-entry, .business-day-summary)[open] > summary .expand-chevron { transform: rotate(225deg); }
    .revenue-hero-summary > .expand-chevron { position: absolute !important; top: 50%; right: 16px; transform: translateY(-50%) rotate(45deg); }
    .revenue-hero-summary { padding-right: 46px !important; }
    .invoice-totals-panel[open] .revenue-hero-summary > .expand-chevron { transform: translateY(-50%) rotate(225deg); }
    .analytics-card > summary > .expand-chevron { position: absolute !important; top: 16px; right: 15px; }
    .activity-expand .expand-chevron { margin-block: 4px; }
    .business-day-summary > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    :is(.revenue-hero-summary, .analytics-card > summary, .earnings-compact-summary, .activity-entry > summary) { transition: background-color var(--staff-motion-fast) var(--staff-motion-ease), transform var(--staff-motion-fast) var(--staff-motion-ease); }
    :is(.revenue-hero-summary, .analytics-card > summary, .earnings-compact-summary, .activity-entry > summary):active { background-color: color-mix(in srgb, var(--business-accent) 5%, transparent); transform: scale(.995); }
    .status-mix-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
    .status-mix-head span { color: var(--business-muted); font-size: .65rem; font-weight: 700; }
    .status-mix-head strong { color: var(--staff-text); font-size: .7rem; font-variant-numeric: tabular-nums; }
    .status-mix-panel .status-mix-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .status-mix-panel .status-mix-grid .kpi { min-height: 58px; padding: 9px 10px; border-radius: 12px; box-shadow: none; }
    .status-mix-panel .status-mix-grid .kpi strong { margin-top: 4px; font-size: 1.05rem; }
    .earnings-summary-grid { gap: 0; }
    .financial-metric { min-height: 98px; gap: 5px; padding: 14px; }
    .financial-metric > strong { font-size: clamp(1.22rem, 1rem + .8vw, 1.7rem); }
    .business-page > .page-head { padding-bottom: 10px; }
    .business-filter-panel { padding: 13px 14px; }
    .filter-heading { margin-bottom: 6px; }
    .filter-heading .eyebrow { margin-bottom: 1px; }
    .filter-primary { gap: 6px; }
    .filter-primary > label { grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; font-size: .68rem; }
    .filter-primary > label:first-child { max-width: 340px; }
    .filter-primary :is(input, select) { min-height: 42px; padding-block: 7px; }
    .advanced-filters { margin-top: 6px; }
    .advanced-filters > summary { min-height: 42px; }
    .business-filter-panel .permission-actions { margin-top: 6px; padding-top: 7px; }
    .business-filter-panel .permission-actions .button { min-height: 42px; padding-block: 7px; }
    .revenue-summary-section { padding-top: 6px; }
    .revenue-summary-section .section-heading h2 { color: color-mix(in srgb, var(--business-accent) 88%, var(--staff-text)); }
    .revenue-summary-section .invoice-totals-panel { border-color: color-mix(in srgb, var(--business-accent) 28%, var(--business-line-strong)); box-shadow: 0 12px 30px rgba(3, 6, 12, .16); }
    .dashboard-section + .dashboard-section, .metric-overview + .dashboard-section, .dashboard-section + .metric-overview { border-top-color: color-mix(in srgb, var(--business-line) 66%, transparent); }
    @keyframes business-reveal { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    @media (hover: hover) and (pointer: fine) {
      .analytics-card { transition: border-color var(--staff-motion-fast) var(--staff-motion-ease), transform var(--staff-motion-fast) var(--staff-motion-ease), box-shadow var(--staff-motion-fast) var(--staff-motion-ease); }
      .analytics-card:hover { border-color: rgba(126, 224, 200, .28); transform: translateY(-2px); box-shadow: 0 12px 28px rgba(3, 6, 12, .16); }
      .analytics-card:hover .analytics-action i { border-color: rgba(169, 232, 216, .3); background: rgba(169, 232, 216, .07); }
      .analytics-card > summary:active { transform: scale(.99); }
      .activity-entry:hover { transform: translateX(3px); }
      .activity-entry:hover > summary { background: rgba(255, 255, 255, .018); }
      .activity-entry > summary:active { transform: scale(.995); }
      .activity-entry .link-button:hover { border-color: rgba(105, 214, 187, .42); background: rgba(105, 214, 187, .12); }
      .earnings-breakdown > summary:hover { background: rgba(105, 214, 187, .035); }
      .earnings-overview > .earnings-compact-summary:hover { background: rgba(105, 214, 187, .035); }
      .earnings-breakdown > summary:active { transform: scale(.995); }
      :is(.invoice-totals-panel, .status-mix-panel) > summary:hover { color: var(--staff-text); background: color-mix(in srgb, var(--staff-primary-hover) 4%, transparent); }
      .business-filter-panel .button:not(:disabled):active { transform: scale(.985); }
    }
    @media (max-width: 1080px) {
      .analytics-preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .analytics-card[open] { grid-column: 1 / -1; }
      .activity-facts { grid-template-columns: repeat(3, minmax(82px, 1fr)); }
    }
    @media (max-width: 860px) {
      .metric-overview { grid-template-columns: minmax(0, 1fr); }
      .metric-overview > .dashboard-section:first-child { padding-right: 0; }
      .metric-overview > .dashboard-section:last-child { padding-left: 0; border-top: 1px solid var(--business-line); border-left: 0; }
      .activity-day { grid-template-columns: minmax(112px, .2fr) minmax(0, 1fr); }
      .activity-facts { grid-template-columns: repeat(2, minmax(82px, 1fr)); }
    }
    @media (max-width: 700px) {
      .business-page { gap: 8px; min-width: 0; padding-inline: 12px; }
      .business-page .page-head { min-height: 0; gap: 3px; padding: 0; }
      .business-page .page-head .eyebrow { margin-bottom: 3px; font-size: .62rem; }
      .business-page .page-head h1 { font-size: 1.5rem; line-height: 1.05; }
      .business-page .page-head p:not(.eyebrow) { margin-top: 4px; font-size: .76rem; line-height: 1.25; }
      .business-page > :is(.state, .notice) { min-height: 52px; border-radius: 14px; }
      .business-filter-panel { padding: 10px; border-radius: 15px; }
      .business-filter-panel .panel-title { min-height: 22px; margin-bottom: 6px; padding-bottom: 6px; }
      .business-filter-panel .panel-title h2 { font-size: .88rem; }
      .business-filter-panel .panel-title span { font-size: .58rem; }
      .business-filter-panel .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 6px; }
      .business-filter-panel .form-grid > label:first-child, .business-filter-panel .search-field { grid-column: 1 / -1; }
      .business-filter-panel label, .business-filter-panel .search-field { gap: 3px; font-size: .68rem; }
      .business-filter-panel input, .business-filter-panel select { min-width: 0; min-height: 44px; padding: 8px 10px; font-size: 16px; }
      .business-filter-panel select { padding-right: 28px; background-position: calc(100% - 15px) 50%, calc(100% - 10px) 50%; }
      .business-filter-panel .permission-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 8px; padding-top: 8px; }
      .business-filter-panel .permission-actions .button { width: 100%; min-height: 44px; padding: 8px; border-radius: 11px; font-size: .75rem; }
      .business-filter-panel .permission-actions .badge { grid-column: 1 / -1; justify-self: start; padding-block: 5px; font-size: .66rem; }
      .dashboard-section { gap: 8px; min-width: 0; padding-block: 10px; }
      .section-heading { gap: 3px; }
      .section-heading p { font-size: .56rem; letter-spacing: .1em; }
      .section-heading h2 { font-size: 1.05rem; }
      .grid.four.business-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .business-kpi-grid .kpi { min-height: 64px; padding: 8px 10px; border-radius: 14px; }
      .business-kpi-grid .kpi span { font-size: .64rem; line-height: 1.2; }
      .business-kpi-grid .kpi strong { margin-top: 4px; font-size: 1.12rem; line-height: 1; }
      .analytics-preview-grid { gap: 8px; }
      .ai-insights-card { gap: 13px; padding: 14px; border-radius: 16px; }
      .ai-insights-head { grid-template-columns: 34px minmax(0, 1fr); gap: 10px; }
      .ai-insights-icon { width: 34px; height: 34px; border-radius: 10px; }
      .ai-insights-head h2 { font-size: 1.05rem; }
      .ai-insights-head small { font-size: .62rem; line-height: 1.35; }
      .ai-insight-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ai-insight-list p { min-height: 62px; padding: 10px; border-bottom: 1px solid rgba(255, 255, 255, .08); }
      .ai-insight-list p:nth-child(odd) { border-left: 0; padding-left: 0; }
      .ai-insight-list p:nth-child(n + 3) { border-bottom: 0; }
      .ai-insight-list strong { font-size: 1.05rem; }
      .ai-insights-empty { padding: 11px 12px; font-size: .66rem; }
      .analytics-card { border-radius: 15px; }
      .analytics-card > summary { min-height: 164px; gap: 10px; padding: 12px; }
      .analytics-card-heading > span { font-size: .82rem; }
      .analytics-card-heading small { font-size: .58rem; }
      .mini-bars, .mini-progress, .analytics-empty { height: 58px; min-height: 58px; }
      .mini-bars { gap: 4px; padding-top: 7px; }
      .analytics-action { font-size: .62rem; }
      .analytics-action i { width: 22px; height: 22px; flex-basis: 22px; }
      .analytics-detail { padding: 0 8px 8px; }
      .status-mix-panel { padding: 10px; border-radius: 15px; }
      .status-mix-panel[open] > summary { margin-bottom: 7px; font-size: .78rem; }
      .status-mix-grid.grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
      .status-mix-grid .kpi { min-height: 58px; padding: 8px 7px; border-radius: 12px; }
      .status-mix-grid .kpi span { font-size: .52rem; line-height: 1.15; letter-spacing: .045em; }
      .status-mix-grid .kpi strong { margin-top: 5px; font-size: 1.05rem; line-height: 1; }
      .invoice-totals-panel { padding: 10px; border-radius: 15px; }
      .invoice-totals-panel[open] > summary { margin-bottom: 7px; font-size: .78rem; }
      .invoice-totals-grid.grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .invoice-totals-grid .kpi { min-height: 66px; padding: 9px 10px; border-radius: 13px; }
      .invoice-totals-grid .kpi span { font-size: .6rem; line-height: 1.15; letter-spacing: .035em; }
      .invoice-totals-grid .kpi strong { margin-top: 6px; font-size: 1.12rem; line-height: 1; }
      .earnings-grid.grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .earnings-grid .kpi { min-height: 78px; padding: 9px 10px; border-radius: 13px; }
      .earnings-grid .kpi span { font-size: .6rem; line-height: 1.15; letter-spacing: .025em; }
      .earnings-grid .kpi strong { margin-top: 6px; font-size: 1.12rem; line-height: 1; }
      .earnings-grid .kpi small { margin-top: 5px; font-size: .58rem; line-height: 1.15; }
      .earnings-financial-shell { border-radius: 16px; }
      .earnings-summary-head { align-items: start; padding: 14px 12px 11px; }
      .earnings-summary-head strong { font-size: .84rem; }
      .earnings-summary-head small { font-size: .57rem; }
      .earnings-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 2px 12px 12px; }
      .financial-metric { min-height: 94px; gap: 5px; padding: 11px 10px; }
      .financial-metric:nth-child(3n) { border-right: 1px solid var(--business-line); }
      .financial-metric:nth-child(2n) { border-right: 0; }
      .financial-metric:nth-last-child(-n + 3) { border-bottom: 1px solid var(--business-line); }
      .financial-metric:nth-last-child(-n + 2) { border-bottom: 0; }
      .financial-metric > span { font-size: .6rem; letter-spacing: .04em; }
      .financial-metric > strong { font-size: clamp(1.05rem, 5.5vw, 1.35rem); }
      .financial-metric > small { font-size: .58rem; }
      .financial-metric .metric-state { font-size: .82rem; }
      .earnings-breakdown > summary { min-height: 56px; padding: 8px 12px; }
      .earnings-breakdown > summary:focus-visible { border-radius: 0 0 15px 15px; }
      .earnings-breakdown-content { padding: 2px 12px 12px; }
      .detailed-work-head { padding: 12px 14px; border-radius: 15px; }
      .detailed-work-head .panel-title { min-height: 24px; margin: 0; }
      .detailed-work-head .panel-title h2 { font-size: .82rem; }
      .detailed-work-head .panel-title span { font-size: .6rem; }
      .activity-day { grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 12px; border-radius: 16px; box-shadow: 0 10px 24px rgba(3, 6, 12, .18); }
      .activity-day .business-day-title { display: flex; min-height: 34px; align-items: center; justify-content: space-between; gap: 8px; padding: 0; }
      .activity-day .business-day-title h2 { font-size: .78rem; }
      .activity-day .business-day-title span { text-align: right; }
      .activity-timeline { padding-left: 25px; }
      .activity-timeline::before { left: 6px; }
      .timeline-dot { left: -25px; }
      .activity-entry > summary { min-height: 116px; grid-template-columns: minmax(0, 1fr) 28px; gap: 8px; padding: 11px 0; }
      .activity-summary { gap: 10px; }
      .activity-service strong { font-size: .86rem; }
      .activity-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px 5px; }
      .activity-facts > span { padding-left: 7px; }
      .activity-facts strong { font-size: .64rem; }
      .activity-entry .expand-indicator { width: 28px; height: 28px; flex-basis: 28px; }
      .activity-entry .expand-indicator::before, .activity-entry .expand-indicator::after { top: 13px; left: 9px; }
      .activity-entry .appointment-expanded { grid-template-columns: minmax(0, 1fr); gap: 10px; padding-bottom: 12px; }
      .activity-entry .appointment-expanded .row-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
      .activity-entry .link-button { width: 100%; min-height: 44px; }
      .activity-day > .business-day-summary { grid-column: 1; margin-left: 25px; font-size: .64rem; line-height: 1.35; }
      .detail-drawer .list { border-radius: 12px; }
      .detail-drawer .list .row { min-height: 44px; }
      .filter-heading { margin-bottom: 4px; }
      .filter-heading h2 { font-size: .84rem; }
      .filter-heading > strong { font-size: .62rem; }
      .filter-primary { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .filter-primary > label { grid-template-columns: 46px minmax(0, 1fr); }
      .filter-primary > label:first-child { grid-column: 1 / -1; max-width: none; }
      .advanced-filters { margin-top: 4px; }
      .advanced-filters > summary { min-height: 44px; }
      .advanced-filters > .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .advanced-filters .search-field { grid-column: 1 / -1; }
      .revenue-hero-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); min-height: 116px !important; gap: 7px; padding: 10px 42px 10px 10px !important; }
      .revenue-hero-summary > span:first-child { grid-column: 1 / 3; }
      .revenue-hero-summary > span + span { padding-top: 7px; padding-left: 0; border-top: 1px solid var(--business-line); border-left: 0; }
      .revenue-hero-summary > span:nth-child(3) { padding-left: 8px; border-left: 1px solid var(--business-line); }
      .revenue-hero-summary > i { grid-column: 3; grid-row: 1 / 3; }
      .period-summary-list { grid-template-columns: 1fr; }
      .period-summary-list p { padding: 9px 0; border-top: 1px solid rgba(255,255,255,.08); border-left: 0; }
      .period-summary-list p:first-child { border-top: 0; }
      .status-summary { grid-template-columns: minmax(0,1fr) 26px; min-height: 110px !important; gap: 7px; }
      .status-summary > span:first-child { align-self: center; }
      .status-preview { grid-column: 1 / 3; grid-row: 2; }
      .status-summary > i { grid-column: 2; grid-row: 1; }
      .analytics-card > summary { min-height: 108px; gap: 6px; padding: 10px; }
      .analytics-card-heading > strong { font-size: .92rem; }
      .mini-bars, .mini-progress, .analytics-empty { height: 50px; min-height: 50px; }
      .revenue-hero-summary { min-height: 100px !important; }
      .status-summary { min-height: 88px !important; }
      .earnings-compact-summary { position: relative; grid-template-columns: repeat(2, minmax(0, 1fr)); min-height: 108px; gap: 0; padding: 8px 42px 8px 9px; }
      .earnings-compact-summary > span:first-child { grid-column: auto; }
      .earnings-compact-summary > span { min-height: 44px; justify-content: center; padding: 6px 8px; }
      .earnings-compact-summary > span + span { padding: 6px 8px; border-top: 0; border-left: 1px solid var(--business-line); }
      .earnings-compact-summary > span:nth-child(odd) { border-left: 0; }
      .earnings-compact-summary > span:nth-child(n + 3) { border-top: 1px solid var(--business-line); }
      .earnings-compact-summary > i { position: absolute; top: 10px; right: 9px; }
      .activity-entry > summary { min-height: 88px; }
      .business-filter-panel .permission-actions { margin-top: 5px; padding-top: 5px; }
      .dashboard-section { padding-block: 8px; }
      .activity-entry > summary { grid-template-columns: minmax(0, 1fr) 48px; }
      .activity-expand .expand-indicator { width: 28px; height: 28px; flex-basis: 28px; }
      .appointment-detail-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .appointment-detail-grid > article { padding: 9px; }
      .business-loading > div { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 380px) {
      .business-page { padding-inline: 10px; }
      .business-page .page-head h1 { font-size: 1.42rem; }
      .business-page .page-head p:not(.eyebrow) { max-width: 36ch; font-size: .75rem; line-height: 1.3; }
      .business-filter-panel .panel-title { align-items: start; gap: 8px; }
      .business-filter-panel .panel-title span { max-width: 54%; overflow-wrap: anywhere; text-align: right; line-height: 1.3; }
      .status-mix-grid.grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
      .status-mix-grid .kpi { min-height: 64px; padding: 7px 6px; }
      .status-mix-grid .kpi span { font-size: .48rem; }
      .analytics-preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
      .analytics-card[open] { grid-column: 1 / -1; }
      .ai-insights-card { padding: 12px; }
      .ai-insights-head { grid-template-columns: 32px minmax(0, 1fr); gap: 9px; }
      .ai-insights-icon { width: 32px; height: 32px; }
      .ai-insight-list p { min-height: 58px; padding: 9px 7px; }
      .ai-insight-list p:nth-child(odd) { padding-left: 0; }
      .ai-insight-list span { font-size: .55rem; letter-spacing: .05em; }
      .ai-insight-list strong { font-size: .98rem; }
      .ai-insight-list small { font-size: .55rem; }
      .analytics-card > summary { min-height: 142px; gap: 8px; padding: 10px; }
      .analytics-card-heading > span { font-size: .82rem; overflow-wrap: anywhere; }
      .analytics-card-heading small, .analytics-action { font-size: .6rem; }
      .mini-bars, .mini-progress, .analytics-empty { height: 46px; min-height: 46px; }
      .analytics-detail .chart-card { padding: 11px; }
      .analytics-detail .chart-row { grid-template-columns: 66px minmax(38px, 1fr) auto; gap: 6px; }
      .earnings-summary-head { gap: 9px; }
      .earnings-summary-head small { max-width: 74px; text-align: right; }
      .earnings-summary-grid { padding-inline: 10px; }
      .financial-metric { min-height: 90px; padding: 10px 8px; }
      .financial-metric > strong { font-size: clamp(1rem, 5.5vw, 1.16rem); }
      .financial-metric > small { line-height: 1.25; }
      .earnings-breakdown-content { padding-inline: 10px; }
      .earnings-grid .kpi { min-height: 72px; padding: 8px 9px; }
      .targets-panel .grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .targets-panel .kpi { min-height: 82px; padding: 9px; border-radius: 13px; }
      .targets-panel .kpi strong { font-size: 1rem; line-height: 1.15; }
      .targets-panel .kpi small { font-size: .6rem; line-height: 1.25; }
      .activity-day { padding: 12px 10px; }
      .activity-timeline { padding-left: 19px; }
      .activity-timeline::before { left: 4px; opacity: .58; }
      .timeline-dot { left: -19px; width: 11px; height: 11px; border-width: 3px; box-shadow: 0 0 0 1px rgba(107, 213, 188, .4); }
      .activity-entry > summary { grid-template-columns: minmax(0, 1fr) 44px; min-height: 92px; }
      .activity-primary { gap: 8px; }
      .activity-status.badge { max-width: 42%; white-space: normal; text-align: center; }
      .activity-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap-block: 6px; }
      .activity-day > .business-day-summary { margin-left: 19px; }
      .detail-drawer { padding-inline: 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .analytics-card,
      .analytics-card > summary,
      .analytics-action i,
      .business-filter-panel :is(input, select),
      .business-filter-panel .button,
      .activity-entry,
      .activity-entry > summary,
      .earnings-breakdown > summary,
      .earnings-compact-summary,
      .earnings-breakdown > summary i::before,
      .earnings-breakdown > summary i::after,
      .advanced-filters > summary i::before,
      .advanced-filters > summary i::after,
      .revenue-hero-summary > i::before,
      .status-summary > i::before,
      .analytics-chevron::before,
      .earnings-compact-summary > i::before,
      .revenue-hero-summary::after,
      .earnings-kpi-chip,
      .appointment-chevron,
      .expand-chevron,
      :is(.invoice-totals-panel, .status-mix-panel) > summary,
      :is(.invoice-totals-panel, .status-mix-panel) > summary::before { transition: none; }
      .analytics-card:hover, .analytics-card > summary:active, .activity-entry:hover, .activity-entry > summary:active, .earnings-breakdown > summary:active, .business-filter-panel .button:not(:disabled):active { transform: none; }
      .dashboard-section, .mini-bars i, .status-meter i, .analytics-detail .chart-track i, .business-loading span, .invoice-totals-grid, .status-mix-grid, .analytics-detail, .earnings-overview > :not(summary) { animation: none !important; }
      .earnings-compact-summary:active .earnings-kpi-chip { transform: none; }
      :is(.revenue-hero-summary, .analytics-card > summary, .earnings-compact-summary, .activity-entry > summary):active { transform: none; }
    }
  `]
})
export class StaffBusinessPage implements OnInit, OnDestroy {
  private readonly todayDate = this.today();
  readonly business = signal<StaffBusiness | null>(null);
  readonly preset = signal<BusinessPreset>("1m");
  readonly fromDate = signal(this.monthsAgo(this.todayDate, 1));
  readonly toDate = signal(this.todayDate);
  readonly search = signal("");
  readonly showSearchSuggestions = signal(false);
  readonly status = signal("all");
  readonly sort = signal<"asc" | "desc">("desc");
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly message = signal("");
  readonly clock = signal(Date.now());
  readonly selectedAppointment = signal<StaffBusinessAppointment | null>(null);
  readonly invoiceDrawerOpen = signal(false);
  readonly invoiceDetail = signal<StaffBusinessInvoiceDetail | null>(null);
  readonly invoiceLoading = signal(false);
  readonly invoiceError = signal("");
  readonly activeFilterCount = computed(() =>
    Number(Boolean(this.search().trim())) + Number(this.status() !== "all") + Number(this.sort() !== "desc")
  );
  readonly searchSuggestions = computed<SearchSuggestion[]>(() => {
    const query = this.search().trim().toLocaleLowerCase();
    if (query.length < 2) return [];

    const suggestions: SearchSuggestion[] = [];
    const seen = new Set<string>();
    const add = (type: SearchSuggestion["type"], value: string | null | undefined) => {
      const cleanValue = value?.trim();
      const key = `${type}:${cleanValue?.toLocaleLowerCase()}`;
      if (!cleanValue || !cleanValue.toLocaleLowerCase().includes(query) || seen.has(key)) return;
      seen.add(key);
      suggestions.push({ type, value: cleanValue });
    };

    for (const appointment of this.business()?.appointments || []) {
      add("Invoice", appointment.billing?.invoiceNumber || appointment.billing?.saleId);
    }
    for (const service of this.business()?.services || []) add("Service", service.name);

    return suggestions
      .sort((a, b) => Number(!a.value.toLocaleLowerCase().startsWith(query)) - Number(!b.value.toLocaleLowerCase().startsWith(query)) || a.value.localeCompare(b.value))
      .slice(0, 6);
  });
  private clockTimer?: ReturnType<typeof setInterval>;
  private drawerTrigger: HTMLElement | null = null;
  private invoiceRequest = 0;
  private selectedInvoiceId = "";
  readonly appointmentGroups = computed(() => {
    const data = this.business();
    if (!data) return [];
    const summaries = new Map(data.dailyBreakdown.map((day) => [day.date, day]));
    const groups = new Map<string, StaffBusinessAppointment[]>();
    for (const item of data.appointments) {
      if (!groups.has(item.businessDate)) groups.set(item.businessDate, []);
      groups.get(item.businessDate)!.push(item);
    }
    return [...groups.entries()].map(([date, appointments]) => ({
      date,
      appointments,
      summary: summaries.get(date)!
    }));
  });

  constructor(readonly staff: StaffAppService) {}
  private loadGeneration = 0;

  ngOnInit() {
    this.clockTimer = setInterval(() => this.clock.set(Date.now()), 60_000);
    if (this.canReadBusiness()) void this.load(true);
  }

  ngOnDestroy() {
    this.loadGeneration++;
    this.invoiceRequest++;
    if (this.clockTimer) clearInterval(this.clockTimer);
  }

  async load(reset: boolean) {
    if (!this.validRange()) return;
    const generation = ++this.loadGeneration;
    const current = this.business();
    const page = reset ? 1 : Number(current?.pagination.page || 1) + 1;
    const queryObj = this.query(page);
    const cachedKey = `business:${JSON.stringify(queryObj)}`;
    const cached = this.staff.readStoredData<StaffBusiness>(cachedKey) || (reset ? this.staff.readStoredData<StaffBusiness>("business:default") : undefined);
    if (cached && reset && !current) {
      this.business.set(cached);
      this.loading.set(false);
    } else {
      reset ? this.loading.set(true) : this.loadingMore.set(true);
    }
    this.message.set("");
    try {
      const data = await this.staff.business(queryObj, reset);
      if (generation !== this.loadGeneration) return;
      if (reset || !current) {
        this.business.set(data);
        if (reset) this.staff.writeStoredData("business:default", data);
      } else {
        const byId = new Map([...current.appointments, ...data.appointments].map((item) => [item.id, item]));
        this.business.set({ ...data, appointments: [...byId.values()] });
      }
    } catch {
      // StaffAppService exposes the API error message in its error signal.
    } finally {
      if (generation === this.loadGeneration) {
        this.loading.set(false);
        this.loadingMore.set(false);
      }
    }
  }

  changePreset(preset: BusinessPreset) {
    this.preset.set(preset);
    this.message.set("");
    if (preset === "custom") return;
    this.toDate.set(this.todayDate);
    this.fromDate.set(preset === "today" ? this.todayDate : this.monthsAgo(this.todayDate, preset === "1y" ? 12 : Number(preset.slice(0, -1))));
    void this.load(true);
  }

  apply() { this.showSearchSuggestions.set(false); void this.load(true); }
  loadMore() { if (this.business()?.pagination.hasMore) void this.load(false); }

  closeSearchSuggestions() { setTimeout(() => this.showSearchSuggestions.set(false)); }

  selectSuggestion(suggestion: SearchSuggestion) {
    this.search.set(suggestion.value);
    this.apply();
  }

  clearFilters() {
    this.search.set("");
    this.showSearchSuggestions.set(false);
    this.status.set("all");
    this.sort.set("desc");
    void this.load(true);
  }

  canReadBusiness(): boolean { return this.staff.hasPermission("read:appointments"); }
  formatMinutes(minutes: number): string { const safe = Math.max(0, Number(minutes || 0)); return `${Math.floor(safe / 60)}h ${safe % 60}m`; }
  formatMoney(paise: number | null): string { return formatPaiseInr(paise); }
  formatPercent(value: number | null): string { return value === null ? "—" : `${value}%`; }
  capProgress(value: number): number { return Math.max(0, Math.min(100, Number(value || 0))); }
  formatTargetValue(value: number, unit: "paise" | "count" | "percent"): string {
    if (unit === "paise") return this.formatMoney(value);
    return unit === "percent" ? `${value}%` : Number(value || 0).toLocaleString("en-IN");
  }
  statusMetrics(data: StaffBusiness) {
    const counts = data.performance.statusCounts;
    return [
      { label: "Booked", value: counts.booked },
      { label: "Confirmed", value: counts.confirmed },
      { label: "Arrived", value: counts.arrived },
      { label: "In service", value: counts.inService },
      { label: "Completed", value: counts.completed },
      { label: "Cancelled", value: counts.cancelled },
      { label: "No-show", value: counts.noShow },
      { label: "Other", value: counts.other }
    ];
  }
  statusChartPercent(value: number, data: StaffBusiness): number {
    return data.summary.appointments ? this.capProgress((value / data.summary.appointments) * 100) : 0;
  }
  statusPercentLabel(value: number, data: StaffBusiness): string { return `${Math.round(this.statusChartPercent(value, data))}%`; }
  timeChart(data: StaffBusiness) {
    const rows = [
      { label: "Worked", value: data.summary.workedMinutes },
      { label: "Scheduled", value: data.summary.scheduledMinutes },
      { label: "Duty", value: data.performance.dutyMinutes }
    ];
    const maximum = Math.max(1, ...rows.map((row) => row.value));
    return rows.map((row) => ({ ...row, percent: this.capProgress((row.value / maximum) * 100) }));
  }
  revenueChart(data: StaffBusiness) {
    const rows = [
      { label: "My revenue", value: Number(data.performance.attributedAfterDiscountPaise || 0) },
      { label: "Avg bill", value: Number(data.performance.averageBillPaise || 0) },
      { label: "Per hour", value: Number(data.performance.revenuePerWorkedHourPaise || 0) }
    ];
    const maximum = Math.max(1, ...rows.map((row) => row.value));
    return rows.map((row) => ({ ...row, percent: this.capProgress((row.value / maximum) * 100) }));
  }
  dateLabel(date: string): string { return new Date(`${date}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }); }
  rangeLabel(): string { return `${this.dateLabel(this.fromDate())} – ${this.dateLabel(this.toDate())}`; }

  liveElapsed(item: StaffBusinessAppointment): number {
    this.clock();
    if (!item.timer.live || !item.timer.startedAt) return item.timer.elapsedMinutes;
    return Math.max(0, Math.round((Date.now() - new Date(item.timer.startedAt).getTime()) / 60_000));
  }

  liveRemaining(item: StaffBusinessAppointment): number {
    return Math.max(0, item.durationMinutes - this.liveElapsed(item));
  }

  liveOverrun(item: StaffBusinessAppointment): number {
    return Math.max(0, this.liveElapsed(item) - item.durationMinutes);
  }

  liveProgress(item: StaffBusinessAppointment): number {
    return item.durationMinutes ? this.capProgress((this.liveElapsed(item) / item.durationMinutes) * 100) : 0;
  }

  openAppointment(item: StaffBusinessAppointment, event: Event) {
    this.drawerTrigger = event.currentTarget as HTMLElement;
    this.invoiceDrawerOpen.set(false);
    this.invoiceDetail.set(null);
    this.selectedAppointment.set(item);
    setTimeout(() => document.getElementById("business-appointment-drawer")?.focus());
  }

  async openInvoice(item: StaffBusinessAppointment, event: Event) {
    const invoiceId = item.billing?.invoiceId;
    if (!invoiceId || !this.business()?.permissions.invoiceDetail) return;
    const request = ++this.invoiceRequest;
    this.selectedInvoiceId = invoiceId;
    this.drawerTrigger = event.currentTarget as HTMLElement;
    this.selectedAppointment.set(null);
    this.invoiceDrawerOpen.set(true);
    this.invoiceDetail.set(null);
    this.invoiceError.set("");
    this.invoiceLoading.set(true);
    setTimeout(() => document.getElementById("business-invoice-drawer")?.focus());
    try {
      const detail = await this.staff.businessInvoice(invoiceId);
      if (request === this.invoiceRequest && this.invoiceDrawerOpen() && this.selectedInvoiceId === invoiceId) this.invoiceDetail.set(detail);
    } catch {
      if (request === this.invoiceRequest && this.invoiceDrawerOpen() && this.selectedInvoiceId === invoiceId) this.invoiceError.set(this.staff.error() || "Unable to load invoice detail.");
    } finally {
      if (request === this.invoiceRequest && this.invoiceDrawerOpen() && this.selectedInvoiceId === invoiceId) this.invoiceLoading.set(false);
    }
  }

  dismissBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.closeDrawers();
  }

  closeDrawers() {
    this.invoiceRequest++;
    this.selectedInvoiceId = "";
    this.selectedAppointment.set(null);
    this.invoiceDrawerOpen.set(false);
    this.invoiceDetail.set(null);
    this.invoiceLoading.set(false);
    this.invoiceError.set("");
    const trigger = this.drawerTrigger;
    this.drawerTrigger = null;
    setTimeout(() => trigger?.focus());
  }

  @HostListener("document:keydown.escape")
  onEscape() {
    if (this.selectedAppointment() || this.invoiceDrawerOpen()) this.closeDrawers();
  }

  private query(page = 1): StaffBusinessQuery {
    return {
      from: this.fromDate(),
      to: this.toDate(),
      page,
      pageSize: 50,
      q: this.search().trim(),
      status: this.status(),
      sort: this.sort()
    };
  }

  private validRange(): boolean {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(this.fromDate()) && /^\d{4}-\d{2}-\d{2}$/.test(this.toDate()) && this.fromDate() <= this.toDate();
    if (!valid) this.message.set("Choose a valid From date on or before the To date.");
    return valid;
  }

  private monthsAgo(date: string, months: number): string {
    const [year, month, day] = date.split("-").map(Number);
    const target = year * 12 + month - 1 - months;
    const targetYear = Math.floor(target / 12);
    const targetMonth = target - targetYear * 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
  }

  private today(): string {
    return businessDate();
  }
}
