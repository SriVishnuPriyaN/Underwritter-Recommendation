import { Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HistoryEvent } from '../../core/models';
import { KvListComponent } from '../../shared/kv-list.component';
import { humanize, roleLabel } from '../../shared/format';

@Component({
  selector: 'app-history-tab',
  imports: [DatePipe, KvListComponent],
  template: `
    @if (events().length) {
      <ol class="timeline">
        @for (e of events(); track $index) {
          <li>
            <div class="tl-dot"></div>
            <div class="tl-body">
              <div class="row-wrap">
                <strong>{{ humanize(e.type) }}</strong>
                <span class="muted small">{{ e.at | date: 'd MMM y, HH:mm:ss' }}</span>
              </div>
              @if (e.actor_name || e.actor_email) {
                <div class="small">
                  {{ e.actor_name || e.actor_email }}
                  @if (e.actor_role) { <span class="muted">· {{ roleLabel(e.actor_role) }}</span> }
                </div>
              } @else {
                <div class="small muted">System</div>
              }
              @if (e.data) { <app-kv-list class="small" [data]="e.data" /> }
            </div>
          </li>
        }
      </ol>
    } @else {
      <div class="empty">No activity yet.</div>
    }
  `,
  styles: `
    :host { display: block; }
    .timeline { list-style: none; margin: 0; padding: 0 0 0 6px; }
    .timeline li { position: relative; display: flex; gap: 12px; padding-bottom: 14px; }
    .timeline li::before { content: ''; position: absolute; left: 4px; top: 14px; bottom: 0; width: 2px; background: var(--border); }
    .timeline li:last-child::before { display: none; }
    .tl-dot { flex: none; width: 10px; height: 10px; margin-top: 4px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
    .tl-body { flex: 1; min-width: 0; }
  `,
})
export class HistoryTabComponent {
  readonly history = input<HistoryEvent[]>([]);
  readonly humanize = humanize;
  readonly roleLabel = roleLabel;

  /** Newest first. */
  readonly events = computed(() =>
    [...(this.history() ?? [])].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))),
  );
}
