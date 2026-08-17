// Kold Kalc — ROI & Freeze Protection Cost Analyzer for Kold Katcher Inc.
// Zero-dependency Node server: node:http + node:sqlite
// Start: node server.js   (PORT env overrides, default 4780; KKROI_DB overrides db path)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 4780;
const DB_PATH = process.env.KKROI_DB || path.join(__dirname, 'data', 'kkroi.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  kit_cost REAL DEFAULT 0,
  install_cost REAL DEFAULT 0,
  ng_scfh REAL DEFAULT 0,
  propane_lph REAL DEFAULT 0,
  maint_per_year REAL DEFAULT 0,
  coverage_ft TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer TEXT NOT NULL,
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  site TEXT DEFAULT '',
  product_line TEXT DEFAULT 'Glycol Heat Trace',
  value_est REAL DEFAULT 0,
  stage TEXT DEFAULT 'new',
  quote_number TEXT DEFAULT '',
  next_action_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  lost_reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS installs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer TEXT NOT NULL,
  site TEXT DEFAULT '',
  region TEXT DEFAULT '',
  unit_name TEXT DEFAULT '',
  serial TEXT DEFAULT '',
  fuel TEXT DEFAULT 'Natural Gas',
  install_date TEXT DEFAULT '',
  last_service TEXT DEFAULT '',
  service_interval_months REAL DEFAULT 12,
  status TEXT DEFAULT 'active',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS kb_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mime TEXT DEFAULT '',
  data TEXT DEFAULT '',
  text_content TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number TEXT,
  customer TEXT DEFAULT '',
  site TEXT DEFAULT '',
  prepared_by TEXT DEFAULT '',
  payload TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

const DEFAULT_SETTINGS = {
  power_rate_kwh: '0.20',        // ALL-IN delivered $/kWh (AB energy ~12¢ + delivery/transmission/riders ~5-8¢)
  demand_charge_kw_mo: '0',      // $/kW/month demand charge (optional)
  gas_price: '2.50',             // natural gas price
  gas_price_unit: 'GJ',          // GJ | Mcf
  propane_price: '0.65',         // propane price
  propane_price_unit: 'L',       // L | gal
  season_months: '7',            // freeze season length (Oct-Apr default)
  duty_cycle_pct: '60',          // thermostat duty cycle for heat systems
  grid_co2_kg_kwh: '0.335',      // Alberta grid intensity 2024 published (post coal phase-out)
  analysis_years: '10',
  company_phone: '1-877-644-2268',
  company_email: 'r.dumaine@koldkatcher.com',
  company_city: 'Drumheller, Alberta',
  carbon_price_t: '95',          // $/t CO2e — AB TIER fund price (frozen at $95 in 2025); federal benchmark is $110
  ch4_gwp: '28',                 // CH4 global warming potential (AR5, current AB/federal reporting)
  ng_energy_gj_scf: '0.001076',  // editable — 1,020 BTU/scf (Alberta GHG methodology default)
  ng_co2_kg_scf: '0.0541',       // editable — EPA 53.06 kg CO2/MMBtu × 1,020 BTU/scf
  propane_co2_kg_l: '1.51',      // editable — propane combustion CO2 factor
  def_watts_per_ft: '5',         // "my standard inputs" — electric trace defaults
  def_trace_cost_ft: '12',
  def_pk_price: '350',
  def_ek_price: '95',
  def_cable_cost_ft: '6',
  def_voltage: '240',
  def_tube_cost_ft: '3.50',      // KK tubing $/ft (same footage as trace)
  def_tube_install: '1500',
  def_fuel_hookup: '800',
  gemini_api_key: '',
  anthropic_api_key: '',
  gemini_model: 'gemini-3.5-flash',
  anthropic_model: 'claude-opus-4-8',
  ai_notes: ''
};
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);
// migrations of superseded defaults (match-old-value semantics: only fires if the user never changed it)
db.prepare("UPDATE settings SET value='28' WHERE key='ch4_gwp' AND value='25'").run();
db.prepare("UPDATE settings SET value='95' WHERE key='def_ek_price' AND value='150'").run();
db.prepare("UPDATE settings SET value='0.20' WHERE key='power_rate_kwh' AND value='0.12'").run();
db.prepare("UPDATE settings SET value='0.335' WHERE key='grid_co2_kg_kwh' AND value='0.43'").run();
db.prepare("UPDATE settings SET value='95' WHERE key='carbon_price_t' AND value='110'").run(); // AB TIER fund price frozen at $95

