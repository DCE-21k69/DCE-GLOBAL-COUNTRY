// ============================================================================
// @dce/client — Paneles de la barra lateral (v1.0): Dashboard, Mi País,
// Economía, Defensa, Diplomacia y Ciudadanía. Todo contra la API real.
// ============================================================================

import {
  BIOME_LABELS,
  BUILDING_DEFS,
  CG_LABELS,
  CONSTITUTION_OPTIONS,
  RESOURCE_ICONS,
  RESOURCE_LABELS,
  UNIT_DEFS,
  type AnyResource,
  type Army,
  type Constitution,
  type ConstitutionPillar,
  type WorldMap,
} from '@dce/shared';
import { api, type MeResponse, type PublicCountry } from './api';
import { openFlagModal, openWikiModal, openCountryModal, openPeaceModal, toast } from './modals';

export interface PanelContext {
  session: MeResponse | null;
  world: WorldMap | null;
  armies: Army[];
  refreshAll: () => Promise<void>;
  refreshArmies: () => Promise<void>;
}

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
};

function myCountryId(ctx: PanelContext): string | null {
  return ctx.session?.country?.id ?? ctx.session?.citizenship?.countryId ?? null;
}

function ownedHexesOf(ctx: PanelContext, countryId: string) {
  return (ctx.world?.hexes ?? []).filter((h) => h.countryId === countryId);
}

function countryById(ctx: PanelContext, id: string | null) {
  return ctx.world?.countries.find((c) => c.id === id) ?? null;
}

const pill = (k: ConstitutionPillar, c: Constitution) => {
  const opt = CONSTITUTION_OPTIONS[k].find((o) => o.value === c[k]);
  return `<li><b>${opt?.label ?? c[k]}</b></li>`;
};

// ── Panel principal ────────────────────────────────────────────────────────

export async function renderPanel(panelId: string, ctx: PanelContext): Promise<void> {
  const panel = document.getElementById('panel')!;
  panel.innerHTML = `<p class="muted">Cargando…</p>`;
  try {
    switch (panelId) {
      case 'dashboard':
        panel.innerHTML = await dashboardHtml(ctx);
        break;
      case 'country':
        panel.innerHTML = await countryHtml(ctx);
        break;
      case 'economy':
        panel.innerHTML = await economyHtml(ctx);
        break;
      case 'defense':
        panel.innerHTML = await defenseHtml(ctx);
        break;
      case 'diplomacy':
        panel.innerHTML = await diplomacyHtml(ctx);
        break;
      case 'citizenship':
        panel.innerHTML = await citizenshipHtml(ctx);
        break;
      default:
        panel.innerHTML = '';
    }
    wirePanel(panel, panelId, ctx);
  } catch (err) {
    panel.innerHTML = `<p class="muted">Error al cargar el panel: ${err instanceof Error ? err.message : err}</p>`;
  }
}

// ── Dashboard ──────────────────────────────────────────────────────────────

async function dashboardHtml(ctx: PanelContext): Promise<string> {
  const status = await api.status().catch(() => null);
  const news = await api.news().catch(() => []);
  const feed = news
    .slice(0, 15)
    .map((n) => `<li class="news-item"><span class="mono">${new Date(n.at).toLocaleTimeString()}</span> ${n.message}</li>`)
    .join('');
  return `
    <h2>📊 Dashboard</h2>
    <div class="stat-card"><b>Hexágonos en el mundo</b><span>${fmt(ctx.world?.hexCount ?? 0)}</span></div>
    <div class="stat-card"><b>Naciones activas</b><span>${ctx.world?.countries.length ?? 0}</span></div>
    <div class="stat-card"><b>Estado del Crédito Global</b><span>${status ? CG_LABELS[status.cgState] ?? status.cgState : '—'}</span></div>
    <div class="stat-card"><b>Impuesto global (ONU)</b><span>${status?.globalTax ?? 0}%</span></div>
    <div class="stat-card"><b>Clientes conectados</b><span>${status?.wsClients ?? 0}</span></div>
    <h3 class="sub">📰 Noticias del mundo</h3>
    <ul class="news-list">${feed || '<li class="muted">Sin noticias todavía.</li>'}</ul>`;
}

// ── Mi País ────────────────────────────────────────────────────────────────

