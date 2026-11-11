import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CaseDetail, CounterRecommendation } from '../../core/models';
import { MoneyPipe } from '../../shared/money.pipe';
import { errorMessage, formatMoney, roleLabel } from '../../shared/format';

interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  tone: 'primary' | 'ok' | 'danger' | 'warn';
  run: () => Observable<CaseDetail>;
}

@Component({
  selector: 'app-action-panel',
  imports: [MoneyPipe, DatePipe],
  template: `
    <div class="card action-card">
      <div class="card-head"><h2>Underwriter decision</h2></div>
      <div class="card-body stack">

        <!-- What has happened so far -->
        @if (d().decision; as dec) {
          <div class="banner" [class.banner-ok]="dec.decision === 'accept'" [class.banner-bad]="dec.decision === 'decline'">
            <div>
              <strong>{{ dec.decision === 'accept' ? 'Accepted' : 'Declined' }}</strong>
              by {{ dec.by_name || dec.by_email }} ({{ roleLabel(dec.role) }}) · {{ dec.at | date: 'd MMM y, HH:mm' }}
              @if (dec.notes) { <div class="small">“{{ dec.notes }}”</div> }
            </div>
          </div>
        }
        @if (d().referral; as ref) {
          <div class="banner banner-warn">
            <div>
              <strong>Referred</strong> by {{ ref.by_name || ref.by_email }} · {{ ref.at | date: 'd MMM y, HH:mm' }}
              <div class="small">Reason: {{ ref.reason }}</div>
              @if (ref.resolved) {
                <div class="small">
                  {{ ref.resolution === 'accept' ? 'Accepted' : 'Declined' }} by {{ ref.resolved_by_name || '—' }}
                  @if (ref.resolved_at) { · {{ ref.resolved_at | date: 'd MMM y, HH:mm' }} }
                  @if (ref.notes) { — “{{ ref.notes }}” }
                </div>
              }
            </div>
          </div>
        }
        @if (d().counter_referral; as cr) {
          <div class="banner banner-warn">
            <div>
              <strong>Counter-offer (round {{ cr.round }}) referred</strong> by {{ cr.by_name || cr.by_email }} · {{ cr.at | date: 'd MMM y, HH:mm' }}
              <div class="small">Reason: {{ cr.reason }}</div>
            </div>
          </div>
        }

        <!-- Initial review: accept / refer -->
        @if (a().accept || a().refer) {
          <div class="stack-sm">
            <h3>Review submission</h3>
            @if (a().accept) {
              <label class="label" for="accept-notes">Notes (optional)</label>
              <textarea id="accept-notes" class="textarea" rows="2" placeholder="Why this risk is acceptable…"
                        [value]="acceptNotes()" (input)="acceptNotes.set($any($event.target).value)"></textarea>
            }
            @if (mode() === 'refer') {
              <label class="label" for="refer-reason">Reason for referral (required)</label>
              <textarea id="refer-reason" class="textarea" rows="3" placeholder="What needs a senior underwriter's decision…"
                        [value]="referReason()" (input)="referReason.set($any($event.target).value)"></textarea>
            }
            <div class="row-wrap">
              @if (a().accept && mode() !== 'refer') {
                <button type="button" class="btn btn-ok" [disabled]="busy()" (click)="askAccept()">Accept</button>
              }
              @if (a().refer) {
                @if (mode() === 'refer') {
                  <button type="button" class="btn btn-warn" [disabled]="busy() || !referReason().trim()" (click)="askRefer()">Send referral</button>
                  <button type="button" class="btn btn-ghost" (click)="mode.set('none')">Cancel</button>
                } @else {
                  <button type="button" class="btn" [disabled]="busy()" (click)="mode.set('refer')">Refer to senior underwriter</button>
                }
              }
            </div>
          </div>
        }

        <!-- Senior: decide a referral -->
        @if (a().referral_decision) {
          <div class="stack-sm">
            <h3>Decide referral</h3>
            <label class="label" for="ref-notes">Notes (required to decline)</label>
            <textarea id="ref-notes" class="textarea" rows="2"
                      [value]="referralNotes()" (input)="referralNotes.set($any($event.target).value)"></textarea>
            <div class="row-wrap">
              <button type="button" class="btn btn-ok" [disabled]="busy()" (click)="askReferral('accept')">Accept referral</button>
              <button type="button" class="btn btn-danger" [disabled]="busy() || !referralNotes().trim()" (click)="askReferral('decline')">Decline</button>
            </div>
          </div>
        }

        <!-- Counter-offer recommendation -->
        @if (a().counter_recommend) {
          <div class="stack-sm">
            <h3>Recommend on the broker's counter-offer</h3>
            @if (neg()?.floor_premium != null) {
              <p class="hint" style="margin:0">
                Authority floor {{ neg()?.floor_premium | money }}
                @if (a().senior_authority) { — you have senior authority to go below it. }
              </p>
            }

            <label class="radio-card" [class.selected]="rec() === 'hold'">
              <input type="radio" name="rec" [checked]="rec() === 'hold'" (change)="rec.set('hold')" />
              <span><span class="rc-title">Hold at quoted premium</span><br /><span class="hint">Keep our price; the broker can accept or decline.</span></span>
              <span class="rc-value">{{ quotedPremium() | money }}</span>
            </label>
            <label class="radio-card" [class.selected]="rec() === 'match'">
              <input type="radio" name="rec" [checked]="rec() === 'match'" [disabled]="counterPremium() == null" (change)="rec.set('match')" />
              <span><span class="rc-title">Match the broker</span><br /><span class="hint">Re-quote at the broker's requested premium.</span></span>
              <span class="rc-value">{{ counterPremium() | money }}</span>
            </label>
            <label class="radio-card" [class.selected]="rec() === 'custom'">
              <input type="radio" name="rec" [checked]="rec() === 'custom'" (change)="rec.set('custom')" />
              <span class="grow"><span class="rc-title">Meet in between</span><br /><span class="hint">Re-quote at a premium you choose.</span>
                @if (rec() === 'custom') {
                  <input class="input" style="margin-top:6px; max-width: 200px" type="number" min="0" step="0.01" placeholder="Premium"
                         [value]="customPremium()" (input)="customPremium.set($any($event.target).value)" />
                }
              </span>
            </label>
            <label class="radio-card" [class.selected]="rec() === 'decline'">
              <input type="radio" name="rec" [checked]="rec() === 'decline'" (change)="rec.set('decline')" />
              <span><span class="rc-title">Decline the negotiation</span><br /><span class="hint">Close the quote as declined.</span></span>
            </label>

            @if (belowFloor()) {
              <div class="banner banner-bad">Below your authority — refer to a senior underwriter.</div>
            }

            <label class="label" for="rec-notes">Notes (optional)</label>
            <textarea id="rec-notes" class="textarea" rows="2"
                      [value]="recNotes()" (input)="recNotes.set($any($event.target).value)"></textarea>

            <div class="row-wrap">
              <button type="button" class="btn btn-primary" [disabled]="busy() || recInvalid()" (click)="askRecommendation()">
                Send recommendation
              </button>
            </div>
          </div>
        }

        @if (a().counter_refer) {
          <div class="stack-sm">
            @if (mode() === 'counter_refer') {
              <label class="label" for="cr-reason">Reason for referral (required)</label>
              <textarea id="cr-reason" class="textarea" rows="2"
                        [value]="counterReferReason()" (input)="counterReferReason.set($any($event.target).value)"></textarea>
              <div class="row-wrap">
                <button type="button" class="btn btn-warn" [disabled]="busy() || !counterReferReason().trim()" (click)="askCounterRefer()">Send referral</button>
                <button type="button" class="btn btn-ghost" (click)="mode.set('none')">Cancel</button>
              </div>
            } @else {
              <button type="button" class="btn" [disabled]="busy()" (click)="mode.set('counter_refer')">Refer counter-offer to senior</button>
            }
          </div>
        }

        @if (!hasAnyAction()) {
          <p class="muted small" style="margin:0">{{ idleMessage() }}</p>
        }

        @if (error()) {
          <div class="banner banner-bad">{{ error() }}</div>
        }
      </div>
    </div>

    @if (confirm(); as c) {
      <div class="modal-backdrop" (click)="confirm.set(null)">
        <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <div class="modal-head">{{ c.title }}</div>
          <div class="modal-body">{{ c.message }}</div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="confirm.set(null)">Cancel</button>
            <button type="button" class="btn"
                    [class.btn-primary]="c.tone === 'primary'" [class.btn-ok]="c.tone === 'ok'"
                    [class.btn-danger]="c.tone === 'danger'" [class.btn-warn]="c.tone === 'warn'"
                    [disabled]="busy()" (click)="runConfirm()">
              @if (busy()) { <span class="spinner"></span> }
              {{ c.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `:host { display: block; } .action-card h3 { margin-bottom: 2px; }`,
})
export class ActionPanelComponent {
  private readonly api = inject(ApiService);

  readonly d = input.required<CaseDetail>({ alias: 'detail' });
  readonly changed = output<CaseDetail>();

  readonly roleLabel = roleLabel;

  readonly a = computed(() => this.d().actions);
  readonly neg = computed(() => this.d().negotiation);
  readonly hasAnyAction = computed(() => {
    const a = this.a();
    return a.accept || a.refer || a.referral_decision || a.counter_recommend || a.counter_refer;
  });

  readonly mode = signal<'none' | 'refer' | 'counter_refer'>('none');
  readonly acceptNotes = signal('');
  readonly referReason = signal('');
  readonly referralNotes = signal('');
  readonly rec = signal<CounterRecommendation>('hold');
  readonly customPremium = signal('');
  readonly recNotes = signal('');
  readonly counterReferReason = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly confirm = signal<PendingConfirm | null>(null);

  readonly quotedPremium = computed(() => this.neg()?.pending_counter?.quoted_premium ?? this.neg()?.quoted_premium ?? null);
  readonly counterPremium = computed(() => this.neg()?.pending_counter?.counter_premium ?? null);

  readonly resultingPremium = computed<number | null>(() => {
    switch (this.rec()) {
      case 'hold':
        return this.quotedPremium();
      case 'match':
        return this.counterPremium();
      case 'custom': {
        const n = parseFloat(this.customPremium());
        return Number.isFinite(n) ? n : null;
      }
      default:
        return null;
    }
  });

  readonly belowFloor = computed(() => {
    if (this.rec() === 'decline' || this.a().senior_authority) return false;
    const premium = this.resultingPremium();
    const floor = this.neg()?.floor_premium;
    return premium != null && floor != null && premium < floor;
  });

  readonly recInvalid = computed(() => {
    if (this.rec() === 'decline') return false;
    const premium = this.resultingPremium();
    return premium == null || premium <= 0 || this.belowFloor();
  });

  readonly idleMessage = computed(() => {
    const s = this.d().status;
    if (this.d().pending_sync) return 'Your decision is being sent to Actuvara.';
    switch (s) {
      case 'referred': return 'Waiting for a senior underwriter to decide the referral.';
      case 'counter_referred': return 'Waiting for a senior underwriter to recommend on the counter-offer.';
      case 'accepted': return 'Accepted — Actuvara is preparing the quote.';
      case 'quoted': return 'Quote sent to the broker — waiting for their response.';
      case 'quote_accepted': return 'The broker accepted the quote.';
      case 'quote_declined': return 'The quote was declined.';
      case 'declined': return 'The submission was declined.';
      default: return 'No action is needed from you right now.';
    }
  });

  private lastStatus: string | null = null;

  constructor() {
    // A new status means a new decision point: start the forms afresh.
    effect(() => {
      const status = this.d().status;
      untracked(() => {
        if (status !== this.lastStatus) {
          this.lastStatus = status;
          this.resetForms();
        }
      });
    });
  }

  askAccept(): void {
    const id = this.d().id;
    const notes = this.acceptNotes().trim();
    this.ask({
      title: 'Accept this submission?',
      message: 'Actuvara will continue the workflow to Quote Generation.',
      confirmLabel: 'Accept',
      tone: 'ok',
      run: () => this.api.accept(id, notes || undefined),
    });
  }

  askRefer(): void {
    const id = this.d().id;
    const reason = this.referReason().trim();
    this.ask({
      title: 'Refer to a senior underwriter?',
      message: 'The submission moves to the senior underwriter queue. The Actuvara workflow keeps waiting.',
      confirmLabel: 'Refer',
      tone: 'warn',
      run: () => this.api.refer(id, reason),
    });
  }

  askReferral(decision: 'accept' | 'decline'): void {
    const id = this.d().id;
    const notes = this.referralNotes().trim();
    this.ask({
      title: decision === 'accept' ? 'Accept the referral?' : 'Decline the submission?',
      message:
        decision === 'accept'
          ? 'Actuvara will continue the workflow to Quote Generation.'
          : 'Actuvara will take the reject path and the run will be marked rejected.',
      confirmLabel: decision === 'accept' ? 'Accept' : 'Decline',
      tone: decision === 'accept' ? 'ok' : 'danger',
      run: () => this.api.referralDecision(id, decision, notes || undefined),
    });
  }

  askRecommendation(): void {
    const id = this.d().id;
    const recommendation = this.rec();
    const premium = this.resultingPremium();
    const notes = this.recNotes().trim();
    const message =
      recommendation === 'decline'
        ? 'The negotiation will close as declined in Actuvara.'
        : `Actuvara will issue the next quote version at ${formatMoney(premium)}.`;
    this.ask({
      title: recommendation === 'decline' ? 'Decline the negotiation?' : 'Send this recommendation?',
      message,
      confirmLabel: recommendation === 'decline' ? 'Decline' : 'Send',
      tone: recommendation === 'decline' ? 'danger' : 'primary',
      run: () =>
        this.api.counterRecommendation(id, {
          recommendation,
          ...(recommendation === 'custom' && premium != null ? { agreed_premium: premium } : {}),
          ...(notes ? { notes } : {}),
        }),
    });
  }

  askCounterRefer(): void {
    const id = this.d().id;
    const reason = this.counterReferReason().trim();
    this.ask({
      title: 'Refer the counter-offer?',
      message: 'A senior underwriter will make the recommendation. The Actuvara workflow keeps waiting.',
      confirmLabel: 'Refer',
      tone: 'warn',
      run: () => this.api.counterRefer(id, reason),
    });
  }

  runConfirm(): void {
    const pending = this.confirm();
    if (!pending || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    pending.run().subscribe({
      next: detail => {
        this.busy.set(false);
        this.confirm.set(null);
        this.resetForms();
        this.changed.emit(detail);
      },
      error: err => {
        this.busy.set(false);
        this.confirm.set(null);
        this.error.set(errorMessage(err, 'The action failed.'));
      },
    });
  }

  private ask(c: PendingConfirm): void {
    this.error.set(null);
    this.confirm.set(c);
  }

  private resetForms(): void {
    this.mode.set('none');
    this.acceptNotes.set('');
    this.referReason.set('');
    this.referralNotes.set('');
    this.rec.set('hold');
    this.customPremium.set('');
    this.recNotes.set('');
    this.counterReferReason.set('');
  }
}
