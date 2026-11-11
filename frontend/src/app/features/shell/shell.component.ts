import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { roleLabel } from '../../shared/format';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink],
  template: `
    <header class="topbar">
      <a class="brand" routerLink="/cases">
        <span class="brand-mark">UR</span>
        Underwriter Recommendation
      </a>
      <div class="topbar-right">
        @if (auth.user(); as u) {
          <div class="user">
            <div class="user-name">{{ u.name || u.email }}</div>
            <div class="user-email">{{ u.email }}</div>
          </div>
          <span class="chip" [class.tone-warn]="u.role === 'senior_underwriter'" [class.tone-info]="u.role === 'underwriter'">
            {{ roleLabel(u.role) }}
          </span>
        }
        <button type="button" class="btn btn-ghost btn-sm" (click)="auth.logout()">Sign out</button>
      </div>
    </header>
    <main class="page">
      <router-outlet />
    </main>
  `,
})
export class ShellComponent {
  readonly auth = inject(AuthService);
  readonly roleLabel = roleLabel;
}
