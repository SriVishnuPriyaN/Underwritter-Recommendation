import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config';
import {
  AuthConfig,
  AuthResponse,
  CaseDetail,
  CaseSummary,
  CounterRecommendation,
  Stats,
  User,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api`;

  private caseUrl(id: string): string {
    return `${this.base}/cases/${encodeURIComponent(id)}`;
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  authConfig(): Observable<AuthConfig> {
    return this.http.get<AuthConfig>(`${this.base}/auth/config`);
  }

  devLogin(email: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.base}/auth/dev-login`, { email });
  }

  /** Swap a Microsoft (Azure AD) ID token for an app token. */
  exchange(idToken: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(
      `${this.base}/auth/exchange`,
      {},
      { headers: { Authorization: `Bearer ${idToken}` } },
    );
  }

  me(): Observable<User> {
    return this.http.get<User>(`${this.base}/auth/me`);
  }

  // ── Cases ─────────────────────────────────────────────────────────────
  stats(): Observable<Stats> {
    return this.http.get<Stats>(`${this.base}/stats`);
  }

  listCases(statuses: string[], q: string): Observable<CaseSummary[]> {
    let params = new HttpParams();
    if (statuses.length) params = params.set('status', statuses.join(','));
    if (q.trim()) params = params.set('q', q.trim());
    return this.http.get<CaseSummary[]>(`${this.base}/cases`, { params });
  }

  getCase(id: string): Observable<CaseDetail> {
    return this.http.get<CaseDetail>(this.caseUrl(id));
  }

  refresh(id: string): Observable<CaseDetail> {
    return this.http.post<CaseDetail>(`${this.caseUrl(id)}/refresh`, {});
  }

  accept(id: string, notes?: string): Observable<CaseDetail> {
    return this.http.post<CaseDetail>(`${this.caseUrl(id)}/accept`, { notes: notes || null });
  }

  refer(id: string, reason: string): Observable<CaseDetail> {
    return this.http.post<CaseDetail>(`${this.caseUrl(id)}/refer`, { reason });
  }

  referralDecision(id: string, decision: 'accept' | 'decline', notes?: string): Observable<CaseDetail> {
    return this.http.post<CaseDetail>(`${this.caseUrl(id)}/referral/decision`, {
      decision,
      notes: notes || null,
    });
  }

  counterRecommendation(
    id: string,
    body: { recommendation: CounterRecommendation; agreed_premium?: number; notes?: string },
  ): Observable<CaseDetail> {
    return this.http.post<CaseDetail>(`${this.caseUrl(id)}/counter/recommendation`, body);
  }

  counterRefer(id: string, reason: string): Observable<CaseDetail> {
    return this.http.post<CaseDetail>(`${this.caseUrl(id)}/counter/refer`, { reason });
  }

  document(id: string, fileId: string): Observable<Blob> {
    return this.http.get(`${this.caseUrl(id)}/documents/${encodeURIComponent(fileId)}`, {
      responseType: 'blob',
    });
  }
}
