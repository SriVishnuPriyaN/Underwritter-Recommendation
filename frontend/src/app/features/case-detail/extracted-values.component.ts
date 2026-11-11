import { Component, computed, input, signal } from '@angular/core';
import { ExtractedField, Segment } from '../../core/models';
import { confidenceInfo, formatValue, humanize } from '../../shared/format';

interface FieldView {
  name: string;
  label: string;
  value: string;
  confidence: string;
  low: boolean;
  page: number | null;
}

interface CellView {
  value: string;
  low: boolean;
  title: string;
}

interface SegmentView {
  key: string;
  name: string;
  source: string | null;
  fields: FieldView[];
  columns: { name: string; label: string }[];
  rows: CellView[][];
  totalFields: number;
  lowCount: number;
}

function fieldView(f: ExtractedField): FieldView {
  const c = confidenceInfo(f.confidence);
  return {
    name: f.name,
    label: humanize(f.name),
    value: formatValue(f.value),
    confidence: c.label,
    low: c.low,
    page: f.page ?? null,
  };
}

function matches(name: string, filter: string): boolean {
  if (!filter) return true;
  return name.toLowerCase().includes(filter) || humanize(name).toLowerCase().includes(filter);
}

@Component({
  selector: 'app-extracted-values',
  template: `
    <div class="row" style="margin-bottom: 10px">
      <input class="input" type="search" style="max-width: 300px" placeholder="Filter fields…"
             [value]="filter()" (input)="filter.set($any($event.target).value)" />
      <span class="muted small">{{ fieldCount() }} values · {{ lowCount() }} below 70% confidence</span>
    </div>

    @for (seg of view(); track seg.key) {
      <section class="section">
        <div class="section-title">
          <span>{{ seg.name }}</span>
          <span class="row">
            @if (seg.lowCount) { <span class="chip tone-warn">{{ seg.lowCount }} low confidence</span> }
            @if (seg.source) { <span class="muted small" [title]="seg.source">{{ seg.source }}</span> }
          </span>
        </div>

        @if (seg.fields.length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th style="width: 34%">Field</th><th>Value</th><th class="num">Confidence</th><th class="num">Page</th></tr>
              </thead>
              <tbody>
                @for (f of seg.fields; track $index) {
                  <tr [class.cell-low]="f.low">
                    <td class="muted" [title]="f.name">{{ f.label }}</td>
                    <td>{{ f.value }}</td>
                    <td class="num">
                      @if (f.low) { <span class="chip tone-warn">{{ f.confidence }}</span> } @else { {{ f.confidence }} }
                    </td>
                    <td class="num">{{ f.page ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (seg.columns.length && seg.rows.length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th class="num">#</th>
                  @for (col of seg.columns; track col.name) { <th [title]="col.name">{{ col.label }}</th> }
                </tr>
              </thead>
              <tbody>
                @for (row of seg.rows; track $index; let i = $index) {
                  <tr>
                    <td class="num muted">{{ i + 1 }}</td>
                    @for (cell of row; track $index) {
                      <td [class.cell-low]="cell.low" [title]="cell.title">{{ cell.value }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    } @empty {
      <div class="empty">
        @if (segments().length) { No fields match "{{ filter() }}". } @else { No extracted values received yet. }
      </div>
    }
  `,
})
export class ExtractedValuesComponent {
  readonly segments = input<Segment[]>([]);
  readonly filter = signal('');

  readonly view = computed<SegmentView[]>(() => {
    const f = this.filter().trim().toLowerCase();
    const out: SegmentView[] = [];
    this.segments().forEach((seg, idx) => {
      const fields = (seg.fields ?? []).filter(x => x && matches(String(x.name ?? ''), f)).map(fieldView);

      const items = seg.items ?? [];
      const allColumns: string[] = [];
      for (const item of items) {
        for (const field of item?.fields ?? []) {
          const name = String(field?.name ?? '');
          if (name && !allColumns.includes(name)) allColumns.push(name);
        }
      }
      const columns = allColumns.filter(c => matches(c, f));
      const rows: CellView[][] = columns.length
        ? items.map(item => {
            const byName = new Map((item?.fields ?? []).map(x => [String(x?.name ?? ''), x] as const));
            return columns.map(col => {
              const field = byName.get(col);
              if (!field) return { value: '—', low: false, title: '' };
              const c = confidenceInfo(field.confidence);
              return { value: formatValue(field.value), low: c.low, title: `Confidence ${c.label}` };
            });
          })
        : [];

      const lowCount = fields.filter(x => x.low).length + rows.flat().filter(c => c.low).length;
      const totalFields = fields.length + rows.flat().filter(c => c.value !== '—').length;
      if (f && !fields.length && !columns.length) return;
      out.push({
        key: `${idx}-${seg.name}`,
        name: seg.name ? humanize(seg.name) : `Segment ${idx + 1}`,
        source: seg.source_filename ?? null,
        fields,
        columns: columns.map(name => ({ name, label: humanize(name) })),
        rows,
        totalFields,
        lowCount,
      });
    });
    return out;
  });

  readonly fieldCount = computed(() => this.view().reduce((sum, s) => sum + s.totalFields, 0));
  readonly lowCount = computed(() => this.view().reduce((sum, s) => sum + s.lowCount, 0));
}
