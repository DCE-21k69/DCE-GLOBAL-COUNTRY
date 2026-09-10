// ============================================================================
// @dce/client — Punto de entrada (v1.0-alpha): sesión, mundo, ejércitos,
// eventos en vivo (WS) y orquestación de paneles.
// ============================================================================

import {
  DEFAULT_SEED,
  generateWorld,
  hexDistance,
  hexKey,
  hexNeighbors,
  type Army,
  type MapFilter,
  type WorldHex,
  type WorldMap,
} from '@dce/shared';
import { HexMap } from './hexMap';
import { formatCountdown, formatNumber } from './ui';
import { api, type MeResponse } from './api';
import { connectWs } from './ws';
import { openAuthModal, openFoundingModal, toast } from './modals';
import { renderPanel, type PanelContext } from './panels';

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
let armies: Army[] = [];
let nextTickAt = 0;
let tickSeconds = 600;
let activePanel = 'dashboard';

// ── Carga inicial ──────────────────────────────────────────────────────────
async function loadWorld(): Promise<WorldMap> {
  const seed = new URLSearchParams(window.location.search).get('seed') ?? DEFAULT_SEED;
  try {
    const world = await api.world();
    setConnection(true);
    return world;
  } catch {
    console.warn('[client] API no disponible — mundo local (determinista).');
    setConnection(false);
    return generateWorld(seed);
  }
}

function setConnection(ok: boolean): void {
  connection.textContent = ok ? '● Conectado al servidor' : '● Modo offline (mundo local)';
  connection.className = ok ? 'connected' : 'offline';
}

const world = await loadWorld();
worldData = world;
seedChip.textContent = `seed: ${world.seed}`;

const hexMap = new HexMap(canvas, {
  onSelect: (hex) => handleHexSelect(hex),
  onFilterChange: (filter) => {
    currentFilter = filter;
    updateLegend();
  },
  onArmySelect: (army) => {
    if (army) showArmyInspector(army);
  },
});
hexMap.setWorld(world);

// Ajustar tamaño del canvas.
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
}

function renderAuth(): void {
  if (session?.user) {
    authButton.textContent = `👤 ${session.user.username}`;
    authButton.dataset.mode = 'out';
  } else {
    authButton.textContent = '🔑 Entrar';
    authButton.dataset.mode = 'in';
  }
}

authButton.addEventListener('click', () => {
  if (authButton.dataset.mode === 'in') {
    openAuthModal(async () => {
      await panelCtx.refreshAll();
    });
  } else {
    api.logout();
    session = null;
    renderAuth();
    updateResources();
    void renderActivePanel();
    toast('Sesión cerrada.');
  }
});

// ── Refresco global y de ejércitos ─────────────────────────────────────────
async function refreshArmies(): Promise<void> {
  try {
    const res = await api.armies();
    armies = res.armies;
    hexMap.setArmies(armies);
    setConnection(true);
  } catch {
    setConnection(false);
  }
}

async function refreshWorld(): Promise<void> {
  try {
    worldData = await api.world();
    hexMap.updateWorld(worldData);
    updateLegend();
    setConnection(true);
  } catch {
    setConnection(false);
  }
}

const panelCtx: PanelContext = {
  get session() {
    return session;
  },
  get world() {
    return worldData;
  },
  get armies() {
    return armies;
  },
  refreshAll: async () => {
    await refreshSession();
    await refreshWorld();
    await refreshArmies();
    await renderActivePanel();
  },
  refreshArmies: async () => {
    await refreshArmies();
  },
};

async function renderActivePanel(): Promise<void> {
  await renderPanel(activePanel, panelCtx);
}

function switchPanel(panelId: string): void {
  activePanel = panelId;
  document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.panel === panelId);
  });
  void renderActivePanel();
}

document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel!));
});

// ── WebSocket: noticias y ticks en vivo ────────────────────────────────────
const stopWs = connectWs({
  onCountryCreated: async () => {
    await refreshWorld();
    await refreshSession();
    void renderActivePanel();
  },
  onTick: async ({ nextTickAt: t, tickSeconds: s }) => {
    nextTickAt = t;
    tickSeconds = s;
    await refreshSession();
    await refreshArmies();
    void renderActivePanel();
  },
  onFamine: ({ countryId }) => {
    if (session?.country?.id === countryId) toast('⚠️ ¡Hambruna en tu nación!');
  },
  onNews: async ({ event }) => {
    if (event?.message) {
      toast(event.message);
      void refreshWorld();
      void renderActivePanel();
    }
  },
});

// ── Selección de hexágonos y órdenes militares ─────────────────────────────
const biomeLabels: Record<string, string> = {
  plain: 'Llanura', forest: 'Bosque', mountain: 'Montaña', desert: 'Desierto', coast: 'Costa',
};
const resourceLabels: Record<string, string> = {
  food: 'Comida', iron: 'Hierro', coal: 'Carbón', stone: 'Piedra', oil: 'Petróleo',
};

