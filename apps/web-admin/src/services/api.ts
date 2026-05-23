const TOKEN_KEY = 'stats_api_token';
const AUTH_USERNAME_KEY = 'stats_api_username';
const DASHBOARD_SELECTION_KEY = 'dashboard:selected-target-ids';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getAuthUsername(): string {
  return localStorage.getItem(AUTH_USERNAME_KEY) ?? '';
}

export function setAuthSession(input: { token: string; username: string }): void {
  setToken(input.token);
  localStorage.setItem(AUTH_USERNAME_KEY, input.username);
}

export function clearAuthSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AUTH_USERNAME_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(getToken().trim());
}

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function storeDashboardSelectedTargetIds(ids: number[]): void {
  if (!hasSessionStorage()) {
    return;
  }

  const sanitized = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  window.sessionStorage.setItem(DASHBOARD_SELECTION_KEY, JSON.stringify(sanitized));
}

export function readDashboardSelectedTargetIds(): number[] {
  if (!hasSessionStorage()) {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_SELECTION_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => Number(value))
      .filter((id) => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

export function clearDashboardSelectedTargetIds(): void {
  if (!hasSessionStorage()) {
    return;
  }

  window.sessionStorage.removeItem(DASHBOARD_SELECTION_KEY);
}

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = getToken().trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: buildHeaders() });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function apiPost<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function apiPut<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = {
  ok: boolean;
  token: string;
  username: string;
};

export async function fileToBase64(file: File): Promise<{ fileName: string; mimeType?: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      const base64 = content.includes(',') ? content.split(',').pop() ?? '' : content;
      resolve({ fileName: file.name, mimeType: file.type || undefined, base64 });
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export type Target = {
  id: number;
  tu_id: string;
  tu_name: string;
  telegram_chat_id: string;
  telegram_user_id: string;
  telegram_username: string | null;
  path?: string | null;
  status?: 'active' | 'inactive';
};

export type SaveTargetRequest = {
  tu_id?: string;
  tu_name?: string;
  telegram_chat_id?: string;
  telegram_user_id?: string;
  telegram_username?: string | null;
  path?: string | null;
  status?: 'active' | 'inactive';
};

export function listTargets(query = '', status: 'active' | 'inactive' | 'all' = 'active'): Promise<Target[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set('query', query.trim());
  }
  if (status !== 'active') {
    params.set('status', status);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiGet<Target[]>(`/api/messages/targets${suffix}`);
}

export function addTarget(payload: SaveTargetRequest): Promise<Target> {
  return apiPost<Target>('/api/messages/targets', payload);
}

export function updateTarget(id: number, payload: SaveTargetRequest): Promise<Target> {
  return apiPut<Target>(`/api/messages/targets/${id}`, payload);
}

export type TargetUploadHistoryDay = {
  date: string;
  total_media: number;
  image_count: number;
  video_count: number;
  document_count: number;
  uploaded_count: number;
  failed_count: number;
  pending_count: number;
};

export type TargetUploadHistoryResponse = {
  user: Target;
  timezone: string;
  limit: number;
  total_dates: number;
  summary: {
    total_media: number;
    uploaded_count: number;
    failed_count: number;
    pending_count: number;
  };
  items: TargetUploadHistoryDay[];
};

export function getTargetUploadHistory(id: number, limit = 90): Promise<TargetUploadHistoryResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  return apiGet<TargetUploadHistoryResponse>(
    `/api/dashboard/users/${encodeURIComponent(id)}/upload-history?${params.toString()}`,
  );
}

export type ReminderScheduleTargetRule =
  | 'no_media_current_period'
  | 'all_active_users';

export type ReminderScheduleRun = {
  id: number;
  schedule_id: number;
  run_key: string;
  run_date: string;
  trigger_type: string;
  status: string;
  campaign_id: string | null;
  target_count: number;
  error: string | null;
  created_at: string;
  updated_at: string | null;
};

export type ReminderSchedule = {
  id: number;
  name: string;
  status: 'active' | 'inactive';
  days_of_month: number[];
  send_time: string;
  timezone: string;
  target_rule: ReminderScheduleTargetRule;
  message_template: string;
  last_run_at: string | null;
  next_run_label: string | null;
  created_at: string;
  updated_at: string | null;
  recent_runs: ReminderScheduleRun[];
};

export type SaveReminderScheduleRequest = {
  name: string;
  status: 'active' | 'inactive';
  days_of_month: number[];
  send_time: string;
  timezone: string;
  target_rule: ReminderScheduleTargetRule;
  message_template: string;
};

