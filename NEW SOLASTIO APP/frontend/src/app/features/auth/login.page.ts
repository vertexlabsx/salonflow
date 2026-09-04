import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { AuthService, Role } from "../../core/auth.service";

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main class="screen login-screen">
      <section class="login-story">
        <a class="brand" routerLink="/book"><span class="mark">S</span><div><strong>Solastio</strong><small>New app</small></div></a>
        <div><p class="eyebrow">Premium salon operating system</p><h1>Calm software for busy salons.</h1><p>Fast booking, staff execution, owner control and customer memory on the Rust backend.</p></div>
      </section>
      <section class="login-panel panel">
        <div><p class="eyebrow">Secure access</p><h2>Sign in</h2><p class="muted">Use staff or owner credentials configured in the backend.</p></div>
        @if (error()) { <p class="notice error">{{ error() }}</p> }
        <div class="role-switch" role="group" aria-label="Role"><button [class.active]="role()==='staff'" (click)="role.set('staff')">Staff</button><button [class.active]="role()==='owner'" (click)="role.set('owner')">Owner</button></div>
        <label class="field">Login ID<input [(ngModel)]="loginId" autocomplete="username" placeholder="reception or owner"></label>
        <label class="field">Password<input [(ngModel)]="password" type="password" autocomplete="current-password"></label>
        <button class="btn primary full" [disabled]="auth.busy() || !loginId.trim() || !password" (click)="submit()">{{ auth.busy() ? 'Signing in...' : 'Enter workspace' }}</button>
      </section>
    </main>
  `,
  styles: [`
    .login-screen{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(360px,.85fr);gap:18px;align-items:stretch;background:linear-gradient(135deg,#f7f2ea,#eee4dc)}.login-story{min-height:calc(100dvh - 36px);display:flex;flex-direction:column;justify-content:space-between;border-radius:28px;padding:28px;background:#1f1b16;color:#fff;overflow:hidden}.login-story .brand small,.login-story p{color:#d5c8b7}.login-story h1{max-width:10ch;margin:0;font-family:Georgia,serif;font-size:clamp(3rem,7vw,6.8rem);font-weight:500;line-height:.9;letter-spacing:-.07em}.login-panel{align-self:center;padding:24px}.role-switch{display:grid;grid-template-columns:1fr 1fr;gap:6px;border:1px solid var(--line);border-radius:16px;padding:5px;background:var(--surface-2)}.role-switch button{min-height:44px;border:0;border-radius:12px;background:transparent;color:var(--muted);font-weight:850}.role-switch button.active{background:var(--surface);color:var(--accent);box-shadow:0 8px 22px rgba(48,39,28,.08)}@media(max-width:820px){.login-screen{grid-template-columns:1fr;gap:12px}.login-story{min-height:auto;padding:18px;border-radius:22px}.login-story h1{font-size:clamp(2rem,12vw,3.4rem);max-width:12ch}.login-panel{align-self:auto}}
  `]
})
export class LoginPage {
  readonly auth = inject(AuthService);
  readonly role = signal<Role>("staff");
  readonly error = signal("");
  loginId = "reception";
  password = "staff@123";

  async submit() {
    this.error.set("");
    try { await this.auth.login(this.loginId.trim(), this.password, this.role()); } catch { this.error.set("Could not sign in. Check credentials and backend status."); }
  }
}
