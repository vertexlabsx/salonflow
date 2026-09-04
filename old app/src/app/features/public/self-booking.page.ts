import { CommonModule } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { SelfBookingService, PublicBranch, PublicService, PublicDate, PublicSlot, PublicStaff } from "./self-booking.service";

type Step = "code" | "branch" | "service" | "schedule" | "contact" | "done";

const GOLD = "#c9a24b";
const PLUM = "#5b2c66";

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <main class="sb-page">
    <header class="sb-brand">
      <div class="sb-logo">S</div>
      <div class="sb-brandtext">
        <h1>Solastio</h1>
        <p>Book your visit in under a minute.</p>
      </div>
    </header>

    <div class="sb-progress" [attr.aria-label]="'Step ' + stepIndex() + ' of ' + totalSteps()">
      @for(p of progress; track p){<i [class.on]="p<=stepIndex()"></i>}
    </div>

    @if(message()){<p class="sb-message" [class.err]="messageError()">{{message()}}</p>}
    @if(busy()){<p class="sb-hint">Working…</p>}

    <!-- STEP: code -->
    @if(step()==='code'){
      <section class="sb-card">
        <h2>Salon code</h2>
        <p class="sb-hint">Enter the code from your salon's booking link.</p>
        <input class="sb-input" [ngModel]="salonCode()" (ngModelChange)="salonCode.set($event)" placeholder="e.g. tenant_aura_main" autocomplete="off">
        <button class="sb-btn primary" [disabled]="!salonCode().trim()||busy()" (click)="applySalon()">Continue</button>
      </section>
    }

    <!-- STEP: branch -->
    @if(step()==='branch'){
      <section class="sb-card">
        <h2>Choose a studio</h2>
        <div class="sb-list">
          @for(b of branches();track b.id){
            <button class="sb-row" (click)="pickBranch(b)"><span class="sb-row-main">{{b.name}}</span><span class="sb-row-arrow">›</span></button>
          }
          @empty{<p class="sb-hint">No studios are accepting online bookings right now.</p>}
        </div>
      </section>
    }

    <!-- STEP: service -->
    @if(step()==='service'){
      <section class="sb-card">
        <h2>Choose a service</h2>
        @for(s of services();track s.id){
          <button class="sb-row" (click)="pickService(s)">
            <span class="sb-row-main"><strong>{{s.name}}</strong><small>{{s.durationMinutes}} min · {{s.pricePaise/100 | currency:'INR'}}</small></span>
            <span class="sb-row-arrow">›</span>
          </button>
        }
        @empty{<p class="sb-hint">No services are available online at this studio.</p>}
      </section>
    }

    <!-- STEP: schedule -->
    @if(step()==='schedule'){
      <section class="sb-card">
        <h2>Pick a date</h2>
        @if(datesLoading()){<p class="sb-hint">Loading available dates…</p>}
        @else{
          <div class="sb-chips">
            @for(d of availableDates();track d.date){
              <button class="sb-chip" [class.on]="selectedDate()===d.date" (click)="pickDate(d)">{{displayDate(d.date)}}</button>
            }@empty{<p class="sb-hint">No availability in the next few weeks.</p>}
          </div>
        }

        @if(selectedDate()){
          <h3>Pick a time</h3>
          @if(slotsLoading()){<p class="sb-hint">Loading times…</p>}
          @else{
            <div class="sb-chips">
              @for(s of slots();track s.startAt){
                <button class="sb-chip" [class.on]="selectedSlot()===s.startAt" (click)="pickSlot(s)">{{displayTime(s.startAt)}}</button>
              }@empty{<p class="sb-hint">No available times on this date. Choose another date.</p>}
            </div>
          }
        }

        <div class="sb-actions">
          <button class="sb-btn" (click)="back()">Back</button>
          <button class="sb-btn primary" [disabled]="!selectedSlot()||busy()" (click)="goContact()">Continue</button>
        </div>
      </section>
    }

    <!-- STEP: contact -->
    @if(step()==='contact'){
      <section class="sb-card">
        <h2>Your details</h2>
        <div class="sb-summary">
          <div><span>{{chosenService()?.name}}</span><small>{{chosenService()?.durationMinutes}} min · {{chosenService()?.pricePaise!/100 | currency:'INR'}}</small></div>
          <div class="sb-summary-meta">{{chosenBranch()?.name}} · {{displayTime(selectedSlot()!)}}</div>
        </div>
        <label class="sb-label">Name</label>
        <input class="sb-input" [ngModel]="customerName()" (ngModelChange)="customerName.set($event)" placeholder="Your name" autocomplete="name">
        <label class="sb-label">WhatsApp number</label>
        <input class="sb-input" [ngModel]="customerPhone()" (ngModelChange)="customerPhone.set($event)" placeholder="e.g. 9876543210" inputmode="tel" autocomplete="tel">
        <p class="sb-hint">Your confirmation, reminders, changes and cancellations are sent by WhatsApp to this number.</p>
        <div class="sb-actions">
          <button class="sb-btn" (click)="back()">Back</button>
          <button class="sb-btn primary" [disabled]="!customerName().trim()||!customerPhone().trim()||busy()" (click)="confirm()">{{busy()?'Booking…':'Confirm booking'}}</button>
        </div>
      </section>
    }

    <!-- STEP: done -->
    @if(step()==='done'&&bookingId()){
      <section class="sb-card sb-done">
        <h2>{{doneTitle()}}</h2>
        <p class="sb-hint">{{doneText()}}</p>
        @if(booked()&&paymentLink()){<a class="sb-btn primary" [href]="paymentLink()">Pay deposit</a>}
        <div class="sb-receipt">
          <div><span>Booking ID</span><b>{{bookingId()}}</b></div>
        </div>
        <button class="sb-btn" (click)="reset()">Book another</button>
      </section>
    }

    <!-- Manage -->
    @if(manageTab()){
      <section class="sb-card">
        <h2>Manage my booking</h2>
        <label class="sb-label">Booking ID</label>
        <input class="sb-input" [ngModel]="manageId()" (ngModelChange)="manageId.set($event)" placeholder="Booking ID">
        <label class="sb-label">WhatsApp number</label>
        <input class="sb-input" [ngModel]="managePhone()" (ngModelChange)="managePhone.set($event)" placeholder="Phone on the booking" inputmode="tel">
        <div class="sb-actions">
          <button class="sb-btn" [disabled]="busy()" (click)="doCancel()">Cancel booking</button>
        </div>
        <p class="sb-hint">To reschedule, contact us on WhatsApp — the booking confirmation includes the option.</p>
      </section>
    }

    <footer class="sb-foot">
      <button class="sb-link" (click)="toggleManage()">{{manageTab()?'Hide manage':'Manage my booking'}}</button>
    </footer>
  </main>
  `,
  styleUrls: ["./self-booking.css"]
})
export class SelfBookingPage {
  private readonly api = inject(SelfBookingService);
  private readonly route = inject(ActivatedRoute);

  readonly salonId = signal("");
  readonly salonCode = signal("");
  readonly step = signal<Step>("code");
  readonly busy = signal(false);
  readonly message = signal("");
  readonly messageError = signal(false);

  readonly branches = signal<PublicBranch[]>([]);
  readonly services = signal<PublicService[]>([]);
  readonly availableDates = signal<PublicDate[]>([]);
  readonly slots = signal<PublicSlot[]>([]);
  readonly datesLoading = signal(false);
  readonly slotsLoading = signal(false);

  readonly chosenBranch = signal<PublicBranch | null>(null);
  readonly chosenService = signal<PublicService | null>(null);
  readonly selectedDate = signal("");
  readonly selectedSlot = signal("");

  readonly customerName = signal("");
  readonly customerPhone = signal("");

  readonly bookingId = signal("");
  readonly booked = signal(true);
  readonly doneTitle = signal("");
  readonly doneText = signal("");
  readonly paymentLink = signal("");
  readonly manageTab = signal(false);
  readonly manageId = signal("");
  readonly managePhone = signal("");

  readonly staff = signal<PublicStaff[]>([]);
  readonly stepIndex = computed(() => ["code", "branch", "service", "schedule", "contact", "done"].indexOf(this.step()) + 1);
  readonly totalSteps = () => 5;
  readonly progress = [1, 2, 3, 4, 5];

  constructor() {
    const salon = this.route.snapshot.queryParamMap.get("salon") || "";
    if (salon) {
      this.salonId.set(salon);
      this.salonCode.set(salon);
      void this.loadBranches();
    }
  }

  async applySalon() {
    if (this.busy()) return;
    this.salonId.set(this.salonCode().trim());
    await this.loadBranches();
  }

  private async loadBranches() {
    const salonId = this.salonId();
    if (!salonId) return;
    this.busy.set(true);
    this.message.set("");
    try {
      const { branches } = await this.api.branches(salonId);
      this.branches.set(branches);
      this.step.set("branch");
    } catch {
      this.flash("That salon code wasn't found. Check it and try again.", true);
    } finally {
      this.busy.set(false);
    }
  }

  pickBranch(b: PublicBranch) {
    this.chosenBranch.set(b);
    this.selectedDate.set("");
    this.selectedSlot.set("");
    void this.loadServices();
  }

  private async loadServices() {
    const branch = this.chosenBranch();
    if (!branch) return;
    this.busy.set(true);
    try {
      const { services } = await this.api.services(this.salonId(), branch.id);
      if (!services.length) {
        this.flash("This studio has no online-bookable services yet.", true);
        return;
      }
      this.services.set(services);
      this.step.set("service");
    } catch {
      this.flash("Could not load services. Try again.", true);
    } finally {
      this.busy.set(false);
    }
  }

  pickService(s: PublicService) {
    this.chosenService.set(s);
    void this.loadDates();
  }

  private async loadDates() {
    const branch = this.chosenBranch(), service = this.chosenService();
    if (!branch || !service) return;
    this.datesLoading.set(true);
    this.selectedDate.set("");
    this.selectedSlot.set("");
    this.slots.set([]);
    try {
      const { dates } = await this.api.availableDates(this.salonId(), branch.id, service.id);
      this.availableDates.set(dates);
      this.step.set("schedule");
    } catch {
      this.flash("Could not load availability. Try again.", true);
    } finally {
      this.datesLoading.set(false);
    }
  }

  pickDate(d: PublicDate) {
    this.selectedDate.set(d.date);
    this.selectedSlot.set("");
    void this.loadSlots();
  }

  private async loadSlots() {
    const branch = this.chosenBranch(), service = this.chosenService();
    const date = this.selectedDate();
    if (!branch || !service || !date) return;
    this.slotsLoading.set(true);
    try {
      const { slots } = await this.api.slots(this.salonId(), branch.id, service.id, date);
      this.slots.set(slots);
    } catch {
      this.slots.set([]);
      this.flash("Could not load times. Choose another date.", true);
    } finally {
      this.slotsLoading.set(false);
    }
  }

  pickSlot(s: PublicSlot) {
    this.selectedSlot.set(s.startAt);
  }

  goContact() {
    this.step.set("contact");
  }

  async confirm() {    const branch = this.chosenBranch(), service = this.chosenService(), startAt = this.selectedSlot();
    if (!branch || !service || !startAt || this.busy()) return;
    this.busy.set(true);
    this.message.set("");
    try {
      const r = await this.api.book({
        salonId: this.salonId(), branchId: branch.id, serviceId: service.id, startAt,
        customerName: this.customerName().trim(), phone: this.customerPhone().trim()
      });
      this.bookingId.set(r.bookingId);
      this.paymentLink.set(r.paymentLink || "");
      this.booked.set(true);
      this.doneTitle.set(r.depositApplied ? "Almost there — deposit required" : "You're booked!");
      this.doneText.set(r.depositApplied
        ? `Pay the advance deposit to hold your slot. A WhatsApp message with the payment link was sent to ${this.customerPhone()}.`
        : `Your ${service.name} visit is confirmed. A WhatsApp confirmation was sent to ${this.customerPhone()}.`);
      this.step.set("done");
    } catch {
      this.flash("We couldn't complete your booking. The time may have just been taken — try another slot.", true);
    } finally {
      this.busy.set(false);
    }
  }

  async doCancel() {
    if (!this.manageId().trim() || !this.managePhone().trim() || this.busy()) return;
    this.busy.set(true);
    this.message.set("");
    try {
      await this.api.cancel(this.salonId(), this.manageId().trim(), this.managePhone().trim());
      this.flash("Your booking was cancelled. A WhatsApp confirmation was sent.", false);
      this.manageId.set("");
      this.managePhone.set("");
    } catch {
      this.flash("We couldn't cancel that booking. Check the ID and phone number.", true);
    } finally {
      this.busy.set(false);
    }
  }

  back() {
    if (this.step() === "contact") { this.step.set("schedule"); return; }
    if (this.step() === "schedule") { this.step.set("service"); return; }
    if (this.step() === "service") { this.step.set("branch"); return; }
  }

  reset() {
    this.step.set("branch");
    this.selectedDate.set("");
    this.selectedSlot.set("");
    this.customerName.set("");
    this.customerPhone.set("");
    this.bookingId.set("");
  }

  toggleManage() {
    this.manageTab.set(!this.manageTab());
  }

  displayDate(d: string) {
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(y, m - 1, day);
    return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  }

  displayTime(iso: string) {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  }

  private flash(text: string, isError: boolean) {
    this.message.set(text);
    this.messageError.set(isError);
    setTimeout(() => { this.message.set(""); }, 6000);
  }
}
