import { Component, computed, input } from '@angular/core';
import { formatValue, humanize } from './format';

interface Row {
  label: string;
  value: string;
}

const MAX_DEPTH = 3;

function flatten(data: unknown, prefix: string, depth: number, exclude: Set<string>, out: Row[]): void {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!prefix && exclude.has(key)) continue;
    if (key.endsWith('_html')) continue;
    const label = prefix ? `${prefix} › ${humanize(key)}` : humanize(key);
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && depth < MAX_DEPTH) {
      flatten(value, label, depth + 1, exclude, out);
    } else {
      out.push({ label, value: formatValue(value) });
    }
  }
}

/** Renders any object as label / value rows. Nested objects become "Parent › Child" rows. */
@Component({
  selector: 'app-kv-list',
  template: `
    @if (rows().length) {
      <dl class="kv">
        @for (row of rows(); track $index) {
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        }
      </dl>
    } @else if (showEmpty()) {
      <p class="muted small">Nothing recorded.</p>
    }
  `,
})
export class KvListComponent {
  readonly data = input<unknown>(null);
  readonly exclude = input<string[]>([]);
  readonly showEmpty = input(false);

  readonly rows = computed<Row[]>(() => {
    const out: Row[] = [];
    flatten(this.data(), '', 0, new Set(this.exclude()), out);
    return out;
  });
}
