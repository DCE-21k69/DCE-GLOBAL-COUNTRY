# 04 — Frontend del Mapa: Cuadrícula Hexagonal Procedimental

> Entregable 4 del prompt técnico. Guía matemática y de rendimiento para generar y renderizar el mapa hexagonal en el navegador. La implementación viva está en `packages/shared/src/hex.ts` (matemáticas, compartidas con el servidor) y `packages/client/src/hexMap.ts` (render Pixi).

## 1. Sistema de coordenadas: axiales (q, r)

Usamos **coordenadas axiales** con orientación *pointy-top* (vértice hacia arriba). Cada hexágono se identifica con un par `(q, r)`; la tercera coordenada cúbica se deriva: `s = -q - r`.

```
                 +r (suroeste ↓)
        (-1, 1)   (0, 1)
      (-1, 0)   (0, 0)   (1, 0)
        (0, -1)   (1, -1)
                 +q (sureste ↘)
```

**Vecinos** (constante `HEX_DIRECTIONS`): `(1,0) (1,-1) (0,-1) (-1,0) (-1,1) (0,1)`.

**Distancia** entre dos hexágonos (coordenadas cúbicas):

```
d = max(|q₁−q₂|, |r₁−r₂|, |s₁−s₂|)
```

## 2. Conversiones axial ↔ píxel

Con `size` = radio del hexágono en píxeles (apotema), orientación pointy-top:

```
x = size · (√3·q + √3/2·r)
y = size · (3/2·r)
```

Píxel → hexágono (necesario para detectar clics): se invierte la fórmula y se **redondea en cúbicas** para corregir el error de muestreo:

```
q_f = (√3/3·x − 1/3·y) / size
r_f = (2/3·y) / size
s_f = −q_f − r_f        → redondear (q_f, r_f, s_f) a enteros
                          corrigiendo la componente de mayor error
                          (cube_round, ~5 líneas de código)
```

El redondeo cúbico es la pieza que hace que el clic **siempre** caiga en el hexágono correcto, incluso en las aristas.

**Vértices del hexágono** (para `Graphics.poly(...)`, flat array `[x0,y0,x1,y1,…]`):

```
para i en 0..5:
  ángulo = 60°·i − 30°          // pointy-top
  vx = cx + size·cos(ángulo)
  vy = cy + size·sin(ángulo)
```

## 3. Generación procedural determinista

Estrategia usada en el Alpha (`packages/shared/src/world.ts`) y alineada con el GDD §2:

1. **Masa continental orgánica:** BFS probabilístico desde el origen: cada celda "coloniza" vecinos con probabilidad p (~0.64). El resultado es un blob irregular con agujeros ocasionales.
2. **Núcleos secundarios (penínsulas):** 4 caminatas aleatorias a distancia 6–8 del centro actúan como semillas de crecimiento adicional → penínsulas y formas no convexas.
3. **Elevación por ruido de valor FBM** (3 octavas, interpolación smoothstep, semilla derivada de la seed del mundo) → biomas por umbrales: desierto < llanura < bosque < montaña. La costa se deduce del grafo (hexágono con vecino inexistente).
4. **Recursos Tier 1** por tabla de pesos por bioma (comida en llanuras, hierro/carbón en montañas, petróleo en desiertos/costas…).
5. **Países demo por Voronoi:** cada capital reclama los hexágonos a distancia ≤ radio; el resto queda como *tierra libre* en la frontera, donde se fundarán naciones (GDD §2).

**Regla de oro: determinismo total.** La generación solo depende de la seed → el servidor es la autoridad y el cliente puede regenerar el mismo mapa offline (fallback), lo que además convierte la generación en 100% testeable en CI.

## 4. Pipeline de render con Pixi.js v8

### 4.1. Estructura de la escena

```
Application (canvas, WebGL2)
└── worldContainer      ← escala = zoom, posición = pan
    └── Graphics × N    ← 1 por hexágono (solo estilo)
└── uiContainer         ← pantalla: selección, overlays
```

