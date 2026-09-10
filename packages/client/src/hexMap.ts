// ============================================================================
// @dce/client — Renderizado del mapa hexagonal con Pixi.js v8 (WebGL).
//
// Estrategia de rendimiento (docs/04-frontend-mapa-hexagonal.md):
//  · 1 Graphics por hexágono (estilo, no geometría): batch optimizado.
//  · Solo se dibujan hexágonos dentro del viewport (culling por AABB).
//  · Zoom continuo con escala; el re-estilo completo solo ocurre al
//    cambiar de filtro, no al hacer zoom/pan.
//  · Interacción por índice espacial Map<key, hex> en O(1).
// ============================================================================

import { Application, Graphics, Container, Point, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';
import {
  BIOME_COLORS,
  BIOME_DEFENSE,
  hexCorners,
  hexKey,
  hexToPixel,
  pixelToHex,
  type Hex,
  type MapFilter,
  type WorldHex,
  type WorldMap,
} from '@dce/shared';

export interface HexMapOptions {
  onSelect: (hex: WorldHex | null) => void;
  onFilterChange: (filter: MapFilter) => void;
}

/** Borde "hull" para que los hexágonos compartan arista sin fisuras. */
const BORDER_COLOR = 0x0a1120;

/** '#rrggbb' → 0xrrggbb (para Pixi Graphics). */
function parseColor(hexColor: string): number | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hexColor)) return null;
  return parseInt(hexColor.slice(1), 16);
}

export class HexMap {
  private app: Application;
  private worldContainer: Container;
  private uiContainer: Container;
  private hexes = new Map<string, WorldHex>();
  private graphics = new Map<string, Graphics>();
  /** Colores reales por país (del servidor), en formato Pixi 0xrrggbb. */
  private colors = new Map<string, number>();
  private selection: Graphics;
  private filter: MapFilter = 'politics';
  private onSelect: HexMapOptions['onSelect'];

  /** Parámetros de cámara (pan + zoom). */
  private pan = new Point(0, 0);
  private zoom = 1;
  private readonly minZoom = 0.5;
  private readonly maxZoom = 3;

  private size = 28;
  private hoveredKey: string | null = null;
  private dragging = false;
  private dragStart = new Point();
  private dragPanStart = new Point();

  constructor(canvas: HTMLCanvasElement, private opts: HexMapOptions) {
    this.onSelect = opts.onSelect;
    this.app = new Application();
    this.worldContainer = new Container();
    this.uiContainer = new Container();

    this.selection = new Graphics();

    this.app.init({ canvas, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio }).then(() => {
      this.app.stage.addChild(this.worldContainer);
      this.app.stage.addChild(this.uiContainer);
      this.uiContainer.addChild(this.selection);
      this.setupInteraction();
      this.app.ticker.add(() => this.renderVisible());
      this.centerWorld();
    });
  }

  // ── API pública ──────────────────────────────────────────────────────────

  setWorld(world: WorldMap): void {
    this.hexes.clear();
    this.worldContainer.removeChildren();
    this.graphics.clear();
    this.updateColors(world);
    this.rebuildGraphics(world);
    this.restyleAll();
    this.centerWorld();
  }

  /**
   * Actualiza el mundo sin reiniciar la cámara (eventos en vivo: fundación,
   * conquista…). Reutiliza los Graphics existentes y solo re-estiliza.
   */
  updateWorld(world: WorldMap): void {
    this.hexes.clear();
    for (const h of world.hexes) this.hexes.set(hexKey(h), h);
    this.updateColors(world);
    this.rebuildGraphics(world);
    this.restyleAll();
  }

  private updateColors(world: WorldMap): void {
    this.colors.clear();
    for (const c of world.countries) {
      const color = parseColor(c.color);
      if (color !== null) this.colors.set(c.id, color);
    }
  }

  private rebuildGraphics(world: WorldMap): void {
    // Un Graphics por hexágono: la geometría se regenera solo en cambios
    // de filtro/estado; zoom y pan no tocan estas primitivas.
    for (const hex of world.hexes) {
      if (this.graphics.has(hexKey(hex))) continue;
      const g = new Graphics();
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.on('pointerdown', () => this.select(hex));
      g.on('pointerenter', () => {
        this.hoveredKey = hexKey(hex);
        this.styleHex(g, hex);
      });
      g.on('pointerleave', () => {
        this.hoveredKey = null;
        this.styleHex(g, hex);
      });
      this.graphics.set(hexKey(hex), g);
      this.worldContainer.addChild(g);
    }
  }

  setFilter(filter: MapFilter): void {
    this.filter = filter;
    this.opts.onFilterChange(filter);
    this.restyleAll();
  }

