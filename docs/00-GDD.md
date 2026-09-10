# GDD — Simulador Geopolítico de Naciones (DCE Global Country)

> **Versión:** 1.0 (documento canónico) · **Proyecto:** DCE-GLOBAL-COUNTRY · **Estado:** Alpha v0.1

Este archivo es la copia canónica del Game Design Document dentro del repositorio. Todo cambio de diseño debe editarse aquí y en el documento original de Google Docs.

---

## 1. Concepto Core

Un simulador geopolítico masivo de navegador (MMO) en el que los usuarios crean países ficticios en un mapa hexagonal que se expande orgánicamente. Los usuarios pueden fundar naciones, gestionar su economía, declarar guerras, y unirse como ciudadanos con roles específicos (trabajadores, soldados, políticos) en un mundo persistente impulsado por la comunidad.

## 2. El Mapa y el Territorio

El mapa utiliza un sistema de cuadrícula hexagonal (Hex grid) para representar el territorio, recursos y batallas.

- **Generación Procedimental:** Los nuevos países aparecen en los bordes del mapa existente (10-20 hexágonos iniciales), expandiendo el mundo orgánicamente.
- **Biomas y Terreno:** Cada hexágono posee un bioma (llanura, bosque, montaña, desierto, costa) que dicta la disponibilidad de materias primas (Tier 1).
- **Expansión:** El territorio inicial tiene forma irregular. La anexión de nuevos hexágonos requiere recursos, diplomacia o guerra.

## 3. Creación y Personalización de País (La Identidad)

La configuración inicial no es meramente estética; define las bonificaciones y penalizaciones (Buffs/Debuffs) de la nación mediante la "Constitución".

### 3.1. Creador de Banderas y Wiki Nacional

- **Creador de Banderas:** Herramienta interna con capas (fondo, símbolos, colores) para evitar contenido inapropiado y unificar el estilo visual.
- **Página Pública (Wiki Nacional):** Perfil del país con su historia (escrita por la comunidad), tratados, aliados, moneda y PIB.

### 3.2. La Constitución (Pilares Iniciales)

| Pilar | Opción | Efectos (Buffs / Debuffs) |
| --- | --- | --- |
| **Sistema de Gobierno** | Autocracia (Dictadura) | + Órdenes instantáneas. − 20% más riesgo de revolución y mayor cansancio ciudadano. |
| | Democracia | + 15% producción por felicidad, atrae más inmigrantes. − Decisiones requieren votación del Congreso (retraso en acción). |
| **Sistema Económico** | Economía Planificada | + Aumento drástico de producción base y control de precios. − Cero ingresos comerciales, riesgo de hambruna generalizada. |
| | Libre Mercado | + Generación masiva de Crédito Global (CG) vía impuestos. − Ciudadanos ricos pueden financiar golpes de estado. |
| **Doctrina Militar** | Servicio Obligatorio | + Costo de reclutamiento reducido a la mitad. − Producción económica cae un 10%. |
| | Ejército Profesional | + 30% más de daño en combate. − Salarios altos, riesgo de deserción por impago. |
| **Política Migratoria** | Fronteras Abiertas | + Crecimiento rápido de población. − Riesgo de infiltración de espías. |
| | Fronteras Cerradas | + Seguridad absoluta. − Crecimiento económico lento por falta de mano de obra. |

## 4. Sistema Económico y Recursos

Un sistema económico profundo basado en un patrón monetario global fluctuante y monedas locales dependientes del PIB.

### 4.1. Moneda Global (Crédito Global - CG) y Crisis

El CG es la moneda base para el comercio internacional. El valor de la moneda local de un país depende de su producción y sus reservas de CG.

| Estado del CG | Impacto Global | Reacción de los Países |
| --- | --- | --- |
| **Caída (Crisis global)** | Precios se disparan. | Pánico y trueque. Monedas locales pierden valor. Potencias con recursos dominan. |
| **Subida (Deflación)** | Dinero vale mucho, bienes baratos. | Acaparamiento por países ricos en CG. Países deudores quiebran y venden territorio. |
| **Guerra Comercial** | Una potencia acumula el 50% del CG. | La economía se congela. Los países pequeños crean monedas alternativas o atacan para saquear. |

### 4.2. Edificios, Infraestructura y Producción

- **Tier 1 (Materia Prima):** Granjas (Comida), Minas (Hierro/Carbón/Piedra), Pozos (Petróleo).
- **Tier 2 (Materiales Refinados):** Fundiciones (Acero), Refinerías (Combustible).
- **Tier 3 (Manufactura y Guerra):** Fábricas de Armamento, Industria de Bienes de Consumo (Felicidad).
- **Logística:** Carreteras y vías férreas son esenciales para transportar recursos a la capital y mover tropas rápidamente. Cortar rutas logísticas paraliza hexágonos.

