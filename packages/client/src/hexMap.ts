// ============================================================================
// @dce/client — Renderizado del mapa hexagonal con Pixi.js v8 (WebGL).
//
// Rendimiento (docs/04): 1 Graphics por hexágono (estilo, no geometría),
// culling por viewport, zoom/pan por transformación de GPU, índice O(1).
// Además: marcadores de ejércitos en pantalla (uiContainer) y resaltado
// de hexágonos adyacentes para órdenes de movimiento/ataque.
// ============================================================================

import { Application, Container, Graphics, Point, Text, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';
import {
  BIOME_COLORS,
  BIOME_DEFENSE,
  hexCorners,
  hexKey,
  hexNeighbors,
  hexToPixel,
  pixelToHex,
  type Army,
  type Hex,
  type MapFilter,
  type WorldHex,
  type WorldMap,
} from '@dce/shared';

export interface HexMapOptions {
  onSelect: (hex: WorldHex | null) => void;
  onFilterChange: (filter: MapFilter) => void;
  onArmySelect: (army: Army | null) => void;
}

const BORDER_COLOR = 0x0a1120;
const UNIT_LETTERS: Record<string, string> = { infantry: 'I', tank: 'T', artillery: 'A' };

function parseColor(hexColor: string): number | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hexColor)) return null;
  return parseInt(hexColor.slice(1), 16);
}

interface ArmyMarker {
  container: Container;
  g: Graphics;
  army: Army;
}

export class HexMap {
  private app: Application;
  private worldContainer: Container;
  private uiContainer: Container;
  private hexes = new Map<string, WorldHex>();
  private graphics = new Map<string, Graphics>();
  private colors = new Map<string, number>();
  private selection: Graphics;
  private highlightLayer: Graphics;
  private filter: MapFilter = 'politics';
  private onSelect: HexMapOptions['onSelect'];
  private onArmySelect: HexMapOptions['onArmySelect'];

  private armies = new Map<string, Army>();
  private markers = new Map<string, ArmyMarker>();
  private selectedArmyId: string | null = null;

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
    this.onArmySelect = opts.onArmySelect;
    this.app = new Application();
    this.worldContainer = new Container();
    this.uiContainer = new Container();
    this.selection = new Graphics();
    this.highlightLayer = new Graphics();

