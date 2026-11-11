import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell.component').then(m => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'cases' },
      {
        path: 'cases',
        loadComponent: () =>
          import('./features/cases-list/cases-list.component').then(m => m.CasesListComponent),
      },
      {
        path: 'cases/:id',
        loadComponent: () =>
          import('./features/case-detail/case-detail.component').then(m => m.CaseDetailComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'cases' },
];
