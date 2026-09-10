// ============================================================================
// @dce/client — Punto de entrada (Alpha v0.2).
// Flujo: sesión → mundo (API → fallback offline) → Pixi → eventos en vivo (WS).
// ============================================================================

import {
  DEFAULT_SEED,
  CONSTITUTION_OPTIONS,
  generateWorld,
  hexKey,
  hexNeighbors,
  type ConstitutionPillar,
  type MapFilter,
  type WorldHex,
  type WorldMap,
} from '@dce/shared';
import { HexMap } from './hexMap';
import { formatCountdown, formatNumber } from './ui';
import { api, type ApiCountry, type MeResponse } from './api';
import { connectWs } from './ws';
import { openAuthModal, openFoundingModal, toast } from './modals';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const mapPanel = document.getElementById('map-panel')!;
const inspector = document.getElementById('hex-inspector')!;
const connection = document.getElementById('connection')!;
const seedChip = document.getElementById('seed-chip')!;
const authButton = document.getElementById('auth-button')!;

// ── Estado global ──────────────────────────────────────────────────────────
let currentFilter: MapFilter = 'politics';
let worldData: WorldMap | null = null;
let session: MeResponse | null = null;
let nextTickAt = 0;
let tickSeconds = 600;

// ── Carga del mundo: API primero, generación local como fallback ───────────
async function loadWorld(): Promise<WorldMap> {
  const seed = new URLSearchParams(window.location.search).get('seed') ?? DEFAULT_SEED;
  try {
    const world = await api.world();
    setConnection(true);
    return world;
  } catch {
    console.warn('[client] API no disponible — renderizando mundo local (determinista).');
    setConnection(false);
    return generateWorld(seed);
  }
}

function setConnection(ok: boolean): void {
  connection.textContent = ok ? '● Conectado al servidor' : '● Modo offline (mundo local)';
  connection.className = ok ? 'connected' : 'offline';
}

// ── Inicialización ─────────────────────────────────────────────────────────
const world = await loadWorld();
worldData = world;
seedChip.textContent = `seed: ${world.seed}`;

const hexMap = new HexMap(canvas, {
  onSelect: (hex) => showInspector(hex),
  onFilterChange: (filter) => {
    currentFilter = filter;
    updateLegend();
    showInspector(hexMap.selectedHex);
  },
});
hexMap.setWorld(world);

// Ajustar tamaño al contenedor y al resize de la ventana.
const fitCanvas = () => {
  const rect = mapPanel.getBoundingClientRect();
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  hexMap.resize(rect.width * window.devicePixelRatio, rect.height * window.devicePixelRatio);
};
window.addEventListener('resize', fitCanvas);
requestAnimationFrame(() => requestAnimationFrame(fitCanvas));

// ── Toolbar del mapa ───────────────────────────────────────────────────────
document.getElementById('zoom-in')!.addEventListener('click', () => hexMap.zoomBy(1.25));
document.getElementById('zoom-out')!.addEventListener('click', () => hexMap.zoomBy(0.8));
document.getElementById('reset-view')!.addEventListener('click', () => hexMap.centerWorld());

document.querySelectorAll<HTMLButtonElement>('#filter-seg .seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#filter-seg .seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    hexMap.setFilter(btn.dataset.filter as MapFilter);
  });
});

// ── Sesión ─────────────────────────────────────────────────────────────────
async function refreshSession(): Promise<void> {
  session = await api.me();
  renderAuth();
  updateResources();
  renderActivePanel();
}

function renderAuth(): void {
  if (session?.user) {
    authButton.textContent = `👤 ${session.user.username}`;
    authButton.title = 'Cerrar sesión';
    authButton.dataset.mode = 'out';
  } else {
    authButton.textContent = '🔑 Entrar';
    authButton.title = 'Iniciar sesión o crear cuenta';
    authButton.dataset.mode = 'in';
  }
}

authButton.addEventListener('click', async () => {
  if (authButton.dataset.mode === 'in') {
    openAuthModal(refreshSession);
  } else {
    api.logout();
    session = null;
    renderAuth();
    updateResources();
    renderActivePanel();
    toast('Sesión cerrada.');
  }
});

// ── Mundo vivo: refresco + WebSocket ───────────────────────────────────────
async function refreshWorld(): Promise<void> {
  try {
    worldData = await api.world();
    hexMap.updateWorld(worldData);
    updateLegend();
    renderActivePanel();
    setConnection(true);
  } catch {
    setConnection(false);
  }
}

async function refreshMyCountry(): Promise<void> {
  if (!session?.user) return;
  const country = await api.myCountry();
  if (country && session) {
    session = { ...session, country };
    updateResources();
    renderActivePanel();
  }
}

