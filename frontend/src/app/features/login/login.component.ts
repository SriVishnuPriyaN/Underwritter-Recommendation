import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AuthConfig } from '../../core/models';
import { errorMessage } from '../../shared/format';

@Component({
  selector: 'app-login',
  template: `
    <div class="login-page">
      <div class="card login-card">
        <div class="login-head">
          <span class="brand-mark">UR</span>
          <div>
            <h1>Underwriter Recommendation</h1>
            <p class="muted small">Review Actuvara submissions, accept or refer, and recommend on counter-offers.</p>
          </div>
        </div>

        <div class="card-body stack">
          @if (loadingConfig()) {
            <div class="row muted"><span class="spinner"></span> Loading sign-in options…</div>
          } @else if (config(); as cfg) {
            @if (cfg.mode === 'azure_ad') {
              <button type="button" class="btn btn-primary btn-block" [disabled]="busy()" (click)="microsoft()">
                @if (busy()) { <span class="spinner"></span> }
                Sign in with Microsoft
              </button>
              <p class="hint">Use your Actuvara work account. Access needs the Underwriter or Senior Underwriter role in Actuvara.</p>
            } @else {
              <form class="stack" (submit)="devLogin($event)">
                <div>
                  <label class="label" for="email">Work email</label>
                  <input id="email" class="input" type="email" autocomplete="username" required
                         placeholder="name@company.com"
                         [value]="email()" (input)="email.set($any($event.target).value)" />
                  <p class="hint" style="margin-top:4px">Development sign-in — your role is looked up in Actuvara.</p>
                </div>
                <button type="submit" class="btn btn-primary btn-block" [disabled]="busy() || !email().trim()">
                  @if (busy()) { <span class="spinner"></span> }
                  Sign in
                </button>
              </form>
            }
          }

          @if (error()) {
            <div class="banner banner-bad">{{ error() }}</div>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; background: linear-gradient(160deg, #13294b 0%, #1f4e8c 55%, #f4f6f9 55.1%); }
    .login-card { width: 100%; max-width: 420px; }
    .login-head { display: flex; gap: 12px; align-items: flex-start; padding: 18px 16px 8px; }
    .login-head .brand-mark { background: #13294b; color: #fff; flex: none; width: 34px; height: 34px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
    .login-head h1 { font-size: 17px; margin-bottom: 2px; }
  `,
})
export class LoginComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly config = signal<AuthConfig | null>(null);
  readonly loadingConfig = signal(true);
  readonly email = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.auth.ensureUser().subscribe(ok => {
      if (ok) this.router.navigate(['/cases']);
    });
    this.api.authConfig().subscribe({
      next: cfg => {
        this.config.set(cfg);
        this.loadingConfig.set(false);
      },
      error: err => {
        this.error.set(errorMessage(err, 'Could not load sign-in settings.'));
        this.loadingConfig.set(false);
      },
    });
  }

  devLogin(event: Event): void {
    event.preventDefault();
    const email = this.email().trim();
    if (!email || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.auth.devLogin(email).subscribe({
      next: () => {
        this.busy.set(false);
        this.router.navigate(['/cases']);
      },
      error: err => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Sign-in failed.'));
      },
    });
  }

  async microsoft(): Promise<void> {
    const cfg = this.config();
    if (!cfg || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.microsoftLogin(cfg);
      this.router.navigate(['/cases']);
    } catch (err) {
      this.error.set(errorMessage(err, 'Microsoft sign-in failed.'));
    } finally {
      this.busy.set(false);
    }
  }
}