async function countryHtml(ctx: PanelContext): Promise<string> {
  if (!ctx.session?.user) {
    return `<h2>🏛️ Mi País</h2><p class="muted">Inicia sesión para fundar o unirte a una nación.</p>
      <button class="btn primary" data-act="login">🔑 Iniciar sesión</button>`;
  }
  if (ctx.session.country) {
    const c = ctx.session.country;
    const invRows = Object.entries(c.inventories)
      .map(([k, v]) => `<tr><th>${RESOURCE_ICONS[k as AnyResource] ?? ''} ${RESOURCE_LABELS[k as AnyResource] ?? k}</th><td class="mono">${fmt(v)}</td></tr>`)
      .join('');
    const pillars: ConstitutionPillar[] = ['government', 'economy', 'militaryDoctrine', 'migrationPolicy'];
    const buildings = await api.buildings().catch(() => ({ buildings: [] }));
    const owned = ownedHexesOf(ctx, c.id);
    const citizens = await api.countries().then((r) => r.countries.find((x) => x.id === c.id));
    const bRows = buildings.buildings
      .map((b) => `<tr><th>${BUILDING_DEFS[b.type]!.label}</th><td class="mono">(${b.hex.q},${b.hex.r})</td><td>${b.workers} 👷</td></tr>`)
      .join('') || '<tr><td colspan="3" class="muted">Sin edificios (construye en Economía).</td></tr>';
    return `
      <h2>🏛️ ${c.flagSvg ? `<span class="flag-sm">${c.flagSvg}</span>` : ''} ${c.name}</h2>
      <p class="muted">${citizens?.wiki.motto ? `«${citizens.wiki.motto}» — ` : ''}moneda <b>${c.currencyCode}</b></p>
      <div class="stat-card"><b>Población</b><span>${fmt(c.population)}</span></div>
      <div class="stat-card"><b>Felicidad</b><span>${c.happiness}/100</span></div>
      <div class="stat-card"><b>PIB (último Tick)</b><span>${fmt(c.gdp)} CG</span></div>
      <div class="stat-card"><b>Hexágonos</b><span>${c.hexCount}</span></div>
      <div class="stat-card"><b>Rebelión interna</b><span>${c.rebellionStrength.toFixed(1)}</span></div>
      ${c.isPariah ? '<div class="stat-card"><b>Estatus</b><span style="color:var(--danger)">Paria (fuera de la ONU)</span></div>' : ''}
      ${c.isPuppetOf ? `<div class="stat-card"><b>Estatus</b><span>Títere de ${countryById(ctx, c.isPuppetOf)?.name}</span></div>` : ''}
      <h3 class="sub">Reservas nacionales</h3>
      <table class="res-table">${invRows}</table>
      <h3 class="sub">Constitución vigente</h3>
      <ul class="constitution-list">${pillars.map((p) => pill(p, c.constitution)).join('')}</ul>
      <h3 class="sub">Edificios (${buildings.buildings.length})</h3>
      <table class="res-table">${bRows}</table>
      <h3 class="sub">Gobierno</h3>
      <form id="salary-form" class="row-form">
        <span class="muted">Salario por obrero (CG/Tick):</span>
        <input type="number" name="salary" min="0" max="1000" value="${c.salary}" style="width:80px">
        <button class="btn" type="submit">Fijar</button>
      </form>
      <form id="minister-form" class="row-form">
        <input type="text" name="username" placeholder="usuario a nombrar ministro" required>
        <button class="btn" type="submit">🎖️ Nombrar ministro</button>
      </form>
      <div class="btn-row">
        <button class="btn" data-act="wiki">📖 Editar Wiki Nacional</button>
        <button class="btn" data-act="flag">🚩 Editar bandera</button>
      </div>`;
  }
  if (ctx.session.citizenship) {
    const cit = ctx.session.citizenship;
    const countryId = cit.countryId;
    const pub = await api.country(countryId).then((r) => r.country).catch(() => null);
    const buildings = (await api.buildings().catch(() => ({ buildings: [] }))).buildings;
    const bOptions = buildings
      .map((b) => `<option value="${b.id}">${BUILDING_DEFS[b.type]!.label} (${b.hex.q},${b.hex.r})</option>`)
      .join('');
    return `
      <h2>👷 Ciudadano de ${cit.countryName ?? countryId}</h2>
      <div class="stat-card"><b>Rol</b><span>${cit.role}</span></div>
      <div class="stat-card"><b>Felicidad del país</b><span>${pub?.happiness ?? '—'}/100</span></div>
      <h3 class="sub">Trabajo (bonifica +8% por obrero, máx. +50%)</h3>
      ${buildings.length > 0 ? `
        <form id="work-form" class="row-form">
          <select name="buildingId">${bOptions}</select>
          <button class="btn" type="submit">🛠️ Asignarme</button>
        </form>` : '<p class="muted">Tu país aún no tiene edificios donde trabajar.</p>'}
      <div class="btn-row">
        <button class="btn" data-act="unassign">🚪 Dejar mi puesto</button>
        <button class="btn danger" data-act="leave">🏃 Emigrar</button>
      </div>
      <h3 class="sub">🔥 Rebelión</h3>
      <div class="stat-card"><b>Felicidad del país</b><span>${pub?.happiness ?? '—'}/100</span></div>
      <p class="muted">Con felicidad baja (&lt;30) la rebelión crece sola; tú puedes sumarte y, si es fuerte, intentar un golpe de estado.</p>
      <div class="btn-row">
        <button class="btn" data-act="rebel">🔥 Unirme a la rebelión</button>
        <button class="btn danger" data-act="coup">💥 Intentar golpe de estado</button>
      </div>`;
  }
  return `<h2>🏛️ Mi País</h2>
    <p class="muted">Aún no tienes país. Funda una nación en tierra libre (clic en un hexágono gris del borde) o únete a una existente desde el panel <b>Ciudadanía</b>.</p>`;
}

