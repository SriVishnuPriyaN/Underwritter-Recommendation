import { Component, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CaseDetail } from '../../core/models';
import { StatusChipComponent } from '../../shared/status-chip.component';
import { errorMessage, humanize, toneFor } from '../../shared/format';
import { ActionPanelComponent } from './action-panel.component';
import { DocumentViewerComponent } from './document-viewer.component';
import { ExtractedValuesComponent } from './extracted-values.component';
import { HistoryTabComponent } from './history-tab.component';
import { NegotiationTabComponent } from './negotiation-tab.component';
import { QuoteTabComponent } from './quote-tab.component';
import { UnderwritingTabComponent } from './underwriting-tab.component';

type TabKey = 'values' | 'underwriting' | 'quote' | 'negotiation' | 'history';

const POLL_MS = 20_000;

@Component({
  selector: 'app-case-detail',
  imports: [
    RouterLink,
    DatePipe,
    StatusChipComponent,
    ActionPanelComponent,
    DocumentViewerComponent,
    ExtractedValuesComponent,
    UnderwritingTabComponent,
    QuoteTabComponent,
    NegotiationTabComponent,
    HistoryTabComponent,
  ],
  template: `
    <a routerLink="/cases" class="small">← Back to submissions</a>

    @if (loading() && !detail()) {
      <div class="empty"><span class="spinner"></span> Loading submission…</div>
    } @else if (loadError() && !detail()) {
      <div class="banner banner-bad" style="margin-top:12px">{{ loadError() }}</div>
    }

    @if (detail(); as d) {
      <div class="detail-head">
        <div class="grow" style="min-width: 0">
          <div class="row-wrap">
            <h1>{{ d.insured_name || 'Unnamed insured' }}</h1>
            <app-status-chip [status]="d.status" />
          </div>
          <div class="muted small meta">
            Ref <code>{{ d.ref_id }}</code>
            · {{ d.process_name || 'Process unknown' }}
            · Broker {{ d.broker_email || '—' }}
            · Received {{ d.received_at | date: 'd MMM y, HH:mm' }}
            @if (d.submission?.run_status; as rs) {
              · Actuvara run <span [class]="'chip tone-' + toneFor(rs)">{{ humanize(rs) }}</span>
            }
          </div>
        </div>
        <div class="row">
          @if (d.snapshot_at) { <span class="muted small nowrap">Synced {{ d.snapshot_at | date: 'HH:mm:ss' }}</span> }
          <button type="button" class="btn" [disabled]="refreshing()" (click)="refresh()">
            @if (refreshing()) { <span class="spinner"></span> } Refresh from Actuvara
          </button>
        </div>
      </div>

      <div class="stack-sm banners">
        @if (d.pending_sync; as p) {
          <div class="banner">
            <span class="dot pulse" style="margin-top:5px"></span>
            <div>
              Sending {{ p.type === 'decision' ? 'decision' : 'counter-offer recommendation' }} to Actuvara… attempt {{ p.attempts }}
              @if (p.last_error) { <div class="small">Last error: {{ p.last_error }}</div> }
            </div>
          </div>
        }
        @if (d.sync_error) {
          <div class="banner banner-warn">
            Could not refresh from Actuvara: {{ d.sync_error }}
            @if (d.snapshot_at) { (showing data from {{ d.snapshot_at | date: 'd MMM y, HH:mm' }}) }
          </div>
        }
        @if (!d.submission) {
          <div class="banner banner-warn">The submission details have not been received from Actuvara yet. Try Refresh.</div>
        }
        @if (actionError()) {
          <div class="banner banner-bad">{{ actionError() }}</div>
        }
      </div>

      <div class="detail-grid">
        <div class="left-col">
          <app-document-viewer [caseId]="d.id" [documents]="d.submission?.documents ?? []" />
        </div>

        <div class="right-col">
          <app-action-panel [detail]="d" (changed)="onChanged($event)" />

          <div class="card">
            <nav class="tabs" aria-label="Submission details">
              <button type="button" class="tab" [class.active]="tab() === 'values'" (click)="tab.set('values')">Extracted values</button>
              <button type="button" class="tab" [class.active]="tab() === 'underwriting'" (click)="tab.set('underwriting')">Underwriting</button>
              <button type="button" class="tab" [class.active]="tab() === 'quote'" (click)="tab.set('quote')">
                Quote @if (d.underwriting?.quote) { <span class="tab-count">V{{ d.underwriting?.quote?.['version'] || 1 }}</span> }
              </button>
              <button type="button" class="tab" [class.active]="tab() === 'negotiation'" (click)="tab.set('negotiation')">
                Negotiation @if (d.negotiation?.status === 'awaiting_underwriter') { <span class="dot pulse"></span> }
              </button>
              <button type="button" class="tab" [class.active]="tab() === 'history'" (click)="tab.set('history')">History</button>
            </nav>
            <div class="card-body">
              @switch (tab()) {
                @case ('values') { <app-extracted-values [segments]="d.submission?.segments ?? []" /> }
                @case ('underwriting') { <app-underwriting-tab [data]="d.underwriting" /> }
                @case ('quote') { <app-quote-tab [quote]="d.underwriting?.quote" /> }
                @case ('negotiation') { <app-negotiation-tab [negotiation]="d.negotiation" /> }
                @case ('history') { <app-history-tab [history]="d.history" /> }
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .detail-head { display: flex; align-items: flex-start; gap: 16px; margin: 8px 0 10px; }
    .meta { margin-top: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    .banners { margin-bottom: 10px; }
    .banners:empty { display: none; }
    .detail-grid { display: grid; grid-template-columns: minmax(360px, 42%) minmax(0, 1fr); gap: 14px; align-items: start; }
    .left-col { position: sticky; top: calc(var(--topbar-h) + 12px); }
    .right-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    @media (max-width: 1100px) {
      .detail-grid { grid-template-columns: 1fr; }
      .left-col { position: static; }
    }
  `,
})
export class CaseDetailComponent implements OnDestroy {
  private readonly api = inject(ApiService);

