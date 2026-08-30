const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  isUpdating?: boolean;
  meta?: Record<string, unknown>;
};

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };
  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
  });

  const json = (await res.json().catch(() => ({
    success: false,
    message: res.statusText,
  }))) as ApiResponse<T>;

  if (json.isUpdating || res.status === 503) {
    import("@/store/system").then(({ useSystemStore }) => {
      useSystemStore.getState().setIsUpdating(true, json.message);
    });
  }

  if (!res.ok) {
    throw new Error(json.message || `Request failed (${res.status})`);
  }

  return json;
}

export function ssoLoginUrl() {
  return `${API_BASE}/auth/sso/login`;
}

export function googleLoginUrl() {
  return `${API_BASE}/auth/google/login`;
}
