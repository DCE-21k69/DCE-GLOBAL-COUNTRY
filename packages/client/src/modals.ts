// ============================================================================
// @dce/client — Modales + toasts: autenticación, fundación, banderas, wiki,
// perfil de país y tratados de paz. UI del panel de control (GDD §7).
// ============================================================================

import {
  CONSTITUTION_OPTIONS,
  DEFAULT_CONSTITUTION,
  renderFlagSvg,
  type Constitution,
  type ConstitutionPillar,
  type FlagLayers,
  type WorldHex,
} from '@dce/shared';
import { api, type PublicCountry } from './api';
import type { PanelContext } from './panels';

export function toast(message: string): void {
  const container = document.getElementById('toasts')!;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, 4200);
}

const modalRoot = document.getElementById('modal-root')!;

function openModal(innerHtml: string): { card: HTMLElement; close: () => void } {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-card">${innerHtml}</div>`;
  modalRoot.appendChild(overlay);
  const card = overlay.querySelector('.modal-card') as HTMLElement;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  return { card, close };
}

function field(label: string, html: string): string {
  return `<label class="field"><span>${label}</span>${html}</label>`;
}

// ── Autenticación ──────────────────────────────────────────────────────────

export function openAuthModal(onSuccess: () => void): void {
  const { card, close } = openModal(`
    <div class="modal-title">
      <h2>🔑 Acceso al Panel</h2>
      <button class="modal-close" data-close>×</button>
    </div>
    <div class="seg" id="auth-tabs" style="margin-bottom:14px">
      <button class="seg-btn active" data-tab="login">Entrar</button>
      <button class="seg-btn" data-tab="register">Registrarse</button>
    </div>
    <form id="auth-login" class="form">
      ${field('Usuario', `<input name="username" required minlength="3" maxlength="20" placeholder="tu_usuario">`)}
      ${field('Contraseña', `<input name="password" type="password" required minlength="8" placeholder="••••••••">`)}
      <button class="btn primary" type="submit">Entrar</button>
      <p class="form-error" id="login-error"></p>
    </form>
    <form id="auth-register" class="form hidden">
      ${field('Usuario', `<input name="username" required minlength="3" maxlength="20" placeholder="tu_usuario">`)}
      ${field('Correo', `<input name="email" type="email" required placeholder="tu@correo.com">`)}
      ${field('Contraseña', `<input name="password" type="password" required minlength="8" placeholder="mínimo 8 caracteres">`)}
      <button class="btn primary" type="submit">Crear cuenta</button>
      <p class="form-error" id="register-error"></p>
    </form>
  `);

  card.querySelector('[data-close]')!.addEventListener('click', close);
  const tabs = card.querySelectorAll<HTMLButtonElement>('#auth-tabs .seg-btn');
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      card.querySelectorAll<HTMLFormElement>('.form').forEach((f) => f.classList.add('hidden'));
      card.querySelector<HTMLFormElement>(`#auth-${t.dataset.tab}`)!.classList.remove('hidden');
    }),
  );

  const submit = async (e: SubmitEvent, isRegister: boolean, errorId: string) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const errorEl = card.querySelector<HTMLElement>(`#${errorId}`)!;
    errorEl.textContent = '';
    try {
      const username = String(data.get('username') ?? '');
      const password = String(data.get('password') ?? '');
      if (isRegister) {
        const email = String(data.get('email') ?? '');
        const res = await api.register(username, email, password);
        api.setToken(res.token);
      } else {
        const res = await api.login(username, password);
        api.setToken(res.token);
      }
      close();
      toast(isRegister ? '👤 Cuenta creada. ¡Bienvenido!' : '👤 Sesión iniciada.');
      onSuccess();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Error desconocido.';
    }
  };
  card.querySelector<HTMLFormElement>('#auth-login')!.addEventListener('submit', (e) => submit(e, false, 'login-error'));
  card.querySelector<HTMLFormElement>('#auth-register')!.addEventListener('submit', (e) => submit(e, true, 'register-error'));
}

// ── Fundación de naciones ──────────────────────────────────────────────────

