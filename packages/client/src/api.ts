// ============================================================================
// @dce/client — Cliente HTTP de la API. Guarda el JWT en localStorage.
// ============================================================================

import type { Constitution, Hex, WorldMap } from '@dce/shared';

const TOKEN_KEY = 'dce_token';

export interface ApiUser {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface ApiCountry {
  id: string;
  name: string;
  color: string;
  capital: Hex;
  constitution: Constitution;
  population: number;
  foundedAt: string;
  hexCount: number;
  inventories: Record<string, number>;
}

export interface MeResponse {
  user: ApiUser;
  country: ApiCountry | null;
}

export interface StatusResponse {
  tickSeconds: number;
  nextTickAt: number;
  countries: number;
  hexCount: number;
  wsClients: number;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

class Api {
  token: string | null = localStorage.getItem(TOKEN_KEY);

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (init.body) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(path, { ...init, headers });
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) {
      throw new ApiError(data.message ?? data.error ?? `HTTP ${res.status}`, res.status, data.error);
    }
    return data as T;
  }

  register(username: string, email: string, password: string): Promise<{ token: string; user: ApiUser }> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  login(username: string, password: string): Promise<{ token: string; user: ApiUser }> {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  /** Devuelve null si no hay sesión (401). */
  async me(): Promise<MeResponse | null> {
    if (!this.token) return null;
    try {
      return await this.request<MeResponse>('/api/auth/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.logout();
        return null;
      }
      throw err;
    }
  }

  async myCountry(): Promise<ApiCountry | null> {
    if (!this.token) return null;
    try {
      const res = await this.request<{ country: ApiCountry }>('/api/me');
      return res.country;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }

  foundCountry(input: {
    name: string;
    color: string;
    constitution: Constitution;
    hex: Hex;
  }): Promise<{ country: ApiCountry; claimedHexCount: number }> {
    return this.request('/api/countries', { method: 'POST', body: JSON.stringify(input) });
  }

  world(): Promise<WorldMap> {
    return this.request('/api/world');
  }

  status(): Promise<StatusResponse> {
    return this.request('/api/status');
  }

  setToken(token: string): void {
    this.token = token;
    localStorage.setItem(TOKEN_KEY, token);
  }

  logout(): void {
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }
}

export const api = new Api();
