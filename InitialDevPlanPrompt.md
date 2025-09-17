# Fleet Snapshot Dashboard — Portable Dev Plan (Small‑Fleet)

*Scope: ≤50 assets (≈25 typical). No trips/locations. Built from ****nightly SQL snapshots****; optional ****live preview**** (non‑persisted).*

**App summary:** A single‑file HTML dashboard that is portable and plug‑and‑play. It reads its environment from `/config.json`, calls an internal REST API backed by SQL Server, and renders KPIs/graphs from nightly snapshots (with an optional live‑preview call that never writes). No secrets sit in the file, no trips/locations are used, and an Admin tab lets IT set FY start, thresholds, odometer precedence, and other org settings stored in the DB—so the **same HTML works across dev/test/prod** with zero code changes.

---

## Navigation (tabs)

**Overview** | **Miles** | **Maintenance** | **Faults** | **Assets** | **Admin**

---

## Global UX (small‑fleet)

* One page per tab, **no pagination**.
* Sticky filters: Agency/Pool, Class, Active/Inactive, Search VIN/Name.
* **Data Freshness** banner (UTC timestamp) + **Refresh (live)** button (preview only).

---

## KPI Bar (top)

* **Fleet size** (target \~25).
* **MTD miles**, **YTD miles**, **FYTD miles**.
* **Active assets (7‑day)**: count with miles > threshold.
* **Fleet utilization % (7‑day)** = active\_assets\_7d / total\_assets × 100.
* **Avg mi/asset/day (7‑day)** = total\_miles\_7d / total\_assets / 7.
* **Overdue maintenance** (target **0**, red if >0).
* **Due soon** (within ≤500 miles or ≤15 days; editable).
* **Active faults**: **Vehicle ECU** vs **Telematics device**.

---

## Overview (landing)

* Trend: **Daily fleet miles** (last 60 days).
* **Top 5 movers** by MTD miles.
* **Compliance strip**: Overdue maint (goal 0) • Missing start/end snapshot • Device swaps since FY start.

---

## Miles (from nightly snapshots)

* Charts: **Column** (Miles by vehicle for selected month); **Line** (Monthly fleet miles last 12).
* Table: Device • Month • **Start Odo** • **End Odo** • **Miles** • Data‑quality badge.
* **CY/FY toggle**: per‑vehicle Start Odo (Jan 1 / FY start), Current Odo, **YTD/FYTD miles**.
* Logic: **Monthly miles** = latest ≤ EOM − earliest ≥ BOM. **Active (7‑day)**: miles > threshold.

---

## Maintenance (zero‑overdue posture)

* KPI tiles: **Overdue** (red; target 0) • **Due soon** (amber) • **Upcoming (30d)**.
* Gantt/List: **Next 60 days** by **Service Type**.
* Table: Device • Service Type • Last Service Date/Odo • **Miles to Due** • **Days to Due** • **Status** (OK / DUE SOON / OVERDUE).
* Rules from `maintenance_intervals` (miles and/or days). **Thresholds editable** (Admin): Due soon ≤500 mi or ≤15 d; Overdue ≤0.

---

## Faults

* Toggle: **Vehicle ECU** vs **Telematics**.
* KPIs: Active (High/Med/Low); **new faults (24h)**.
* Charts: by Severity; Top recurring codes.
* Table: Device • Code (OBD/J1939) • Description • Severity • Last Seen • Active.
* Drill: 30‑day fault timeline per device.

---

## Assets (directory)

* Card/List: Name • VIN • Latest Odo • 7‑day miles • Active faults • Maintenance status.
* Detail drawer: mini 12‑month miles chart • fault history • upcoming services.

---

## Admin (settings & config)

**Two sections:**

1. **Org Settings (persist to DB)**

   * FY start month (default **7**).
   * Due‑soon thresholds: **miles** (default 500), **days** (15).
   * Utilization threshold (mi/day; 0 or 1).
   * Odometer precedence (ordered diag IDs; also store `source_diag_id`).
   * Merge rules for device swaps (prefer VIN/Asset ID).
2. **View Settings (front‑end only)**

   * Default month, CY/FY toggle, saved filters.

Admin also shows **Instant refresh** (live preview; no write).

---

## Portable Architecture

* **Front end:** `index.html` (vanilla JS/CSS). No secrets. Reads `/config.json`.
* **App API:** small service (Node/Express, .NET, or Python) on intranet.
* **DB:** SQL Server with nightly‑refreshed tables.
* **Nightly ETL:** pulls Geotab → writes snapshots → updates freshness.

