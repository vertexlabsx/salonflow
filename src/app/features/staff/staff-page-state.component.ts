import { Component, input } from "@angular/core";
import { IonSpinner } from "@ionic/angular/standalone";

@Component({
  selector: "section[staffPageState], div[staffPageState]",
  standalone: true,
  imports: [IonSpinner],
  host: {
    role: "status",
    "aria-live": "polite",
    "[attr.aria-busy]": "loading()"
  },
  template: `@if (loading()) { <ion-spinner name="crescent" aria-label="Loading" /> }<ng-content />`
})
export class StaffPageStateComponent {
  readonly loading = input(false);
}
