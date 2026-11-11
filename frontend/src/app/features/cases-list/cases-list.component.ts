import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CaseSummary, Stats } from '../../core/models';
import { MoneyPipe } from '../../shared/money.pipe';
import { StatusChipComponent } from '../../shared/status-chip.component';
import { errorMessage, humanize, toneFor } from '../../shared/format';

interface QueueTab {
  key: string;
  label: string;
  statuses: string[];
}

const TABS: QueueTab[] = [
  { key: 'review', label: 'Needs review', statuses: ['awaiting_review'] },
  { key: 'referrals', label: 'Referrals', statuses: ['referred'] },
  { key: 'counter', label: 'Counter-offers', statuses: ['counter_pending', 'counter_referred'] },
  { key: 'progress', label: 'In progress', statuses: ['accepted', 'quoted'] },
  { key: 'closed', label: 'Closed', statuses: ['declined', 'quote_accepted', 'quote_declined'] },
  { key: 'all', label: 'All', statuses: [] },
];

const REFRESH_MS = 30_000;

@Component({
  selector: 'app-cases-list',
  imports: [StatusChipComponent, MoneyPipe, DatePipe],
  template: `
    <div class="row" style="margin-bottom: 12px">
      <div>
        <h1>Submissions</h1>
        <p class="muted small" style="margin:0">Submissions sent from Actuvara for underwriter review.</p>
      </div>
      <span class="spacer"></span>
      <input class="input" style="max-width: 320px" type="search"
             placeholder="Search insured, reference, broker…"
             [value]="query()" (input)="onSearch($any($event.target).value)" />
      <button type="button" class="btn" (click)="load()" [disabled]="loading()">
        @if (loading()) { <span class="spinner"></span> } Refresh
      </button>
    </div>

    <div class="card">
      <nav class="tabs" aria-label="Queues">
        @for (tab of tabs; track tab.key) {
          <button type="button" class="tab" [class.active]="activeTab() === tab.key" (click)="selectTab(tab.key)">
            {{ tab.label }}
            <span class="tab-count">{{ count(tab) }}</span>
          </button>
        }
      </nav>

      @if (error()) {
        <div class="card-body"><div class="banner banner-bad">{{ error() }}</div></div>
      }

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Insured</th>
              <th>Reference</th>
              <th>Process</th>
              <th class="num">Premium</th>
              <th>Risk</th>
              <th>Rating</th>
              <th>Status</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            @for (c of cases(); track c.id) {
              <tr class="clickable" (click)="open(c)" tabindex="0" (keydown.enter)="open(c)">
                <td>
                  <div class="row">
                    @if (c.pending_sync) {
                      <span class="dot pulse" title="Waiting to send a decision to Actuvara"></span>
                    }
                    <strong>{{ c.insured_name || 'Unnamed insured' }}</strong>
                  </div>
                  @if (c.broker_email) { <div class="muted small">{{ c.broker_email }}</div> }
                </td>
                <td><code>{{ c.ref_id }}</code></td>
                <td>{{ c.process_name || '—' }}</td>
                <td class="num">{{ c.premium | money }}</td>
                <td>
                  @if (c.risk_category) {
                    <span [class]="'chip tone-' + toneFor(c.risk_category)">{{ humanize(c.risk_category) }}</span>
                  } @else { <span class="muted">—</span> }
                </td>
                <td>
                  @if (c.rating_status) {
                    <span [class]="'chip tone-' + toneFor(c.rating_status)">{{ humanize(c.rating_status) }}</span>
                  } @else { <span class="muted">—</span> }
                </td>
                <td><app-status-chip [status]="c.status" /></td>
                <td class="nowrap">{{ c.received_at | date: 'd MMM y, HH:mm' }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8">
                  <div class="empty">
                    @if (loading()) { Loading… } @else { No submissions in this queue. }
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class CasesListComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly tabs = TABS;
  readonly toneFor = toneFor;
  readonly humanize = humanize;

  readonly activeTab = signal('review');
  readonly stats = signal<Stats>({});
  readonly cases = signal<CaseSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly query = signal('');

  private timer?: ReturnType<typeof setInterval>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const requested = params.get('tab');
    const fallback = this.auth.isSenior() ? 'referrals' : 'review';
    this.activeTab.set(TABS.some(t => t.key === requested) ? (requested as string) : fallback);
    this.query.set(params.get('q') ?? '');
    this.load();
    this.timer = setInterval(() => this.load(true), REFRESH_MS);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    clearTimeout(this.searchTimer);
  }

  count(tab: QueueTab): number {
    const stats = this.stats() as Record<string, number | undefined>;
    const keys = tab.statuses.length ? tab.statuses : Object.keys(stats);
    return keys.reduce((sum, k) => sum + (stats[k] ?? 0), 0);
  }

  selectTab(key: string): void {
    if (key === this.activeTab()) return;
    this.activeTab.set(key);
    this.cases.set([]);
    this.syncUrl();
    this.load();
  }

  onSearch(value: string): void {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.syncUrl();
      this.load();
    }, 300);
  }

  load(silent = false): void {
    const tab = TABS.find(t => t.key === this.activeTab()) ?? TABS[0];
    const seq = ++this.seq;
    if (!silent) this.loading.set(true);

    this.api.stats().subscribe({ next: s => this.stats.set(s ?? {}), error: () => {} });
    this.api.listCases(tab.statuses, this.query()).subscribe({
      next: rows => {
        if (seq !== this.seq) return;
        this.cases.set(rows ?? []);
        this.error.set(null);
        this.loading.set(false);
      },
      error: err => {
        if (seq !== this.seq) return;
        this.error.set(errorMessage(err, 'Could not load submissions.'));
        this.loading.set(false);
      },
    });
  }

  open(c: CaseSummary): void {
    this.router.navigate(['/cases', c.id]);
  }

  private syncUrl(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: this.activeTab(), q: this.query().trim() || null },
      replaceUrl: true,
    });
  }
}