export function openFoundingModal(
  hex: WorldHex,
  onFounded: (country: { id: string; name: string; color: string }) => void,
): void {
  const pillars: ConstitutionPillar[] = ['government', 'economy', 'militaryDoctrine', 'migrationPolicy'];
  const pillarLabels: Record<ConstitutionPillar, string> = {
    government: '🏛️ Sistema de Gobierno',
    economy: '💰 Sistema Económico',
    militaryDoctrine: '⚔️ Doctrina Militar',
    migrationPolicy: '🛂 Política Migratoria',
  };

  const selects = pillars
    .map((p) => {
      const options = CONSTITUTION_OPTIONS[p]
        .map(
          (o) =>
            `<option value="${o.value}" data-pillar="${p}" ${o.value === DEFAULT_CONSTITUTION[p] ? 'selected' : ''}>${o.label}</option>`,
        )
        .join('');
      return field(pillarLabels[p], `<select name="${p}">${options}</select>`);
    })
    .join('');

  const { card, close } = openModal(`
    <div class="modal-title">
      <h2>🏛️ Fundar Nación</h2>
      <button class="modal-close" data-close>×</button>
    </div>
    <p class="muted">Fundando en el hexágono <b class="mono">(${hex.q}, ${hex.r})</b> — reclamarás 10-15 hexágonos de tierra libre en la frontera (GDD §2).</p>
    <form id="found-form" class="form">
      ${field('Nombre de la nación', `<input name="name" required minlength="3" maxlength="32" placeholder="República de...">`)}
      ${field('Color nacional', `<input name="color" type="color" value="#38bdf8">`)}
      ${selects}
      <div class="effects-preview muted" id="effects-preview"></div>
      <button class="btn primary" type="submit">📜 Promulgar Constitución y fundar</button>
      <p class="form-error" id="found-error"></p>
    </form>
  `);

  card.querySelector('[data-close]')!.addEventListener('click', close);

  const preview = card.querySelector<HTMLElement>('#effects-preview')!;
  const updatePreview = () => {
    const constitution = readConstitution(card);
    const rows = pillars.map((p) => {
      const opt = CONSTITUTION_OPTIONS[p].find((o) => o.value === constitution[p])!;
      const buffs = opt.buffs.map((b) => `<li class="buff">+ ${b}</li>`).join('');
      const debuffs = opt.debuffs.map((d) => `<li class="debuff">− ${d}</li>`).join('');
      return `<div class="effect"><b>${pillarLabels[p]}</b><ul>${buffs}${debuffs}</ul></div>`;
    });
    preview.innerHTML = rows.join('');
  };
  card.querySelectorAll('select').forEach((s) => s.addEventListener('change', updatePreview));
  updatePreview();

  card.querySelector<HTMLFormElement>('#found-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const errorEl = card.querySelector<HTMLElement>('#found-error')!;
    errorEl.textContent = '';
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    submitBtn.disabled = true;
    try {
      const res = await api.foundCountry({
        name: String(data.get('name') ?? ''),
        color: String(data.get('color') ?? '#38bdf8'),
        constitution: readConstitution(card),
        hex: { q: hex.q, r: hex.r },
      });
      close();
      toast(`🏛️ ¡${res.country.name} ha sido fundada! (${res.claimedHexCount} hexágonos)`);
      onFounded(res.country);
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'No se pudo fundar la nación.';
      submitBtn.disabled = false;
    }
  });
}

function readConstitution(card: HTMLElement): Constitution {
  const form = card.querySelector<HTMLFormElement>('#found-form')!;
  const data = new FormData(form);
  return {
    government: String(data.get('government')) as Constitution['government'],
    economy: String(data.get('economy')) as Constitution['economy'],
    militaryDoctrine: String(data.get('militaryDoctrine')) as Constitution['militaryDoctrine'],
    migrationPolicy: String(data.get('migrationPolicy')) as Constitution['migrationPolicy'],
  };
}

// ── Bandera (creador de banderas por capas, GDD §3.1) ─────────────────────

