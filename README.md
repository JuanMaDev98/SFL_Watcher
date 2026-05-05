# SFL Watcher Backend

Backend para monitorear precios de recursos en Sunflower Land y enviar alertas por Telegram y NTFY.

## Estado actual del producto

- **Bot principal:** Telegram
- **Notificaciones extra:** NTFY opcional para teléfono
- **Beta actual:** gratis
- **Wallet / pagos:** implementados pero ocultos temporalmente en la experiencia principal del bot
- **Scheduler recomendado:** cron-job.org

## Stack

- **Runtime:** Node.js + Express
- **Database:** Supabase (PostgreSQL)
- **Hosting:** Vercel
- **Notifications:** Telegram Bot API + NTFY
- **Charts:** SVG/PNG server-side

## Variables de Entorno

Crear `.env` basado en `.env.example`.

Variables clave:

```bash
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=***
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SFL_API_URL=https://sfl.world/api/v1
TELEGRAM_BOT_TOKEN=***
TELEGRAM_WEBHOOK_SECRET=***
INTERNAL_API_SECRET=***
NTFY_BASE_URL=https://ntfy.sh
BETA_FREE_MODE=true
OWNER_TELEGRAM_ID=123456789
```

## API Endpoints principales

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/prices` | Todos los recursos con stats actuales |
| GET | `/api/prices/:resource` | Precio + stats de un recurso específico |
| GET | `/api/prices/:resource/history` | Histórico del recurso |
| POST | `/api/telegram/webhook` | Webhook del bot de Telegram |
| POST | `/api/cron/fetch-prices` | Actualiza snapshots desde SFL |
| POST | `/api/cron/monitor` | Verifica salud del cron y gaps de snapshots |
| POST | `/api/cron/daily-report` | Resumen diario para owner |
| POST | `/api/alerts` | Crear alerta vía API |
| GET | `/api/alerts?user_id=X` | Ver alertas de usuario |
| DELETE | `/api/alerts/:id` | Desactivar/eliminar alerta |
| POST | `/api/subscribe` | Guardar token legacy de FCM/web app |

## Comandos visibles del bot

- `/start`
- `/help`
- `/price <resource>`
- `/priceall`
- `/graph <resource>`
- `/list`
- `/alerts`
- `/alert <resource> <high%> <low%>`
- `/alertall <high%> <low%> [keep]`
- `/pricealert <resource> <above|below> <price>`
- `/criticalalerts on|off`
- `/removealert <resource>`
- `/removeallalerts`
- `/ntfy`
- `/ntfytest`
- `/ntfygraph on|off`
- `/ntfystatus`
- `/language es|en`

## Scripts

```bash
npm install          # Instalar dependencias
npm run dev          # Desarrollo local
npm run deploy       # Deploy a Vercel
npm test             # Tests automáticos mínimos
```

## Database Schema

El schema está en `/supabase/schema.sql`. Ejecutar en SQL Editor de Supabase.

## Flujo real actual

1. cron-job.org llama `/api/cron/fetch-prices`
2. Se guardan snapshots en `price_snapshots`
3. El monitor revisa gaps, frescura y volumen de snapshots
4. El motor de alertas compara thresholds por usuario
5. Si hay breach → Telegram y/o NTFY
6. Un reporte diario resume salud del sistema al owner

## Scheduler recomendado

Usar **cron-job.org** como scheduler principal.

Configuración detallada:
- `docs/CRON_JOB_ORG_SETUP.md`

**Importante:**
- `vercel.json` no debe contener cron jobs sub-diarios en Vercel Hobby
- el workflow GitHub de cron quedó solo para disparo manual
- el bot ya no debe presentarse como dependiente de FCM para la experiencia principal