// ── Economía ───────────────────────────────────────────────────────────────

async function economyHtml(ctx: PanelContext): Promise<string> {
  const market = await api.market().catch(() => null);
  const countryId = myCountryId(ctx);
  const owned = countryId ? ownedHexesOf(ctx, countryId) : [];

  const quotes = market?.quotes ?? [];
  const quoteRows = quotes
    .map((q) => `<tr><th>${RESOURCE_ICONS[q.resource] ?? ''} ${RESOURCE_LABELS[q.resource]}</th>
      <td class="mono">${q.buy}</td><td class="mono">${q.sell}</td></tr>`)
    .join('');

  const resources: AnyResource[] = ['food', 'iron', 'coal', 'stone', 'oil', 'steel', 'fuel', 'arms', 'goods'];

  const buildings = countryId ? (await api.buildings().catch(() => ({ buildings: [] }))).buildings : [];
  const hexOptions = owned
    .map((h) => `<option value="${h.q},${h.r}">(${h.q},${h.r}) ${BIOME_LABELS[h.biome]} ${h.resources.map((r) => RESOURCE_ICONS[r] ?? r).join('')}</option>`)
    .join('');
  const buildingOptions = Object.entries(BUILDING_DEFS)
    .map(([type, def]) => `<option value="${type}">${def.label} (T${def.tier}) — ${Object.entries(def.cost).map(([r, q]) => `${q} ${r}`).join('+')}</option>`)
    .join('');

  return `
    <h2>🏭 Ministerio de Economía</h2>
    <div class="stat-card"><b>Crédito Global</b><span>${market ? CG_LABELS[market.cgState] ?? market.cgState : '—'}</span></div>
    <div class="stat-card"><b>Impuesto global</b><span>${market?.globalTax ?? 0}%</span></div>
    ${market?.blocked ? '<p class="muted" style="color:var(--danger)">⚠️ El mercado global está CONGELADO (guerra comercial). Solo mercado negro.</p>' : ''}
    <h3 class="sub">Mercado global</h3>
    <table class="res-table"><tr><th>Recurso</th><th>Compra</th><th>Venta</th></tr>${quoteRows}</table>
    ${countryId ? `
      <form id="trade-form" class="row-form">
        <select name="resource">${resources.map((r) => `<option value="${r}">${RESOURCE_LABELS[r]}</option>`).join('')}</select>
        <input type="number" name="qty" value="10" min="1" style="width:70px">
        <button class="btn" data-trade="buy" type="button">🛒 Comprar</button>
        <button class="btn" data-trade="sell" type="button">💰 Vender</button>
      </form>
      <h3 class="sub">Mercado negro (contrabando, GDD §6.2)</h3>
      <form id="black-form" class="row-form">
        <select name="resource">${resources.map((r) => `<option value="${r}">${RESOURCE_LABELS[r]}</option>`).join('')}</select>
        <input type="number" name="qty" value="10" min="1" style="width:70px">
        <button class="btn" type="submit">🥷 Comprar (precio inflado)</button>
      </form>
      <h3 class="sub">Construir (GDD §4.2)</h3>
      ${owned.length > 0 ? `
        <form id="build-form" class="col-form">
          <select name="type">${buildingOptions}</select>
          <select name="hex">${hexOptions}</select>
          <button class="btn primary" type="submit">⚒️ Construir</button>
        </form>` : '<p class="muted">No gobiernas territorio donde construir.</p>'}
      <h3 class="sub">Mis edificios (${buildings.length})</h3>
      <table class="res-table">
        ${buildings.map((b) => `<tr><th>${BUILDING_DEFS[b.type]!.label} Nv.${b.level}</th><td class="mono">(${b.hex.q},${b.hex.r})</td><td>${b.workers} 👷</td></tr>`).join('') || '<tr><td class="muted">Ninguno.</td></tr>'}
      </table>` : '<p class="muted">Fundada o únete a un país para comerciar.</p>'}
  `;
}

