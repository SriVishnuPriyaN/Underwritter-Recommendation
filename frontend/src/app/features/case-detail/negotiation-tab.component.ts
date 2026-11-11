import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Negotiation } from '../../core/models';
import { MoneyPipe } from '../../shared/money.pipe';
import { formatValue, humanize, toneFor } from '../../shared/format';

const NEGOTIATION_LABELS: Record<string, string> = {
  awaiting_response: 'Waiting for broker',
  awaiting_underwriter: 'Counter-offer – needs underwriter',
  accepted: 'Accepted by broker',
  counter: 'Counter-offer agreed – re-quoting',
  declined: 'Declined',
};

@Component({
  selector: 'app-negotiation-tab',
  imports: [MoneyPipe, DatePipe],
  template: `
    @if (negotiation(); as n) {
      <div class="stack">
        <div class="row-wrap">
          <h2>Negotiation</h2>
          <span [class]="'chip tone-' + statusTone(n.status)">{{ statusLabel(n.status) }}</span>
          <span class="muted">Round {{ n.round || 0 }} of {{ n.max_rounds || '—' }}</span>
        </div>

        <div class="stat-grid">
          <div class="stat"><div class="stat-label">Quoted premium</div><div class="stat-value">{{ n.quoted_premium | money }}</div></div>
          <div class="stat"><div class="stat-label">Rated premium</div><div class="stat-value">{{ n.rated_premium | money }}</div></div>
          <div class="stat">
            <div class="stat-label">Authority floor @if (n.max_discount_pct) { ({{ n.max_discount_pct }}% max discount) }</div>
            <div class="stat-value">{{ n.floor_premium != null ? (n.floor_premium | money) : 'No limit' }}</div>
          </div>
        </div>

        @if (n.pending_counter; as pc) {
          <section class="section counter-card">
            <div class="section-title">
              <span>Broker counter-offer · round {{ pc.round }}</span>
              <span class="muted small">{{ pc.at | date: 'd MMM y, HH:mm' }}</span>
            </div>
            <div class="section-body">
              <div class="stat-grid" style="margin-bottom:8px">
                <div class="stat"><div class="stat-label">Our quote</div><div class="stat-value">{{ (pc.quoted_premium ?? n.quoted_premium) | money }}</div></div>
                <div class="stat"><div class="stat-label">Broker asks</div><div class="stat-value">{{ pc.counter_premium | money }}</div></div>
                @if (difference(pc.quoted_premium ?? n.quoted_premium, pc.counter_premium); as diff) {
                  <div class="stat"><div class="stat-label">Difference</div><div class="stat-value">{{ diff }}</div></div>
                }
              </div>
              <dl class="kv">
                @if (pc.counter_terms) { <dt>Requested terms</dt><dd>{{ formatValue(pc.counter_terms) }}</dd> }
                @if (pc.notes) { <dt>Broker notes</dt><dd>{{ pc.notes }}</dd> }
                @if (pc.user) { <dt>Recorded by</dt><dd>{{ pc.user }}</dd> }
              </dl>
            </div>
          </section>
        }

        <section class="section">
          <div class="section-title"><span>Rounds</span></div>
          @if (n.rounds.length) {
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th class="num">Round</th><th>Broker response</th><th class="num">Quoted</th><th class="num">Broker asked</th>
                    <th class="num">Agreed</th><th>Underwriter</th><th>Notes</th><th>When</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of n.rounds; track $index) {
                    <tr>
                      <td class="num">{{ r.round }}</td>
                      <td><span [class]="'chip tone-' + statusTone(r.response)">{{ humanize(r.response) }}</span></td>
                      <td class="num">{{ r.quoted_premium | money }}</td>
                      <td class="num">{{ r.counter_premium | money }}</td>
                      <td class="num">{{ r.revised_premium | money }}</td>
                      <td>
                        @if (r.underwriter_recommendation) { {{ humanize(r.underwriter_recommendation) }} }
                        @if (r.recommended_by) { <div class="muted small">{{ r.recommended_by }}</div> }
                        @if (!r.underwriter_recommendation && !r.recommended_by) { <span class="muted">—</span> }
                      </td>
                      <td>{{ r.notes || '—' }}</td>
                      <td class="nowrap">{{ r.at | date: 'd MMM y, HH:mm' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="section-body muted">No responses recorded yet.</div>
          }
        </section>
      </div>
    } @else {
      <div class="empty">Negotiation has not started. It begins once Actuvara sends the quote to the broker.</div>
    }
  `,
  styles: `
    :host { display: block; }
    .counter-card { border-color: var(--warn-border); }
    .counter-card .section-title { background: var(--warn-bg); color: var(--warn-fg); }
  `,
})
export class NegotiationTabComponent {
  readonly negotiation = input<Negotiation | null>(null);

  readonly humanize = humanize;
  readonly formatValue = formatValue;

  statusLabel(status: string | null | undefined): string {
    return (status && NEGOTIATION_LABELS[status]) || humanize(status ?? '') || '—';
  }

  statusTone(status: string | null | undefined): string {
    if (status === 'awaiting_underwriter' || status === 'counter') return 'warn';
    if (status === 'awaiting_response') return 'info';
    return toneFor(status);
  }

  difference(quoted: number | null | undefined, asked: number | null | undefined): string | null {
    if (quoted == null || asked == null || !quoted) return null;
    const diff = asked - quoted;
    const pct = (diff / quoted) * 100;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${sign}${pct.toFixed(1)}%)`;
  }
}