    this.app.init({ canvas, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio }).then(() => {
      this.app.stage.addChild(this.worldContainer);
      this.app.stage.addChild(this.uiContainer);
      this.worldContainer.addChild(this.highlightLayer);
      this.uiContainer.addChild(this.selection);
      this.setupInteraction();
      this.app.ticker.add(() => this.renderFrame());
      this.centerWorld();
    });
  }

  // ── Mundo ────────────────────────────────────────────────────────────────

  setWorld(world: WorldMap): void {
    this.hexes.clear();
    this.worldContainer.removeChildren();
    this.graphics.clear();
    this.updateColors(world);
    this.rebuildGraphics(world);
    this.restyleAll();
    this.centerWorld();
  }

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

  // ── Ejércitos ────────────────────────────────────────────────────────────

  setArmies(armies: Army[]): void {
    this.armies.clear();
    for (const a of armies) this.armies.set(a.id, a);
    for (const [, marker] of this.markers) marker.container.destroy();
    this.markers.clear();
    for (const army of armies) {
      const color = this.colors.get(army.countryId) ?? 0x8899aa;
      const container = new Container();
      const g = new Graphics();
      g.circle(0, 0, 9).fill({ color, alpha: 0.95 });
      g.circle(0, 0, 9).stroke({ color: 0xffffff, width: 1.5 });
      if (!army.supply) g.circle(0, 0, 12).stroke({ color: 0xff3333, width: 2 });
      const letter = new Text({
        text: UNIT_LETTERS[army.unitType] ?? '?',
        style: { fontSize: 10, fill: 0xffffff, fontWeight: 'bold' },
      });
      letter.anchor.set(0.5);
      container.addChild(g);
      container.addChild(letter);
      container.eventMode = 'static';
      container.cursor = 'pointer';
      container.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation();
        this.selectArmy(army.id);
      });
      this.uiContainer.addChild(container);
      this.markers.set(army.id, { container, g, army });
    }
    this.updateArmyHighlights();
  }

  selectArmy(armyId: string | null): void {
    this.selectedArmyId = armyId;
    if (armyId) {
      const army = this.armies.get(armyId);
      this.onArmySelect(army ?? null);
    } else {
      this.onArmySelect(null);
    }
    this.updateArmyHighlights();
  }

  getSelectedArmy(): Army | null {
    return this.selectedArmyId ? this.armies.get(this.selectedArmyId) ?? null : null;
  }

  private updateArmyHighlights(): void {
    this.highlightLayer.clear();
    const army = this.getSelectedArmy();
    if (!army) return;
    // Todo en coordenadas del mundo (la capa vive en worldContainer).
    const armyCenter = hexToPixel(army.hex.q, army.hex.r, this.size);
    this.highlightLayer.circle(armyCenter.x, armyCenter.y, 13).stroke({ color: 0xffd54a, width: 2.5, alpha: 0.9 });
    for (const n of hexNeighbors(army.hex)) {
      const hex = this.hexes.get(hexKey(n));
      if (!hex) continue;
      const color = hex.countryId === army.countryId ? 0x22c55e : hex.countryId !== null ? 0xef4444 : 0x9aa6b8;
      const corners = hexCorners(hex.q, hex.r, this.size);
      this.highlightLayer.poly(corners).stroke({ color, width: 2, alpha: 0.95, alignment: 0.5 });
    }
  }

  // ── Interacción ──────────────────────────────────────────────────────────

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
        if (dist < 5 && this.hoveredKey === null) {
          this.select(null);
          this.selectArmy(null);
        }
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
      const local = this.app.stage.toLocal(e.global);
      const newZoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
      const k = newZoom / this.zoom;
      this.pan.x = e.global.x - local.x * k;
      this.pan.y = e.global.y - local.y * k;
      this.zoom = newZoom;
      this.applyCamera();
    });
  }

  private applyCamera(): void {
    this.worldContainer.scale.set(this.zoom);
    this.worldContainer.position.set(this.pan.x, this.pan.y);
  }

  // ── Estilos ──────────────────────────────────────────────────────────────

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
        fill = hex.countryId !== null
          ? this.colors.get(hex.countryId) ?? this.colorFromString(hex.countryId)
          : 0x9aa6b8;
        opacity = hex.countryId ? 0.85 : 0.35;
        break;
      case 'resources':
        fill = hex.resources.length > 0 ? 0xf5c14e : BIOME_COLORS[hex.biome];
        opacity = hex.resources.length > 0 ? 0.95 : 0.22;
        break;
      case 'military':
        fill = BIOME_COLORS[hex.biome];
        opacity = 0.3 + BIOME_DEFENSE[hex.biome] * 0.6;
        break;
    }

    g.poly(corners).fill({ color: fill, alpha: opacity });
    g.poly(corners).stroke({ color: BORDER_COLOR, width: 1.5, alignment: 0.5 });
    if (hex.isCapital) g.poly(corners).stroke({ color: 0xffffff, width: 2.5, alignment: 0 });

    if (this.filter === 'resources' && hex.resources.length > 0) {
      const c = hexToPixel(hex.q, hex.r, this.size);
      g.circle(c.x + 6, c.y - 6, 7).fill({ color: 0x0a1120, alpha: 0.9 });
      g.circle(c.x + 6, c.y - 6, 7).stroke({ color: 0xffffff, width: 1 });
    }

    if (this.hoveredKey === hexKey(hex)) {
      g.poly(corners).stroke({ color: 0xffffff, width: 2, alignment: 0.5 });
    }
  }

  private colorFromString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return (hash & 0xffffff) | 0x222222;
  }

  // ── Frame loop ───────────────────────────────────────────────────────────

  private renderFrame(): void {
    // Culling del terreno.
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
      g.visible = c.x >= left && c.x <= right && c.y >= top && c.y <= bottom;
    }

    // Posicionar marcadores de ejércitos en coordenadas de pantalla.
    for (const [id, marker] of this.markers) {
      const army = this.armies.get(id);
      if (!army) continue;
      const c = hexToPixel(army.hex.q, army.hex.r, this.size);
      const p = this.worldContainer.toGlobal(new Point(c.x, c.y));
      marker.container.position.set(p.x, p.y);
    }
  }

  // ── Selección de hexágonos ───────────────────────────────────────────────

  private selected: WorldHex | null = null;

  private select(hex: WorldHex | null): void {
    this.selected = hex;
    this.updateSelection();
    this.onSelect(hex);
  }

  private updateSelection(): void {
    this.selection.clear();
    if (!this.selected) return;
    const corners = hexCorners(this.selected.q, this.selected.r, this.size);
    this.selection.poly(corners).stroke({ color: 0xffffff, width: 2.5, alignment: 0.5 });
    this.selection.poly(corners).stroke({ color: 0xffd54a, width: 4, alignment: 0.5, alpha: 0.5 });
  }

  get selectedHex(): WorldHex | null {
    return this.selected;
  }
}
