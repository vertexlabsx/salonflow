import { CommonModule } from "@angular/common";
import { Component, effect, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { OwnerAppService, OwnerExpense, OwnerGstReport } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";

type ExpenseForm = Omit<OwnerExpense, "id" | "taxPaise" | "totalPaise" | "createdAt">;

const CATEGORIES = ["rent", "salaries", "utilities", "products", "equipment", "marketing", "maintenance", "insurance", "taxes", "other"] as const;

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <article class="gst-page" [attr.aria-busy]="loading()">
      <header class="phase-header"><div><p>GST workspace</p><h1>GST & Expenses</h1><span>Track taxable sales, input credit and everyday salon expenses.</span></div><button type="button" (click)="refresh()" [disabled]="loading()">{{ loading() ? 'Refreshing...' : 'Refresh' }}</button></header>
      @if (error()) { <p class="owner-alert error" role="alert">{{ error() }}</p> }

      @if (report(); as gst) {
        <section class="gst-summary" aria-label="GST summary">
          <article><span>Taxable sales</span><strong>{{ money(gst.taxableValuePaise) }}</strong></article>
          <article><span>Output GST</span><strong>{{ money(gst.outputTaxPaise) }}</strong></article>
          <article><span>Input credit</span><strong>{{ money(gst.inputCreditPaise) }}</strong></article>
          <article class="payable"><span>Net GST payable</span><strong>{{ money(gst.netGstPayablePaise) }}</strong></article>
        </section>

        <section class="gst-card">
          <header><div><p>{{ gst.gstin || 'GSTIN not set' }}</p><h2>Return snapshot</h2></div><span>{{ gst.fromDate }} to {{ gst.toDate }}</span></header>
          <div class="gst-split"><span>CGST {{ money(gst.liability.cgstPaise) }}</span><span>SGST {{ money(gst.liability.sgstPaise) }}</span><span>IGST {{ money(gst.liability.igstPaise) }}</span></div>
          <div class="responsive-table small"><table><thead><tr><th>Rate</th><th>Taxable</th><th>Tax</th></tr></thead><tbody>@for (row of gst.rateBreakdown; track row.rateBps) { <tr><td>{{ row.rateBps / 100 }}%</td><td>{{ money(row.taxablePaise) }}</td><td>{{ money(row.taxPaise) }}</td></tr> } @empty { <tr><td colspan="3">No taxable invoices in this period.</td></tr> }</tbody></table></div>
        </section>
      }

      <section class="gst-grid">
        <form class="gst-card" (ngSubmit)="saveExpense()">
          <header><div><p>Input credit</p><h2>{{ editingId() ? 'Edit expense' : 'Add expense' }}</h2></div></header>
          <div class="expense-form">
            <label>Date<input type="date" name="date" [(ngModel)]="form.date" required /></label>
            <label>Category<select name="category" [(ngModel)]="form.category">@for (category of categories; track category) { <option [value]="category">{{ label(category) }}</option> }</select></label>
            <label>Vendor<input name="vendor" [(ngModel)]="form.vendor" maxlength="160" /></label>
            <label>Description<input name="description" [(ngModel)]="form.description" maxlength="300" /></label>
            <label>Amount (Rs.)<input type="number" name="amount" min="0" step="0.01" [ngModel]="form.amountPaise / 100" (ngModelChange)="form.amountPaise = rupeesToPaise($event)" /></label>
            <label>GST rate %<input type="number" name="rate" min="0" max="100" step="0.01" [ngModel]="form.taxRateBps / 100" (ngModelChange)="form.taxRateBps = percentToBps($event)" /></label>
            <label class="wide">Notes<textarea name="notes" [(ngModel)]="form.notes" maxlength="600" rows="3"></textarea></label>
          </div>
          <div class="sticky-actions"><button type="button" class="ghost" (click)="resetForm()" [disabled]="saving()">Clear</button><button type="submit" [disabled]="saving() || !form.branchId || !form.date">{{ saving() ? 'Saving...' : editingId() ? 'Update expense' : 'Add expense' }}</button></div>
        </form>

        <section class="gst-card">
          <header><div><p>{{ expenses().length }} shown</p><h2>Expense ledger</h2></div><select [ngModel]="categoryFilter()" (ngModelChange)="categoryFilter.set($event); refresh()"><option value="all">All categories</option>@for (category of categories; track category) { <option [value]="category">{{ label(category) }}</option> }</select></header>
          <div class="expense-list">@for (expense of expenses(); track expense.id) { <article><div><strong>{{ expense.vendor || label(expense.category) }}</strong><span>{{ expense.date }} · {{ label(expense.category) }}</span><small>{{ expense.description || 'No description' }}</small></div><aside><b>{{ money(expense.totalPaise) }}</b><span>GST {{ money(expense.taxPaise) }}</span><button type="button" (click)="editExpense(expense)">Edit</button><button type="button" class="danger" (click)="removeExpense(expense)">Delete</button></aside></article> } @empty { <p class="empty-state">No expenses recorded for this period.</p> }</div>
        </section>
      </section>
    </article>
  `,
  styleUrls: ["./owner-shell.styles.css", "./owner-gst.css"]
})
export class OwnerGstPage {
  readonly categories = CATEGORIES;
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal("");
  readonly report = signal<OwnerGstReport | null>(null);
  readonly expenses = signal<OwnerExpense[]>([]);
  readonly categoryFilter = signal("all");
  readonly editingId = signal("");
  form: ExpenseForm = this.blankForm();

  constructor(readonly context: OwnerContextService, private readonly api: OwnerAppService) {
    effect(() => {
      const branchId = this.branchId();
      const range = this.context.periodRange();
      untracked(() => { this.form.branchId = branchId === "all" ? "" : branchId; this.form.date = range.end; void this.refresh(); });
    });
  }

  async refresh(): Promise<void> {
    const branchId = this.branchId();
    const range = this.context.periodRange();
    this.loading.set(true);
    this.error.set("");
    try {
      const [gst, expenses] = await Promise.all([
        this.api.ownerGstReport({ branchId, fromDate: range.start, toDate: range.end }),
        this.api.ownerExpenses({ branchId, fromDate: range.start, toDate: range.end, category: this.categoryFilter(), limit: 100, offset: 0 })
      ]);
      this.report.set(gst.report);
      this.expenses.set(expenses.items);
    } catch {
      this.error.set("GST data could not be loaded.");
    } finally {
      this.loading.set(false);
    }
  }

  async saveExpense(): Promise<void> {
    if (!this.form.branchId) { this.error.set("Select a specific branch before recording expenses."); return; }
    this.saving.set(true);
    this.error.set("");
    try {
      if (this.editingId()) await this.api.updateOwnerExpense(this.editingId(), this.form);
      else await this.api.createOwnerExpense(this.form);
      this.resetForm();
      await this.refresh();
    } catch {
      this.error.set("Expense could not be saved.");
    } finally {
      this.saving.set(false);
    }
  }

  editExpense(expense: OwnerExpense): void {
    this.editingId.set(expense.id);
    this.form = { branchId: expense.branchId, date: expense.date, category: expense.category, vendor: expense.vendor, description: expense.description, amountPaise: expense.amountPaise, taxRateBps: expense.taxRateBps, notes: expense.notes };
  }

  async removeExpense(expense: OwnerExpense): Promise<void> {
    if (!confirm(`Delete expense ${expense.vendor || expense.description || expense.date}?`)) return;
    await this.api.deleteOwnerExpense(expense.id);
    await this.refresh();
  }

  resetForm(): void { this.editingId.set(""); this.form = this.blankForm(); }
  money(paise: number): string { return this.context.formatCurrency(paise); }
  label(value: string): string { return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
  rupeesToPaise(value: string | number): number { return Math.round((Number(value) || 0) * 100); }
  percentToBps(value: string | number): number { return Math.round((Number(value) || 0) * 100); }
  private branchId(): string { return this.context.selectedBranchId() || "all"; }
  private blankForm(): ExpenseForm { const range = this.context.periodRange(); const branchId = this.branchId(); return { branchId: branchId === "all" ? "" : branchId, date: range.end, category: "other", vendor: "", description: "", amountPaise: 0, taxRateBps: 0, notes: "" }; }
}