// Real 2026 Kold Katcher catalog (specs + CDN list pricing from KK's own sheets, Aug 2026).
// Burn rates are manufacturer "gas consumption @ maximum output"; propane L/hr derived from BTU rating.
db.prepare("DELETE FROM units WHERE description LIKE '%PLACEHOLDER SPECS%'").run();
const unitCount = db.prepare('SELECT COUNT(*) AS n FROM units').get().n;
if (unitCount === 0) {
  const ins = db.prepare(`INSERT INTO units (code, name, description, kit_cost, install_cost, ng_scfh, propane_lph, maint_per_year, coverage_ft, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const desc = (btu, series, usd) => `${btu.toLocaleString('en-CA')} BTU/hr flush-mount catalytic heater (flameless, 700°F face), ½" tubing loop, Class I Div II. ${series} CDN list pricing (USD $${usd}). Install & maintenance are estimates — set your real numbers.`;
  // S-series — complete solar systems (380 W module + battery bank)
  ins.run('S5',  'Elite S5KX — 5,000 BTU/hr (Solar)',  desc(5000, 'Complete solar system.', '9,985.85'),  11095.40, 1500, 5,  0.21, 250, '50 – 175 ft', 1);
  ins.run('S10', 'Elite S10KX — 10,000 BTU/hr (Solar)', desc(10000, 'Complete solar system.', '14,695.24'), 16532.15, 1500, 10, 0.41, 250, '175 – 350 ft', 2);
  ins.run('S20', 'Elite S20KX — 20,000 BTU/hr (Solar)', desc(20000, 'Complete solar system.', '16,846.64'), 17827.47, 1500, 20, 0.83, 250, '350 – 650 ft', 3);
  ins.run('S40', 'Elite S40KX — 40,000 BTU/hr (Solar)', desc(40000, 'Complete solar system.', '19,917.78'), 21837.65, 1500, 40, 1.65, 250, '650 – 1,000 ft', 4);
  // T-series — customer-supplied power (TEG / battery add-ons available)
  ins.run('T5',  'Elite T5KX — 5,000 BTU/hr (Cust. Power)',  desc(5000, 'Customer-supplied power.', '7,280.65'),  8390.20,  1500, 5,  0.21, 250, '50 – 175 ft', 5);
  ins.run('T10', 'Elite T10KX — 10,000 BTU/hr (Cust. Power)', desc(10000, 'Customer-supplied power.', '10,859.63'), 11825.32, 1500, 10, 0.41, 250, '175 – 350 ft', 6);
  ins.run('T20', 'Elite T20KX — 20,000 BTU/hr (Cust. Power)', desc(20000, 'Customer-supplied power.', '12,172.21'), 13868.10, 1500, 20, 0.83, 250, '350 – 650 ft', 7);
  ins.run('T40', 'Elite T40KX — 40,000 BTU/hr (Cust. Power)', desc(40000, 'Customer-supplied power.', '14,391.06'), 15939.94, 1500, 40, 1.65, 250, '650 – 1,000 ft', 8);
}

// Seed the knowledge base with the official 2026 price sheet (replaces the old made-up sample doc)
db.prepare("DELETE FROM kb_docs WHERE name = 'dealer-prices-2026.txt'").run();
const kbCount = db.prepare('SELECT COUNT(*) AS n FROM kb_docs').get().n;
if (kbCount === 0) {
  const PRICE_TEXT = `KOLD KATCHER 2026 OFFICIAL PRICE SHEET (from company price sheets, Aug 2026) — 1-877-644-2268, koldkatcher.com

GLYCOL HEAT TRACE — "T" SERIES (customer-supplied power), CDN / USD:
Elite T5KX  5,000 BTU/hr,  50-175 ft:  $8,390.20 / $7,280.65
Elite T10KX 10,000 BTU/hr, 175-350 ft: $11,825.32 / $10,859.63
Elite T20KX 20,000 BTU/hr, 350-650 ft: $13,868.10 / $12,172.21
Elite T40KX 40,000 BTU/hr, 650-1000 ft: $15,939.94 / $14,391.06
T-series add-ons (CDN / USD): 5050N-24 TEG 50 W +$14,156.20 / $12,105.00; 5100N-24 TEG 100 W +$15,156.20 / $13,105.00; 2× 155 AH battery backup +$1,300 / $1,100; 4× 155 AH battery backup +$2,200 / $1,900.

GLYCOL HEAT TRACE — "S" SERIES (complete solar system), CDN / USD:
Elite S5KX  5,000 BTU/hr,  50-175 ft:  $11,095.40 / $9,985.85
Elite S10KX 10,000 BTU/hr, 175-350 ft: $16,532.15 / $14,695.24
Elite S20KX 20,000 BTU/hr, 350-650 ft: $17,827.47 / $16,846.64
Elite S40KX 40,000 BTU/hr, 650-1000 ft: $21,837.65 / $19,917.78

SOLAR PUMPING SYSTEMS (circulators), CDN / USD:
SPSX-280-SP 0-0.7 GPM, up to 500 ft: $8,130.98 / $7,317.88
SPSX-560-SP 0-1.0 GPM, up to 1000 ft: $10,845.00 / $8,976.00
SPSX-560-DP 0-2.0 GPM, up to 1000 ft: $12,126.80 / $9,789.29

FTR SERIES (AC power only), CDN / USD:
FTR-80 80,000 BTU/hr, 2,000 ft: $31,117.00 / $27,327.00
FTR-120 120,000 BTU/hr tank heating, 400 bbl: $37,620.00 / $33,982.00

IN-LINE HEATER BOOSTERS, CDN / USD: B10KX 10,000 BTU $6,944 / $6,264; B20KX 20,000 BTU $8,126 / $7,232; B40KX 40,000 BTU $11,200 / $9,876.
PNEUMATIC-TO-ELECTRIC CONVERSION: FPS-1040 bolt-on pump box, 0-1000 ft: $3,452.72 / $2,980.00.
ACCESSORIES: KK-NHBC 24 V 20 A battery charger/tender: $1,118.35 / $987.90.

SPEC NOTES (from KK spec sheets): all KX heat-trace units use flush-mount catalytic heaters (flameless, ~700°F face temp), gas consumption at maximum output = BTU rating ÷ 1,000 in scf/hr (5KX = 5 scf/hr, 10KX = 10, 20KX = 20, 40KX = 40). ½" tubing loops. Class I Div II available. Max glycol set point 65°C (150°F) inlet, 98°C high-temp shutdown. S-series: 380 W solar module, 200-300 AH batteries. T-series: runs on customer power, optional TEG or battery add-ons; T10KX power capacity 50 W @ 24 VDC with auxiliary power hub.`;
  db.prepare('INSERT INTO kb_docs (name, mime, data, text_content, notes) VALUES (?, ?, ?, ?, ?)')
    .run('KK 2026 Official Price Sheet (CDN + USD)', 'text/plain', '', PRICE_TEXT, 'Official Kold Katcher 2026 pricing + spec summary — loaded from company price sheets');
}

// ---------- helpers ----------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 30e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json'
};

