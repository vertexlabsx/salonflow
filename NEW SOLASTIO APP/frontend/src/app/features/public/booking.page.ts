import { CurrencyPipe, DatePipe } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ApiService, PublicBranch, PublicDate, PublicService, PublicSlot } from "../../core/api.service";

type Step = "salon" | "branch" | "service" | "time" | "contact" | "done";

@Component({
  standalone: true,
  imports: [CurrencyPipe, DatePipe, FormsModule],
  template: `
    <main class="screen booking-screen">
      <section class="booking-card">
        <header class="booking-brand">
          <span class="mark">S</span>
          <div><strong>Solastio</strong><small>Premium booking</small></div>
        </header>

        <div class="booking-progress" [attr.aria-label]="'Step ' + stepIndex() + ' of 5'">
          @for (item of [1,2,3,4,5]; track item) { <i [class.on]="item <= stepIndex()"></i> }
        </div>

        @if (message()) { <p class="notice" [class.error]="messageError()">{{ message() }}</p> }

        @if (step() === 'salon') {
          <section class="hero compact">
            <p class="eyebrow">Book online</p>
            <h1>Choose your salon visit.</h1>
            <p>Enter the salon code from your booking link.</p>
            <label class="field">Salon code<input [(ngModel)]="salonId" placeholder="tenant_aura" autocomplete="off"></label>
            <button class="btn primary full" [disabled]="busy() || !salonId.trim()" (click)="loadBranches()">Continue</button>
          </section>
        }

        @if (step() === 'branch') {
          <section class="panel"><div class="panel-head"><h2>Select studio</h2><button class="btn" (click)="back()">Back</button></div><div class="list">
            @for (branch of branches(); track branch.id) { <button class="list-row" (click)="pickBranch(branch)"><span><strong>{{ branch.name }}</strong><small>{{ branch.city || branch.address || 'Available for online booking' }}</small></span><b>Next</b></button> }
            @empty { <p class="muted">No online booking branches found.</p> }
          </div></section>
        }

        @if (step() === 'service') {
          <section class="panel"><div class="panel-head"><h2>Select service</h2><button class="btn" (click)="back()">Back</button></div><div class="list">
            @for (service of services(); track service.id) { <button class="list-row" (click)="pickService(service)"><span><strong>{{ service.name }}</strong><small>{{ service.durationMinutes }} min · {{ service.pricePaise / 100 | currency:'INR' }}</small></span><b>Next</b></button> }
            @empty { <p class="muted">No online services found for this branch.</p> }
          </div></section>
        }

        @if (step() === 'time') {
          <section class="panel">
            <div class="panel-head"><h2>Pick time</h2><button class="btn" (click)="back()">Back</button></div>
            <div class="chip-grid">
              @for (date of dates(); track date.date) { <button class="chip" [class.active]="selectedDate() === date.date" (click)="pickDate(date)">{{ date.date | date:'EEE, d MMM' }}</button> }
            </div>
            @if (selectedDate()) {
              <div class="chip-grid">
                @for (slot of slots(); track slot.startAt) { <button class="chip" [class.active]="selectedSlot()?.startAt === slot.startAt" (click)="selectedSlot.set(slot)">{{ slot.startAt | date:'shortTime' }}</button> }
                @empty { <p class="muted">No slots for this date.</p> }
              </div>
            }
            <button class="btn primary full" [disabled]="!selectedSlot()" (click)="step.set('contact')">Continue</button>
          </section>
        }

        @if (step() === 'contact') {
          <section class="panel">
            <div class="panel-head"><h2>Your details</h2><button class="btn" (click)="back()">Back</button></div>
            <p class="notice">{{ selectedService()?.name }} at {{ selectedBranch()?.name }} · {{ selectedSlot()?.startAt | date:'EEE, d MMM, shortTime' }}</p>
            <label class="field">Name<input [(ngModel)]="customerName" autocomplete="name"></label>
            <label class="field">WhatsApp number<input [(ngModel)]="customerPhone" inputmode="tel" autocomplete="tel"></label>
            <button class="btn primary full" [disabled]="busy() || !customerName.trim() || !customerPhone.trim()" (click)="book()">{{ busy() ? 'Booking...' : 'Confirm booking' }}</button>
          </section>
        }

        @if (step() === 'done') {
          <section class="hero compact done"><p class="eyebrow">Confirmed</p><h1>Booking received.</h1><p>Your booking ID is <strong>{{ bookingId() }}</strong>.</p><button class="btn full" (click)="reset()">Book another</button></section>
        }
      </section>
    </main>
  `,
  styles: [`
    .booking-screen{display:grid;place-items:start center;background:radial-gradient(circle at 50% 0,rgba(181,139,69,.22),transparent 30%),var(--bg)}
    .booking-card{width:min(100%,560px);display:grid;gap:14px}.booking-brand{display:flex;align-items:center;gap:10px}.booking-brand strong{display:block;font-family:Georgia,serif;font-size:1.5rem;font-weight:500}.booking-brand small{display:block;color:var(--muted);font-weight:700}.booking-progress{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.booking-progress i{height:5px;border-radius:999px;background:var(--line)}.booking-progress i.on{background:linear-gradient(90deg,var(--accent-2),var(--accent))}.compact{box-shadow:var(--shadow)}.chip-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.chip{min-height:48px;border:1px solid var(--line);border-radius:15px;background:#fff;color:var(--ink);font-weight:850}.chip.active{border-color:var(--accent);background:var(--accent);color:#fff}.done{text-align:center}.done h1{max-width:none}@media(min-width:680px){.chip-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:360px){.chip-grid{grid-template-columns:1fr}}
  `]
})
export class BookingPage {
  private readonly api = inject(ApiService);
  salonId = "tenant_aura";
  customerName = "";
  customerPhone = "";
  readonly step = signal<Step>("salon");
  readonly busy = signal(false);
  readonly message = signal("");
  readonly messageError = signal(false);
  readonly branches = signal<PublicBranch[]>([]);
  readonly services = signal<PublicService[]>([]);
  readonly dates = signal<PublicDate[]>([]);
  readonly slots = signal<PublicSlot[]>([]);
  readonly selectedBranch = signal<PublicBranch | null>(null);
  readonly selectedService = signal<PublicService | null>(null);
  readonly selectedDate = signal("");
  readonly selectedSlot = signal<PublicSlot | null>(null);
  readonly bookingId = signal("");
  readonly stepIndex = computed(() => Math.min(["salon", "branch", "service", "time", "contact", "done"].indexOf(this.step()) + 1, 5));

