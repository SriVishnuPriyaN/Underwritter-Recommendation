import { Component, computed, input } from '@angular/core';
import { statusLabel, statusTone } from './format';

@Component({
  selector: 'app-status-chip',
  template: `<span class="chip" [class]="'chip tone-' + tone()">{{ label() }}</span>`,
})
export class StatusChipComponent {
  readonly status = input<string | null | undefined>(null);
  readonly label = computed(() => statusLabel(this.status()));
  readonly tone = computed(() => statusTone(this.status()));
}