  zoomBy(factor: number): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.applyCamera();
  }

  centerWorld(): void {
    this.pan.set(this.app.screen.width / 2, this.app.screen.height / 2);
    this.zoom = 1;
    this.applyCamera();
  }

  resize(w: number, h: number): void {
    this.app.renderer.resize(w, h);
  }

  // ── Interacción: click, hover, drag-pan, wheel-zoom ─────────────────────

  private setupInteraction(): void {
    const canvas = this.app.canvas;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
      if (e.button === 0 && this.hoveredKey === null) {
        this.dragging = true;
        this.dragStart = e.global.clone();
        this.dragPanStart = this.pan.clone();
      }
    });

    this.app.stage.on('pointerup', (e: FederatedPointerEvent) => {
      if (e.button === 0) {
        const dist = Math.hypot(e.global.x - this.dragStart.x, e.global.y - this.dragStart.y);
        this.dragging = false;
        // Click en el vacío (distancia corta) = deseleccionar.
        if (dist < 5 && this.hoveredKey === null) this.select(null);
      }
    });

    this.app.stage.on('pointermove', (e: FederatedPointerEvent) => {
      if (this.dragging) {
        this.pan.set(
          this.dragPanStart.x + (e.global.x - this.dragStart.x),
          this.dragPanStart.y + (e.global.y - this.dragStart.y),
        );
        this.applyCamera();
      }
    });

    this.app.stage.on('wheel', (e: FederatedWheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      // Zoom anclado al cursor: ajustar el pan para mantener el punto bajo el ratón.
      const local = this.app.stage.toLocal(e.global);
      const newZoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
      const k = newZoom / this.zoom;
      this.pan.x = e.global.x - (local.x) * k;
      this.pan.y = e.global.y - (local.y) * k;
      this.zoom = newZoom;
      this.applyCamera();
    });
  }

  private applyCamera(): void {
    this.worldContainer.scale.set(this.zoom);
    this.worldContainer.position.set(this.pan.x, this.pan.y);
  }

  // ── Estilos por filtro (GDD §7: Política / Recursos / Militar) ───────────

  private restyleAll(): void {
    for (const [key, g] of this.graphics) {
      const hex = this.hexes.get(key);
      if (!hex) continue;
      this.styleHex(g, hex);
    }
    this.updateSelection();
  }

  private styleHex(g: Graphics, hex: WorldHex): void {
    g.clear();
    const corners = hexCorners(hex.q, hex.r, this.size);
    let fill: number;
    let opacity = 0.72;

    switch (this.filter) {
      case 'politics':
        fill =
          hex.countryId !== null
            ? this.colors.get(hex.countryId) ?? this.colorFromString(hex.countryId)
            : 0x9aa6b8;
        opacity = hex.countryId ? 0.85 : 0.35;
        break;
      case 'resources':
        fill = hex.resources.length > 0 ? 0xf5c14e : BIOME_COLORS[hex.biome];
        opacity = hex.resources.length > 0 ? 0.95 : 0.22;
        break;
      case 'military':
        // Verde → rojo según defensa del terreno (GDD §6.1).
        fill = BIOME_COLORS[hex.biome];
        opacity = 0.3 + BIOME_DEFENSE[hex.biome] * 0.6;
        break;
    }

    // Capitales: anillo blanco persistente en todos los filtros.
    g.poly(corners).fill({ color: fill, alpha: opacity });
    // Borde "hull": sobresale 1px por fuera y evita fisuras entre celdas.
    g.poly(corners).stroke({ color: BORDER_COLOR, width: 1.5, alignment: 0.5 });
    if (hex.isCapital) {
      g.poly(corners).stroke({ color: 0xffffff, width: 2.5, alignment: 0 });
    }

    if (this.filter === 'resources') {
      const anchor = this.anchorOf(hex);
      if (hex.resources.length > 0) {
        // Marcador circular: un punto por recurso (máx. 2) alrededor del centro.
        g.circle(anchor.x + 6, anchor.y - 6, 7).fill({ color: 0x0a1120, alpha: 0.9 });
        g.circle(anchor.x + 6, anchor.y - 6, 7).stroke({ color: 0xffffff, width: 1 });
      }
    }

    if (this.hoveredKey === hexKey(hex)) {
      g.poly(corners).stroke({ color: 0xffffff, width: 2, alignment: 0.5 });
    }
  }

  private anchorOf(hex: Hex): { x: number; y: number } {
    // Centro del hexágono en coordenadas locales del contenedor.
    return hexToPixel(hex.q, hex.r, this.size);
  }

  private colorFromString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return (hash & 0xffffff) | 0x222222;
  }

  // ── Render con culling ──────────────────────────────────────────────────

  private renderVisible(): void {
    const local = this.app.stage.toLocal(new Point(0, 0));
    const w = this.app.screen.width / this.zoom;
    const h = this.app.screen.height / this.zoom;
    const left = local.x - this.size * 2;
    const right = local.x + w + this.size * 2;
    const top = local.y - this.size * 2;
    const bottom = local.y + h + this.size * 2;

    for (const [key, g] of this.graphics) {
      const hex = this.hexes.get(key);
      if (!hex) continue;
      const c = hexToPixel(hex.q, hex.r, this.size);
      g.visible =
        c.x >= left && c.x <= right && c.y >= top && c.y <= bottom;
    }
  }

  // ── Selección ───────────────────────────────────────────────────────────

  private select(hex: WorldHex | null): void {
    this.selected = hex;
    this.updateSelection();
    this.onSelect(hex);
  }

  private selected: WorldHex | null = null;

  private updateSelection(): void {
    this.selection.clear();
    if (!this.selected) return;
    const corners = hexCorners(this.selected.q, this.selected.r, this.size);
    this.selection
      .poly(corners)
      .stroke({ color: 0xffffff, width: 2.5, alignment: 0.5 });
    // Halo pulsante sutil.
    this.selection
      .poly(corners)
      .stroke({ color: 0xffd54a, width: 4, alignment: 0.5, alpha: 0.5 });
  }

  get selectedHex(): WorldHex | null {
    return this.selected;
  }

  /** Pixel de pantalla → hexágono (para inspección y futuros clics de menú contextual). */
  hexAtScreen(x: number, y: number): WorldHex | null {
    const local = this.app.stage.toLocal(new Point(x, y));
    const hex = pixelToHex(local.x, local.y, this.size);
    return this.hexes.get(hexKey(hex)) ?? null;
  }
}