// ── Defensa ────────────────────────────────────────────────────────────────

async function defenseHtml(ctx: PanelContext): Promise<string> {
  const countryId = myCountryId(ctx);
  const wars = await api.wars().catch(() => ({ wars: [] }));
  const allArmies = ctx.armies;
  const myArmies = countryId ? allArmies.filter((a) => a.countryId === countryId) : [];

  const unitButtons = (Object.values(UNIT_DEFS) as { type: string; label: string; costCg: number }[])
    .map((u) => `<button class="btn" data-recruit="${u.type}">🎖️ ${u.label} (${u.costCg} CG)</button>`)
    .join('');

  const myWarRows = wars.wars
    .filter((w) => w.status === 'active' && (w.aggressorId === countryId || w.defenderId === countryId))
    .map((w) => {
      const against = w.aggressorId === countryId ? w.defenderId : w.aggressorId;
      const name = countryById(ctx, against)?.name ?? against;
      const iAmAggressor = w.aggressorId === countryId;
      return `<tr><th>⚔️ vs ${name}</th><td>capturados: ${w.capturedHexes.length}</td>
        <td>${iAmAggressor ? `<button class="btn btn-sm" data-peace="${w.id}">🕊️ Paz</button>` : ''}</td></tr>`;
    })
    .join('');

  const allRows = allArmies
    .map((a) => {
      const owner = countryById(ctx, a.countryId)?.name ?? '?';
      return `<tr><th>${UNIT_DEFS[a.unitType]?.label ?? a.unitType}</th><td>${a.soldiers}</td><td class="mono">(${a.hex.q},${a.hex.r})</td><td>${owner}</td><td>${a.supply ? '✅' : '🚫 sin suministro'}</td></tr>`;
    })
    .join('');

  return `
    <h2>🪖 Ministerio de Defensa</h2>
    ${countryId ? `
      <h3 class="sub">Reclutar (aparecen en tu capital)</h3>
      <div class="btn-col">${unitButtons}</div>
      <p class="muted">Tip: selecciona un ejército en el mapa (círculos con letra) y haz clic en un hexágono adyacente: <b style="color:var(--ok)">verde</b> = mover, <b style="color:var(--danger)">rojo</b> = atacar. 1 acción por Tick.</p>
      <h3 class="sub">Mis guerras activas</h3>
      <table class="res-table">${myWarRows || '<tr><td class="muted">En paz… por ahora.</td></tr>'}</table>
      <h3 class="sub">Mis ejércitos (${myArmies.length})</h3>
      <table class="res-table">
        ${myArmies.map((a) => `<tr><th>${UNIT_DEFS[a.unitType]?.label}</th><td>${a.soldiers} soldados</td><td class="mono">(${a.hex.q},${a.hex.r})</td><td>${a.supply ? '✅ suministrado' : '🚫 sin suministro'}</td></tr>`).join('') || '<tr><td class="muted">Ninguno. Recluta tropas.</td></tr>'}
      </table>` : '<p class="muted">Fundada o únete a un país para mandar ejércitos.</p>'}
    <h3 class="sub">Todas las fuerzas del mundo (${allArmies.length})</h3>
    <table class="res-table"><tr><th>Unidad</th><th>Soldados</th><th>Posición</th><th>País</th><th>Suministro</th></tr>${allRows}</table>`;
}