function nextQuoteNumber() {
  const yr = new Date().getFullYear();
  const row = db.prepare(`SELECT quote_number FROM quotes WHERE quote_number LIKE ? ORDER BY id DESC LIMIT 1`).get(`ROI-${yr}-%`);
  let n = 1;
  if (row && row.quote_number) {
    const m = row.quote_number.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `ROI-${yr}-${String(n).padStart(3, '0')}`;
}

// ---------- AI engine (zero-dep: REST via global fetch) ----------
function setting(key) {
  const row = getSetting.get(key);
  return row ? row.value : '';
}
function aiProvider() {
  if (setting('anthropic_api_key')) return 'claude';
  if (setting('gemini_api_key')) return 'gemini';
  return null;
}
function parseJsonLoose(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  if (start > 0) t = t.slice(start);
  const end = t.lastIndexOf('}');
  if (end >= 0) t = t.slice(0, end + 1);
  return JSON.parse(t);
}

// messages: [{role:'user'|'assistant', text, attachment?:{mime, data_b64}}]
async function claudeGenerate(system, messages) {
  const model = setting('anthropic_model') || 'claude-opus-4-8';
  const msgs = messages.map(m => {
    const content = [];
    if (m.attachment) {
      const { mime, data_b64 } = m.attachment;
      if (mime === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: mime, data: data_b64 } });
      else if (mime.startsWith('image/')) content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: data_b64 } });
      else content.push({ type: 'text', text: '[Attached file content]\n' + Buffer.from(data_b64, 'base64').toString('utf8').slice(0, 60000) });
    }
    content.push({ type: 'text', text: m.text || '' });
    return { role: m.role, content };
  });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': setting('anthropic_api_key'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 3000, system, messages: msgs })
  });
  const j = await res.json();
  if (!res.ok) {
    const msg = (j.error && j.error.message) || res.status;
    if (res.status === 401) throw new Error('Claude API key was rejected — check it in Defaults → KK AI.');
    throw new Error('Claude API error: ' + msg);
  }
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function geminiGenerate(system, messages) {
  const key = setting('gemini_api_key');
  const primary = setting('gemini_model') || 'gemini-3.5-flash';
  const chain = [primary, 'gemini-flash-latest', 'gemini-3.1-flash-lite'].filter((v, i, a) => a.indexOf(v) === i);
  const contents = messages.map(m => {
    const parts = [];
    if (m.attachment) {
      const { mime, data_b64 } = m.attachment;
      if (mime === 'application/pdf' || mime.startsWith('image/')) parts.push({ inline_data: { mime_type: mime, data: data_b64 } });
      else parts.push({ text: '[Attached file content]\n' + Buffer.from(data_b64, 'base64').toString('utf8').slice(0, 60000) });
    }
    parts.push({ text: m.text || '' });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
  let lastErr = null;
  for (const model of chain) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 3000 } })
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      const cand = j.candidates && j.candidates[0];
      const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
      if (text) return text;
      lastErr = new Error('Gemini returned an empty answer.');
      continue;
    }
    const msg = (j.error && j.error.message) || String(res.status);
    if (res.status === 400 || res.status === 403) throw new Error('Gemini API key problem: ' + msg + ' — check the key in Defaults → KK AI.');
    if (res.status === 429) lastErr = new Error('Gemini rate limit hit — wait a minute and try again.');
    else lastErr = new Error(`Gemini (${model}): ${msg}`);
  }
  throw lastErr || new Error('Gemini failed.');
}

