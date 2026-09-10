// ============================================================================
// @dce/client — Modales (autenticación y fundación de naciones) + toasts.
// UI del panel de control geopolítico (GDD §7), construida con DOM simple.
// ============================================================================

import {
  CONSTITUTION_OPTIONS,
  DEFAULT_CONSTITUTION,
  type Constitution,
  type ConstitutionPillar,
  type WorldHex,
} from '@dce/shared';
import { api } from './api';

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
