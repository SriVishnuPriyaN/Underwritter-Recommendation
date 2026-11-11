import { Component, computed, input } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { Underwriting } from '../../core/models';
import { KvListComponent } from '../../shared/kv-list.component';
import { MoneyPipe } from '../../shared/money.pipe';
import { formatMoney, formatNumber, formatValue, humanize, toneFor } from '../../shared/format';

interface BreakdownRow {
  label: string;
  detail: string;
  value: string;
  kind?: 'subtotal' | 'total';
}

const KNOWN = ['completeness', 'reconciliation', 'exposure_loss_analysis', 'rating', 'quote', 'negotiation', 'outcomes'];

@Component({
  selector: 'app-underwriting-tab',
  imports: [KvListComponent, MoneyPipe, UpperCasePipe],
  template: `
    @if (!hasAny()) {
      <div class="empty">No underwriting results received from Actuvara yet.</div>
    }

    <!-- Rating -->
    @if (rating(); as r) {
      <section class="section">
        <div class="section-title">
          <span>Rating &amp; pricing</span>
          @if (r['status']) { <span [class]="'chip tone-' + toneFor(r['status'])">{{ humanize(r['status']) }}</span> }
        </div>
        <div class="section-body stack">
          @for (reason of referralReasons(); track $index) {
            <div class="banner banner-warn">{{ reason }}</div>
          }
          <div class="stat-grid">
            <div class="stat"><div class="stat-label">Premium</div><div class="stat-value">{{ r['premium'] | money }}</div></div>
            <div class="stat"><div class="stat-label">Taxes &amp; fees</div><div class="stat-value">{{ r['taxes_fees'] | money }}</div></div>
            <div class="stat"><div class="stat-label">Total cost</div><div class="stat-value">{{ r['total_cost'] | money }}</div></div>
            <div class="stat"><div class="stat-label">Exposure ({{ (r['rating_basis'] || 'tiv') | uppercase }})</div><div class="stat-value">{{ r['exposure'] | money }}</div></div>
          </div>
          @if (breakdown().length) {
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Step</th><th>Detail</th><th class="num">Value</th></tr></thead>
                <tbody>
                  @for (row of breakdown(); track $index) {
                    <tr [class.subtotal]="row.kind === 'subtotal'" [class.total]="row.kind === 'total'">
                      <td>{{ row.label }}</td>
                      <td class="muted">{{ row.detail }}</td>
                      <td class="num">{{ row.value }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      </section>
    }

    <!-- Exposure & loss -->
    @if (ela(); as e) {
      <section class="section">
        <div class="section-title">
          <span>Exposure &amp; loss analysis</span>
          @if (e['risk_category']) { <span [class]="'chip tone-' + toneFor(e['risk_category'])">{{ humanize(e['risk_category']) }} risk</span> }
        </div>
        <div class="section-body stack">
          @if (e['risk_score'] != null) {
            <div class="stat-grid">
              <div class="stat"><div class="stat-label">Risk score</div><div class="stat-value">{{ formatNumber(e['risk_score'], 1) }} / 100</div></div>
            </div>
          }
          @if (e['loss_analysis']) {
            <div><h3 style="margin-bottom:4px">Loss analysis</h3><app-kv-list [data]="e['loss_analysis']" /></div>
          }
          @if (e['exposure_analysis']) {
            <div><h3 style="margin-bottom:4px">Exposure analysis</h3><app-kv-list [data]="e['exposure_analysis']" /></div>
          }
          <app-kv-list [data]="e" [exclude]="['risk_category', 'risk_score', 'loss_analysis', 'exposure_analysis']" />
        </div>
      </section>
    }

    <!-- Reconciliation -->
    @if (recon(); as rc) {
      <section class="section">
        <div class="section-title">
          <span>Reconciliation</span>
          @if (rc['status']) { <span [class]="'chip tone-' + toneFor(rc['status'])">{{ humanize(rc['status']) }}</span> }
        </div>
        <div class="section-body stack">
          @if (mismatches().length) {
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Field</th><th>Values by document</th><th>Detail</th></tr></thead>
                <tbody>
                  @for (m of mismatches(); track $index) {
                    <tr>
                      <td><strong>{{ m.field }}</strong></td>
                      <td>
                        @for (v of m.values; track $index) {
                          <div><span class="muted">{{ v.source }}:</span> {{ v.value }}</div>
                        }
                      </td>
                      <td class="muted">{{ m.detail }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else if (rc['status'] === 'consistent') {
            <p class="muted">Documents agree with each other.</p>
          }
          <app-kv-list [data]="rc" [exclude]="['status', 'mismatches']" />
        </div>
      </section>
    }

    <!-- Completeness -->
    @if (completeness(); as c) {
      <section class="section">
        <div class="section-title">
          <span>Completeness check</span>
          @if (c['status']) { <span [class]="'chip tone-' + toneFor(c['status'])">{{ humanize(c['status']) }}</span> }
        </div>
        <div class="section-body stack">
          @if (asList(c['missing_documents']).length) {
            <div class="banner banner-bad">Missing: {{ asList(c['missing_documents']).join(', ') }}</div>
          }
          <dl class="kv">
            @if (asList(c['required_documents']).length) {
              <dt>Required</dt><dd>{{ asList(c['required_documents']).join(', ') }}</dd>
            }
            @if (asList(c['present_documents']).length) {
              <dt>Present</dt><dd>{{ asList(c['present_documents']).join(', ') }}</dd>
            }
          </dl>
          <app-kv-list [data]="c" [exclude]="['status', 'missing_documents', 'required_documents', 'present_documents']" />
        </div>
      </section>
    }

    <!-- Anything else Actuvara recorded -->
    @for (key of otherKeys(); track key) {
      <section class="section">
        <div class="section-title"><span>{{ humanize(key) }}</span></div>
        <div class="section-body"><app-kv-list [data]="data()?.[key]" [showEmpty]="true" /></div>
      </section>
    }
  `,
  styles: `:host { display: block; }`,
})
export class UnderwritingTabComponent {
  readonly data = input<Underwriting | null>(null);

