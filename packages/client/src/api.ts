// ============================================================================
// @dce/client — Cliente HTTP de la API (v1.0). Guarda el JWT en localStorage.
// ============================================================================

import type {
  Army,
  AnyResource,
  Building,
  Constitution,
  EspionageMission,
  FlagLayers,
  Hex,
  MarketQuote,
  MissionKind,
  NewsEvent,
  Proposal,
  ProposalKind,
  Treaty,
  TreatyKind,
  UnitType,
  War,
  WorldMap,
} from '@dce/shared';

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
  flagSvg: string;
  capital: Hex;
  constitution: Constitution;
  population: number;
  happiness: number;
  salary: number;
  currencyCode: string;
  gdp: number;
  rebellionStrength: number;
  isPariah: boolean;
  isPuppetOf: string | null;
  foundedAt: string;
  foundedBy: string | null;
  npc: boolean;
  hexCount: number;
  inventories: Record<string, number>;
  buildings: number;
  citizens: number;
}

export interface PublicCountry {
  id: string;
  name: string;
  color: string;
  flagSvg: string;
  npc: boolean;
  isPariah: boolean;
  isPuppetOf: string | null;
  population: number;
  gdp: number;
  happiness: number;
  currencyCode: string;
  hexCount: number;
  wiki: { history: string; motto: string };
  treaties: { kind: TreatyKind; with: string }[];
  wars: { id: string; against: string }[];
}

export interface CitizenshipInfo {
  countryId: string;
  countryName?: string;
  role: 'worker' | 'soldier' | 'minister';
  assignedBuildingId: string | null;
}

export interface MeResponse {
  user: ApiUser;
  country: ApiCountry | null;
  citizenship: CitizenshipInfo | null;
}

