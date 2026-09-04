import { Component, effect, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import { OwnerAttendanceDevice, OwnerAttendanceEvidence, OwnerAttendancePolicy } from "./owner-people.models";

const DEFAULT_POLICY: OwnerAttendancePolicy = {
  branchId: "", latitude: null, longitude: null, radiusMeters: 50, maxAccuracyMeters: 25,
  enforceClockIn: true, enforceClockOut: true, requireVerifiedAttestation: false,
  status: "disabled", version: 0
};

@Component({
  selector: "owner-attendance-verification",
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="verification" aria-labelledby="secure-attendance-title">
      <header><div><p class="eyebrow">Secure mobile attendance</p><h2 id="secure-attendance-title">Verification policy & evidence</h2><p>Configure one salon branch, trust staff devices and review the exact evidence behind accepted or rejected punches.</p></div><span>{{ context.selectedBranch()?.name || 'Select one branch' }}</span></header>
      @if (!validBranch()) { <p class="state" role="status">Select one active branch before managing secure attendance. “All Branches” cannot hold a location policy.</p> }
      @else {
        @if (error()) { <p class="notice error" role="alert">{{ error() }}</p> }
        <div class="grid">
          <section class="panel policy" [attr.aria-busy]="loading()">
             <div class="panel-head"><div><b>Branch policy</b><small>Salon geofence and enforcement</small></div><label class="toggle"><input type="checkbox" [checked]="policy().status === 'active'" (change)="setEnabled($event)"> Enforce</label></div>
             @if (showCoordinateGuide()) { <aside class="setup-guide" aria-labelledby="coordinate-guide-title"><div><span aria-hidden="true">1</span><strong id="coordinate-guide-title">Add your salon location</strong></div><ol><li><a href="https://maps.google.com" target="_blank" rel="noopener noreferrer">Open Google Maps</a> and zoom to the salon entrance.</li><li>Press and hold the exact entrance pin, then copy the coordinate pair.</li><li>Paste the first number into Latitude and the second into Longitude.</li><li>Start with a 50 m radius and 25 m maximum accuracy.</li></ol><p>Example format: <code>19.xxxxxx, 72.xxxxxx</code>. Do not enter a staff member's current location.</p></aside> }
            <div class="coordinates"><label>Salon latitude<input type="number" step="any" min="-90" max="90" [ngModel]="policy().latitude" (ngModelChange)="setNumber('latitude',$event)"></label><label>Salon longitude<input type="number" step="any" min="-180" max="180" [ngModel]="policy().longitude" (ngModelChange)="setNumber('longitude',$event)"></label></div>
             <div class="coordinates"><label>Allowed radius (10–1000 m)<input type="number" min="10" max="1000" step="5" [ngModel]="policy().radiusMeters" (ngModelChange)="setNumber('radiusMeters',$event)"></label><label>Maximum accuracy (1–500 m)<input type="number" min="1" max="500" step="1" [ngModel]="policy().maxAccuracyMeters" (ngModelChange)="setNumber('maxAccuracyMeters',$event)"></label></div>
             <fieldset><legend>Apply verification</legend><label><input type="checkbox" [checked]="policy().enforceClockIn" (change)="setFlag('enforceClockIn',$event)"> Clock-in</label><label><input type="checkbox" [checked]="policy().enforceClockOut" (change)="setFlag('enforceClockOut',$event)"> Clock-out</label><label><input type="checkbox" [checked]="policy().requireVerifiedAttestation" (change)="setFlag('requireVerifiedAttestation',$event)"> Require server-verified key attestation</label></fieldset>
             @if (!policyValid()) { <p class="validation">Enter valid, non-zero salon coordinates, radius 10–1000 m and accuracy 1–500 m.</p> }
             <p class="privacy"><strong>Privacy and retention:</strong> precise coordinates, accuracy, device trust, biometric result, mock-location signal and optional integrity verdict are sensitive attendance evidence. Inform staff before enforcement and retain only for the configured/legal period.</p>
            <footer><span>{{ message() }}</span><button class="button primary" type="button" [disabled]="saving() || !policyValid()" (click)="savePolicy()">{{ saving() ? 'Saving…' : 'Save policy' }}</button></footer>
          </section>
          <section class="panel devices">
            <div class="panel-head"><div><b>Trusted devices</b><small>Approve registrations or revoke access</small></div><button class="button" type="button" (click)="loadDevices()">Refresh</button></div>
             @for (device of devices(); track device.id) { <article><div><strong>{{ device.staffId }}</strong><small>{{ device.deviceLabel }} · {{ device.platform }} · {{ device.publicKeyAlgorithm }}</small><small>{{ device.verificationCapability }} · hardware claim: {{ device.hardwareBackedClaim ? 'yes (client-reported)' : 'no' }} · attestation: {{ device.attestationStatus }}</small><code>{{ device.keyFingerprint }}</code></div><span [attr.data-status]="device.status">{{ label(device.status) }}</span><div class="actions">@if(device.status !== 'approved'){<button type="button" [disabled]="busyDevice() === device.id" (click)="setDevice(device,'approved')">Approve</button>}@if(device.status !== 'revoked'){<button type="button" [disabled]="busyDevice() === device.id" (click)="setDevice(device,'revoked')">Revoke</button>}</div></article> } @empty { <p class="empty">No registered devices for this branch.</p> }
          </section>
        </div>
        <section class="panel evidence">
          <div class="panel-head"><div><b>Punch evidence</b><small>Exact location, trust checks and rejection details</small></div><label>Decision<select [ngModel]="decision()" (ngModelChange)="decision.set($event);loadEvidence()"><option value="">All</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></label></div>
           @for (item of evidence(); track item.id) { <article><header><div><strong>{{ item.staffId }}</strong><small>{{ label(item.action) }} · {{ context.formatDateTime(item.capturedAt) }}</small></div><span [attr.data-status]="item.decision">{{ label(item.decision) }}</span></header><dl><div><dt>Exact location</dt><dd>{{ coordinates(item) }}</dd></div><div><dt>Distance / accuracy</dt><dd>{{ metres(item.serverDistanceMeters) }} / {{ metres(item.accuracyMeters) }}</dd></div><div><dt>Signature</dt><dd>{{ item.signatureValid ? 'Verified' : 'Not verified' }}</dd></div><div><dt>Mock / integrity</dt><dd>{{ item.mockLocation ? 'Mock detected' : 'Not reported as mock' }} / {{ item.integrityVerdict || 'Not supplied' }}</dd></div><div class="wide"><dt>Decision reason</dt><dd>{{ item.reason }}</dd></div></dl>@if(item.decision === 'rejected'){<p class="guidance">Review only. Evidence is never overridden here. Use the saved attendance records below to submit a reasoned correction.</p>}</article> } @empty { <p class="empty">No verification evidence matches this branch and period.</p> }
        </section>
      }
    </section>
  `,
  styleUrls: ["./owner-attendance-verification.component.css"]
})
export class OwnerAttendanceVerificationComponent {
  readonly policy = signal<OwnerAttendancePolicy>({ ...DEFAULT_POLICY });
  readonly devices = signal<OwnerAttendanceDevice[]>([]);
  readonly evidence = signal<OwnerAttendanceEvidence[]>([]);
  readonly loading = signal(false); readonly saving = signal(false); readonly busyDevice = signal("");
  readonly error = signal(""); readonly message = signal(""); readonly decision = signal("");
  private generation = 0;

  constructor(private readonly api: OwnerAppService, readonly context: OwnerContextService) {
    effect(() => { const branch = context.selectedBranch(); const range = context.periodRange(); untracked(() => { this.generation++; this.policy.set({ ...DEFAULT_POLICY, branchId: branch?.id || "" }); this.devices.set([]); this.evidence.set([]); if (this.validBranch()) void this.loadAll(range.start, range.end); }); });
  }

  validBranch(): boolean { const branch = this.context.selectedBranch(); return !!branch?.id && String(branch.status).toLowerCase() === "active"; }
  showCoordinateGuide(): boolean { const p = this.policy(); return p.version === 0 || p.latitude === null || p.longitude === null; }
  policyValid(): boolean { const p = this.policy(); return this.validBranch() && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0) && Number(p.latitude) >= -90 && Number(p.latitude) <= 90 && Number(p.longitude) >= -180 && Number(p.longitude) <= 180 && p.radiusMeters >= 10 && p.radiusMeters <= 1000 && p.maxAccuracyMeters >= 1 && p.maxAccuracyMeters <= 500; }
  setNumber(key: "latitude"|"longitude"|"radiusMeters"|"maxAccuracyMeters", value: number|string|null) { this.policy.update(p => ({ ...p, [key]: value === null || value === "" ? null : Number(value) } as OwnerAttendancePolicy)); this.message.set(""); }
  setFlag(key: "enforceClockIn"|"enforceClockOut"|"requireVerifiedAttestation", event: Event) { this.policy.update(p => ({ ...p, [key]: (event.target as HTMLInputElement).checked })); }
  setEnabled(event: Event) { this.policy.update(p => ({ ...p, status: (event.target as HTMLInputElement).checked ? "active" : "disabled" })); }
  async loadAll(from: string, to: string) { const id = ++this.generation; this.loading.set(true); this.error.set(""); const branchId = this.context.selectedBranchId(); try { const [policy, devices, evidence] = await Promise.all([this.api.ownerAttendancePolicy(branchId), this.api.ownerAttendanceDevices({ branchId }), this.api.ownerAttendanceEvidence({ branchId, from, to })]); if(id !== this.generation)return; this.policy.set({ ...DEFAULT_POLICY, ...policy, branchId }); this.devices.set(devices); this.evidence.set(evidence); } catch { if(id === this.generation)this.error.set("Secure attendance settings could not be loaded for this branch."); } finally { if(id === this.generation)this.loading.set(false); } }
  async savePolicy() { if(!this.policyValid() || this.saving())return; this.saving.set(true); this.message.set(""); try { this.policy.set(await this.api.saveOwnerAttendancePolicy(this.context.selectedBranchId(), this.policy())); this.message.set("Policy saved for this branch."); } catch { this.message.set("Policy was not saved. Refresh and try again."); } finally { this.saving.set(false); } }
  async loadDevices() { const branchId=this.context.selectedBranchId(); if(!branchId)return; try { this.devices.set(await this.api.ownerAttendanceDevices({branchId})); } catch { this.error.set("Trusted devices could not be refreshed."); } }
  async loadEvidence() { const branchId=this.context.selectedBranchId(), range=this.context.periodRange(); if(!branchId)return; try { this.evidence.set(await this.api.ownerAttendanceEvidence({branchId,from:range.start,to:range.end,decision:this.decision()})); } catch { this.error.set("Punch evidence could not be refreshed."); } }
  async setDevice(device: OwnerAttendanceDevice, decision: "approved"|"revoked") { if(!confirm(`${decision === "approved" ? "Approve" : "Revoke"} ${device.deviceLabel} for ${device.staffId}?`))return; this.busyDevice.set(device.id); const reason=decision === "approved" ? "Owner explicitly approved this unverified device registration." : "Owner explicitly revoked this device registration."; try { const updated=await this.api.setOwnerAttendanceDeviceStatus(device.id,decision,device.version,reason); this.devices.update(items=>items.map(item=>item.id===updated.id?updated:item)); } catch { this.error.set("Device status was not changed. Refresh and try again."); } finally { this.busyDevice.set(""); } }
  coordinates(item: OwnerAttendanceEvidence): string { return item.latitude === null || item.longitude === null ? "Not captured" : `${item.latitude}, ${item.longitude}`; }
  metres(value: number|null): string { return value === null ? "Unavailable" : `${Math.round(value)} m`; }
  label(value: string): string { return String(value || "Unavailable").replaceAll("_"," ").replace(/\b\w/g, c=>c.toUpperCase()); }
}