const stopWs = connectWs({
  onCountryCreated: ({ country }) => {
    if (session?.country?.id !== country.id) {
      toast(`🌍 Nueva nación en el mundo: ${country.name}`);
      void refreshWorld();
    }
  },
  onTick: ({ nextTickAt: t, tickSeconds: s }) => {
    nextTickAt = t;
    tickSeconds = s;
    if (session?.country) void refreshMyCountry();
  },
  onFamine: ({ countryId }) => {
    if (session?.country?.id === countryId) toast('⚠️ ¡Hambruna en tu nación! La despensa está vacía.');
  },
});

// ── Inspector de hexágonos (menú contextual del mapa, GDD §7) ──────────────
function isClaimable(hex: WorldHex): boolean {
  if (!worldData || hex.countryId !== null) return false;
  const byKey = new Map(worldData.hexes.map((h) => [hexKey(h), h]));
  if (hex.isCoast) return true;
  return hexNeighbors(hex).some((n) => {
    const nh = byKey.get(hexKey(n));
    return !nh || nh.countryId === null;
  });
}

function showInspector(hex: WorldHex | null): void {
  if (!hex) {
    inspector.classList.add('hidden');
    return;
  }
  const biomeLabels: Record<string, string> = {
    plain: 'Llanura', forest: 'Bosque', mountain: 'Montaña', desert: 'Desierto', coast: 'Costa',
  };
  const resourceLabels: Record<string, string> = {
    food: 'Comida', iron: 'Hierro', coal: 'Carbón', stone: 'Piedra', oil: 'Petróleo',
  };
  const owner = worldData?.countries.find((c) => c.id === hex.countryId) ?? null;
  const rows = [
    ['Coordenada', `(${hex.q}, ${hex.r})`],
    ['Bioma', biomeLabels[hex.biome] ?? hex.biome],
    ['Terreno', hex.isCoast ? 'Costa / frontera' : 'Interior'],
    ['Recursos', hex.resources.map((r) => resourceLabels[r] ?? r).join(', ') || 'Ninguno'],
    ['Propietario', owner ? owner.name : 'Tierra libre (fundable)'],
    ['Capital', hex.isCapital ? '★ Sí' : 'No'],
  ];
  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');

  const claimable = isClaimable(hex);
  let fundBtn: string;
  if (hex.countryId !== null) {
    fundBtn = `<button class="btn" disabled>Territorio ocupado</button>`;
  } else if (!session?.user) {
    fundBtn = `<button class="btn primary" id="fund-btn">🔑 Entra para fundar aquí</button>`;
  } else if (session?.country) {
    fundBtn = `<button class="btn" disabled>Ya fundaste tu nación</button>`;
  } else if (!claimable) {
    fundBtn = `<button class="btn" disabled>No es frontera del mundo</button>`;
  } else {
    fundBtn = `<button class="btn primary" id="fund-btn">🏛️ Fundar nación aquí</button>`;
  }

  inspector.innerHTML = `
    <div class="inspector-title">
      ${hex.isCapital ? '★ ' : ''}Hex ${hex.q},${hex.r}
      <button id="inspector-close" title="Cerrar">×</button>
    </div>
    <table>${table}</table>
    <div class="inspector-actions">
      ${fundBtn}
      <button class="btn" disabled title="Sprint 3">⚒️ Construir</button>
      <button class="btn" disabled title="Sprint 5">⚔️ Atacar</button>
    </div>`;
  inspector.classList.remove('hidden');
  document.getElementById('inspector-close')!.addEventListener('click', () => {
    inspector.classList.add('hidden');
  });
  const fundButton = document.getElementById('fund-btn');
  if (fundButton) {
    fundButton.addEventListener('click', () => {
      if (!session?.user) {
        openAuthModal(() => {
          void refreshSession().then(() => showInspector(hex));
        });
        return;
      }
      openFoundingModal(hex, async (country) => {
        await refreshSession();
        await refreshWorld();
        switchPanel('country');
        toast(`👑 Eres el fundador de ${country.name}.`);
      });
    });
  }
}

