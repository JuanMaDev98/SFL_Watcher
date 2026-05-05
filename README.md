# SFL Watcher Backend

Backend para monitorear precios de recursos en Sunflower Land y enviar notificaciones push.

## Stack

- **Runtime:** Node.js + Express
- **Database:** Supabase (PostgreSQL)
- **Hosting:** Vercel
- **Push:** Firebase Cloud Messaging

## Variables de Entorno

Crear `.env` basado en `.env.example`:

```bash
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SFL_API_URL=https://sfl.world/api/v1
FCM_PROJECT_ID=your_firebase_project_id
```

## API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/prices` | Todos los recursos con stats (avg 90d, min/max) |
| GET | `/api/prices/:resource` | Stats de un recurso específico |
| GET | `/api/prices/:resource/history` | Histórico últimos 30 días |
| POST | `/api/snapshots/fetch` | Fetch prices desde SFL API (cron) |
| POST | `/api/alerts` | Crear alerta |
| GET | `/api/alerts?user_id=X` | Ver alertas de usuario |
| DELETE | `/api/alerts/:id` | Eliminar alerta |
| POST | `/api/subscribe` | Guardar FCM token |

## Scripts

```bash
npm install          # Instalar dependencias
npm run dev          # Desarrollo local
npm run deploy       # Deploy a Vercel
npm test             # Predeploy check mínimo
```

## Database Schema

El schema está en `/supabase/schema.sql`. Ejecutar en SQL Editor de Supabase.

## Flujo

1. Un scheduler externo llama `/api/cron/fetch-prices`
2. Guarda snapshots en `price_snapshots`
3. Alert engine compara con thresholds de usuarios
4. Si breach → Telegram / NTFY notification

## Scheduler recomendado

Usar **cron-job.org** como scheduler principal.

Configuración detallada:
- `docs/CRON_JOB_ORG_SETUP.md`

**Importante:**
- `vercel.json` no debe contener cron jobs sub-diarios en Vercel Hobby
- el workflow GitHub de cron quedó solo para disparo manual