export interface StatusResponse {
  tickSeconds: number;
  nextTickAt: number;
  countries: number;
  hexCount: number;
  wsClients: number;
  cgState: string;
  globalTax: number;
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
    return this.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
  }

  login(username: string, password: string): Promise<{ token: string; user: ApiUser }> {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  }

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

  world(): Promise<WorldMap> {
    return this.request('/api/world');
  }

  status(): Promise<StatusResponse> {
    return this.request('/api/status');
  }

  news(): Promise<NewsEvent[]> {
    return this.request('/api/news');
  }

  foundCountry(input: { name: string; color: string; constitution: Constitution; hex: Hex }): Promise<{ country: ApiCountry; claimedHexCount: number }> {
    return this.request('/api/countries', { method: 'POST', body: JSON.stringify(input) });
  }

  countries(): Promise<{ countries: PublicCountry[] }> {
    return this.request('/api/countries');
  }

  country(id: string): Promise<{ country: PublicCountry }> {
    return this.request(`/api/countries/${id}`);
  }

  updateWiki(id: string, history: string, motto: string): Promise<{ ok: boolean }> {
    return this.request(`/api/countries/${id}/wiki`, { method: 'PATCH', body: JSON.stringify({ history, motto }) });
  }

  updateFlag(id: string, layers: FlagLayers): Promise<{ ok: boolean }> {
    return this.request(`/api/countries/${id}/flag`, { method: 'PATCH', body: JSON.stringify(layers) });
  }

  joinCountry(countryId: string): Promise<{ ok: boolean }> {
    return this.request('/api/citizenship', { method: 'POST', body: JSON.stringify({ countryId }) });
  }

  leaveCountry(): Promise<{ ok: boolean }> {
    return this.request('/api/citizenship', { method: 'DELETE' });
  }

  assignWork(buildingId: string): Promise<{ ok: boolean }> {
    return this.request('/api/work', { method: 'POST', body: JSON.stringify({ buildingId }) });
  }

  unassignWork(): Promise<{ ok: boolean }> {
    return this.request('/api/work', { method: 'DELETE' });
  }

  setSalary(amount: number): Promise<{ ok: boolean; salary: number }> {
    return this.request('/api/salary', { method: 'POST', body: JSON.stringify({ amount }) });
  }

  appointMinister(username: string): Promise<{ ok: boolean }> {
    return this.request('/api/ministers', { method: 'POST', body: JSON.stringify({ username }) });
  }

  buildings(): Promise<{ buildings: Building[] }> {
    return this.request('/api/buildings');
  }

  build(type: string, hex: Hex): Promise<{ building: Building }> {
    return this.request('/api/buildings', { method: 'POST', body: JSON.stringify({ type, hex }) });
  }

  market(): Promise<{ cgState: string; blocked: boolean; globalTax: number; quotes: MarketQuote[] }> {
    return this.request('/api/market');
  }

  marketBuy(resource: AnyResource, qty: number): Promise<{ ok: boolean }> {
    return this.request('/api/market/buy', { method: 'POST', body: JSON.stringify({ resource, qty }) });
  }

  marketSell(resource: AnyResource, qty: number): Promise<{ ok: boolean }> {
    return this.request('/api/market/sell', { method: 'POST', body: JSON.stringify({ resource, qty }) });
  }

  blackMarket(): Promise<{ quotes: MarketQuote[] }> {
    return this.request('/api/black-market');
  }

  blackMarketBuy(resource: AnyResource, qty: number): Promise<{ ok: boolean }> {
    return this.request('/api/black-market/buy', { method: 'POST', body: JSON.stringify({ resource, qty }) });
  }

  armies(): Promise<{ armies: Army[] }> {
    return this.request('/api/armies');
  }

  recruit(unitType: UnitType): Promise<{ army: Army }> {
    return this.request('/api/armies', { method: 'POST', body: JSON.stringify({ unitType }) });
  }

  moveArmy(id: string, hex: Hex): Promise<{ ok: boolean }> {
    return this.request(`/api/armies/${id}/move`, { method: 'POST', body: JSON.stringify({ hex }) });
  }

  attack(id: string, hex: Hex): Promise<{ result: string; message: string }> {
    return this.request(`/api/armies/${id}/attack`, { method: 'POST', body: JSON.stringify({ hex }) });
  }

  wars(): Promise<{ wars: War[] }> {
    return this.request('/api/wars');
  }

  declareWar(targetCountryId: string): Promise<{ wars: War[] }> {
    return this.request('/api/wars', { method: 'POST', body: JSON.stringify({ targetCountryId }) });
  }

  settleWar(warId: string, terms: string): Promise<{ ok: boolean }> {
    return this.request(`/api/wars/${warId}/settle`, { method: 'POST', body: JSON.stringify({ terms }) });
  }

  proposeTreaty(targetCountryId: string, kind: TreatyKind): Promise<{ treaty: Treaty }> {
    return this.request('/api/treaties', { method: 'POST', body: JSON.stringify({ targetCountryId, kind }) });
  }

  assembly(): Promise<{
    proposals: (Proposal & { proposerName: string; targetName: string | null })[];
    members: { id: string; name: string; gdp: number; population: number }[];
    globalTax: number;
  }> {
    return this.request('/api/assembly');
  }

  propose(kind: ProposalKind, targetCountryId: string | null, taxPercent: number): Promise<{ proposal: Proposal }> {
    return this.request('/api/assembly/proposals', { method: 'POST', body: JSON.stringify({ kind, targetCountryId, taxPercent }) });
  }

  vote(proposalId: string, vote: 'yes' | 'no' | 'abstain'): Promise<{ ok: boolean }> {
    return this.request(`/api/assembly/proposals/${proposalId}/vote`, { method: 'POST', body: JSON.stringify({ vote }) });
  }

  withdrawAssembly(): Promise<{ ok: boolean }> {
    return this.request('/api/assembly/withdraw', { method: 'POST' });
  }

  joinAssembly(): Promise<{ ok: boolean }> {
    return this.request('/api/assembly/join', { method: 'POST' });
  }

  espionage(): Promise<{ missions: EspionageMission[] }> {
    return this.request('/api/espionage');
  }

  launchMission(targetCountryId: string, kind: MissionKind): Promise<{ mission: EspionageMission }> {
    return this.request('/api/espionage', { method: 'POST', body: JSON.stringify({ targetCountryId, kind }) });
  }

  joinRebellion(countryId: string): Promise<{ ok: boolean }> {
    return this.request('/api/rebellion/join', { method: 'POST', body: JSON.stringify({ countryId }) });
  }

  coup(countryId: string): Promise<{ success: boolean; message: string }> {
    return this.request('/api/rebellion/coup', { method: 'POST', body: JSON.stringify({ countryId }) });
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