export function listReminderSchedules(): Promise<ReminderSchedule[]> {
  return apiGet<ReminderSchedule[]>('/api/reminder-schedules');
}

export function createReminderSchedule(payload: SaveReminderScheduleRequest): Promise<ReminderSchedule> {
  return apiPost<ReminderSchedule>('/api/reminder-schedules', payload);
}

export function updateReminderSchedule(
  id: number,
  payload: SaveReminderScheduleRequest,
): Promise<ReminderSchedule> {
  return apiPut<ReminderSchedule>(`/api/reminder-schedules/${id}`, payload);
}

export function runReminderScheduleNow(id: number): Promise<ReminderScheduleRun> {
  return apiPost<ReminderScheduleRun>(`/api/reminder-schedules/${id}/run-now`, {});
}

export type HistoryItem = {
  campaign_id: string;
  body_template: string;
  status: string;
  total_targets: number;
  success_targets: number;
  failed_targets: number;
  media_count: number;
  created_at: string;
};

export type HistoryDetailResponse = {
  campaign_id: string;
  body_template: string;
  created_by: string;
  status: string;
  total_targets: number;
  success_targets: number;
  failed_targets: number;
  created_at: string;
  updated_at: string | null;
  medias: Array<{
    id: number;
    file_name: string;
    mime_type: string | null;
    order_index: number;
    local_path: string;
  }>;
  targets: Array<{
    id: number;
    user_tu_id: number | null;
    tu_name: string;
    telegram_chat_id: string;
    rendered_body: string;
    status: string;
    attempt_count: number;
    error: string | null;
    sent_at: string | null;
    failed_at: string | null;
  }>;
};

export function getHistoryDetail(campaignId: string): Promise<HistoryDetailResponse> {
  return apiGet<HistoryDetailResponse>(`/api/messages/histories/${encodeURIComponent(campaignId)}`);
}

export type DashboardOverview = {
  generated_at: string;
  health: {
    status: string;
    uptime_seconds: number;
    telegram_connected: boolean;
    queues: {
      upload: Record<string, number>;
    };
    staging: {
      used_gb: number;
      cap_gb: number;
      used_pct: number;
      backpressure_active: boolean;
    };
  };
  today_summary: {
    date: string;
    total_received: number;
    total_uploaded: number;
    total_failed: number;
    active_users: number;
    top_uploaders: Array<{
      user_tu_id: number | null;
      tu_name: string;
      telegram_username: string | null;
      sender_id: string | null;
      chat_id: string;
      total: number;
    }>;
  };
  recent_activity: Array<{
    id: string;
    created_at: string;
    sender_id: string | null;
    chat_id: string;
    media_type: string;
    status: string;
    file_name: string | null;
    error: string | null;
  }>;
  recent_failures: Array<{
    error: string | null;
    count: number;
    last_at: string | null;
  }>;
  campaigns: Array<{
    campaign_id: string;
    status: string;
    total_targets: number;
    success_targets: number;
    failed_targets: number;
    media_count: number;
    created_at: string;
    updated_at: string | null;
  }>;
};

export type MonthlyHeatmapMonth = {
  month_key: string;
  label: string;
  total_media: number;
  active_users: number;
  cycle_start: string;
  cycle_end: string;
};

export type MonthlyHeatmapResponse = {
  year: number;
  timezone: string;
  cycle_start_day: number;
  months: MonthlyHeatmapMonth[];
};

export type DashboardMonthUser = {
  user_tu_id: number;
  tu_id: string;
  tu_name: string;
  telegram_username: string | null;
  telegram_chat_id: string;
  total_media: number;
  image_count: number;
  video_count: number;
  document_count: number;
};

export type DashboardMonthUsersResponse = {
  month: string;
  timezone: string;
  cycle_start_day: number;
  cycle_start: string;
  cycle_end: string;
  total: number;
  limit: number;
  offset: number;
  summary: {
    total_media: number;
    active_users: number;
  };
  items: DashboardMonthUser[];
};

export type MissingImageUser = {
  user_tu_id: number;
  tu_id: string;
  tu_name: string;
  telegram_username: string | null;
  telegram_chat_id: string;
  image_upload_count: number;
};

export type MissingImageUsersResponse = {
  month: string;
  timezone: string;
  cycle_start_day: number;
  cycle_start: string;
  cycle_end: string;
  total: number;
  limit: number;
  offset: number;
  items: MissingImageUser[];
};
