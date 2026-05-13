# SFL Watcher Backend — Contexto del Proyecto

> Archivo de contexto para asistentes de IA. Contiene todo lo necesario para entender, mantener y extender este proyecto sin re-analizar el código fuente completo.
> Última actualización: 2026-05-11

---

## 1. ¿Qué es?

Backend en **Node.js + Express** que monitorea precios de recursos del juego **Sunflower Land (SFL)**. Consulta la API pública de SFL cada 15 minutos, almacena snapshots en **Supabase (PostgreSQL)**, y envía alertas a usuarios via **Telegram Bot** y **NTFY** cuando los precios cruzan umbrales configurables. Genera **gráficos SVG/PNG** del histórico on-the-fly. Corre en **Vercel** como serverless.

---

## 2. Stack

| Componente | Tecnología |
|-------------|-----------|
| Runtime | Node.js >=18 + Express |
| Base de datos | Supabase (PostgreSQL) |
| Hosting | Vercel (serverless) |
| Scheduler externo | cron-job.org (NO Vercel Cron) |
| Bot principal | Telegram Bot API |
| Push notifications | NTFY (ntfy.sh) |
| Charts | SVG renderizado local → PNG con `@resvg/resvg-js` + `fontkit` |
| Font | Inter Variable (`assets/fonts/Inter-Variable.ttf`) |
| Hosting de imágenes | catbox.fyi (para adjuntos NTFY) |
| Blockchain | Alchemy JSON-RPC (Base y Ronin) |
| Tests | `node:test` (built-in) |

---

## 3. Arquitectura General

```
cron-job.org (scheduler externo)
  ├── GET /api/cron/fetch-prices   (cada 15 min)
  ├── GET /api/cron/monitor        (cada 15 min, offset)
  └── GET /api/cron/daily-report   (diario 00:10)
          │
          ▼
  Express API (Vercel serverless)
          │
          ├── Supabase (PostgreSQL)
          ├── Telegram Bot API
          └── NTFY (push)
```

### Flujo de datos (fetch + alertas)

```
cron-job.org
  → GET /api/cron/fetch-prices
    → priceFetcher.fetchPrices()
      → GET sfl.world/api/v1/prices
      → bulk INSERT en price_snapshots
    → chartService.clearChartCache()
    → alertEngine.checkAlerts()
      → carga alertas activas de user_alerts
      → por cada alerta: calcula stats, compara umbral, verifica escalación por pasos
      → si hay breach: Telegram y/o NTFY
      → persiste estado de steps en BD
    → checkExpiringSubscriptions()
      → notifica usuarios con suscripción por expirar (<24h)
```

---

## 4. Estructura del Proyecto

```
src/
├── index.js                  # Entry point Express, monta routers, health check
├── deploy-trigger.txt         # Hack para forzar redeploy en Vercel (tocar timestamp)
├── lib/
│   └── supabase.js            # Cliente Supabase singleton
├── utils/
│   └── logger.js              # Logger mínimo (error/warn/info/debug)
├── routes/
│   ├── prices.js              # GET /api/prices[/:resource[/history]]
│   ├── alerts.js              # CRUD /api/alerts
│   ├── subscribe.js           # POST/DELETE /api/subscribe (FCM legacy)
│   ├── cron.js                # Endpoints para cron-job.org
│   └── telegram.js            # Webhook del bot + todos los comandos (1707 líneas)
└── services/
    ├── priceFetcher.js        # Consulta API SFL, inserta snapshots
    ├── alertEngine.js         # Motor de alertas (605 líneas)
    ├── alertMath.js           # Lógica pura de escalación de pasos
    ├── chartService.js        # Renderizado SVG/PNG con caché LRU (620 líneas)
    ├── telegramService.js     # Envío de mensajes/fotos a Telegram
    ├── ntfyService.js         # Push notifications via ntfy.sh + catbox.fyi
    ├── formatters.js          # i18n (es/en), formato de mensajes y números
    ├── commandParser.js       # Parsea comandos de Telegram a objetos
    ├── cronMonitor.js         # Analiza ventanas de snapshots, detecta gaps
    ├── subscriptionService.js # Suscripciones, wallets, pagos, preferencias (518 líneas)
    ├── paymentVerifier.js     # Verifica pagos FLOWER on-chain (Alchemy)
    ├── priceStats.js          # Estadísticas puras desde snapshots
    ├── resourceCatalog.js     # Extrae recursos únicos de snapshots
    ├── requestSecurity.js     # Comparación de secrets en tiempo constante
    └── runtimeStatsService.js # Throttling, cooldown promos, errores en memoria

test/
├── alert-math.test.js
├── command-parser.test.js
├── cron-monitor.test.js
├── price-stats.test.js
└── request-security.test.js

supabase/                      # Migraciones SQL (10 archivos)
sql/
└── setup.sql                  # Setup completo DB (índices + función RPC)
docs/
└── CRON_JOB_ORG_SETUP.md      # Guía de configuración del scheduler
```

