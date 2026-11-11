import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MoneyPipe } from '../../shared/money.pipe';
import { formatMoney, formatValue, humanize, toNumber } from '../../shared/format';

@Component({
  selector: 'app-quote-tab',
  imports: [MoneyPipe, DatePipe],
  template: `
    @if (quote(); as q) {
      <div class="stack">
        <div class="row-wrap">
          <h2>Quote {{ q['quote_number'] || '' }}</h2>
          @if (q['version']) { <span class="chip tone-info">Version {{ q['version'] }}</span> }
          @if (q['premium_source'] === 'negotiated') { <span class="chip tone-warn">Negotiated premium</span> }
        </div>

        <div class="stat-grid">
          <div class="stat"><div class="stat-label">Premium</div><div class="stat-value">{{ q['premium'] | money }}</div></div>
          <div class="stat"><div class="stat-label">Taxes &amp; fees</div><div class="stat-value">{{ q['taxes_fees'] | money }}</div></div>
          <div class="stat"><div class="stat-label">Total</div><div class="stat-value">{{ q['total_cost'] | money }}</div></div>
          <div class="stat"><div class="stat-label">Valid until</div><div class="stat-value">{{ q['valid_until'] || '—' }}</div></div>
        </div>

        <dl class="kv">
          <dt>Insurer</dt><dd>{{ q['insurer_name'] || '—' }}</dd>
          <dt>Product</dt><dd>{{ q['product_name'] || '—' }}</dd>
          <dt>Insured</dt><dd>{{ q['insured_name'] || '—' }}</dd>
          <dt>Policy period</dt><dd>{{ q['effective_date'] || '—' }} to {{ q['expiration_date'] || '—' }}</dd>
          <dt>Deductible</dt><dd>{{ q['deductible'] != null ? formatMoney(q['deductible']) : 'As per application' }}</dd>
        </dl>

        <section class="section">
          <div class="section-title"><span>Limits</span></div>
          @if (limits().length) {
            <table class="table">
              <tbody>
                @for (l of limits(); track l.label) {
                  <tr><td>{{ l.label }}</td><td class="num">{{ l.value }}</td></tr>
                }
              </tbody>
            </table>
          } @else {
            <div class="section-body muted">As per application.</div>
          }
        </section>

        <div class="two-col">
          <section class="section">
            <div class="section-title"><span>Subjectivities</span></div>
            <div class="section-body">
              @if (list(q['subjectivities']).length) {
                <ul class="plain">@for (s of list(q['subjectivities']); track $index) { <li>{{ s }}</li> }</ul>
              } @else { <span class="muted">None</span> }
            </div>
          </section>
          <section class="section">
            <div class="section-title"><span>Exclusions</span></div>
            <div class="section-body">
              @if (list(q['exclusions']).length) {
                <ul class="plain">@for (s of list(q['exclusions']); track $index) { <li>{{ s }}</li> }</ul>
              } @else { <span class="muted">None</span> }
            </div>
          </section>
        </div>

        @if (html()) {
          <section class="section">
            <div class="section-title"><span>Quote document</span></div>
            <iframe class="quote-frame" sandbox="" title="Quote document" [srcdoc]="html()"></iframe>
          </section>
        }

        @if (list(q['history']).length) {
          <section class="section">
            <div class="section-title"><span>Earlier versions</span></div>
            <table class="table">
              <thead><tr><th>Quote</th><th class="num">Version</th><th class="num">Premium</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>
                @for (h of list(q['history']); track $index) {
                  <tr>
                    <td><code>{{ h?.quote_number || '—' }}</code></td>
                    <td class="num">{{ h?.version ?? '—' }}</td>
                    <td class="num">{{ h?.premium | money }}</td>
                    <td>{{ humanize(h?.status) || '—' }}</td>
                    <td class="nowrap">{{ h?.created_at | date: 'd MMM y, HH:mm' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }
      </div>
    } @else {
      <div class="empty">No quote yet. Actuvara issues the quote after the submission is accepted.</div>
    }
  `,
  styles: `
    :host { display: block; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .two-col .section + .section { margin-top: 0; }
    .plain { margin: 0; padding-left: 18px; }
    .quote-frame { width: 100%; height: 520px; border: 0; background: #fff; border-radius: 0 0 var(--radius) var(--radius); }
  `,
})
export class QuoteTabComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly quote = input<Record<string, any> | null | undefined>(null);

  readonly humanize = humanize;
  readonly formatMoney = formatMoney;

  /** Rendered in a fully sandboxed iframe (no scripts, no same-origin), so trusting it here is safe. */
  readonly html = computed<SafeHtml | null>(() => {
    const raw = this.quote()?.['document_html'];
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const doc = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#17202b;padding:12px 16px}table td{padding:4px 6px;border-bottom:1px solid #eee}</style></head><body>${raw}</body></html>`;
    return this.sanitizer.bypassSecurityTrustHtml(doc);
  });

  readonly limits = computed(() => {
    const raw = this.quote()?.['limits'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    return Object.entries(raw as Record<string, unknown>).map(([label, value]) => ({
      label,
      value: toNumber(value) != null ? formatMoney(value) : formatValue(value),
    }));
  });

  list(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }
}