  async loadBranches() {
    await this.run(async () => {
      const response = await this.api.get<{ branches: PublicBranch[] }>("/self-booking/branches", { salonId: this.salonId.trim() });
      this.branches.set(response.branches || []);
      this.step.set("branch");
    }, "Could not load studios.");
  }

  async pickBranch(branch: PublicBranch) {
    this.selectedBranch.set(branch);
    await this.run(async () => {
      const response = await this.api.get<{ services: PublicService[] }>("/self-booking/services", { salonId: this.salonId, branchId: branch.id });
      this.services.set(response.services || []);
      this.step.set("service");
    }, "Could not load services.");
  }

  async pickService(service: PublicService) {
    this.selectedService.set(service);
    await this.run(async () => {
      const response = await this.api.get<{ dates: PublicDate[] }>("/self-booking/available-dates", { salonId: this.salonId, branchId: this.selectedBranch()!.id, serviceId: service.id });
      this.dates.set(response.dates || []);
      this.step.set("time");
    }, "Could not load dates.");
  }

  async pickDate(date: PublicDate) {
    this.selectedDate.set(date.date);
    this.selectedSlot.set(null);
    await this.run(async () => {
      const response = await this.api.get<{ slots: PublicSlot[] }>("/self-booking/slots", { salonId: this.salonId, branchId: this.selectedBranch()!.id, serviceId: this.selectedService()!.id, date: date.date });
      this.slots.set(response.slots || []);
    }, "Could not load slots.");
  }

  async book() {
    const slot = this.selectedSlot();
    if (!slot) return;
    await this.run(async () => {
      const response = await this.api.post<{ bookingId: string }>("/self-booking/book", { salonId: this.salonId, branchId: this.selectedBranch()!.id, serviceId: this.selectedService()!.id, staffId: slot.staffId, startAt: slot.startAt, customerName: this.customerName, customerPhone: this.customerPhone });
      this.bookingId.set(response.bookingId || "Pending confirmation");
      this.step.set("done");
    }, "Could not create booking.");
  }

  back() {
    const order: Step[] = ["salon", "branch", "service", "time", "contact", "done"];
    this.step.set(order[Math.max(0, order.indexOf(this.step()) - 1)]);
  }

  reset() { this.step.set("salon"); this.bookingId.set(""); this.selectedBranch.set(null); this.selectedService.set(null); this.selectedDate.set(""); this.selectedSlot.set(null); }

  private async run(work: () => Promise<void>, fallback: string) {
    this.busy.set(true); this.message.set(""); this.messageError.set(false);
    try { await work(); } catch { this.message.set(fallback); this.messageError.set(true); } finally { this.busy.set(false); }
  }
}
