import { Component } from "@angular/core";

const TEMPLATE = `
  <section class="content">
    <section class="hero">
      <p class="eyebrow">Clients</p>
      <h1>Remember people, not records.</h1>
      <p>Client search, notes, visit history and WhatsApp context will connect here.</p>
      <div class="actions">
        <label class="field"><span>Search clients</span><input placeholder="Name, phone or booking ID"></label>
        <button class="btn primary">Search</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Client workspace</h2><span class="muted">Ready for client API</span></div>
      <p class="muted">This page is intentionally clean and mobile-first. Next step is wiring the customer catalog or staff-specific client endpoints.</p>
    </section>
  </section>
`;

@Component({ standalone: true, template: TEMPLATE })
export class StaffClientsPage {}