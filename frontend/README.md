# Underwriter Recommendation — frontend

Angular 21 (standalone components, signals, zoneless).

```bash
npm install
npm start          # http://localhost:4210
npm run build      # output: dist/uw-recommendation/browser
```

The backend URL is read at runtime from `public/config.js` (`window.__UW_CONFIG__.apiBaseUrl`,
default `http://localhost:8010`), so a deployed build can be pointed at another backend
without rebuilding.

Sign-in mode comes from the backend (`GET /api/auth/config`): `dev` shows an email box,
`azure_ad` shows "Sign in with Microsoft" (MSAL popup; the backend swaps the Microsoft ID
token for an app token).