// ── Leyenda según filtro ───────────────────────────────────────────────────
function updateLegend(): void {
  const legend = document.getElementById('legend')!;
  if (!worldData) return;
  if (currentFilter === 'politics') {
    const chips = worldData.countries
      .map((c) => `<span class="legend-item"><i style="background:${c.color}"></i>${c.name}</span>`)
      .join('');
    legend.innerHTML = `${chips}<span class="legend-item"><i class="unclaimed"></i>Tierra libre</span>`;
  } else if (currentFilter === 'resources') {
    legend.innerHTML = `
      <span class="legend-item"><i style="background:#f5c14e"></i>Con recursos</span>
      <span class="legend-item"><i style="background:#2f6b3f"></i>Sin recursos</span>`;
  } else {
    legend.innerHTML = `
      <span class="legend-item"><i style="background:#7d8794"></i>Alta defensa (montaña/bosque)</span>
      <span class="legend-item"><i style="background:#4c8c52"></i>Baja defensa (llanura)</span>`;
  }
}

// ── Paneles laterales ──────────────────────────────────────────────────────
let activePanel = 'dashboard';

const pillarLabels: Record<ConstitutionPillar, string> = {
  government: 'Gobierno', economy: 'Economía', militaryDoctrine: 'Doctrina militar', migrationPolicy: 'Migración',
};

function countryPanelHtml(country: ApiCountry): string {
  const inv = country.inventories;
  const resRows = Object.entries(inv)
    .map(([k, v]) => `<tr><th>${k.toUpperCase()}</th><td class="mono">${formatNumber(v)}</td></tr>`)
    .join('');
  const constitutionRows = (Object.keys(pillarLabels) as ConstitutionPillar[])
    .map((p) => {
      const opt = CONSTITUTION_OPTIONS[p].find((o) => o.value === country.constitution[p]);
      return `<li><b>${pillarLabels[p]}:</b> ${opt?.label ?? country.constitution[p]}</li>`;
    })
    .join('');
  return `
    <h2>🏛️ Mi País — <span style="color:${country.color}">${country.name}</span></h2>
    <div class="stat-card"><b>Población</b><span>${formatNumber(country.population)}</span></div>
    <div class="stat-card"><b>Hexágonos</b><span>${country.hexCount}</span></div>
    <div class="stat-card"><b>Fundada</b><span class="mono">${new Date(country.foundedAt).toLocaleDateString()}</span></div>
    <h3 class="sub">Reservas nacionales</h3>
    <table class="res-table">${resRows}</table>
    <h3 class="sub">Constitución vigente</h3>
    <ul class="constitution-list">${constitutionRows}</ul>
    <p class="muted">Los buffs/debuffs se aplican en cada Tick (economía: producción e impuestos ya activos).</p>`;
}

function renderPanel(panelId: string): void {
  const panel = document.getElementById('panel')!;
  if (panelId === 'country') {
    if (!session?.user) {
      panel.innerHTML = `
        <h2>🏛️ Mi País</h2>
        <p class="muted">Inicia sesión para fundar una nación o gestionar la tuya.</p>
        <button class="btn primary" id="panel-login-btn">🔑 Iniciar sesión</button>`;
      panel.querySelector('#panel-login-btn')!.addEventListener('click', () => openAuthModal(refreshSession));
      return;
    }
    if (!session.country) {
      panel.innerHTML = `
        <h2>🏛️ Mi País</h2>
        <p class="muted">Aún no has fundado una nación. Busca <b>tierra libre</b> (gris) en la frontera del mundo, haz clic en un hexágono y pulsa <b>«Fundar nación aquí»</b>.</p>
        <div class="tier">📜 Elige tu <b>Constitución</b>: gobierno, economía, doctrina militar y migración (GDD §3.2).</div>
        <div class="tier">🗺️ Reclama 10-15 hexágonos irregulares en el borde del mundo (GDD §2).</div>`;
      return;
    }
    panel.innerHTML = countryPanelHtml(session.country);
    return;
  }

  const content: Record<string, string> = {
    dashboard: `
      <h2>📊 Dashboard</h2>
      <p class="muted">Noticias y alertas del mundo (Alpha v0.2).</p>
      <div class="stat-card"><b>Hexágonos en el mundo</b><span>${formatNumber(worldData?.hexCount ?? 0)}</span></div>
      <div class="stat-card"><b>Naciones activas</b><span>${worldData?.countries.length ?? 0}</span></div>
      <div class="stat-card"><b>Seed del mundo</b><span class="mono">${worldData?.seed ?? ''}</span></div>
      <div class="stat-card"><b>Estado del Crédito Global</b><span>Estable 🟢</span></div>
      <div class="stat-card"><b>Tick económico</b><span class="mono">cada ${tickSeconds}s</span></div>
      <p class="muted">Las naciones fundadas por jugadores aparecen en el mapa en tiempo real. Siguen en el
      <a href="https://github.com/DCE-21k69/DCE-GLOBAL-COUNTRY/blob/main/docs/02-roadmap-sprints.md" target="_blank">roadmap</a>:
      ciudadanía, mercado global, guerra y Asamblea.</p>`,
    economy: `
      <h2>🏭 Ministerio de Economía</h2>
      <p class="muted">Producción Tier 1 activa: cada Tick, tus hexágonos producen según su bioma y tu Constitución (GDD §4).</p>
      <div class="tier"><b>Tier 1</b> — Granjas, Minas, Pozos de petróleo <span class="ok-tag">activo</span></div>
      <div class="tier"><b>Tier 2</b> — Fundiciones (acero), Refinerías (combustible) <span class="muted-tag">Sprint 3</span></div>
      <div class="tier"><b>Tier 3</b> — Fábricas de armamento, Bienes de consumo <span class="muted-tag">Sprint 3</span></div>
      <div class="tier muted">Logística — Carreteras y vías férreas hasta la capital <span class="muted-tag">Sprint 3</span></div>`,
    defense: `
      <h2>🪖 Ministerio de Defensa</h2>
      <p class="muted">Ejércitos, frentes y líneas de suministro (GDD §6.1).</p>
      <div class="tier"><b>Infantería</b> — ocupa hexágonos</div>
      <div class="tier"><b>Tanques</b> — rompen defensas</div>
      <div class="tier"><b>Artillería</b> — destruye infraestructura</div>
      <p class="muted">Tip: activa el filtro <b>Militar</b> en el mapa para ver la defensa del terreno.</p>`,
    diplomacy: `
      <h2>🕊️ Diplomacia y Asamblea Global</h2>
      <p class="muted">Tratados, bloques geopolíticos y votaciones de la "ONU" (GDD §6.3).</p>
      <div class="stat-card"><b>Miembros de la Asamblea</b><span>${worldData?.countries.length ?? 0}</span></div>
      <div class="stat-card"><b>Estados parias (independientes)</b><span>0</span></div>
      <button class="btn danger" disabled title="Disponible en el Sprint 4">🔴 Retirarse de la Asamblea</button>
      <p class="muted">El peso del voto dependerá del PIB y la población.</p>`,
  };
  panel.innerHTML = content[panelId] ?? '';
}

