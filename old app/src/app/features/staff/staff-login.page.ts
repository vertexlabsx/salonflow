import { Component, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { IonContent, IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [FormsModule, IonContent, IonSpinner],
  template: `
    <ion-content class="staff-login-shell">
      <main class="login-grid">
        <section class="staff-card">
          <div class="orb login-orb"></div>
          <div class="orb login-orb-secondary"></div>
          <p class="eyebrow dark">Solastio Workspace</p>
          <h2>Open your workspace</h2>

          @if (staff.error()) {
            <div class="notice">{{ staff.error() }}</div>
          }
          @if (message()) {
            <div class="notice success">{{ message() }}</div>
          }
           @if (staff.biometricEnabled()) {
             <button type="button" class="biometric-button" [disabled]="staff.loading()" (click)="unlockBiometric()">Sign in with passkey</button>
          }

          <form class="staff-form" (ngSubmit)="login($event)">
            <div class="floating-field">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v4h1a2 2 0 0 1 2 2v10h-7v-4H8v4H4Zm3-14h2V5H7v2Zm4 0h2V5h-2v2Zm-4 4h2V9H7v2Zm4 0h2V9h-2v2Zm4 2v2h2v-2h-2Zm0 6h2v-2h-2v2Z"></path></svg>
              <input id="staff-tenant-id" [(ngModel)]="tenantId" name="tenantId" placeholder="tenant_" autocomplete="organization" />
              <label for="staff-tenant-id">Tenant ID</label>
            </div>

            <div class="floating-field">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5C21 16.5 17 14 12 14Z"></path></svg>
              <input id="staff-login-id" [(ngModel)]="loginId" name="loginId" placeholder="isha.staff" autocomplete="username" />
              <label for="staff-login-id">Email or staff login ID</label>
            </div>

            <div class="floating-field password-field">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 9h-1V7A4 4 0 0 0 8 7v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm3 10.7V19h-2v-1.3a2 2 0 1 1 2 0Z"></path></svg>
              <input id="staff-password" [(ngModel)]="password" name="password" [type]="showPassword() ? 'text' : 'password'" placeholder="Password" autocomplete="current-password" />
              <label for="staff-password">Password</label>
              <button class="password-toggle" type="button" [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'" [attr.aria-pressed]="showPassword()" (click)="showPassword.set(!showPassword())">
                @if (showPassword()) {
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.3 2 18.7 18.7-1.3 1.3-3.3-3.3A11.7 11.7 0 0 1 12 20C5 20 1 12 1 12a20 20 0 0 1 4.1-5.3L2 3.3 3.3 2Zm3.2 6.1A15.6 15.6 0 0 0 3.3 12c1 1.6 4.1 6 8.7 6 1.4 0 2.7-.4 3.8-.9l-2-2a4 4 0 0 1-5-5l-2.3-2Zm5.1-.1L16 12.4V12a4 4 0 0 0-4.4-4Zm.4-4c7 0 11 8 11 8a19.6 19.6 0 0 1-3.4 4.6l-1.4-1.4a16 16 0 0 0 2.5-3.2C19.7 10.4 16.6 6 12 6c-.8 0-1.6.1-2.3.4L8.1 4.8c1.2-.5 2.5-.8 3.9-.8Z"></path></svg>
                } @else {
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4C5 4 1 12 1 12s4 8 11 8 11-8 11-8-4-8-11-8Zm0 14c-4.6 0-7.7-4.4-8.7-6 1-1.6 4.1-6 8.7-6s7.7 4.4 8.7 6c-1 1.6-4.1 6-8.7 6Zm0-10a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"></path></svg>
                }
              </button>
            </div>

            <button type="submit" [disabled]="staff.loading()">
              @if (staff.loading()) { <ion-spinner name="crescent"></ion-spinner> } @else { Open workspace }
            </button>
          </form>

           @if (staff.hasSavedSession() && staff.biometricSupported()) {
            <button type="button" class="secondary-button" [disabled]="staff.loading()" (click)="toggleBiometric()">
              {{ staff.biometricEnabled() ? 'Turn off biometric unlock' : 'Enable biometric unlock' }}
            </button>
          }

         </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .staff-login-shell { --background: radial-gradient(circle at 12% 5%, color-mix(in srgb,var(--staff-primary) 16%,transparent), transparent 30%), radial-gradient(circle at 88% 12%, color-mix(in srgb,var(--staff-border-accent) 42%,transparent), transparent 26%), var(--staff-background); }
    .login-grid { width: min(540px, calc(100% - 28px)); min-height: 100%; margin: 0 auto; padding: 7vh 0; display: grid; grid-template-columns: 1fr; align-items: center; }
    .staff-card { position: relative; overflow: hidden; padding: 38px; border: 1px solid color-mix(in srgb,var(--staff-primary) 18%,var(--staff-border)); border-radius: 34px; background: linear-gradient(145deg,var(--staff-surface),var(--staff-surface-secondary)); box-shadow: var(--staff-shadow-elevated); }
    .orb { position: absolute; z-index: 0; border-radius: 50%; opacity: .5; pointer-events: none; }
    .orb.login-orb { width: 220px; height: 220px; right: -54px; top: -54px; background: radial-gradient(circle,var(--staff-border-accent),transparent 68%); }
    .orb.login-orb-secondary { width: 170px; height: 170px; left: -58px; bottom: -58px; background: radial-gradient(circle,var(--staff-primary-light),transparent 70%); }
    .staff-card > :not(.orb) { position: relative; z-index: 1; }
    .eyebrow { position: relative; margin: 0 0 12px; color: var(--staff-primary-hover); font-size: .72rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .dark { color: var(--staff-primary); }
    h2 { margin: 0; color: var(--staff-text); font-family:Georgia,"Times New Roman",serif;font-size: clamp(2.2rem, 5vw, 3.5rem); font-weight:500;line-height: .98; letter-spacing: -.055em; }
    .staff-form { display: grid; gap: 12px; margin-top: 20px; }
    .floating-field { position: relative; min-width: 0; }
    .floating-field > svg { position: absolute; z-index: 2; top: 50%; left: 18px; width: 20px; height: 20px; transform: translateY(-50%); fill: currentColor; color: #64748b; pointer-events: none; transition: color 180ms ease; }
    .floating-field input { box-sizing: border-box; width: 100%; height: var(--staff-input-height); min-height: var(--staff-input-height); border: 1px solid var(--staff-input-border); border-radius: var(--staff-input-radius); padding: 28px 50px 2px; color: var(--staff-input-text); background: var(--staff-input-background); font-size: 16px; font-weight: 500; line-height: 20px; caret-color: var(--staff-input-focus); transition: border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease, transform 180ms ease; }
    .floating-field input::placeholder { color: transparent; font-size: 15px; font-weight: 400; transition: color 180ms ease; }
    .floating-field label { position: absolute; z-index: 2; top: 50%; left: 50px; max-width: calc(100% - 106px); overflow: hidden; transform: translateY(-50%); transform-origin: left center; color: var(--staff-input-label); font-size: 14px; font-weight: 600; line-height: 14px; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; transition: top 180ms ease, transform 180ms ease, color 180ms ease; }
    .floating-field input:focus, .floating-field input:not(:placeholder-shown), .floating-field input:-webkit-autofill { padding-top: 28px; padding-bottom: 2px; }
    .floating-field input:focus + label, .floating-field input:not(:placeholder-shown) + label, .floating-field input:-webkit-autofill + label { top: 5px; transform: none; font-size: 11px; }
    .floating-field input:focus::placeholder { color: var(--staff-input-placeholder); }
    .floating-field:focus-within > svg, .floating-field:focus-within label { color: var(--staff-input-focus); }
    .floating-field input:hover { border-color: #b9d5c2; }
    .floating-field input:focus { border: 2px solid var(--staff-input-focus); outline: 0; box-shadow: 0 0 0 4px var(--staff-input-focus-ring); background: var(--staff-input-background); }
    .floating-field input:disabled { border-color: var(--staff-input-border); background: var(--staff-input-disabled-background); color: var(--staff-input-disabled-text); cursor: not-allowed; opacity: 1; }
    .floating-field input:-webkit-autofill { -webkit-text-fill-color: var(--staff-input-text); box-shadow: 0 0 0 1000px var(--staff-input-background) inset; caret-color: var(--staff-input-focus); font-family: inherit !important; font-size: 16px !important; font-weight: 500 !important; line-height: 20px !important; }
    .floating-field input:-webkit-autofill::first-line { color: var(--staff-input-text); font-family: inherit; font-size: 16px; font-weight: 500; line-height: 20px; }
    .floating-field input:-webkit-autofill:focus { box-shadow: 0 0 0 1000px var(--staff-input-background) inset, 0 0 0 4px var(--staff-input-focus-ring); }
    .floating-field input:active { transform: scale(.995); }
    .password-field input { padding-right: 60px; }
    .password-field input::-ms-reveal, .password-field input::-ms-clear { display: none; }
    .password-toggle { position: absolute; z-index: 3; top: 0; right: 0; display: grid; place-items: center; width: 56px; min-height: 56px; margin: 0; padding: 0; border: 0; border-radius: 0 var(--staff-input-radius) var(--staff-input-radius) 0; background: transparent; color: #64748b; }
    .password-toggle:hover:not(:disabled), .password-toggle:focus-visible { border: 0; background: transparent; color: var(--staff-input-focus); }
    .password-toggle:focus-visible { outline: 3px solid var(--staff-input-focus-ring); outline-offset: -5px; }
    .password-toggle svg { width: 20px; height: 20px; fill: currentColor; }
    button { margin-top: 14px; min-height: 56px; border: 1px solid var(--staff-primary); border-radius: 18px; background: linear-gradient(135deg,var(--staff-primary),var(--staff-primary-hover)); color: var(--staff-on-primary); font-weight: 800; cursor: pointer; box-shadow:0 16px 34px color-mix(in srgb,var(--staff-primary) 24%,transparent); }
    button:hover:not(:disabled) { border-color: var(--staff-primary-hover); background: linear-gradient(135deg,var(--staff-primary-hover),var(--staff-primary)); transform:translateY(-1px); }
    button:disabled { cursor: progress; opacity: .72; }
    .biometric-button, .secondary-button { width: 100%; margin-top: 14px; min-height: 52px; border: 1px solid var(--staff-border-accent); border-radius: 18px; background: var(--staff-surface); color: var(--staff-primary-hover); font-weight: 800; cursor: pointer; box-shadow:var(--staff-shadow); }
    .biometric-button { border-color: var(--staff-border-accent); background: var(--staff-primary-light); color: var(--staff-primary-hover); }
    .notice { margin: 18px 0; padding: 14px 16px; border: 1px solid var(--staff-error-border); border-radius: 16px; color: var(--staff-error-text); background: var(--staff-error-surface); font-weight: 650; }
    .success { border-color: var(--staff-success-border); color: var(--staff-success-text); background: var(--staff-success-surface); }
    .debug-box { margin: 10px 0; padding: 10px 14px; border: 1px dashed #94a3b8; border-radius: 12px; background: #1e293b; color: #e2e8f0; font-family: monospace; font-size: 11px; line-height: 1.6; }
    .debug-box summary { cursor: pointer; font-size: 12px; font-weight: 700; color: #94a3b8; }
    .debug-line { white-space: pre-wrap; word-break: break-all; }
    @media (max-width: 820px) { .login-grid { width: calc(100% - 30px); padding: max(20px, env(safe-area-inset-top)) 0 max(20px, env(safe-area-inset-bottom)); } .staff-card { padding: 24px 20px;border-radius:28px; } }
    @media (max-width: 420px) { .login-grid { width: 100%; min-height: 100dvh; padding: max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)); align-items: center; } .staff-card { display:grid;align-content:start;min-height:0;padding:18px 14px;border-radius:18px;box-shadow:0 10px 28px rgba(42,20,51,.12); } h2 { font-size: clamp(1.45rem, 8vw, 1.9rem); line-height:1.05; } .staff-form { gap: 9px; margin-top: 14px; } .floating-field input { height: 50px; min-height:50px; padding-left:44px; padding-right:44px; } .floating-field label { left:44px; max-width:calc(100% - 88px); } .floating-field > svg { left:14px; } button,.biometric-button,.secondary-button { min-height:46px;margin-top:8px; } }
    @media (prefers-reduced-motion: reduce) { .floating-field input, .floating-field label, .floating-field > svg, .floating-field input::placeholder { transition: none; } }
  `]
})
export class StaffLoginPage {
  readonly message = signal("");
  readonly showPassword = signal(false);
  tenantId = "tenant_";
  loginId = "";
  password = "";

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  async ngOnInit() {
    if (this.staff.hasSavedSession()) {
      const user = this.staff.user();
      const isOwner = String(user?.role || "").trim().toLowerCase() === "owner";
      await this.router.navigateByUrl(isOwner ? "/owner/dashboard" : "/staff/dashboard", { replaceUrl: true });
    }
  }

