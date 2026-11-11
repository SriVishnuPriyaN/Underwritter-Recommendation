import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../config';
import { AuthService } from './auth.service';

/** Attaches the app token to backend calls; a 401 on an authenticated call ends the session. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const isApi = req.url.startsWith(API_BASE_URL);
  const attach = isApi && !!token && !req.headers.has('Authorization');
  const request = attach ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(request).pipe(
    catchError((err: unknown) => {
      if (attach && err instanceof HttpErrorResponse && err.status === 401) {
        auth.clearSession();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
