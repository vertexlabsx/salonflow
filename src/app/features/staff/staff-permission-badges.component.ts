import { Component, input } from "@angular/core";

@Component({
  selector: "div[staffPermissionBadges]",
  standalone: true,
  template: `
    @for (permission of permissions(); track permission) { <span class="badge">{{ permission }}</span> }
    @empty { <p class="empty">No permission metadata.</p> }
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffPermissionBadgesComponent {
  readonly permissions = input.required<readonly string[]>();
}
