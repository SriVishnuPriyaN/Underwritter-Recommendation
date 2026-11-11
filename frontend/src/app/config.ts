declare global {
  interface Window {
    __UW_CONFIG__?: { apiBaseUrl?: string };
  }
}

/** Base URL of the Underwriter Recommendation backend. Set in public/config.js at deploy time. */
export const API_BASE_URL: string = (
  (typeof window !== 'undefined' && window.__UW_CONFIG__?.apiBaseUrl) || 'http://localhost:8010'
).replace(/\/+$/, '');