// ── Diplomacia ─────────────────────────────────────────────────────────────

async function diplomacyHtml(ctx: PanelContext): Promise<string> {
  const countryId = myCountryId(ctx);
  const [countries, assembly, missions, wars] = await Promise.all([
    api.countries().catch(() => ({ countries: [] as PublicCountry[] })),
    api.assembly().catch(() => null),
    countryId ? api.espionage().catch(() => ({ missions: [] })) : { missions: [] },
    api.wars().catch(() => ({ wars: [] })),
  ]);

  const rows = countries.countries
    .filter((c) => c.id !== countryId)
    .map((c) => `<tr><th>${c.npc ? '🤖' : '👤'} ${c.name} ${c.isPariah ? '🚩' : ''}</th>
      <td class="mono">pop ${fmt(c.population)} · PIB ${fmt(c.gdp)}</td>
      <td><button class="btn btn-sm" data-view-country="${c.id}">📖 Ver</button></td></tr>`)
    .join('');

  const proposals = assembly?.proposals ?? [];
  const propRows = proposals
    .map((p) => {
      const target = p.kind === 'embargo' ? ` contra ${p.targetName}` : ` del ${p.taxPercent}%`;
      return `<div class="stat-card"><b>${p.kind === 'embargo' ? '🚫 Embargo' : '🧾 Impuesto'}${target}</b>
        <span class="muted">por ${p.proposerName} · cierra pronto</span>
        <span class="btn-row"><button class="btn btn-sm" data-vote="${p.id}" data-choice="yes">✅</button>
        <button class="btn btn-sm" data-vote="${p.id}" data-choice="no">❌</button></span></div>`;
    })
    .join('') || '<p class="muted">Sin propuestas abiertas.</p>';

  const memberNames = (assembly?.members ?? []).map((m) => m.name).join(', ');

  const missionRows = missions.missions
    .map((m) => {
      const target = countryById(ctx, m.targetCountryId)?.name ?? '?';
      return `<li class="news-item"><b>${m.kind}</b> → ${target}: ${m.status === 'success' ? '✅' : '❌'} ${m.result ?? ''}</li>`;
    })
    .join('');

  const treatyKinds = [
    { value: 'non_aggression', label: '🕊️ No agresión' },
    { value: 'free_trade', label: '🛒 Libre comercio' },
    { value: 'mutual_defense', label: '🛡️ Defensa mutua' },
  ];

  return `
    <h2>🕊️ Diplomacia y Asamblea Global</h2>
    <h3 class="sub">Naciones del mundo</h3>
    <table class="res-table">${rows}</table>
    ${countryId ? `
      <h3 class="sub">Acciones bilaterales</h3>
      <form id="treaty-form" class="row-form">
        <select name="target">${countries.countries.filter((c) => c.id !== countryId).map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
        <select name="kind">${treatyKinds.map((k) => `<option value="${k.value}">${k.label}</option>`).join('')}</select>
        <button class="btn" type="submit">Firmar tratado</button>
      </form>
      <form id="war-form" class="row-form">
        <select name="target">${countries.countries.filter((c) => c.id !== countryId).map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
        <button class="btn danger" type="submit">⚔️ Declarar la guerra (1000 CG)</button>
      </form>
      <h3 class="sub">🕵️ Espionaje (GDD §6.2)</h3>
      <form id="spy-form" class="row-form">
        <select name="target">${countries.countries.filter((c) => c.id !== countryId).map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
        <select name="kind">
          <option value="recon">🔭 Reconocimiento (300 CG)</option>
          <option value="sabotage">💣 Sabotaje (600 CG)</option>
          <option value="heist">💰 Robo de CG (900 CG)</option>
          <option value="proxy">🔥 Guerra proxy (700 CG)</option>
        </select>
        <button class="btn" type="submit">Enviar misión</button>
      </form>
      <h3 class="sub">Informes de inteligencia</h3>
      <ul class="news-list">${missionRows || '<li class="muted">Sin misiones.</li>'}</ul>
      <h3 class="sub">Mis guerras</h3>
      <ul class="news-list">
        ${wars.wars.filter((w) => w.status === 'active' && (w.aggressorId === countryId || w.defenderId === countryId)).map((w) => {
          const against = w.aggressorId === countryId ? w.defenderId : w.aggressorId;
          return `<li class="news-item">⚔️ vs ${countryById(ctx, against)?.name ?? against} (capturados: ${w.capturedHexes.length}) ${w.aggressorId === countryId ? `<button class="btn btn-sm" data-peace="${w.id}">🕊️ Paz</button>` : ''}</li>`;
        }).join('') || '<li class="muted">En paz.</li>'}
      </ul>` : ''}
    <h3 class="sub">🏛️ Asamblea Global (${assembly?.members.length ?? 0} miembros)</h3>
    <p class="muted">Miembros: ${memberNames || '—'}</p>
    ${propRows}
    ${countryId ? `
      <form id="propose-form" class="col-form">
        <select name="kind">
          <option value="embargo">🚫 Proponer embargo</option>
          <option value="tax">🧾 Proponer impuesto global</option>
        </select>
        <select name="target">${countries.countries.filter((c) => c.id !== countryId).map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
        <input type="number" name="taxPercent" value="5" min="1" max="25" placeholder="% impuesto (1-25)" style="width:140px">
        <button class="btn primary" type="submit">Presentar propuesta</button>
      </form>
      <div class="btn-row">
        <button class="btn danger" data-act="withdraw" ${ctx.session?.country?.isPariah ? 'disabled' : ''}>🔴 Retirarse de la Asamblea (Estado Paria)</button>
        <button class="btn" data-act="join" ${!ctx.session?.country?.isPariah ? 'disabled' : ''}>🏛️ Reincorporarse (2000 CG)</button>
      </div>` : '<p class="muted">Gobierna un país para votar y proponer.</p>'}
  `;
}

// ── Ciudadanía ─────────────────────────────────────────────────────────────

async function citizenshipHtml(ctx: PanelContext): Promise<string> {
  const countries = await api.countries().catch(() => ({ countries: [] as PublicCountry[] }));
  const cit = ctx.session?.citizenship ?? null;

  if (!ctx.session?.user) {
    return `<h2>👥 Ciudadanía</h2><p class="muted">Inicia sesión para unirte a una nación.</p>
      <button class="btn primary" data-act="login">🔑 Iniciar sesión</button>`;
  }
  if (ctx.session?.country) {
    return `<h2>👥 Ciudadanía</h2><p class="muted">Eres fundador de <b>${ctx.session.country.name}</b>: los ciudadanos de otras naciones pueden unirse a ti desde este panel. Comparte tu nombre de país con la comunidad.</p>
      <div class="stat-card"><b>Ciudadanos actuales</b><span>${ctx.session.country.citizens}</span></div>`;
  }

  const rows = countries.countries
    .map((c) => `<tr><th>${c.npc ? '🤖' : '👤'} ${c.name}</th>
      <td class="mono">pop ${fmt(c.population)} · felicidad ${c.happiness}</td>
      <td>${cit?.countryId === c.id ? '<span class="ok-tag">eres ciudadano</span>' : `<button class="btn btn-sm" data-join="${c.id}">Unirme</button>`}</td></tr>`)
    .join('');

  const countryId = cit?.countryId ?? null;
  const pub = countryId ? await api.country(countryId).then((r) => r.country).catch(() => null) : null;
  const buildings = countryId ? (await api.buildings().catch(() => ({ buildings: [] }))).buildings : [];

  return `
    <h2>👥 Ciudadanía (Multijugador real, GDD §5)</h2>
    ${cit ? `
      <div class="stat-card"><b>Soy ciudadano de</b><span>${cit.countryName}</span></div>
      <div class="stat-card"><b>Mi rol</b><span>${cit.role}</span></div>
      <h3 class="sub">Trabajo</h3>
      ${cit.role === 'worker' && buildings.length > 0 ? `
        <form id="work-form" class="row-form">
          <select name="buildingId">${buildings.map((b) => `<option value="${b.id}">${BUILDING_DEFS[b.type]!.label} (${b.hex.q},${b.hex.r})</option>`).join('')}</select>
          <button class="btn" type="submit">🛠️ Asignarme</button>
        </form>` : '<p class="muted">No puedes trabajar (sin edificios o rol distinto a obrero).</p>'}
      <h3 class="sub">🔥 Rebelión contra ${pub ? 'mi país' : 'el gobierno'}</h3>
      <div class="stat-card"><b>Felicidad del país</b><span>${pub?.happiness ?? '—'}/100</span></div>
      <div class="btn-row">
        <button class="btn" data-act="rebel">🔥 Unirme a la rebelión (+2 fuerza)</button>
        <button class="btn danger" data-act="coup">💥 Intentar golpe de estado</button>
      </div>
      <div class="btn-row"><button class="btn danger" data-act="leave">🏃 Emigrar</button></div>` : `
      <p class="muted">Elige una nación donde vivir. Como <b>obrero</b> trabajas en edificios y bonificas la producción; como <b>ministro</b> (si te nombran) gestionas economía y defensa. Los descontentos pueden rebelarse.</p>`}
    <h3 class="sub">Naciones que aceptan ciudadanos</h3>
    <table class="res-table">${rows}</table>`;
}

// ── Eventos de cada panel ──────────────────────────────────────────────────

function wirePanel(panel: HTMLElement, panelId: string, ctx: PanelContext): void {
  const refresh = async () => {
    await ctx.refreshAll();
  };

  panel.querySelectorAll<HTMLElement>('[data-act="login"]').forEach((b) =>
    b.addEventListener('click', () => openAuthModalLocal(ctx)),
  );

  if (panelId === 'country') {
    panel.querySelector('[data-act="wiki"]')?.addEventListener('click', () => {
      if (ctx.session?.country) openWikiModal(ctx.session.country.id, ctx.session.country, () => refresh());
    });
    panel.querySelector('[data-act="flag"]')?.addEventListener('click', () => {
      if (ctx.session?.country) openFlagModal(ctx.session.country.id, () => refresh());
    });
    panel.querySelector<HTMLFormElement>('#salary-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number(new FormData(e.target as HTMLFormElement).get('salary'));
      try {
        await api.setSalary(amount);
        toast('💵 Salario actualizado.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector<HTMLFormElement>('#minister-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = String(new FormData(e.target as HTMLFormElement).get('username'));
      try {
        await api.appointMinister(username);
        toast('🎖️ Ministro nombrado.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector<HTMLFormElement>('#work-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const buildingId = String(new FormData(e.target as HTMLFormElement).get('buildingId'));
      try {
        await api.assignWork(buildingId);
        toast('🛠️ Asignado al edificio.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector('[data-act="unassign"]')?.addEventListener('click', async () => {
      try {
        await api.unassignWork();
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector('[data-act="leave"]')?.addEventListener('click', async () => {
      try {
        await api.leaveCountry();
        toast('🏃 Has emigrado.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector('[data-act="rebel"]')?.addEventListener('click', async () => {
      const countryId = myCountryId(ctx);
      if (!countryId) return;
      try {
        await api.joinRebellion(countryId);
        toast('🔥 Te has unido a la rebelión.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector('[data-act="coup"]')?.addEventListener('click', async () => {
      const countryId = myCountryId(ctx);
      if (!countryId) return;
      try {
        const r = await api.coup(countryId);
        toast(r.message);
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
  }

  if (panelId === 'economy') {
    const trade = panel.querySelector<HTMLFormElement>('#trade-form');
    trade?.querySelectorAll<HTMLButtonElement>('[data-trade]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const data = new FormData(trade);
        const resource = String(data.get('resource')) as AnyResource;
        const qty = Number(data.get('qty'));
        try {
          if (btn.dataset.trade === 'buy') await api.marketBuy(resource, qty);
          else await api.marketSell(resource, qty);
          toast('🛒 Operación completada.');
          await refresh();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Error');
        }
      }),
    );
    panel.querySelector<HTMLFormElement>('#black-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target as HTMLFormElement);
      try {
        await api.blackMarketBuy(String(data.get('resource')) as AnyResource, Number(data.get('qty')));
        toast('🥷 Contrabando completado.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector<HTMLFormElement>('#build-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target as HTMLFormElement);
      const [q, r] = String(data.get('hex')).split(',').map(Number);
      try {
        await api.build(String(data.get('type')), { q: q!, r: r! });
        toast('⚒️ Edificio construido.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
  }

  if (panelId === 'defense') {
    panel.querySelectorAll<HTMLElement>('[data-recruit]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await api.recruit(btn.dataset.recruit as never);
          toast('🎖️ Unidad reclutada en tu capital.');
          await ctx.refreshArmies();
          await refresh();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Error');
        }
      }),
    );
    panel.querySelectorAll<HTMLElement>('[data-peace]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const warId = btn.dataset.peace!;
        openPeaceModal(warId, () => refresh());
      }),
    );
  }

  if (panelId === 'diplomacy') {
    panel.querySelectorAll<HTMLElement>('[data-view-country]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const country = await api.country(btn.dataset.viewCountry!).then((r) => r.country);
        openCountryModal(country, ctx, () => refresh());
      }),
    );
    panel.querySelector<HTMLFormElement>('#treaty-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target as HTMLFormElement);
      try {
        await api.proposeTreaty(String(data.get('target')), String(data.get('kind')) as never);
        toast('🤝 Tratado firmado.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector<HTMLFormElement>('#war-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target as HTMLFormElement);
      try {
        await api.declareWar(String(data.get('target')));
        toast('⚔️ ¡Guerra declarada!');
        await ctx.refreshArmies();
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector<HTMLFormElement>('#spy-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target as HTMLFormElement);
      try {
        const r = await api.launchMission(String(data.get('target')), String(data.get('kind')) as never);
        toast(r.mission.status === 'success' ? `🕵️ ${r.mission.result ?? 'Éxito'}` : '🕵️ La misión fracasó.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelectorAll<HTMLElement>('[data-vote]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await api.vote(btn.dataset.vote!, btn.dataset.choice as never);
          toast('🗳️ Voto emitido.');
          await refresh();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Error');
        }
      }),
    );
    panel.querySelector<HTMLFormElement>('#propose-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(e.target as HTMLFormElement);
      const kind = String(data.get('kind'));
      try {
        await api.propose(
          kind as never,
          kind === 'embargo' ? String(data.get('target')) : null,
          Number(data.get('taxPercent')) || 5,
        );
        toast('🏛️ Propuesta presentada.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector('[data-act="withdraw"]')?.addEventListener('click', async () => {
      try {
        await api.withdrawAssembly();
        toast('🚩 Tu nación es ahora un Estado Paria (independiente).');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector('[data-act="join"]')?.addEventListener('click', async () => {
      try {
        await api.joinAssembly();
        toast('🏛️ Reincorporado a la Asamblea.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelectorAll<HTMLElement>('[data-peace]').forEach((btn) =>
      btn.addEventListener('click', () => openPeaceModal(btn.dataset.peace!, () => refresh())),
    );
  }

  if (panelId === 'citizenship') {
    panel.querySelectorAll<HTMLElement>('[data-join]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await api.joinCountry(btn.dataset.join!);
          toast('👋 ¡Bienvenido a tu nueva nación!');
          await refresh();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Error');
        }
      }),
    );
    panel.querySelector<HTMLFormElement>('#work-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const buildingId = String(new FormData(e.target as HTMLFormElement).get('buildingId'));
      try {
        await api.assignWork(buildingId);
        toast('🛠️ Asignado.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector('[data-act="rebel"]')?.addEventListener('click', async () => {
      const countryId = myCountryId(ctx);
      if (!countryId) return;
      try {
        await api.joinRebellion(countryId);
        toast('🔥 Unido a la rebelión.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector('[data-act="coup"]')?.addEventListener('click', async () => {
      const countryId = myCountryId(ctx);
      if (!countryId) return;
      try {
        const r = await api.coup(countryId);
        toast(r.message);
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
    panel.querySelector('[data-act="leave"]')?.addEventListener('click', async () => {
      try {
        await api.leaveCountry();
        toast('🏃 Has emigrado.');
        await refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Error');
      }
    });
  }
}

// Importación tardía para evitar ciclos con modals.
import { openAuthModal } from './modals';
function openAuthModalLocal(ctx: PanelContext): void {
  openAuthModal(() => ctx.refreshAll());
}