---

## Universal Data Contract (API endpoints)

Front‑end expects these JSON endpoints (stable across environments):

* `GET /api/info` → `{ last_snapshot_utc, fleet_size }`
* `GET /api/kpis` → `{ mtd_miles, ytd_miles, fytd_miles, active_assets_7d, utilization_pct_7d, avg_mi_asset_day_7d, faults_active_vehicle, faults_active_telematics, maint_overdue, maint_due_soon }`
* `GET /api/miles/monthly?months=12` → rows `{ device_id, device_name, month, start_miles, end_miles, miles_driven, dq_flag }`
* `GET /api/ytd` → rows `{ device_id, device_name, current_miles, cy_miles, fy_miles }`
* `GET /api/faults/activeSummary` → rows `{ device_id, device_name, active_faults, high_sev, last_fault_utc }`
* `GET /api/maintenance/due` → rows `{ device_id, service_type, last_service_date, last_service_odo, miles_to_due, days_to_due, status }`
* `GET /api/assets` → rows `{ device_id, device_name, vin, latest_odo_miles, miles_7d, faults_active, maint_status }`
* **Live preview:** `POST /api/refresh-now` (fresh data only; no DB write)
* **Admin config:** `GET/POST /api/admin/config` (CRUD key/values)

---

## SQL Server Objects (IT contract)

**Tables (nightly ETL writes):**

* `devices(device_id PK, name, vin, plate, make_model, product, created_utc, active)`
* `odometer_snapshots(device_id, snapshot_ts_utc, odometer_km, source_diag_id, PK(device_id, snapshot_ts_utc)`
* `fault_events(fault_uid PK, device_id, dt_utc, is_active, severity, code_type, code, failure_mode, diagnostic_name)`
* `maintenance_intervals(rule_id PK, device_id NULL, vehicle_class NULL, service_type, every_miles, every_days, warn_at_pct, enabled)`
* `maintenance_events(event_id PK, device_id, service_type, service_date_utc, odometer_miles, notes)`
* `config(key PK, value)`

**Views/Procs (read‑only for API):**

* `v_odometer_snapshots` (adds miles = km×0.621371).
* `sp_miles_monthly(@months int)` → for `/api/miles/monthly`.
* `sp_ytd_fytd()` → for `/api/ytd`.
* `sp_faults_active_summary(@days int = 30)`.
* `sp_maintenance_due()` (applies intervals + thresholds from `config`).
* `sp_assets_overview()` (latest odo, 7‑day miles, statuses).
* `sp_info()` (freshness, fleet size), `sp_kpis()` (all KPIs).

**ETL loaders (agnostic):** `sp_load_devices`, `sp_load_odometer_snapshots`, `sp_load_fault_events` (TVPs/staging accepted).

---

## Security & Portability

* **Front end:** no secrets; `API_BASE` from `/config.json` (overridable per env).
* **API:** Windows Integrated/AAD; Admin routes require *FleetAdmin* group.
* **DB:** least‑privilege for API (EXEC procs, SELECT views). Separate loader creds for ETL.

---

## Operations

* **Nightly job:** ETL → set `LAST_SNAPSHOT_UTC` in `config`.
* **Health:** `/api/info` powers freshness banner; warn if stale.
* **Handoff bundle:** ZIP with `index.html`, `config.json.sample`, API README (env vars/routes), SQL DDL + procs.

---

## Metric Definitions (authoritative)

* **7‑day miles:** latest odo − odo at T−7d (closest snapshot fill).
* **Active assets 7‑day:** 7‑day miles > threshold.
* **Utilization % (7‑day):** active\_assets\_7d / total\_assets × 100.
* **Avg mi/asset/day (7‑day):** total\_miles\_7d / total\_assets / 7.
* **Monthly miles:** end\_odo\_month − start\_odo\_month.
* **YTD/FYTD miles:** current\_odo − first snapshot on/after Jan 1 / FY start.
* **Due soon / Overdue:** thresholds from Admin (defaults: ≤500 mi / ≤15 d; overdue ≤0).

---

## Notes for IT

* Environment config precedence: **DB ****`config`**** → /config.json → defaults**.
* Keep **SQL read path stable** (views/procs) so HTML remains portable.
* Live preview endpoint is optional; does **not** persist—safe for ad‑hoc checks.
