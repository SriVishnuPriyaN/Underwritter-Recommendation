import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, firstValueFrom, map, of, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthConfig, AuthResponse, User } from './models';

const TOKEN_KEY = 'uw_app_token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — the session lasts for this page only */
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  private readonly tokenSignal = signal<string | null>(readToken());
  readonly token = this.tokenSignal.asReadonly();
  readonly user = signal<User | null>(null);
  readonly isSenior = computed(() => this.user()?.role === 'senior_underwriter');

  setSession(res: AuthResponse): void {
    writeToken(res.token);
    this.tokenSignal.set(res.token);
    this.user.set(res.user);
  }

  clearSession(): void {
    writeToken(null);
    this.tokenSignal.set(null);
    this.user.set(null);
  }

  /** True when a valid session exists (loads the user on first call). */
  ensureUser(): Observable<boolean> {
    if (!this.tokenSignal()) return of(false);
    if (this.user()) return of(true);
    return this.api.me().pipe(
      tap(u => this.user.set(u)),
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      }),
    );
  }

  devLogin(email: string): Observable<User> {
    return this.api.devLogin(email).pipe(
      tap(res => this.setSession(res)),
      map(res => res.user),
    );
  }

  async microsoftLogin(config: AuthConfig): Promise<User> {
    if (!config.client_id || !config.tenant_id) {
      throw new Error('Microsoft sign-in is not configured on the server (tenant / client id missing).');
    }
    const { PublicClientApplication } = await import('@azure/msal-browser');
    const pca = new PublicClientApplication({
      auth: {
        clientId: config.client_id,
        authority: `https://login.microsoftonline.com/${config.tenant_id}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
    await pca.initialize();
    const result = await pca.loginPopup({
      scopes: ['openid', 'profile', 'email'],
      prompt: 'select_account',
    });
    const res = await firstValueFrom(this.api.exchange(result.idToken));
    this.setSession(res);
    return res.user;
  }

  logout(): void {
    this.clearSession();
    this.router.navigate(['/login']);
  }
}
