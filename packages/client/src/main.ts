// ============================================================================
// @dce/client — Punto de entrada del Alpha.
// Flujo: cargar mundo (API → fallback offline) → inicializar Pixi → UI.
// ============================================================================

import { DEFAULT_SEED, generateWorld, type MapFilter, type WorldHex, type WorldMap } from '@dce/shared';
import { HexMap } from './hexMap';
import { formatCountdown, formatNumber } from './ui';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const mapPanel = document.getElementById('map-panel')!;
const inspector = document.getElementById('hex-inspector')!;
const connection = document.getElementById('connection')!;
const seedChip = document.getElementById('seed-chip')!;

// ── Estado ─────────────────────────────────────────────────────────────────
let currentFilter: MapFilter = 'politics';
let countriesById = new Map<string, { name: string; color: string }>();
let worldHexCount = 0;

// ── Carga del mundo: API primero, generación local como fallback ───────────
async function loadWorld(): Promise<WorldMap> {
  const seed = new URLSearchParams(window.location.search).get('seed') ?? DEFAULT_SEED;
  try {
    const res = await fetch(`/api/world?seed=${encodeURIComponent(seed)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const world: WorldMap = await res.json();
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
seedChip.textContent = `seed: ${world.seed}`;
worldHexCount = world.hexCount;
countriesById = new Map(world.countries.map((c) => [c.id, c]));

const hexMap = new HexMap(canvas, {
  onSelect: (hex) => showInspector(hex),
  onFilterChange: (filter) => {
    currentFilter = filter;
    updateLegend(filter);
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

// ── Inspector de hexágonos (menú contextual del mapa, GDD §7) ──────────────
function showInspector(hex: WorldHex | null): void {
  if (!hex) {
    inspector.classList.add('hidden');
    return;
  }
  const biomeLabels: Record<string, string> = {
    plain: 'Llanura',
    forest: 'Bosque',
    mountain: 'Montaña',
    desert: 'Desierto',
    coast: 'Costa',
  };
  const resourceLabels: Record<string, string> = {
    food: 'Comida',
    iron: 'Hierro',
    coal: 'Carbón',
    stone: 'Piedra',
    oil: 'Petróleo',
  };
  const owner = hex.countryId ? countriesById.get(hex.countryId) : null;
  const rows = [
    ['Coordenada', `(${hex.q}, ${hex.r})`],
    ['Bioma', biomeLabels[hex.biome] ?? hex.biome],
    ['Terrero', hex.isCoast ? 'Costa / frontera' : 'Interior'],
    ['Recursos', hex.resources.map((r) => resourceLabels[r] ?? r).join(', ') || 'Ninguno'],
    ['Propietario', owner ? owner.name : 'Tierra libre (fundable)'],
    ['Capital', hex.isCapital ? '★ Sí' : 'No'],
  ];
  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  inspector.innerHTML = `
    <div class="inspector-title">
      ${hex.isCapital ? '★ ' : ''}Hex ${hex.q},${hex.r}
      <button id="inspector-close" title="Cerrar">×</button>
    </div>
    <table>${table}</table>
    <div class="inspector-actions">
      <button class="btn" disabled title="Sprint 2">🏛️ Fundar nación</button>
      <button class="btn" disabled title="Sprint 3">⚒️ Construir</button>
      <button class="btn" disabled title="Sprint 5">⚔️ Atacar</button>
    </div>`;
  inspector.classList.remove('hidden');
  document.getElementById('inspector-close')!.addEventListener('click', () => {
    inspector.classList.add('hidden');
    hexMap.selectedHex; // mantener referencia
  });
}

// ── Leyenda según filtro ───────────────────────────────────────────────────
function updateLegend(filter: MapFilter): void {
  const legend = document.getElementById('legend')!;
  if (filter === 'politics') {
    const chips = world.countries
      .map((c) => `<span class="legend-item"><i style="background:${c.color}"></i>${c.name}</span>`)
      .join('');
    legend.innerHTML = `${chips}<span class="legend-item"><i class="unclaimed"></i>Tierra libre</span>`;
  } else if (filter === 'resources') {
    legend.innerHTML = `
      <span class="legend-item"><i style="background:#f5c14e"></i>Con recursos</span>
      <span class="legend-item"><i style="background:#2f6b3f"></i>Sin recursos</span>`;
  } else {
    legend.innerHTML = `
      <span class="legend-item"><i style="background:#7d8794"></i>Alta defensa (montaña/bosque)</span>
      <span class="legend-item"><i style="background:#4c8c52"></i>Baja defensa (llanura)</span>`;
  }
}
updateLegend('politics');

// ── Paneles laterales (Dashboards con datos en vivo del mapa) ──────────────
function renderPanel(panelId: string): void {
  const panel = document.getElementById('panel')!;
  const content: Record<string, string> = {
    dashboard: `
      <h2>📊 Dashboard</h2>
      <p class="muted">Noticias y alertas del mundo (Alpha).</p>
      <div class="stat-card"><b>Hexágonos en el mundo</b><span>${formatNumber(worldHexCount)}</span></div>
      <div class="stat-card"><b>Naciones activas</b><span>${world.countries.length}</span></div>
      <div class="stat-card"><b>Seed del mundo</b><span class="mono">${world.seed}</span></div>
      <div class="stat-card"><b>Estado del Crédito Global</b><span>Estable 🟢</span></div>
      <p class="muted">Los ticks económicos, ciudadanos y la Asamblea Global llegan en el Sprint 3-4
      (<a href="https://github.com/DCE-21k69/DCE-GLOBAL-COUNTRY/blob/main/docs/02-roadmap-sprints.md" target="_blank">roadmap</a>).</p>`,
    economy: `
      <h2>🏭 Ministerio de Economía</h2>
      <p class="muted">Industria, impuestos y cadena de producción Tier 1 → Tier 3 (GDD §4).</p>
      <div class="tier"><b>Tier 1</b> — Granjas, Minas, Pozos de petróleo</div>
      <div class="tier"><b>Tier 2</b> — Fundiciones (acero), Refinerías (combustible)</div>
      <div class="tier"><b>Tier 3</b> — Fábricas de armamento, Bienes de consumo</div>
      <div class="tier muted">Logística — Carreteras y vías férreas hasta la capital</div>
      <p class="muted">Disponible en el Sprint 3 del roadmap.</p>`,
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
      <div class="stat-card"><b>Miembros de la Asamblea</b><span>${world.countries.length}</span></div>
      <div class="stat-card"><b>Estados parias (independientes)</b><span>0</span></div>
      <button class="btn danger" disabled title="Disponible en el Sprint 4">🔴 Retirarse de la Asamblea</button>
      <p class="muted">El peso del voto dependerá del PIB y la población.</p>`,
  };
  panel.innerHTML = content[panelId] ?? '';
}

document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderPanel(btn.dataset.panel!);
  });
});
renderPanel('dashboard');