async function aiGenerate(system, messages) {
  const provider = aiProvider();
  if (!provider) throw new Error('No AI key configured. Add a free Google Gemini key (aistudio.google.com/apikey) or a Claude API key in Defaults → KK AI.');
  const answer = provider === 'claude' ? await claudeGenerate(system, messages) : await geminiGenerate(system, messages);
  return { answer, provider };
}

function businessSnapshot() {
  const units = db.prepare('SELECT code, name, description, coverage_ft, kit_cost, install_cost, ng_scfh, propane_lph, maint_per_year, active FROM units ORDER BY sort').all();
  const quotes = db.prepare('SELECT quote_number, customer, site, prepared_by, payload, updated_at FROM quotes ORDER BY id DESC LIMIT 25').all()
    .map(q => {
      let p = {}; try { p = JSON.parse(q.payload); } catch (e) {}
      return { quote_number: q.quote_number, customer: q.customer, site: q.site, updated: q.updated_at,
        trace_ft: p.len_ft, watts_per_ft: p.watts_per_ft, unit_id: p.unit_id, fuel: p.fuel_type };
    });
  const settings = {};
  for (const k of ['power_rate_kwh','demand_charge_kw_mo','gas_price','gas_price_unit','propane_price','propane_price_unit','season_months','duty_cycle_pct','grid_co2_kg_kwh','analysis_years']) settings[k] = setting(k);
  const kb = db.prepare('SELECT id, name, notes, text_content, created_at FROM kb_docs ORDER BY id DESC').all()
    .map(d => ({ name: d.name, notes: d.notes, uploaded: d.created_at,
      content: (d.text_content || '').slice(0, 8000) || '(binary file — no extracted text)' }));
  const pipeline = db.prepare(`SELECT customer, contact, site, product_line, value_est, stage, quote_number, next_action_date, notes FROM pipeline WHERE stage NOT IN ('won','lost') ORDER BY next_action_date LIMIT 40`).all();
  const pipelineStats = db.prepare(`SELECT stage, COUNT(*) AS n, SUM(value_est) AS value FROM pipeline GROUP BY stage`).all();
  const installs = db.prepare(`SELECT customer, site, region, unit_name, serial, fuel, install_date, last_service, service_interval_months, status FROM installs WHERE status = 'active' ORDER BY last_service LIMIT 60`).all();
  return { units, recent_quotes: quotes, default_rates: settings, company_notes: setting('ai_notes') || '(none provided yet)', knowledge_base: kb,
    sales_pipeline_open: pipeline, pipeline_stage_totals: pipelineStats, install_base_active: installs };
}

