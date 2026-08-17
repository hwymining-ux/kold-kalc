# Kold Kalc — Freeze Protection ROI Analyzer

Custom software built for **Kold Katcher Inc.** (Drumheller, AB). Compares the full
cost of **electric heat trace** against a **Kold Katcher glycol heat trace system**
for a given site, and produces a branded, printable ROI quote.

## Run it

```
node server.js
```

Open http://localhost:4780. No dependencies — plain Node (uses built-in `node:sqlite`).
`PORT` and `KKROI_DB` env vars override the port and database path.
Database auto-creates at `data/kkroi.db` on first run.

## What it does

**Calculator** (live, recalculates on every keystroke):
- Electric side: trace length (ft) × watts/ft → kW load; $/ft trace cost; power kits,
  end kits, and cable-to-kit pricing; electrical install; grid/line-extension cost;
  $/kWh energy + optional demand charge.
- Kold Katcher side: pick a real unit from the catalog — Elite S5/S10/S20/S40KX
  (complete solar) or T5/T10/T20/T40KX (customer power) — which auto-fills official
  CDN list pricing and the manufacturer burn rate (BTU÷1,000 scf/hr @ max output);
  natural gas ($/GJ or $/Mcf, scf/hr or m³/hr) or propane ($/L or $/US gal);
  **"site fuel gas" checkbox** for wells that run the unit on produced gas at zero
  fuel cost (with an opportunity-cost caveat if that gas is sellable).
- Shared assumptions: freeze-season months, duty cycle, analysis period.
- Outputs: capex/opex comparison table, annual savings, payback, N-year TCO and ROI,
  cumulative-cost chart with breakeven marker + hover tooltip, CO₂e comparison.

**Saved ROIs** — save/reopen/duplicate/delete; auto-numbered `ROI-YYYY-NNN`.

**Unit Catalog** — admin CRUD over the real 2026 KK lineup (8 units, official CDN
list pricing + manufacturer burn rates from KK's spec sheets; USD pricing noted in
each description). Install/maintenance are editable estimates; propane L/hr is
derived from the BTU rating.

**Defaults** — default utility rates, fuel prices, grid CO₂ factor, quote-footer contact,
and **KK AI keys** (free Google Gemini key from aistudio.google.com/apikey, or a Claude
API key from console.anthropic.com — Claude preferred when both are set).

**✨ KK AI** (zero-dependency, REST calls to Gemini/Claude — no SDKs):
- **Quote & Document Analyzer** — drop a customer's electric heat trace quote, materials
  list, or invoice (PDF/photo/CSV/text). AI extracts every calculator-relevant number,
  summarizes the doc, flags exclusions/opportunities, and one click fills the calculator.
- **Ask KK AI** — chat grounded in live business data: unit catalog + pricing, default
  rates, saved quotes, company notes, and knowledge-base documents. Sizes systems,
  drafts follow-up emails, builds talking points vs electric.
- **Knowledge Base** — free-text "company notes" plus a document drop. Binary docs get
  an automatic AI digest stored alongside, so their numbers feed all future answers.
  Text docs are read directly. Gemini fallback chain: primary → gemini-flash-latest →
  gemini-3.1-flash-lite (stops immediately on key errors).
- Calculator also auto-suggests the right unit from trace length vs catalog coverage
  ranges (click-to-apply pill).

**Print / PDF Quote** — branded one-pager (logo, red/charcoal theme, headline savings
boxes, comparison + assumptions tables) via the browser's print-to-PDF.

**Other Tools** (top-nav tab, four sub-tools):
- **Vent-Gas Elimination ROI** — pneumatic pumps → KK solar pumping system. Vent rate ×
  pump count → gas lost (GJ), methane → CO₂e (editable GWP, default AB TIER 25),
  carbon value ($/t, default $95), retained-gas value, maintenance delta, payback,
  and a "cost of doing nothing" cumulative chart.
- **Solar Power Sizer** — editable load list (RTU, measurement, lighting, gas detection…)
  → daily Wh with losses → PV watts + panel count (winter sun-hours × derate) and
  battery kWh (autonomy days ÷ DoD). Copy-spec-to-clipboard for quote requests.
- **Sales Pipeline** — lead CRM: stages new/quoted/follow-up/won/lost, deal value,
  next-action dates with overdue flags, freeze-up (Oct 1) countdown banner, and
  "→ Pipeline" one-click from any saved quote. Feeds KK AI's context.
- **Install Base & Service** — every unit in the field, service due dates from
  last-service + interval, overdue/due-soon flags, one-click "Serviced Today".
  Also feeds KK AI's context.

**Floating KK AI widget** — red FAB bottom-right on every page opens a popup chat
sharing history with the KK AI tab (hidden while on that tab).

**Print quotes** — charcoal header + red verdict band ("KOLD KATCHER SAVES $X OVER
N YEARS"), the live breakeven chart embedded as an image, zebra comparison tables,
branded footer. Browser print-to-PDF.

## Key conversion factors (in `public/app.js`)

- 1 scf natural gas = 1,020 BTU = 0.001076 GJ (Alberta GHG methodology default; editable); 1 m³ = 35.3147 scf
- 1 US gal propane = 3.78541 L
- Emissions: NG 0.0551 kg CO₂/scf, propane 1.51 kg CO₂/L, grid factor configurable
  (Alberta ≈ 0.335 kg/kWh, 2024 published)

## Stack notes

Same pattern as the other apps on this machine: zero-build vanilla JS SPA
(`public/`), single-file Node server (`server.js`), `node:sqlite` for persistence
(better-sqlite3 won't compile here — no VS C++ toolchain).