  readonly toneFor = toneFor;
  readonly humanize = humanize;
  readonly formatNumber = formatNumber;

  readonly rating = computed(() => this.obj('rating'));
  readonly ela = computed(() => this.obj('exposure_loss_analysis'));
  readonly recon = computed(() => this.obj('reconciliation'));
  readonly completeness = computed(() => this.obj('completeness'));

  readonly hasAny = computed(() => !!(this.rating() || this.ela() || this.recon() || this.completeness() || this.otherKeys().length));

  readonly otherKeys = computed(() => {
    const d = this.data();
    if (!d) return [];
    return Object.keys(d).filter(k => !KNOWN.includes(k) && d[k] && typeof d[k] === 'object');
  });

  readonly referralReasons = computed<string[]>(() => this.asList(this.rating()?.['referral_reasons']).map(String));

  readonly breakdown = computed<BreakdownRow[]>(() => {
    const r = this.rating();
    if (!r || r['base_premium'] == null) return [];
    const rows: BreakdownRow[] = [];
    rows.push({
      label: 'Base premium',
      detail: `${formatMoney(r['exposure'])} ÷ ${formatNumber(r['rate_per'])} × ${formatNumber(r['base_rate'])}` +
        (r['rate_source'] ? ` (${r['rate_source']})` : ''),
      value: formatMoney(r['base_premium']),
      kind: 'subtotal',
    });
    for (const f of this.asList(r['factors'])) {
      rows.push({
        label: `Factor: ${f?.name ?? '—'}`,
        detail: f?.value != null ? `Value: ${formatValue(f.value)}` : 'Not found — default used',
        value: `× ${formatNumber(f?.factor)}`,
      });
    }
    if (this.asList(r['factors']).length) {
      rows.push({ label: 'Combined factor', detail: '', value: `× ${formatNumber(r['combined_factor'])}` });
    }
    rows.push({
      label: 'Experience mod',
      detail: r['loss_category'] ? `Loss category: ${humanize(r['loss_category'])}` : 'No loss analysis — neutral',
      value: `× ${formatNumber(r['experience_mod'])}`,
    });
    rows.push({
      label: 'Deductible credit',
      detail: r['deductible'] != null ? `Deductible ${formatMoney(r['deductible'])}` : 'No deductible found',
      value: `× ${formatNumber(r['deductible_credit'])}`,
    });
    rows.push({ label: 'Technical premium', detail: '', value: formatMoney(r['technical_premium']), kind: 'subtotal' });
    rows.push({
      label: 'Minimum premium',
      detail: r['minimum_premium_applied'] ? 'Applied — technical premium was lower' : 'Not applied',
      value: formatMoney(r['minimum_premium']),
    });
    rows.push({ label: 'Premium', detail: '', value: formatMoney(r['premium']), kind: 'subtotal' });
    rows.push({ label: 'Taxes & fees', detail: '', value: formatMoney(r['taxes_fees']) });
    rows.push({ label: 'Total cost', detail: '', value: formatMoney(r['total_cost']), kind: 'total' });
    return rows;
  });

  readonly mismatches = computed(() => {
    const list = this.asList(this.recon()?.['mismatches']);
    return list.map((m: any) => {
      const raw = m?.values;
      let values: { source: string; value: string }[];
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        values = Object.entries(raw).map(([source, value]) => ({ source, value: formatValue(value) }));
      } else if (Array.isArray(raw)) {
        values = raw.map((v: any, i: number) =>
          v && typeof v === 'object'
            ? { source: String(v.source ?? v.document ?? v.filename ?? `#${i + 1}`), value: formatValue(v.value ?? v) }
            : { source: `#${i + 1}`, value: formatValue(v) },
        );
      } else {
        values = raw != null ? [{ source: 'Value', value: formatValue(raw) }] : [];
      }
      const rest: Record<string, unknown> = { ...(m && typeof m === 'object' ? m : {}) };
      delete rest['field'];
      delete rest['values'];
      return {
        field: humanize(String(m?.field ?? m?.name ?? 'Field')),
        values,
        detail: Object.keys(rest).length ? formatValue(rest) : '',
      };
    });
  });

  asList(value: unknown): any[] {
    return Array.isArray(value) ? value : [];
  }

  private obj(key: string): Record<string, any> | null {
    const v = this.data()?.[key];
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null;
  }
}
