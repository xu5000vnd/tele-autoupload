const TOKEN_KEY = 'stats_api_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
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
};

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