export function openFlagModal(countryId: string, onDone: () => void): void {
  const { card, close } = openModal(`
    <div class="modal-title"><h2>🚩 Creador de Banderas</h2><button class="modal-close" data-close>×</button></div>
    <p class="muted">Diseño por capas (fondo, colores, emblema): imposible subir imágenes, estilo unificado (GDD §3.1).</p>
    <div id="flag-preview" style="text-align:center;margin:10px 0"></div>
    <form id="flag-form" class="form">
      <label class="field"><span>Patrón de fondo</span>
        <select name="pattern">
          <option value="solid">Sólido</option>
          <option value="stripes" selected>Franjas verticales</option>
          <option value="cross">Cruz</option>
        </select></label>
      <label class="field"><span>Color principal</span><input name="colorA" type="color" value="#0f2a4a"></label>
      <label class="field"><span>Color secundario</span><input name="colorB" type="color" value="#38bdf8"></label>
      <label class="field"><span>Emblema</span>
        <select name="emblem">
          <option value="none">Sin emblema</option>
          <option value="star" selected>⭐ Estrella</option>
          <option value="moon">🌙 Luna</option>
          <option value="swords">⚔️ Espadas</option>
          <option value="eagle">🦅 Águila</option>
          <option value="anchor">⚓ Ancla</option>
          <option value="wheat">🌾 Espigas</option>
          <option value="sun">☀️ Sol</option>
        </select></label>
      <label class="field"><span>Color del emblema</span><input name="emblemColor" type="color" value="#f5c14e"></label>
      <button class="btn primary" type="submit">Guardar bandera</button>
      <p class="form-error" id="flag-error"></p>
    </form>
  `);
  card.querySelector('[data-close]')!.addEventListener('click', close);

  const preview = card.querySelector<HTMLElement>('#flag-preview')!;
  const readLayers = (): FlagLayers => {
    const data = new FormData(card.querySelector<HTMLFormElement>('#flag-form')!);
    return {
      pattern: String(data.get('pattern')) as FlagLayers['pattern'],
      colorA: String(data.get('colorA')),
      colorB: String(data.get('colorB')),
      emblem: String(data.get('emblem')) as FlagLayers['emblem'],
      emblemColor: String(data.get('emblemColor')),
    };
  };
  const update = () => (preview.innerHTML = renderFlagSvg(readLayers()));
  update();
  card.querySelectorAll('#flag-form select, #flag-form input').forEach((el) => el.addEventListener('input', update));

  card.querySelector<HTMLFormElement>('#flag-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = card.querySelector<HTMLElement>('#flag-error')!;
    error.textContent = '';
    try {
      await api.updateFlag(countryId, readLayers());
      close();
      toast('🚩 Bandera actualizada.');
      onDone();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Error';
    }
  });
}

// ── Wiki Nacional (GDD §3.1) ──────────────────────────────────────────────

export function openWikiModal(countryId: string, country: { name: string }, onDone: () => void): void {
  const { card, close } = openModal(`
    <div class="modal-title"><h2>📖 Wiki Nacional — ${country.name}</h2><button class="modal-close" data-close>×</button></div>
    <p class="muted">Historia escrita por la comunidad de tu nación (visible para todo el mundo).</p>
    <form id="wiki-form" class="form">
      <label class="field"><span>Lema nacional</span><input name="motto" maxlength="120" placeholder="Unidos venceremos"></label>
      <label class="field"><span>Historia</span><textarea name="history" rows="7" maxlength="2000" placeholder="Cuenta la historia de tu nación…"></textarea></label>
      <button class="btn primary" type="submit">Publicar</button>
      <p class="form-error" id="wiki-error"></p>
    </form>
  `);
  card.querySelector('[data-close]')!.addEventListener('click', close);
  card.querySelector<HTMLFormElement>('#wiki-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target as HTMLFormElement);
    const error = card.querySelector<HTMLElement>('#wiki-error')!;
    error.textContent = '';
    try {
      await api.updateWiki(countryId, String(data.get('history') ?? ''), String(data.get('motto') ?? ''));
      close();
      toast('📖 Wiki publicada.');
      onDone();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : 'Error';
    }
  });
}

// ── Perfil público de país (Wiki + acciones) ──────────────────────────────