---

## 5. Base de Datos — Supabase

### Tablas principales

| Tabla | Propósito |
|-------|-----------|
| `price_snapshots` | Snapshots de precios (resource, price NUMERIC(30,20), created_at) |
| `user_alerts` | Alertas configuradas por usuario, con step tracking |
| `user_subscriptions` | Suscripciones, idioma, preferencias NTFY, critical_alerts_enabled |
| `user_wallets` | Wallets Ethereum conectadas |
| `user_payments` | Pagos verificados on-chain |
| `critical_alert_states` | Estado de escalación de alertas críticas (persistido entre reinicios) |

### Función clave

**`get_price_stats(resource_name TEXT, days_limit INTEGER)`** — creada en `sql/setup.sql`. Calcula current_price, avg_price, min_price, max_price, percent_vs_avg y snapshot_count en una sola query. Concede permisos a `service_role`.

### Migraciones (`supabase/*.sql`)

Aplicar en orden: `alerts_table.sql` → `wallet_tables.sql` → `subscription_tables.sql` → `ntfy_settings.sql` → `critical_alerts_toggle.sql` → `critical_alert_state.sql` → `alert_steps_migration.sql` → `add_notify_expiry.sql` → `fix_alert_type_constraint.sql` → `fix_price_column.sql` → `feedback_table.sql`.

---

## 6. API Endpoints

| Método | Endpoint | Propósito |
|--------|----------|-----------|
| GET | `/health` | Health check |
| GET | `/api/prices` | Todos los recursos con stats |
| GET | `/api/prices/:resource` | Stats de un recurso |
| GET | `/api/prices/:resource/history?days=30` | Histórico |
| POST | `/api/telegram/webhook` | Webhook del bot Telegram |
| POST | `/api/telegram/test` | Enviar test al owner |
| POST | `/api/telegram/setwebhook` | Configurar webhook |
| GET | `/api/cron/fetch-prices` | Fetch + alertas + expiry (usa GET x compatibilidad cron-job.org) |
| GET | `/api/cron/monitor` | Salud del cron |
| GET | `/api/cron/daily-report` | Reporte diario al owner |
| POST | `/api/alerts` | Crear/actualizar alerta |
| GET | `/api/alerts?user_id=X` | Listar alertas |
| DELETE | `/api/alerts/:id` | Desactivar alerta |
| POST | `/api/subscribe` | Guardar token FCM (legacy) |
| DELETE | `/api/subscribe` | Eliminar token FCM (legacy) |

---

## 7. Bot de Telegram — Comandos

| Comando | Descripción |
|---------|-------------|
| `/start` | Bienvenida |
| `/help` | Ayuda |
| `/price <resource>` | Precio de un recurso |
| `/priceall` | Todos los precios |
| `/graph <resource>` | Gráfico del recurso |
| `/list` | Recursos disponibles |
| `/alerts` | Listar alertas activas |
| `/alert <res> <high%> <low%>` | Crear alerta porcentual |
| `/alertall <high%> <low%> [keep]` | Alertas para todos los recursos |
| `/pricealert <res> <above/below> <price>` | Alerta por precio absoluto |
| `/targetalert` | Alias de pricealert |
| `/criticalalerts on/off` | Alertas críticas globales |
| `/critical` | Alias de criticalalerts |
| `/removealert <res>` | Eliminar alerta de un recurso |
| `/removeallalerts` | Eliminar todas las alertas |
| `/setall <high%> <low%>` | Alias de alertall |
| `/ntfy` | Configurar NTFY |
| `/ntfytest` | Probar NTFY |
| `/ntfygraph on/off` | Activar/desactivar gráficos en NTFY |
| `/ntfystatus` | Ver estado de NTFY |
| Comandos en grupos | `/price`, `/priceall`, `/graph`, `/list`, `/help`, `/language` — restringidos a `ALLOWED_GROUP_ID` |
| `/feedback` | Enviar bug, sugerencia o idea (flow multistep) |
| `/feedbackanalysis` (solo admin) | Analiza todos los logs con IA (Gemini) y devuelve resumen |