  /** Bound from the :id route parameter. */
  readonly id = input.required<string>();

  readonly detail = signal<CaseDetail | null>(null);
  readonly loading = signal(false);
  readonly refreshing = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly tab = signal<TabKey>('values');

  readonly toneFor = toneFor;
  readonly humanize = humanize;

  readonly isCounterStage = computed(() => {
    const s = this.detail()?.status;
    return s === 'counter_pending' || s === 'counter_referred';
  });

  private sub?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  private tabChosenFor: string | null = null;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.detail.set(null);
        this.tabChosenFor = null;
        this.load(id);
        clearInterval(this.timer);
        this.timer = setInterval(() => this.load(id, true), POLL_MS);
      });
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    clearInterval(this.timer);
  }

  refresh(): void {
    const id = this.id();
    this.refreshing.set(true);
    this.actionError.set(null);
    this.api.refresh(id).subscribe({
      next: d => {
        this.refreshing.set(false);
        this.apply(d);
      },
      error: err => {
        this.refreshing.set(false);
        this.actionError.set(errorMessage(err, 'Refresh failed.'));
      },
    });
  }

  onChanged(d: CaseDetail): void {
    this.actionError.set(null);
    this.apply(d);
  }

  private load(id: string, silent = false): void {
    this.sub?.unsubscribe();
    if (!silent) this.loading.set(true);
    this.sub = this.api.getCase(id).subscribe({
      next: d => {
        this.loading.set(false);
        this.loadError.set(null);
        this.apply(d);
      },
      error: err => {
        this.loading.set(false);
        if (!silent || !this.detail()) this.loadError.set(errorMessage(err, 'Could not load the submission.'));
      },
    });
  }

  private apply(d: CaseDetail): void {
    this.detail.set(d);
    // Open on the negotiation tab when a counter-offer is the decision at hand — once per status.
    const key = `${d.id}:${d.status}`;
    if (this.tabChosenFor !== key) {
      this.tabChosenFor = key;
      if (d.status === 'counter_pending' || d.status === 'counter_referred') this.tab.set('negotiation');
    }
  }
}