export function openCountryModal(country: PublicCountry, ctx: PanelContext, onDone: () => void): void {
  const treatyKinds = [
    { value: 'non_aggression', label: '🕊️ No agresión' },
    { value: 'free_trade', label: '🛒 Libre comercio' },
    { value: 'mutual_defense', label: '🛡️ Defensa mutua' },
  ];
  const myId = ctx.session?.country?.id ?? ctx.session?.citizenship?.countryId ?? null;
  const actions = myId && myId !== country.id
    ? `
      <form id="country-actions" class="form">
        <label class="field"><span>Tratado</span>
          <select name="treaty">${treatyKinds.map((k) => `<option value="${k.value}">${k.label}</option>`).join('')}</select></label>
        <label class="field"><span>Espionaje (GDD §6.2)</span>
          <select name="mission">
            <option value="recon">🔭 Reconocimiento (300 CG)</option>
            <option value="sabotage">💣 Sabotaje (600 CG)</option>
            <option value="heist">💰 Robo de CG (900 CG)</option>
            <option value="proxy">🔥 Guerra proxy (700 CG)</option>
          </select></label>
        <div class="btn-row">
          <button class="btn" id="sign-treaty" type="button">🤝 Firmar tratado</button>
          <button class="btn" id="send-mission" type="button">🕵️ Enviar misión</button>
        </div>
        <button class="btn danger" id="declare-war" type="button">⚔️ Declarar la guerra (1000 CG)</button>
        <p class="form-error" id="country-error"></p>
      </form>`
    : '<p class="muted">Gobierna un país para actuar contra esta nación.</p>';

  const treaties = country.treaties.length > 0
    ? `<ul class="news-list">${country.treaties.map((t) => `<li>${treatyKinds.find((k) => k.value === t.kind)?.label ?? t.kind} con ${ctx.world?.countries.find((c) => c.id === t.with)?.name ?? t.with}</li>`).join('')}</ul>`
    : '<p class="muted">Sin tratados.</p>';

  const { card, close } = openModal(`
    <div class="modal-title"><h2>${country.flagSvg ? `<span class="flag-sm">${country.flagSvg}</span>` : ''} ${country.name}</h2><button class="modal-close" data-close>×</button></div>
    <p class="muted">${country.wiki.motto ? `«${country.wiki.motto}» · ` : ''}${country.npc ? 'Nación original del mundo (NPC)' : 'Fundada por un jugador'}${country.isPariah ? ' · 🚩 Estado Paria' : ''}</p>
    <div class="stat-card"><b>Población</b><span>${fmt(country.population)}</span></div>
    <div class="stat-card"><b>PIB</b><span>${fmt(country.gdp)} CG</span></div>
    <div class="stat-card"><b>Moneda local</b><span>${country.currencyCode}</span></div>
    <div class="stat-card"><b>Territorio</b><span>${country.hexCount} hexes</span></div>
    <div class="stat-card"><b>Felicidad</b><span>${country.happiness}/100</span></div>
    <h3 class="sub">📜 Historia (Wiki)</h3>
    <p class="muted">${country.wiki.history ? country.wiki.history.replace(/\n/g, '<br>') : 'Esta nación aún no ha escrito su historia.'}</p>
    <h3 class="sub">🤝 Tratados</h3>
    ${treaties}
    ${actions}
  `);
  card.querySelector('[data-close]')!.addEventListener('click', close);
  const error = () => card.querySelector<HTMLElement>('#country-error')!;

  card.querySelector('#sign-treaty')?.addEventListener('click', async () => {
    const kind = String(new FormData(card.querySelector<HTMLFormElement>('#country-actions')!).get('treaty'));
    try {
      await api.proposeTreaty(country.id, kind as never);
      close();
      toast('🤝 Tratado firmado.');
      onDone();
    } catch (err) {
      error().textContent = err instanceof Error ? err.message : 'Error';
    }
  });
  card.querySelector('#send-mission')?.addEventListener('click', async () => {
    const kind = String(new FormData(card.querySelector<HTMLFormElement>('#country-actions')!).get('mission'));
    try {
      const r = await api.launchMission(country.id, kind as never);
      close();
      toast(r.mission.status === 'success' ? `🕵️ ${r.mission.result ?? 'Éxito'}` : '🕵️ Misión fallida.');
      onDone();
    } catch (err) {
      error().textContent = err instanceof Error ? err.message : 'Error';
    }
  });
  card.querySelector('#declare-war')?.addEventListener('click', async () => {
    try {
      await api.declareWar(country.id);
      close();
      toast('⚔️ ¡Guerra declarada!');
      onDone();
    } catch (err) {
      error().textContent = err instanceof Error ? err.message : 'Error';
    }
  });
}

// ── Tratado de paz (GDD §6.1) ─────────────────────────────────────────────

export function openPeaceModal(warId: string, onDone: () => void): void {
  const terms = [
    { value: 'white_peace', label: '🤝 Paz blanca (sin cambios)', hint: 'Devuelve los hexágonos capturados.' },
    { value: 'annex', label: '🗺️ Anexión', hint: 'Conserva el territorio capturado.' },
    { value: 'indemnity', label: '💰 Indemnización', hint: 'Roba el 25% del CG enemigo.' },
    { value: 'puppet', label: '🎭 Estado títere', hint: 'El perdedor tributa el 30% de su producción.' },
  ];
  const { card, close } = openModal(`
    <div class="modal-title"><h2>🕊️ Tratado de Paz</h2><button class="modal-close" data-close>×</button></div>
    <p class="muted">Elige los términos (la anexión, indemnización y títere solo puede imponerlas el agresor).</p>
    <div class="btn-col" id="peace-terms">
      ${terms.map((t) => `<button class="btn" data-term="${t.value}" title="${t.hint}">${t.label}<br><small class="muted">${t.hint}</small></button>`).join('')}
    </div>
    <p class="form-error" id="peace-error"></p>
  `);
  card.querySelector('[data-close]')!.addEventListener('click', close);
  card.querySelectorAll<HTMLElement>('#peace-terms [data-term]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const error = card.querySelector<HTMLElement>('#peace-error')!;
      error.textContent = '';
      try {
        await api.settleWar(warId, btn.dataset.term!);
        close();
        toast('🕊️ Paz firmada.');
        onDone();
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : 'Error';
      }
    }),
  );
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
}