function renderActivePanel(): void {
  renderPanel(activePanel);
}

function switchPanel(panelId: string): void {
  activePanel = panelId;
  document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.panel === panelId);
  });
  renderPanel(panelId);
}

document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel!));
});

// ── HUD: recursos y temporizador del Tick (GDD §7) ─────────────────────────
const resCg = document.getElementById('res-cg')!;
const resFood = document.getElementById('res-food')!;
const resSteel = document.getElementById('res-steel')!;
const resOil = document.getElementById('res-oil')!;
const resTick = document.getElementById('res-tick')!;

function updateResources(): void {
  if (session?.country) {
    const inv = session.country.inventories;
    resCg.textContent = formatNumber(inv.cg ?? 0);
    resFood.textContent = formatNumber(inv.food ?? 0);
    resSteel.textContent = formatNumber(inv.steel ?? 0);
    resOil.textContent = formatNumber(inv.oil ?? 0);
  } else {
    // Sin país: valores demo (se sustituyen al fundar/iniciar sesión).
    resCg.textContent = formatNumber(1_250_000 + Math.floor(Math.random() * 50_000));
    resFood.textContent = formatNumber(42_000 + Math.floor(Math.random() * 3_000));
    resSteel.textContent = formatNumber(8_400 + Math.floor(Math.random() * 400));
    resOil.textContent = formatNumber(15_700 + Math.floor(Math.random() * 700));
  }
}

function updateCountdown(): void {
  const remaining = nextTickAt > 0 ? (nextTickAt - Date.now()) / 1000 : tickSeconds;
  resTick.textContent = formatCountdown(remaining);
}

// Estado inicial del tick (y re-sondeo periódico como respaldo del WS).
api.status().then((s) => {
  tickSeconds = s.tickSeconds;
  nextTickAt = s.nextTickAt;
  setConnection(true);
}).catch(() => setConnection(false));
setInterval(() => {
  api.status().then((s) => {
    tickSeconds = s.tickSeconds;
    if (nextTickAt === 0) nextTickAt = s.nextTickAt;
  }).catch(() => setConnection(false));
}, 30_000);

setInterval(updateCountdown, 1000);
setInterval(updateResources, 1000);

// ── Arranque de UI ─────────────────────────────────────────────────────────
updateLegend();
renderPanel('dashboard');
await refreshSession();
void refreshWorld();

console.info('[client] DCE Global Country v0.2 cargado ✓');

// Limpieza teórica al recargar (para HMR de Vite).
window.addEventListener('beforeunload', stopWs);