// ── HUD: recursos y temporizador del Tick (GDD §7) ─────────────────────────
const resCg = document.getElementById('res-cg')!;
const resFood = document.getElementById('res-food')!;
const resSteel = document.getElementById('res-steel')!;
const resOil = document.getElementById('res-oil')!;
const resTick = document.getElementById('res-tick')!;

const TICK_SECONDS = 60 * 10; // 10 minutos por Tick en el Alpha.

function updateHud(): void {
  // Simulación de recursos demo (serán reales en el Sprint 3 con PostgreSQL).
  const cg = 1_250_000 + Math.floor(Math.random() * 50_000);
  const food = 42_000 + Math.floor(Math.random() * 3_000);
  const steel = 8_400 + Math.floor(Math.random() * 400);
  const oil = 15_700 + Math.floor(Math.random() * 700);
  resCg.textContent = formatNumber(cg);
  resFood.textContent = formatNumber(food);
  resSteel.textContent = formatNumber(steel);
  resOil.textContent = formatNumber(oil);
  const elapsed = (Date.now() / 1000) % TICK_SECONDS;
  resTick.textContent = formatCountdown(TICK_SECONDS - elapsed);
}
updateHud();
setInterval(updateHud, 1000);

console.info('[client] DCE Global Country Alpha cargado ✓');