function kkSystemPrompt() {
  return `You are KK AI, the in-house assistant for Kold Katcher Inc. — a Drumheller, Alberta manufacturer of freeze-protection equipment for remote oil & gas sites since 2003 (10,000 sq ft facility, distribution across North America, phone ${setting('company_phone')}, email ${setting('company_email')}).

PRODUCT KNOWLEDGE:
- Glycol Heat Trace systems (flagship): gas-fired units circulating heated glycol through tracer lines on process piping. A safe alternative to fire-tube burners and to electric heat trace at sites with limited/no grid power. Also used for de-waxing surface piping, tank & vessel heating, oil conditioning. Elite solar series covers 50-1000 ft runs by model; TEG and FTR series for other duties.
- Solar Pumping Systems: replace pneumatic (vent-gas) pumps — eliminates methane venting; magnetically coupled, stainless, brushless variable-speed.
- Power Systems: plug-and-play solar power skids and well-site lighting for RTUs, measurement, gas detection, security.
- Key selling angles: no grid dependency, no Class I Div 1/2 electrical on piping, keeps working through outages, can run on site fuel gas (near-zero fuel cost), eliminates vent gas emissions.

You are embedded in "Kold Kalc", the company's ROI tool that compares electric heat trace against Kold Katcher units. The tool also has: a Vent-Gas Elimination ROI calculator (solar pumping line — methane/TIER carbon value), a Solar Power Sizer, a Sales Pipeline tracker, and an Install Base & service tracker. The CURRENT BUSINESS DATA below is live from the tool — unit catalog with pricing, default rates, recent quotes, open sales pipeline, active field installs, and the team's own knowledge base. Trust the knowledge base and company notes over generic assumptions; they are the company's real numbers. When asked about follow-ups, deals, or service, use the pipeline and install-base data (flag overdue next_action_date and overdue service).

CURRENT BUSINESS DATA:
${JSON.stringify(businessSnapshot(), null, 1)}

RULES:
- Be practical and concise; these are field/sales people. Use their catalog pricing when quoting numbers, and say when a number is a placeholder or assumption.
- When asked to size a system, match trace length to unit coverage ranges and recommend a unit.
- You may draft emails, quote summaries, and talking points on request.
- If you don't have a number, say so and point to where they can add it (Unit Catalog, Defaults → KK AI knowledge base).`;
}

const EXTRACT_PROMPT = `You are analyzing a document for Kold Katcher Inc. — usually a customer's electric heat trace quote, a materials list, an invoice, or a spec sheet. Extract everything relevant to a freeze-protection cost comparison.

Reply with ONLY a JSON object (no prose, no markdown fences) with these keys (null when not found):
{
 "doc_type": "short label, e.g. 'Electric heat trace quote'",
 "customer": string|null, "site": string|null,
 "trace_length_ft": number|null, "watts_per_ft": number|null, "trace_cost_per_ft": number|null,
 "power_kits_qty": number|null, "power_kit_price": number|null,
 "end_kits_qty": number|null, "end_kit_price": number|null,
 "cable_ft": number|null, "cable_cost_per_ft": number|null,
 "elec_install": number|null, "grid_ext": number|null,
 "power_rate_kwh": number|null,
 "total_quoted": number|null,
 "other_items": [{"desc": string, "amount": number}],
 "summary": "3-5 sentence plain-language summary of the document and its key numbers",
 "red_flags": ["anything notable: exclusions, expensive line items, missing scope, assumptions worth challenging, opportunities for Kold Katcher to win"]
}
Convert metres to feet (×3.281) and note the conversion in summary. If a lump-sum covers several of these fields, put it in the closest field and explain in summary.`;