  async login(event?: Event) {
    event?.preventDefault();
    if (this.staff.loading()) return;
    this.message.set("");
    try {
      const user = await this.staff.login({ tenantId: this.tenantId, loginId: this.loginId, password: this.password });
      const isOwner = String(user.role || "").trim().toLowerCase() === "owner";
      this.message.set(isOwner ? "Owner verified. Opening dashboard..." : "Staff session created. Opening dashboard...");
      await this.router.navigateByUrl(isOwner ? "/owner/dashboard" : "/staff/dashboard");
    } catch {
      this.message.set("");
    }
  }

  async unlockBiometric() {
    if (this.staff.loading()) return;
    try {
      await this.staff.unlockWithBiometric();
      this.message.set("Biometric verified. Opening dashboard...");
      await this.router.navigateByUrl("/staff/dashboard");
    } catch (error) {
      this.staff.error.set(error instanceof Error ? error.message : "Biometric unlock failed.");
    }
  }

  async toggleBiometric() {
    if (this.staff.loading()) return;
    try {
      const next = !this.staff.biometricEnabled();
      await this.staff.setBiometricEnabled(next);
      this.message.set(next ? "Biometric unlock enabled on this device." : "Biometric unlock disabled.");
    } catch (error) {
      this.staff.error.set(error instanceof Error ? error.message : "Unable to update biometric unlock.");
    }
  }
}
