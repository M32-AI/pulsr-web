import { z } from "zod";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const signInSchema = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type SignInInput = z.infer<typeof signInSchema>;

export interface SessionResponse {
  access_token: string;
  refresh_token: string;
  role?: string;
  assistant_emails?: string[];
  user: { id: string; email: string; name?: string; user_metadata?: { name?: string } };
}

export async function apiSignIn(input: SignInInput): Promise<SessionResponse> {
  const res = await fetch(`${API_URL}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Sign in failed");
  return json.data ?? json;
}

export async function apiSignOut(accessToken: string): Promise<void> {
  await fetch(`${API_URL}/api/auth/signout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function apiRefreshSession(refreshToken: string): Promise<SessionResponse> {
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Token refresh failed");
  return json.data ?? json;
}

export async function apiGetMe(accessToken: string): Promise<{ id: string; email: string; name?: string } | null> {
  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const data = json?.data ?? json;
  return data?.user ?? null;
}