**Comandos ocultos** (desactivados por `BETA_FREE_MODE=true`):
`/connectwallet`, `/wallet`, `/subscribe`, `/status`, `/pay`

---

## 8. Variables de Entorno (`.env`)

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SFL_API_URL=https://sfl.world/api/v1
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
INTERNAL_API_SECRET=
NTFY_BASE_URL=https://ntfy.sh
BETA_FREE_MODE=true
OWNER_TELEGRAM_ID=
BETTERSTACK_TOKEN=         # Opcional, runtime logging
OPENROUTER_API_KEY=        # Análisis de feedback con IA
OPENROUTER_MODEL=openrouter/free  # Modelo (default: router automático)
ALLOWED_GROUP_ID=        # Chat ID del grupo permitido para comandos grupales (dejar vacío para permitir todos)
PORT=3000                  # Opcional
```

---

## 9. Sistema de Alertas (Detalle)

### Tipos de alerta
1. **dual/percent** — Se dispara cuando el precio se desvía ±X% del promedio de 90 días.
2. **price_above / price_below** — Se dispara cuando el precio cruza un valor absoluto fijado por el usuario.
3. **critical** — Alertas sistémicas: se envían a TODOS los usuarios con `critical_alerts_enabled=true` cuando un recurso supera ±50% de desviación.

### Escalación por pasos
- Alerta normal: cada +20 puntos porcentuales más allá del umbral → nuevo aviso.
- Alerta crítica: escala desde 50% en pasos de 20 puntos.
- Reset: cuando el precio vuelve a 0% de desviación (percent) o cruza de vuelta el target (price).
- El estado de cada paso se persiste en BD (`last_notified_rise_step`, `last_notified_fall_step`, `last_notified_target_step` en `user_alerts`, y `critical_alert_states` para críticas).
- Además hay un throttle en memoria de 24h por alerta+step vía `runtimeStatsService`.

### Flujo
1. `fetchPrices()` termina → `checkAlerts()` se ejecuta.
2. Agrupa alertas activas por recurso.
3. Calcula stats de cada recurso vía `get_price_stats()` (RPC).
4. Para cada alerta: compara precio actual vs umbral, determina step, chequea si ya se notificó ese step.
5. Si es breach: envía Telegram (con chart opcional) y NTFY.

---

## 10. Gráficos (Chart Service)

- Se renderizan como SVG en memoria y se rasterizan a PNG con `@resvg/resvg-js`.
- Vista de 90 días con timestamps reales en eje X.
- Agregación horaria automática si hay >~336 puntos (~2 semanas de datos horarios).
- **Season bands**: franjas de colores de fondo para primavera/verano/otoño/invierno.
- **Marcadores semanales**: líneas verticales azules punteadas.
- Texto renderizado glyph-level con `fontkit` usando Inter Variable.
- **Caché LRU** en memoria: 120 entries, TTL 6h. Se invalida completamente tras cada `fetchPrices()`.
- **En Vercel**: el caché se pierde en cold starts.

---

## 11. NTFY

- Cada usuario tiene un topic `sfl-{telegramUserId}`.
- Mensajes en texto plano (sin HTML).
- Para adjuntar imágenes: se suben a catbox.fyi (expiran en 12h) y se envía header `Attach`.
- Costo: el usuario se suscribe al topic en su app NTFY.

---

## 12. Pagos / Suscripciones

- `BETA_FREE_MODE=true` desactiva todo el gating de suscripciones en producción.
- Si se desactiva: nuevos usuarios tienen 7 días de trial, luego deben pagar.
- Pago on-chain en token **FLOWER** (contratos en Base y Ronin).
- Verificación via Alchemy JSON-RPC (sin ethers.js).
- Costo: `getSubscriptionCost()` calcula FLOWER necesarios según precio actual del exchange de SFL.

---

## 13. Seguridad

- Webhook de Telegram validado con `x-telegram-bot-api-secret-token`.
- Endpoints admin protegidos con `x-internal-api-secret`.
- `requestSecurity.js` usa `crypto.timingSafeEqual` para comparación en tiempo constante.
- RLS en tablas de Supabase para aislamiento por usuario.

---

## 14. Sistema de Feedback

- Los usuarios envían feedback via comando `/feedback` (multistep con `pending_action`).
- El bot detecta automáticamente la categoría (`bug`, `suggestion`, `other`) según keywords.
- Se almacena en tabla `user_feedback` en Supabase (id, user_id, message, category, created_at).
- El admin puede descargar todos los logs con `/feedbacklog` (solo OWNER_TELEGRAM_ID).
- El admin puede limpiar los logs con `/feedbacklogclean` (solo OWNER_TELEGRAM_ID).
- El admin puede analizar todos los logs con IA (Gemini 2.0 Flash) via `/feedbackanalysis` (solo OWNER_TELEGRAM_ID).

---

## 15. CODE_REVIEW.md — Hallazgos

Archivo `CODE_REVIEW.md` contiene review de terceros (Kahel). Los hallazgos más importantes:

**Críticos (4):**
1. ~~`now` undefined en `subscriptionService.js`~~ → Corregido
2. ~~Import path incorrecto en `cron.js`~~ → Corregido
3. `console.log` en producción (verificar si persisten)
4. Llamadas a Telegram fire-and-forget sin manejo de errores

**Warnings destacados (14 total):**
- N+1 query en `getAllPrices()` (carga stats recurso por recurso en vez de batch)
- `process.exit()` agresivo en `supabase.js` (mata el proceso si falta config)
- `require()` dinámico dentro de funciones (anti-patrón)
- Imports no utilizados

---

## 16. Cosas Críticas a Saber

1. **El scheduler NO es Vercel Cron.** Usa cron-job.org externo. El workflow de GitHub (`cron.yml`) solo sirve para disparo manual.
2. **`/api/cron/fetch-prices` es GET**, no POST (compatibilidad con cron-job.org).
3. **BETA_FREE_MODE=true** en producción — toda la lógica de pagos existe pero está desactivada.
4. **Caché de charts en memoria volátil** — se pierde en cold starts de Vercel.
5. **catbox.fyi** host de imágenes para NTFY — las URLs expiran en 12h.
6. **Firebase/FCM está legacy** — el bot ya no usa FCM para la experiencia principal, pero el endpoint `/api/subscribe` y tablas persisten.
7. **`src/deploy-trigger.txt`** — no es código. Existe solo para hacer git commit y forzar redeploy en Vercel.
8. **Tests mínimos** — solo 5 tests unitarios con `node:test`, sin tests de integración. Comando: `npm test`.
9. **Node.js >=18** requerido (usa `node:test`, `crypto.timingSafeEqual`, etc.).
10. **Font Inter** incluido en `assets/fonts/Inter-Variable.ttf` — necesario para renderizado de charts.

---

## 17. Bitácora de Cambios

*Formato: YYYY-MM-DD — Descripción del cambio (motivo / contexto)*

### 2026-05-11
- **Comando `/feedbackanalysis`** — Se añadió análisis de logs con IA (OpenRouter, modelo `openrouter/free`) para admin. Usa `OPENROUTER_API_KEY` y `OPENROUTER_MODEL`. Si la respuesta excede 4096 chars se envía como archivo .txt.
- **Grupos de Telegram** — Se añadió soporte para que el bot responda en grupos. Variable `ALLOWED_GROUP_ID` restringe a un grupo específico. Comandos disponibles en grupos: `/price`, `/priceall`, `/graph`, `/list`, `/help`, `/language`. Comando temporal `/detectgroup` para que el admin obtenga el chat ID del grupo.
- **Nuevo sistema de feedback** — Se añadió comando `/feedback` para que usuarios envíen bugs, sugerencias o ideas (flow multistep con detección automática de categoría). Se creó tabla `user_feedback` en Supabase (migración `feedback_table.sql`). Comandos admin: `/feedbacklog` (descarga logs) y `/feedbacklogclean` (limpia logs). Solo accesibles para OWNER_TELEGRAM_ID.
- **Modificación comando `/ntfy`** — Se añadió link clickeable a `https://ntfy.sh/` para que el usuario sepa dónde descargar la app. Se ocultaron todas las referencias a `/ntfygraph` en mensajes de ayuda, `/ntfy`, `/ntfystatus` y webhook handler (comentadas, no eliminadas) porque el comando no está disponible temporalmente.
- **Creación de este archivo (`CONTEXT.md`)** — Para que asistentes de IA puedan entender el proyecto completo sin re-analizar el código fuente, ahorrando tokens y facilitando el onboarding en distintas máquinas/ sesiones de trabajo.

---
*Agregar nuevas entradas al inicio de esta sección a medida que se realizan cambios.*
