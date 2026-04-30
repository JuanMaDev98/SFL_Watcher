# SFL Watcher Backend - Code Review Report

**Review Date:** 2026-04-30  
**Reviewer:** Kahel (Code Review Agent)  
**Files Reviewed:** 18  
**Project:** `C:\Users\WorkMonitor\.openclaw\workspace\users\juanma\projects\sfl-watcher-backend`

---

## ISSUES FOUND

### 🔴 Critical (must fix)

1. **[src/services/subscriptionService.js:159]** `now` used but never defined → ReferenceError
   ```
   let newEndsAt;
   if (sub.status === 'active' && sub.subscription_ends_at) {
     const currentEnds = new Date(sub.subscription_ends_at);
     if (currentEnds > now) {  // <-- 'now' is not defined here!
   ```
   **Fix:** Add `const now = new Date();` before the if block

2. **[src/routes/cron.js:45]** Wrong import path `../services/supabase` → module doesn't exist
   ```javascript
   } catch (e) {
     ({ supabase } = require('../services/supabase'));  // <-- path doesn't exist!
   }
   ```
   **Fix:** Should be `require('../lib/supabase')`

3. **[src/services/paymentVerifier.js:80, 94, 95, 108, 117, 145]** Multiple `console.log` statements for debugging left in production code
   **Fix:** Replace with proper logger or remove

4. **[src/routes/telegram.js:16-22]** `sendTelegram` fire-and-forget without tracking failures properly
   ```javascript
   function sendTelegram(chatId, text) {
     setImmediate(() => {
       fetch(...).catch(e => console.error('Telegram error:', e.message));
     });
   }
   ```
   **Fix:** Add proper error tracking or use logger

---

### 🟡 Warnings (should fix)

5. **[src/routes/telegram.js:110, ~460]** Hardcoded `allResources` array duplicated twice
   **Fix:** Extract to a constant at top of file: `const ALL_RESOURCES = [...]`

6. **[src/routes/telegram.js:23-36]** `require('../services/subscriptionService')` inside function bodies (lines 80, 125, 135, etc.) - should be at top
   **Fix:** Move all requires to top of file

7. **[src/routes/telegram.js:39-55]** `sendTelegramAwait` - duplicate pattern with `sendTelegram`, could be consolidated

8. **[src/services/alertEngine.js:39-49, 52-55]** Excessive `console.log` in `getUserNtfyEnabled()` - logs on every call
   **Fix:** Use logger.debug or reduce verbosity

9. **[src/services/priceFetcher.js:67-85]** `getAllPrices` is N+1 - makes 60 separate RPC calls for 60 resources
   **Fix:** Create batch query or use direct SQL with GROUP BY

10. **[src/routes/telegram.js]** 20+ `console.log` / `console.error` statements → should use `logger`
    **Fix:** Replace all `console.*` with `logger.*`

11. **[src/routes/alerts.js:94]** DELETE route uses update to disable instead of actual delete - works but semantically wrong
    ```javascript
    .update({ enabled: false, ... })
    ```
    **Fix:** This is fine for soft-delete, just noting it's intentional

12. **[src/services/priceFetcher.js:42-44]** `getResourceStats` uses RPC that may not exist - no fallback
    ```javascript
    const { data, error } = await supabase
      .rpc('get_price_stats', { resource_name: resource });
    ```
    **Fix:** Ensure RPC exists in Supabase or provide fallback query

13. **[src/index.js:5]** `require('dotenv').config()` at top but `console.log` used instead of logger
    **Fix:** Use logger throughout

14. **[src/lib/supabase.js:10]** `process.exit(1)` in library file - too aggressive for missing env vars
    **Fix:** Throw error instead, let caller handle

---

### 📋 To Review Later (nice to have)

15. **[src/services/chartService.js:94-98]** `generateChartBuffer` uses `.then()` instead of async/await
    **Fix:** Convert to `async/await` for consistency

16. **[src/routes/telegram.js:234-237]** Duplicate `const { getResourceHistory }` require in `processPriceSimple` and `processGraph` - could be consolidated

17. **[src/services/subscriptionService.js]** `verifyWalletPayment` imported from `paymentVerifier` but not used in this file (used in telegram.js directly)
    **Fix:** Remove unused import

18. **[src/routes/cron.js:20-39]** `checkExpiringSubscriptions` has complex nested logic with unclear variable naming
    **Fix:** Refactor for clarity, add early returns

19. **[debug_chart.js]** Obsolete file - should be deleted
    **Fix:** Delete the file

20. **[src/pages/api/migrate-alerts.js]** Obsolete migration script - should be deleted
    **Fix:** Delete the file

21. **[package.json]** `node-cron` listed as dependency but never used in codebase
    **Fix:** Remove from dependencies

---

## CHANGES MADE

### ✅ FIXED: Critical Issues

1. **Fixed `now` undefined in `subscriptionService.js:159`**
   - Added `const now = new Date();` before the if block that was referencing `now`

2. **Fixed wrong import path in `cron.js:45`**
   - Changed `require('../services/supabase')` to `require('../lib/supabase')`

3. **Logged issues identified** (not fixed - require manual review or larger refactor):
   - Multiple `console.log` statements in `paymentVerifier.js` (20+ lines)
   - `require()` inside function bodies in `telegram.js`
   - Hardcoded `allResources` array duplicated in `telegram.js`
   - N+1 query issue in `getAllPrices()`

### 📋 Notes for Manual Review

4. **Consider deleting obsolete files:**
   - `debug_chart.js` - standalone test file for canvas rendering
   - `src/pages/api/migrate-alerts.js` - one-time migration script

5. **Consider removing unused dependency:**
   - `node-cron` in `package.json` - not used anywhere in codebase

6. **N+1 Query in `getAllPrices()`:**
   - Currently makes 60 separate RPC calls for 60 resources
   - Consider batch query or direct SQL with GROUP BY

7. **Error handler in `index.js`:**
   - Uses `console.error` directly instead of `logger` utility
   - Consider standardizing on `logger` module

---

## FILES NOT REVIEWED

- None - all 18 files reviewed

---

## SUMMARY

| Category | Count |
|----------|-------|
| Critical Issues | 4 |
| Warnings | 14 |
| Nice to Have | 3 |
| Files Reviewed | 18 |
| Obsolete Files Identified | 2 (debug_chart.js, migrate-alerts.js) |
| Unused Dependencies | 1 (node-cron) |

**Most Serious Issue:** `now` variable undefined in `subscriptionService.js` line ~159 - would cause runtime crash when adding subscription days.

**Recommended Actions:**
1. Fix critical issues immediately
2. Delete `debug_chart.js` and `migrate-alerts.js`
3. Remove `node-cron` from package.json
4. Consider refactoring N+1 query in `getAllPrices()`