// ---------- API ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const id = parts[2] ? parseInt(parts[2], 10) : null;

  // GET /api/bootstrap
  if (req.method === 'GET' && parts[1] === 'bootstrap') {
    const settings = {};
    for (const row of db.prepare('SELECT key, value FROM settings').all()) settings[row.key] = row.value;
    const units = db.prepare('SELECT * FROM units WHERE active = 1 ORDER BY sort, id').all();
    return json(res, 200, { settings, units });
  }

  // PUT /api/settings  {key: value, ...}
  if (req.method === 'PUT' && parts[1] === 'settings') {
    const body = await readBody(req);
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(body)) up.run(String(k), String(v == null ? '' : v));
    return json(res, 200, { ok: true });
  }

  // units CRUD
  if (parts[1] === 'units') {
    if (req.method === 'GET') {
      return json(res, 200, db.prepare('SELECT * FROM units ORDER BY sort, id').all());
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const r = db.prepare(`INSERT INTO units (code, name, description, kit_cost, install_cost, ng_scfh, propane_lph, maint_per_year, coverage_ft, sort, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
        String(b.code || '?'), String(b.name || 'New Unit'), String(b.description || ''),
        Number(b.kit_cost) || 0, Number(b.install_cost) || 0, Number(b.ng_scfh) || 0,
        Number(b.propane_lph) || 0, Number(b.maint_per_year) || 0, String(b.coverage_ft || ''),
        Number(b.sort) || 99);
      return json(res, 200, db.prepare('SELECT * FROM units WHERE id = ?').get(r.lastInsertRowid));
    }
    if (req.method === 'PUT' && id) {
      const b = await readBody(req);
      const cur = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
      if (!cur) return json(res, 404, { error: 'unit not found' });
      const v = (k, cast) => (b[k] === undefined || b[k] === null) ? cur[k] : (cast ? Number(b[k]) || 0 : String(b[k]));
      db.prepare(`UPDATE units SET code=?, name=?, description=?, kit_cost=?, install_cost=?, ng_scfh=?, propane_lph=?, maint_per_year=?, coverage_ft=?, sort=?, active=? WHERE id=?`)
        .run(v('code'), v('name'), v('description'), v('kit_cost', 1), v('install_cost', 1), v('ng_scfh', 1),
             v('propane_lph', 1), v('maint_per_year', 1), v('coverage_ft'), v('sort', 1),
             b.active === undefined ? cur.active : (b.active ? 1 : 0), id);
      return json(res, 200, db.prepare('SELECT * FROM units WHERE id = ?').get(id));
    }
    if (req.method === 'DELETE' && id) {
      db.prepare('DELETE FROM units WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
  }

  // quotes CRUD
  if (parts[1] === 'quotes') {
    if (req.method === 'GET' && !id) {
      const rows = db.prepare('SELECT id, quote_number, customer, site, prepared_by, created_at, updated_at FROM quotes ORDER BY id DESC').all();
      return json(res, 200, rows);
    }
    if (req.method === 'GET' && id) {
      const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
      if (!row) return json(res, 404, { error: 'quote not found' });
      return json(res, 200, row);
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const qn = nextQuoteNumber();
      const r = db.prepare(`INSERT INTO quotes (quote_number, customer, site, prepared_by, payload) VALUES (?, ?, ?, ?, ?)`)
        .run(qn, String(b.customer || ''), String(b.site || ''), String(b.prepared_by || ''), JSON.stringify(b.payload || {}));
      return json(res, 200, db.prepare('SELECT * FROM quotes WHERE id = ?').get(r.lastInsertRowid));
    }
    if (req.method === 'PUT' && id) {
      const b = await readBody(req);
      const cur = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
      if (!cur) return json(res, 404, { error: 'quote not found' });
      db.prepare(`UPDATE quotes SET customer=?, site=?, prepared_by=?, payload=?, updated_at=datetime('now') WHERE id=?`)
        .run(b.customer !== undefined ? String(b.customer) : cur.customer,
             b.site !== undefined ? String(b.site) : cur.site,
             b.prepared_by !== undefined ? String(b.prepared_by) : cur.prepared_by,
             b.payload !== undefined ? JSON.stringify(b.payload) : cur.payload, id);
      return json(res, 200, db.prepare('SELECT * FROM quotes WHERE id = ?').get(id));
    }
    if (req.method === 'DELETE' && id) {
      db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
  }

  // ---- pipeline CRUD ----
  if (parts[1] === 'pipeline') {
    if (req.method === 'GET') return json(res, 200, db.prepare("SELECT * FROM pipeline ORDER BY CASE stage WHEN 'won' THEN 2 WHEN 'lost' THEN 3 ELSE 1 END, next_action_date, id DESC").all());
    if (req.method === 'POST') {
      const b = await readBody(req);
      const r = db.prepare(`INSERT INTO pipeline (customer, contact, phone, email, site, product_line, value_est, stage, quote_number, next_action_date, notes, lost_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        String(b.customer || 'Unknown'), String(b.contact || ''), String(b.phone || ''), String(b.email || ''),
        String(b.site || ''), String(b.product_line || 'Glycol Heat Trace'), Number(b.value_est) || 0,
        String(b.stage || 'new'), String(b.quote_number || ''), String(b.next_action_date || ''),
        String(b.notes || ''), String(b.lost_reason || ''));
      return json(res, 200, db.prepare('SELECT * FROM pipeline WHERE id = ?').get(r.lastInsertRowid));
    }
    if (req.method === 'PUT' && id) {
      const b = await readBody(req);
      const cur = db.prepare('SELECT * FROM pipeline WHERE id = ?').get(id);
      if (!cur) return json(res, 404, { error: 'lead not found' });
      const v = (k, cast) => (b[k] === undefined || b[k] === null) ? cur[k] : (cast ? Number(b[k]) || 0 : String(b[k]));
      db.prepare(`UPDATE pipeline SET customer=?, contact=?, phone=?, email=?, site=?, product_line=?, value_est=?, stage=?, quote_number=?, next_action_date=?, notes=?, lost_reason=?, updated_at=datetime('now') WHERE id=?`)
        .run(v('customer'), v('contact'), v('phone'), v('email'), v('site'), v('product_line'), v('value_est', 1),
             v('stage'), v('quote_number'), v('next_action_date'), v('notes'), v('lost_reason'), id);
      return json(res, 200, db.prepare('SELECT * FROM pipeline WHERE id = ?').get(id));
    }
    if (req.method === 'DELETE' && id) { db.prepare('DELETE FROM pipeline WHERE id = ?').run(id); return json(res, 200, { ok: true }); }
  }

  // ---- install base CRUD ----
  if (parts[1] === 'installs') {
    if (req.method === 'GET') return json(res, 200, db.prepare("SELECT * FROM installs ORDER BY CASE status WHEN 'active' THEN 1 ELSE 2 END, id DESC").all());
    if (req.method === 'POST') {
      const b = await readBody(req);
      const r = db.prepare(`INSERT INTO installs (customer, site, region, unit_name, serial, fuel, install_date, last_service, service_interval_months, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        String(b.customer || 'Unknown'), String(b.site || ''), String(b.region || ''), String(b.unit_name || ''),
        String(b.serial || ''), String(b.fuel || 'Natural Gas'), String(b.install_date || ''), String(b.last_service || ''),
        Number(b.service_interval_months) || 12, String(b.status || 'active'), String(b.notes || ''));
      return json(res, 200, db.prepare('SELECT * FROM installs WHERE id = ?').get(r.lastInsertRowid));
    }
    if (req.method === 'PUT' && id) {
      const b = await readBody(req);
      const cur = db.prepare('SELECT * FROM installs WHERE id = ?').get(id);
      if (!cur) return json(res, 404, { error: 'install not found' });
      const v = (k, cast) => (b[k] === undefined || b[k] === null) ? cur[k] : (cast ? Number(b[k]) || 0 : String(b[k]));
      db.prepare(`UPDATE installs SET customer=?, site=?, region=?, unit_name=?, serial=?, fuel=?, install_date=?, last_service=?, service_interval_months=?, status=?, notes=? WHERE id=?`)
        .run(v('customer'), v('site'), v('region'), v('unit_name'), v('serial'), v('fuel'), v('install_date'),
             v('last_service'), v('service_interval_months', 1), v('status'), v('notes'), id);
      return json(res, 200, db.prepare('SELECT * FROM installs WHERE id = ?').get(id));
    }
    if (req.method === 'DELETE' && id) { db.prepare('DELETE FROM installs WHERE id = ?').run(id); return json(res, 200, { ok: true }); }
  }

  // ---- AI ----
  if (parts[1] === 'ai') {
    if (req.method === 'GET' && parts[2] === 'status') {
      return json(res, 200, { provider: aiProvider() });
    }
    if (req.method === 'POST' && parts[2] === 'ask') {
      const b = await readBody(req);
      const history = Array.isArray(b.history) ? b.history.slice(-10) : [];
      const messages = history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', text: String(h.text || '').slice(0, 8000) }));
      messages.push({ role: 'user', text: String(b.question || '').slice(0, 8000) });
      try {
        const out = await aiGenerate(kkSystemPrompt(), messages);
        return json(res, 200, out);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && parts[2] === 'analyze-doc') {
      const b = await readBody(req);
      if (!b.data_b64) return json(res, 400, { error: 'no file data received' });
      try {
        const out = await aiGenerate(kkSystemPrompt(), [{
          role: 'user', text: EXTRACT_PROMPT + `\n\nFile name: ${b.name || 'document'}`,
          attachment: { mime: b.mime || 'application/pdf', data_b64: b.data_b64 }
        }]);
        let extracted;
        try { extracted = parseJsonLoose(out.answer); }
        catch (e) { return json(res, 400, { error: 'AI reply was not valid JSON — try again. Raw start: ' + out.answer.slice(0, 200) }); }
        return json(res, 200, { extracted, provider: out.provider });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
  }

  // ---- knowledge base ----
  if (parts[1] === 'kb') {
    if (req.method === 'GET' && !id) {
      return json(res, 200, db.prepare(`SELECT id, name, mime, notes, created_at,
        CASE WHEN length(text_content) > 0 THEN 1 ELSE 0 END AS has_text,
        length(data) AS data_len FROM kb_docs ORDER BY id DESC`).all());
    }
    if (req.method === 'GET' && id && parts[3] === 'file') {
      const row = db.prepare('SELECT name, mime, data FROM kb_docs WHERE id = ?').get(id);
      if (!row || !row.data) return json(res, 404, { error: 'no file' });
      const buf = Buffer.from(row.data, 'base64');
      res.writeHead(200, { 'Content-Type': row.mime || 'application/octet-stream', 'Content-Length': buf.length,
        'Content-Disposition': `inline; filename="${row.name.replace(/[^\w.\- ]/g, '_')}"` });
      return res.end(buf);
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const isText = b.mime && (b.mime.startsWith('text/') || b.mime === 'application/json' || b.mime === 'text/csv');
      let textContent = '';
      if (b.text) textContent = String(b.text).slice(0, 100000);
      else if (isText && b.data_b64) textContent = Buffer.from(b.data_b64, 'base64').toString('utf8').slice(0, 100000);
      const r = db.prepare('INSERT INTO kb_docs (name, mime, data, text_content, notes) VALUES (?, ?, ?, ?, ?)')
        .run(String(b.name || 'document'), String(b.mime || ''), String(b.data_b64 || ''), textContent, String(b.notes || ''));
      const docId = r.lastInsertRowid;
      // Auto-digest binary docs so their numbers feed future AI context
      let digested = false;
      if (!textContent && b.data_b64 && aiProvider()) {
        try {
          const out = await aiGenerate(
            'You extract key facts and numbers from company documents into a dense reference digest.',
            [{ role: 'user',
               text: `Summarize this document into a dense plain-text digest for a knowledge base: every price, rate, spec, model number, quantity, term, and contact it contains. Use short lines, no prose padding. File name: ${b.name || 'document'}`,
               attachment: { mime: b.mime || 'application/pdf', data_b64: b.data_b64 } }]);
          db.prepare('UPDATE kb_docs SET text_content = ? WHERE id = ?').run('[AI digest]\n' + out.answer.slice(0, 20000), docId);
          digested = true;
        } catch (e) { /* no key / AI failure — doc still stored */ }
      }
      const row = db.prepare('SELECT id, name, mime, notes, created_at FROM kb_docs WHERE id = ?').get(docId);
      return json(res, 200, Object.assign(row, { digested }));
    }
    if (req.method === 'DELETE' && id) {
      db.prepare('DELETE FROM kb_docs WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: 'not found' });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    // static files
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(file).replace(/^([.][.][\\/])+/, '');
    const full = path.join(PUBLIC_DIR, file);
    if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      return fs.createReadStream(full).pipe(res);
    }
    // SPA fallback
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(PUBLIC_DIR, 'index.html')).pipe(res);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => console.log(`Kold Kalc running at http://localhost:${PORT} (db: ${DB_PATH})`));
