export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export const STATUS_LABELS: Record<string, string> = {
  awaiting_review: 'Awaiting review',
  referred: 'Referred to senior',
  accepted: 'Accepted – quoting',
  declined: 'Declined',
  quoted: 'Quoted – with broker',
  counter_pending: 'Counter-offer – needs recommendation',
  counter_referred: 'Counter-offer – referred to senior',
  quote_accepted: 'Quote accepted',
  quote_declined: 'Quote declined',
};

export const STATUS_TONES: Record<string, Tone> = {
  awaiting_review: 'info',
  referred: 'warn',
  accepted: 'ok',
  declined: 'bad',
  quoted: 'info',
  counter_pending: 'warn',
  counter_referred: 'warn',
  quote_accepted: 'ok',
  quote_declined: 'bad',
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return STATUS_LABELS[status] ?? humanize(status);
}

export function statusTone(status: string | null | undefined): Tone {
  return (status && STATUS_TONES[status]) || 'neutral';
}

const OK_WORDS = ['low', 'complete', 'consistent', 'rated', 'accepted', 'accept', 'issued', 'bound', 'approved', 'completed', 'success'];
const WARN_WORDS = ['medium', 'referral', 'referred', 'counter', 'awaiting', 'pending', 'review', 'in_progress', 'inprogress', 'pending_review'];
const BAD_WORDS = ['high', 'critical', 'mismatch', 'incomplete', 'declined', 'decline', 'rejected', 'failed', 'not_bound', 'awaiting_documents'];

/** Tone for a generic outcome word (risk band, rating status, run status…). */
export function toneFor(value: unknown): Tone {
  if (value == null || value === '') return 'neutral';
  const v = String(value).toLowerCase().trim();
  if (BAD_WORDS.includes(v)) return 'bad';
  if (OK_WORDS.includes(v)) return 'ok';
  if (WARN_WORDS.includes(v) || v.startsWith('awaiting')) return 'warn';
  return 'neutral';
}

export function humanize(key: string | null | undefined): string {
  if (!key) return '';
  const text = String(key).replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[,$\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function formatMoney(v: unknown): string {
  const n = toNumber(v);
  return n == null
    ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatNumber(v: unknown, maxFraction = 4): string {
  const n = toNumber(v);
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: maxFraction });
}

function scalar(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return formatNumber(v);
  return String(v);
}

/** Readable text for any extracted / computed value. */
export function formatValue(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) {
    if (!v.length) return '—';
    return v
      .map(item =>
        item !== null && typeof item === 'object'
          ? Object.entries(item as Record<string, unknown>)
              .filter(([, x]) => x != null && x !== '')
              .map(([k, x]) => `${humanize(k)}: ${formatValue(x)}`)
              .join(', ')
          : scalar(item),
      )
      .join(' | ');
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null && x !== '');
    if (!entries.length) return '—';
    return entries.map(([k, x]) => `${humanize(k)}: ${formatValue(x)}`).join(', ');
  }
  return scalar(v);
}

export interface ConfidenceInfo {
  label: string;
  low: boolean;
}

/** Confidence may arrive as 0–1 or 0–100. Below 70 % is flagged. */
export function confidenceInfo(c: number | null | undefined): ConfidenceInfo {
  if (c == null || !Number.isFinite(c)) return { label: '—', low: false };
  const fraction = c > 1 ? c / 100 : c;
  return { label: `${Math.round(fraction * 100)}%`, low: fraction < 0.7 };
}

export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  const e = err as any;
  const detail = e?.error?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: any) => d?.msg ?? JSON.stringify(d)).join('; ');
  }
  if (e?.status === 0) return 'Cannot reach the Underwriter Recommendation service.';
  if (typeof e?.error === 'string' && e.error && e.error.length < 300) return e.error;
  if (typeof e?.errorMessage === 'string' && e.errorMessage) return e.errorMessage;
  if (typeof e?.message === 'string' && e.message) return e.message;
  return fallback;
}

export function roleLabel(role: string | null | undefined): string {
  if (role === 'senior_underwriter') return 'Senior underwriter';
  if (role === 'underwriter') return 'Underwriter';
  return humanize(role ?? '');
}