function handleHexSelect(hex: WorldHex | null): void {
  const selectedArmy = hexMap.getSelectedArmy();
  if (selectedArmy && hex) {
    // Modo orden militar: clic en un hex adyacente al ejército seleccionado.
    if (hexDistance(selectedArmy.hex, hex) !== 1) {
      toast('Selecciona un hexágono adyacente al ejército (resaltado en el mapa).');
      return;
    }
    if (hex.countryId === selectedArmy.countryId) {
      void api.moveArmy(selectedArmy.id, { q: hex.q, r: hex.r })
        .then(async () => {
          toast('🚚 Ejército movido.');
          hexMap.selectArmy(null);
          await refreshArmies();
          await refreshSession();
        })
        .catch((err) => toast(err instanceof Error ? err.message : 'No se pudo mover.'));
    } else if (hex.countryId !== null) {
      void api.attack(selectedArmy.id, { q: hex.q, r: hex.r })
        .then(async (r) => {
          toast(`⚔️ ${r.message}`);
          hexMap.selectArmy(null);
          await refreshArmies();
          await refreshWorld();
          await refreshSession();
        })
        .catch((err) => toast(err instanceof Error ? err.message : 'No se pudo atacar.'));
    } else {
      toast('No puedes moverte a tierra libre: la expansión es por fundación o conquista.');
    }
    return;
  }
  if (!hex) {
    inspector.classList.add('hidden');
    return;
  }
  showHexInspector(hex);
}

function showArmyInspector(army: Army): void {
  const owner = worldData?.countries.find((c) => c.id === army.countryId)?.name ?? '?';
  inspector.innerHTML = `
    <div class="inspector-title">🎖️ Ejército de ${owner}
      <button id="inspector-close" title="Cerrar">×</button>
    </div>
    <table>
      <tr><th>Tipo</th><td>${army.unitType === 'infantry' ? 'Infantería' : army.unitType === 'tank' ? 'Tanques' : 'Artillería'}</td></tr>
      <tr><th>Soldados</th><td>${army.soldiers}</td></tr>
      <tr><th>Posición</th><td class="mono">(${army.hex.q}, ${army.hex.r})</td></tr>
      <tr><th>Suministro</th><td>${army.supply ? '✅ Conectado a la capital' : '🚫 Cortado (desgaste)'}</td></tr>
    </table>
    <div class="inspector-actions">
      <p class="muted">Haz clic en un hexágono adyacente:
      <b style="color:var(--ok)">verde</b> mover · <b style="color:var(--danger)">rojo</b> atacar.</p>
      <button class="btn" id="army-deselect">Cancelar orden</button>
    </div>`;
  inspector.classList.remove('hidden');
  document.getElementById('inspector-close')!.addEventListener('click', () => {
    inspector.classList.add('hidden');
    hexMap.selectArmy(null);
  });
  document.getElementById('army-deselect')!.addEventListener('click', () => {
    inspector.classList.add('hidden');
    hexMap.selectArmy(null);
  });
}

function showHexInspector(hex: WorldHex): void {
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
      <button class="btn" disabled title="Disponible en el panel Economía">⚒️ Construir (panel Economía)</button>
    </div>`;
  inspector.classList.remove('hidden');
  document.getElementById('inspector-close')!.addEventListener('click', () => {
    inspector.classList.add('hidden');
  });
  const fundButton = document.getElementById('fund-btn');
  if (fundButton) {
    fundButton.addEventListener('click', () => {
      if (!session?.user) {
        openAuthModal(async () => {
          await refreshSession();
          showHexInspector(hex);
        });
        return;
      }
      openFoundingModal(hex, async () => {
        await refreshSession();
        await refreshWorld();
        switchPanel('country');
        toast('👑 ¡Nación fundada! Gestiona todo desde los paneles laterales.');
      });
    });
  }
}

function isClaimable(hex: WorldHex): boolean {
  if (!worldData || hex.countryId !== null) return false;
  const byKey = new Map(worldData.hexes.map((h) => [hexKey(h), h]));
  if (hex.isCoast) return true;
  return hexNeighbors(hex).some((n) => {
    const nh = byKey.get(hexKey(n));
    return !nh || nh.countryId === null;
  });
}

// ── Leyenda ────────────────────────────────────────────────────────────────
function updateLegend(): void {
  const legend = document.getElementById('legend')!;
  if (!worldData) return;
  if (currentFilter === 'politics') {
    const chips = worldData.countries
      .slice(0, 10)
      .map((c) => `<span class="legend-item"><i style="background:${c.color}"></i>${c.name}</span>`)
      .join('');
    legend.innerHTML = `${chips}<span class="legend-item"><i class="unclaimed"></i>Tierra libre</span>`;
  } else if (currentFilter === 'resources') {
    legend.innerHTML = `
      <span class="legend-item"><i style="background:#f5c14e"></i>Con recursos</span>
      <span class="legend-item"><i style="background:#2f6b3f"></i>Sin recursos</span>`;
  } else {
    legend.innerHTML = `
      <span class="legend-item"><i style="background:#7d8794"></i>Alta defensa</span>
      <span class="legend-item"><i style="background:#4c8c52"></i>Baja defensa</span>`;
  }
}

// ── HUD ────────────────────────────────────────────────────────────────────
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
    resCg.textContent = '—';
    resFood.textContent = '—';
    resSteel.textContent = '—';
    resOil.textContent = '—';
  }
}

function updateCountdown(): void {
  const remaining = nextTickAt > 0 ? (nextTickAt - Date.now()) / 1000 : tickSeconds;
  resTick.textContent = formatCountdown(remaining);
}

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

// ── Arranque de UI ─────────────────────────────────────────────────────────
updateLegend();
await refreshSession();
await refreshArmies();
await renderActivePanel();
setInterval(updateResources, 1000);

console.info('[client] DCE Global Country v1.0.0-alpha cargado ✓');
window.addEventListener('beforeunload', stopWs);