### 4.2. Reglas de rendimiento (medibles)

| Técnica | Por qué | Resultado esperado |
| --- | --- | --- |
| **1 Graphics por hexágono** | El objeto guarda solo primitivas de estilo (un poly fill + stroke). Cambiar color = rebuild local, no toca al vecino. | 2 000 hexes en < 5 ms de construcción |
| **Batching nativo de Pixi** | Al no crear texturas por hexágono, todas las primitivas comparten shader y se envían a la GPU en pocos draw calls. | ~1–4 draw calls para todo el mapa |
| **Culling por viewport** | Cada frame se calcula el AABB visible y se pone `g.visible=false` a lo que no se ve. El cálculo es O(1) por hexágono (centro en coordenadas locales). | 60 fps con 10 000+ hexes |
| **Zoom = escala, no re-geometría** | `worldContainer.scale` se aplica en GPU. Solo se regenera geometría al cambiar filtro o estado. | Zoom fluido sin GC pressure |
| **Índice espacial `Map<"q,r", WorldHex>`** | Hover/click → `pixelToHex` + lookup O(1). Sin recorrer arrays. | Input < 1 ms |

### 4.3. Lo que NO se hace (anti-patrones)

- ❌ Un `Graphics` único global que se re-dibuja entero en cada frame → GC pressure y parones.
- ❌ Recalcular vértices en el loop de render (el zoom ya lo hace la GPU).
- ❌ Texturas por hexágono (atlas masivo) → derrota el batching y complica el tinte dinámico.
- ❌ `setTimeout` para el game loop → usar el `Ticker` de Pixi.

### 4.4. Detalle de implementación: bordes "hull"

Para evitar fisuras translúcidas entre hexágonos adyacentes (artefacto clásico del antialias), el borde oscuro se dibuja con `alignment: 0.5` (sobresale medio píxel por cada lado) en **todos** los hexágonos, no solo en los que cambian de color.

## 5. Filtros visuales (GDD §7)

Los filtros son **estilos**, no datos nuevos:

- **Político:** color derivado de `countryId` (hash determinista → color), tierra libre en gris translúcido, capitales con anillo blanco.
- **Recursos:** hexágonos con Tier 1 en ámbar brillante + marcador; sin recursos, bioma atenuado.
- **Militar:** opacidad proporcional al factor de defensa del bioma (`BIOME_DEFENSE`: montaña 1.0, bosque 0.75, llanura 0.2…), que es el mismo dato que usará el motor de combate del Sprint 5.

## 6. Sincronización cliente-servidor del mapa

- **Carga inicial:** `GET /api/world` devuelve el mapa completo (los ≈2 000 hexágonos pesan ~200 KB con gzip).
- **Deltas (Sprint 1+):** WebSocket con patches incrementales: `{hex:(q,r), owner, buildings, army}`. El cliente actualiza **solo ese Graphics** (rebuild O(1)).
- **Interacción:** el cliente envía *intenciones* (clic en "fundar", orden de ataque); el servidor valida contra el estado del motor y responde con el delta autorizado. Nunca se confía en el render local.

## 7. Escalado futuro (mapas de 50k+ hexes)

1. **Chunks estáticos:** agrupar hexágonos en `Graphics` por chunk (32×32) cuando no cambien → 1 primitiva por chunk en vez de 1 por hexágono, culling por chunk.
2. **RenderTexture de fondo:** el terreno "quieto" se pre-renderiza a una textura gigante; solo las capas vivas (frentes, fronteras) son Graphics dinámicos.
3. **LOD por zoom:** a zoom mínimo, los hexágonos se sustituyen por una textura del continente; los detalles vuelven al acercar.
4. **Web Workers** para precomputar el culling/estilo si el mundo supera 100k celdas.

## 8. Referencias

- Amit Patel, *Hexagonal Grids* (redblobgames.com) — la referencia canónica de coordenadas, distancias y redondeo.
- Documentación oficial de Pixi.js v8 (Graphics API, `alignment` en strokes).
