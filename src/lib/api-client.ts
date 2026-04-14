const BASE = "";
const REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(
  path: string,
  opts?: RequestInit
): Promise<{ data?: T; error?: string; status?: number }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      credentials: "same-origin",
      cache: "no-store",
      ...opts,
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Request failed", status: res.status };
    return { data: json as T, status: res.status };
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { error: "Request timed out" };
    }
    return { error: "Network error" };
  }
}

export const api = {
  // Auth
  register: (body: { name: string; email: string; password: string }) =>
    request("/api/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  me: () => request<{ id: number; name: string; email: string; preferredCurrency: string; monthlyBudget: number | null; displayName: string; showEmail: boolean }>("/api/auth/me"),
  updateProfile: (body: { displayName?: string; showEmail?: boolean }) =>
    request("/api/auth/me", { method: "PUT", body: JSON.stringify(body) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),

  // Dashboard
  dashboard: () =>
    request<{
      monthlyTotal: number;
      pendingBills: Array<{ id: number; subscriptionName: string; amount: number; currency: string }>;
      subscriptions: Array<{ name: string; price: number; currency: string; memberCount: number }>;
    }>("/api/dashboard"),

  // Groups
  getGroups: () => request<Array<{ id: number; name: string; publicId: string; createdBy: number }>>("/api/groups"),
  createGroup: (name: string) => request("/api/groups", { method: "POST", body: JSON.stringify({ name }) }),
  getGroup: (id: number) => request<{ id: number; name: string; publicId: string; createdBy: number; members: Array<{ userId: number; name: string }>; subscriptions: Array<{ id: number; name: string; price: number; currency: string }> }>(`/api/groups/${id}`),
  joinGroup: (publicId: string) => request(`/api/groups/${publicId}/join`, { method: "POST" }),
  leaveGroup: (id: number) => request(`/api/groups/${id}/leave`, { method: "POST" }),
  deleteGroup: (id: number) => request(`/api/groups/${id}`, { method: "DELETE" }),

  // Subscriptions
  getSubscriptions: () =>
    request<Array<{ id: number; name: string; price: number; currency: string; nextPayment: string; groupId: number | null; memberCount: number; inactive: number }>>("/api/subscriptions"),
  createSubscription: (body: { name: string; price: number; currency: string; nextPayment: string; groupId?: number }) =>
    request("/api/subscriptions", { method: "POST", body: JSON.stringify(body) }),
  getSubscription: (id: number) =>
    request<{
      id: number;
      name: string;
      price: number;
      currency: string;
      nextPayment: string;
      ownerId: number;
      payerId: number;
      groupId: number | null;
      logo: string | null;
      url: string | null;
      notes: string | null;
      inactive: number;
      members: Array<{
        userId: number;
        displayName: string;
        email?: string;
        addedAt: string;
        isPayer: boolean;
        isOwner: boolean;
        isSelf: boolean;
      }>;
    }>(`/api/subscriptions/${id}`),
  updateSubscription: (id: number, body: Record<string, unknown>) =>
    request(`/api/subscriptions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteSubscription: (id: number) => request(`/api/subscriptions/${id}`, { method: "DELETE" }),

  // Billing
  markPaid: (id: number) => request(`/api/billing/${id}/paid`, { method: "PUT" }),

  // Notifications
  notifications: (limit?: number) =>
    request<{
      items: Array<{
        id: number;
        type: string;
        subscriptionId: number | null;
        payload: Record<string, unknown>;
        createdAt: string;
        readAt: string | null;
      }>;
      unreadCount: number;
    }>(`/api/notifications${limit ? `?limit=${limit}` : ""}`),
  markNotificationRead: (id: number) =>
    request(`/api/notifications/${id}/read`, { method: "PUT" }),
  markAllNotificationsRead: () =>
    request(`/api/notifications/read-all`, { method: "PUT" }),

  // Friends
  friends: () =>
    request<
      Array<{
        userId: number;
        displayName: string;
        email?: string;
        since: string;
      }>
    >("/api/friends"),

  // Settlement
  settlement: () =>
    request<
      Array<{
        counterpartyUserId: number;
        counterpartyName: string;
        currency: string;
        owedByMe: number;
        owedToMe: number;
        net: number;
        billIds: number[];
      }>
    >("/api/settlement"),
  markPairSettled: (counterpartyUserId: number, currency: string) =>
    request<{ marked: number }>("/api/settlement", {
      method: "POST",
      body: JSON.stringify({ counterpartyUserId, currency }),
    }),

  // Subscription members / payer
  addSubMembers: (subId: number, members: number[]) =>
    request<{ added: number }>(`/api/subscriptions/${subId}/members`, {
      method: "POST",
      body: JSON.stringify({ members }),
    }),
  removeSubMember: (subId: number, userId: number) =>
    request(`/api/subscriptions/${subId}/members/${userId}`, {
      method: "DELETE",
    }),
  transferPayer: (subId: number, newPayerId: number) =>
    request(`/api/subscriptions/${subId}/payer`, {
      method: "PUT",
      body: JSON.stringify({ newPayerId }),
    }),
};
