# cron-job.org setup for SFL Watcher

Use `cron-job.org` as the only scheduler for this project.

## Why

Vercel Hobby rejects sub-daily cron schedules, so `vercel.json` cron jobs will fail deployment.
This project now expects an external scheduler.

## Base URL

Production base URL:

```text
https://sfl-watcher.vercel.app
```

Replace it if your production domain changes.

## Jobs to create

### 1) Fetch prices + alerts
- **Method:** `GET`
- **URL:** `https://sfl-watcher.vercel.app/api/cron/fetch-prices`
- **Schedule:** every 15 minutes
- **Cron expression:** `*/15 * * * *`

### 2) Snapshot health monitor
- **Method:** `GET`
- **URL:** `https://sfl-watcher.vercel.app/api/cron/monitor`
- **Schedule:** every 15 minutes, offset from fetch
- **Cron expression:** `7,22,37,52 * * * *`

### 3) Daily snapshot report
- **Method:** `GET`
- **URL:** `https://sfl-watcher.vercel.app/api/cron/daily-report`
- **Schedule:** once per day
- **Recommended time:** `00:10` in your preferred project timezone
- **If using UTC cron expression:** `10 0 * * *`

## Recommended cron-job.org settings

For each job:
- **Request timeout:** 60s or more
- **Follow redirects:** enabled
- **Retry on failure:** enabled if available
- **Notify on failure:** enabled if you want email alerts from cron-job.org

## Important notes

- Do **not** also run Vercel cron jobs for the same endpoints.
- Do **not** also keep GitHub scheduled cron for `/api/cron/fetch-prices`, or you will duplicate snapshots and alerts.
- The GitHub workflow in this repo was left as **manual only** (`workflow_dispatch`) for emergency/manual testing.

## Manual test URLs

These can be opened or triggered manually when needed:

```text
https://sfl-watcher.vercel.app/api/cron/fetch-prices
https://sfl-watcher.vercel.app/api/cron/monitor
https://sfl-watcher.vercel.app/api/cron/daily-report
```
