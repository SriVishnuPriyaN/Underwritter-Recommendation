export type Role = 'underwriter' | 'senior_underwriter';

export interface User {
  email: string;
  name: string;
  role: Role;
  actuvara_roles: string[];
}

export interface AuthConfig {
  mode: 'dev' | 'azure_ad';
  tenant_id?: string;
  client_id?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export type CaseStatus =
  | 'awaiting_review'
  | 'referred'
  | 'accepted'
  | 'declined'
  | 'quoted'
  | 'counter_pending'
  | 'counter_referred'
  | 'quote_accepted'
  | 'quote_declined';

export type Stats = Partial<Record<CaseStatus, number>>;

export interface CaseSummary {
  id: string;
  ref_id: string;
  insured_name: string | null;
  process_name: string | null;
  broker_email: string | null;
  status: CaseStatus | string;
  premium: number | null;
  risk_category: string | null;
  rating_status: string | null;
  received_at: string | null;
  updated_at: string | null;
  pending_sync: boolean;
}

export interface ExtractedField {
  name: string;
  value: any;
  confidence: number | null;
  page: number | null;
}

export interface Segment {
  name: string;
  source_filename: string | null;
  is_list: boolean;
  fields: ExtractedField[];
  items: { fields: ExtractedField[] }[];
}

export interface DocumentRef {
  file_id: string;
  filename: string;
  mime_type: string | null;
  pages: number | null;
  is_primary: boolean;
}

export interface Submission {
  run_status: string;
  process_name: string;
  created_at: string | null;
  documents: DocumentRef[];
  segments: Segment[];
}

export interface PendingSync {
  type: 'decision' | 'counter_recommendation';
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface Decision {
  decision: 'accept' | 'decline';
  by_email: string;
  by_name: string;
  role: string;
  notes: string | null;
  at: string;
}

export interface Referral {
  reason: string;
  by_email: string;
  by_name: string;
  at: string;
  resolved: boolean;
  resolution: 'accept' | 'decline' | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  notes: string | null;
}

export interface CounterReferral {
  reason: string;
  by_email: string;
  by_name: string;
  at: string;
  round: number;
}

export interface PendingCounter {
  round: number;
  counter_premium: number | null;
  counter_terms: any;
  notes: string | null;
  user: string | null;
  at: string;
  quoted_premium: number | null;
}

export interface NegotiationRound {
  round: number;
  response: string;
  quoted_premium: number | null;
  revised_premium: number | null;
  counter_premium: number | null;
  counter_terms: any;
  notes: string | null;
  user: string | null;
  at: string;
  underwriter_recommendation?: string;
  recommended_by?: string;
}

export interface Negotiation {
  status: string;
  round: number;
  max_rounds: number;
  quoted_premium: number | null;
  rated_premium: number | null;
  max_discount_pct: number;
  floor_premium: number | null;
  pending_counter: PendingCounter | null;
  rounds: NegotiationRound[];
}

export interface HistoryEvent {
  type: string;
  actor_email: string | null;
  actor_name: string | null;
  actor_role: string | null;
  data: Record<string, any> | null;
  at: string;
}

export interface CaseActions {
  accept: boolean;
  refer: boolean;
  referral_decision: boolean;
  counter_recommend: boolean;
  counter_refer: boolean;
  senior_authority: boolean;
}

/** Raw sections written by Actuvara's underwriting nodes — any may be missing. */
export interface Underwriting {
  completeness?: Record<string, any> | null;
  reconciliation?: Record<string, any> | null;
  exposure_loss_analysis?: Record<string, any> | null;
  rating?: Record<string, any> | null;
  quote?: Record<string, any> | null;
  [key: string]: any;
}

export interface CaseDetail {
  id: string;
  ref_id: string;
  status: CaseStatus | string;
  insured_name: string | null;
  process_name: string | null;
  broker_email: string | null;
  received_at: string | null;
  updated_at: string | null;
  snapshot_at: string | null;
  pending_sync: PendingSync | null;
  sync_error: string | null;
  decision: Decision | null;
  referral: Referral | null;
  counter_referral: CounterReferral | null;
  submission: Submission | null;
  underwriting: Underwriting | null;
  negotiation: Negotiation | null;
  history: HistoryEvent[];
  actions: CaseActions;
}

export type CounterRecommendation = 'hold' | 'match' | 'custom' | 'decline';