## 5. El Sistema de Ciudadanos (Multijugador Real)

Los usuarios reales forman el tejido de la nación, interactuando con la economía y la política.

- **Necesidades Básicas:** Los ciudadanos consumen comida cada "Tick". Si no pueden comprarla (escasez o inflación), su salud baja hasta "morir" (perder progreso) o emigrar.
- **Trabajo y Salario:** Trabajan en minas/fábricas. El fundador (o el mercado) fija sueldos. Pueden emigrar si el sueldo es bajo.
- **Roles:** Obreros/Empresarios, Soldados, Ministros (delegados por el fundador).
- **Revoluciones:** Los ciudadanos descontentos pueden formar partidos rebeldes, comprar armas en el mercado negro e intentar un Golpe de Estado militar para derrocar al fundador.

## 6. Diplomacia, Guerra y Espionaje

La interacción entre países incluye conflictos armados territoriales, diplomacia burocrática y guerra clandestina.

### 6.1. Guerra y Conquista (Hexágono por Hexágono)

- **Líneas de Suministro:** Las tropas necesitan un camino seguro a la capital. Si son rodeadas, pierden suministros y se rinden.
- **Terreno y Defensa:** Atacar montañas/bosques es más costoso y lento que atacar llanuras.
- **Tipos de Unidades:** Infantería (ocupa), Tanques (rompen defensas), Artillería (destruye infraestructura).
- **Tratados de Paz y Estados Títere:** El ganador puede exigir anexión, reservas de CG, cambio de gobierno o convertir al perdedor en un Estado Títere (tributo del 30% de recursos).

### 6.2. Espionaje y Mercado Negro

- **Misiones de Inteligencia:** Espías pueden realizar reconocimiento (revelar tropas), sabotear infraestructura o robar reservas de CG del banco central enemigo.
- **Mercado Negro:** Permite financiar rebeliones en países vecinos de forma anónima (Proxy Wars) o evadir embargos internacionales comprando recursos a contrabandistas a precios inflados.

### 6.3. Alianzas y la Asamblea Global ("ONU")

- **Tratados:** Acuerdos formales (No Agresión, Libre Comercio) aplicados por el servidor.
- **Bloques Geopolíticos:** Facciones tipo OTAN con defensa mutua y economía compartida.
- **Asamblea Global ("ONU"):** Votaciones periódicas para establecer leyes mundiales (embargos, impuestos). El peso del voto depende del PIB/Población.
- **Independencia (Estado Paria):** Un país puede retirarse de la Asamblea. Pierde acceso al mercado global y protección diplomática, pero se libra de leyes y bloqueos, operando únicamente en el Mercado Negro.

## 7. Diseño de Interfaz (UI/UX)

La interfaz emula un panel de control geopolítico moderno y estratégico.

- **Barra Superior (HUD):** Identidad del país/usuario, recursos en tiempo real (CG, Comida, Acero, Petróleo), temporizador del próximo "Tick", felicidad y notificaciones.
- **Pantalla Principal (Mapa Interactivo):** Mapa WebGL con filtros (Política, Recursos, Militar) y menú contextual al hacer clic en hexágonos.
- **Barra Lateral (Navegación):** Acceso al Dashboard (noticias/alertas), Ministerio de Economía (industria, impuestos) y Ministerio de Defensa (ejércitos, frentes).
- **Diplomacia y Asamblea:** Gestión de relaciones bilaterales y participación en la "ONU". Incluye el botón rojo de "Retirarse de la Asamblea" para volverse un Estado Independiente/Paria.

## 8. Stack Tecnológico Recomendado

- **Frontend:** React.js o Vue.js (UI) + Pixi.js o Phaser.io (Renderizado del mapa WebGL).
- **Backend:** Node.js o Go (Golang) para cálculos concurrentes de "Ticks".
- **Base de Datos:** PostgreSQL (Estado persistente) + Redis (Chat, mercado y eventos en tiempo real).

---

*Este documento se complementa con los entregables técnicos del repositorio: [01 — Evaluación de arquitectura](01-evaluacion-arquitectura.md), [02 — Roadmap de sprints](02-roadmap-sprints.md), [03 — Base de datos](03-base-de-datos.md) y [04 — Frontend del mapa](04-frontend-mapa-hexagonal.md).*
