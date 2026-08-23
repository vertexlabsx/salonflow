import { ApiError } from "../../../shared/http";
import { metaConfig } from "./meta-config";

async function graph<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const config = metaConfig();
  const url = path.startsWith("http") ? new URL(path) : new URL(`${config.graphBaseUrl}/${config.apiVersion}/${path.replace(/^\//, "")}`);
  if (!init?.body) url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
  if (!response.ok) throw new ApiError(response.status >= 500 ? 502 : 400, payload.error?.message || `Meta API request failed (${response.status})`);
  return payload as T;
}

export async function exchangeEmbeddedSignupCode(code: string, redirectUri?: string): Promise<{ access_token: string; expires_in?: number; token_type?: string }> {
  const config = metaConfig();
  if (!config.appId || !config.appSecret) throw ApiError.unavailableFeature("Meta Embedded Signup is not configured.");
  const url = new URL(`${config.graphBaseUrl}/${config.apiVersion}/oauth/access_token`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("code", code);
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);
  const response = await fetch(url);
  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; token_type?: string; error?: { message?: string } };
  if (!response.ok || !payload.access_token) throw new ApiError(400, payload.error?.message || "Unable to exchange Meta authorization code.");
  return { access_token: payload.access_token, expires_in: payload.expires_in, token_type: payload.token_type };
}

export async function fetchWabaPhoneNumbers(accessToken: string, wabaId: string): Promise<Array<{ id: string; display_phone_number?: string; verified_name?: string; code_verification_status?: string; quality_rating?: string }>> {
  const payload = await graph<{ data?: Array<{ id: string; display_phone_number?: string; verified_name?: string; code_verification_status?: string; quality_rating?: string }> }>(`/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating`, accessToken);
  return payload.data || [];
}

export async function subscribeWabaToWebhooks(accessToken: string, wabaId: string): Promise<boolean> {
  const config = metaConfig();
  const url = `${config.graphBaseUrl}/${config.apiVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`;
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 400 || response.status === 403) return false;
  if (!response.ok) throw new ApiError(502, `Unable to subscribe WABA webhook (${response.status}).`);
  return true;
}
