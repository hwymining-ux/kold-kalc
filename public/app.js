/* Kold Kalc — SPA (vanilla JS, no deps) */
'use strict';

const S = {
  settings: {},
  units: [],
  calc: null,      // current calculator state
  quoteId: null,   // loaded quote id
  quoteNumber: null,
  page: 'calc'
};

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-CA');
const money2 = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-CA', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const num = (n, d) => Number(n || 0).toLocaleString('en-CA', {maximumFractionDigits: d == null ? 1 : d});
const F = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

async function api(path, opts) {
  const res = await fetch(path, opts ? Object.assign({headers: {'Content-Type': 'application/json'}}, opts) : undefined);
  if (!res.ok) { let msg = res.status; try { msg = (await res.json()).error || msg; } catch (e) {} throw new Error(msg); }
  return res.json();
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.display = 'none', 3200);
}

/* ===================== calc state ===================== */
const GAL_L = 3.78541;
const SCF_PER_M3 = 35.3147;
const GJ_PER_SCF = 0.001076;   // 1,020 BTU/scf — Alberta GHG methodology default heating value
const KG_CO2_PER_SCF_NG = 0.0541; // EPA 53.06 kg CO2/MMBtu × 1,020 BTU/scf
const KG_CO2_PER_L_PROPANE = 1.51; // EPA 5.72 kg CO2/US gal ÷ 3.78541 L/gal

function defaultCalc() {
  const st = S.settings;
  const firstUnit = S.units[0] || {};
  return {
    customer: '', site: '', prepared_by: '',
    // electric heat trace
    len_ft: 300, watts_per_ft: F(st.def_watts_per_ft) || 5, trace_cost_ft: F(st.def_trace_cost_ft) || 12,
    voltage: [120, 208, 240, 277].includes(F(st.def_voltage)) ? F(st.def_voltage) : 240,
    startup_f: -40, breaker_a: 20, auto_kits: true,
    pk_qty: 2, pk_price: F(st.def_pk_price) || 350, ek_qty: 2, ek_price: F(st.def_ek_price) || 150,
    cable_ft: 100, cable_cost_ft: F(st.def_cable_cost_ft) || 6,
    elec_install: 2500, grid_ext: 0, elec_maint: 0,
    power_rate: F(st.power_rate_kwh) || 0.14,
    demand_charge: F(st.demand_charge_kw_mo) || 0,
    // shared operating assumptions
    season_months: F(st.season_months) || 7,
    duty_cycle_pct: F(st.duty_cycle_pct) || 60,
    analysis_years: F(st.analysis_years) || 10,
    // kold katcher
    unit_id: firstUnit.id || null,
    kk_kit_cost: F(firstUnit.kit_cost), kk_install: F(firstUnit.install_cost), kk_maint: F(firstUnit.maint_per_year),
    tube_cost_ft: F(st.def_tube_cost_ft) || 3.5, tube_install: F(st.def_tube_install) || 1500, fuel_hookup: F(st.def_fuel_hookup) || 800,
    fuel_type: 'ng',
    ng_usage: F(firstUnit.ng_scfh), ng_usage_unit: 'scf',
    gas_price: F(st.gas_price) || 2.5, gas_price_unit: st.gas_price_unit || 'GJ',
    site_gas: false,
    prop_usage: F(firstUnit.propane_lph), prop_usage_unit: 'L',
    prop_price: F(st.propane_price) || 0.65, prop_price_unit: st.propane_price_unit || 'L'
  };
}

// Maximum circuit lengths from the published Raychem BTV datasheet (Pentair/nVent
// H51086, "Maximum Circuit Lengths Based on Circuit Breaker Sizes"): feet per circuit
// by cable W/ft, start-up ambient (°F), voltage family, and breaker [15A, 20A, 30A, 40A].
const BTV_TABLE = {
  3: { 50: {120: [330, 330, 330, 330], 240: [660, 660, 660, 660]}, 0: {120: [200, 265, 330, 330], 240: [395, 530, 660, 660]},
       '-20': {120: [175, 235, 330, 330], 240: [350, 465, 660, 660]}, '-40': {120: [155, 205, 310, 330], 240: [310, 410, 620, 660]} },
  5: { 50: {120: [230, 270, 270, 270], 240: [460, 540, 540, 540]}, 0: {120: [140, 190, 270, 270], 240: [285, 380, 540, 540]},
       '-20': {120: [125, 165, 250, 270], 240: [250, 330, 500, 540]}, '-40': {120: [110, 145, 220, 270], 240: [220, 295, 440, 540]} },
  8: { 50: {120: [150, 200, 210, 210], 240: [300, 400, 420, 420]}, 0: {120: [100, 130, 200, 210], 240: [200, 265, 400, 420]},
       '-20': {120: [85, 115, 175, 210], 240: [175, 235, 350, 420]}, '-40': {120: [80, 105, 155, 210], 240: [155, 210, 315, 420]} },
  10: { 50: {120: [120, 160, 180, 180], 240: [240, 315, 360, 360]}, 0: {120: [80, 110, 160, 180], 240: [160, 215, 325, 360]},
        '-20': {120: [70, 95, 140, 180], 240: [145, 190, 285, 360]}, '-40': {120: [65, 85, 125, 170], 240: [125, 170, 255, 340]} }
};
// Datasheet circuit-length adjustment factors for 208 V and 277 V supplies
const LEN_ADJ_208 = { 3: 0.96, 5: 0.94, 8: 0.92, 10: 0.92 };
const LEN_ADJ_277 = { 3: 1.08, 5: 1.09, 8: 1.11, 10: 1.11 };
const BREAKER_IDX = { 15: 0, 20: 1, 30: 2, 40: 3 };
function nearestBtv(wpf) {
  return [3, 5, 8, 10].reduce((a, b) => Math.abs(b - wpf) < Math.abs(a - wpf) ? b : a);
}
function maxCircuitFt(c) {
  if (!c.watts_per_ft || !c.voltage) return 0;
  const wpf = nearestBtv(c.watts_per_ft);
  const byTemp = BTV_TABLE[wpf][String(c.startup_f)] || BTV_TABLE[wpf]['-40'];
  const family = c.voltage <= 130 ? 120 : 240;
  let ft = byTemp[family][BREAKER_IDX[c.breaker_a] != null ? BREAKER_IDX[c.breaker_a] : 1];
  if (c.voltage === 208) ft *= LEN_ADJ_208[wpf];
  if (c.voltage === 277) ft *= LEN_ADJ_277[wpf];
  return ft;
}
function circuitCount(c) {
  const mx = maxCircuitFt(c);
  if (!mx || !c.len_ft) return 1;
  return Math.max(1, Math.ceil(c.len_ft / mx));
}

// Editable assumption factors (default to the standard constants when unset)
function ngGjScf() { return F(S.settings.ng_energy_gj_scf) || GJ_PER_SCF; }
function ngCo2KgScf() { return F(S.settings.ng_co2_kg_scf) || KG_CO2_PER_SCF_NG; }
function propaneCo2KgL() { return F(S.settings.propane_co2_kg_l) || KG_CO2_PER_L_PROPANE; }
function gridCo2KgKwh() { return F(S.settings.grid_co2_kg_kwh) || 0.335; }

function compute(c) {
  const hours = c.season_months * 730.5 * (c.duty_cycle_pct / 100);
  // --- electric ---
  const kw = c.len_ft * c.watts_per_ft / 1000;
  const traceCost = c.len_ft * c.trace_cost_ft;
  const kitsCost = c.pk_qty * c.pk_price + c.ek_qty * c.ek_price;
  const cableCost = c.cable_ft * c.cable_cost_ft;
  const capexE = traceCost + kitsCost + cableCost + c.elec_install + c.grid_ext;
  const kwhYr = kw * hours;
  const energyCost = kwhYr * c.power_rate;
  const demandCost = c.demand_charge * kw * c.season_months;
  const opexE = energyCost + demandCost + c.elec_maint;
  // --- kold katcher (unit + tubing run the same footage as the trace) ---
  const tubeCost = c.len_ft * c.tube_cost_ft;
  const capexK = c.kk_kit_cost + c.kk_install + tubeCost + c.tube_install + c.fuel_hookup;
  let fuelCost = 0, fuelDetail = '', scfYr = 0, litresYr = 0, gjYr = 0;
  if (c.fuel_type === 'ng') {
    const scfh = c.ng_usage_unit === 'm3' ? c.ng_usage * SCF_PER_M3 : c.ng_usage;
    scfYr = scfh * hours;
    gjYr = scfYr * ngGjScf();
    if (c.site_gas) {
      fuelCost = 0;
      fuelDetail = `${num(gjYr, 0)} GJ/yr of site fuel gas (no purchase cost)`;
    } else {
      fuelCost = c.gas_price_unit === 'GJ' ? gjYr * c.gas_price : (scfYr / 1000) * c.gas_price;
      fuelDetail = `${num(gjYr, 0)} GJ/yr (${num(scfYr / 1000, 1)} Mcf) @ ${money2(c.gas_price)}/${c.gas_price_unit}`;
    }
  } else {
    const lph = c.prop_usage_unit === 'gal' ? c.prop_usage * GAL_L : c.prop_usage;
    litresYr = lph * hours;
    const pricePerL = c.prop_price_unit === 'gal' ? c.prop_price / GAL_L : c.prop_price;
    fuelCost = litresYr * pricePerL;
    fuelDetail = `${num(litresYr, 0)} L/yr (${num(litresYr / GAL_L, 0)} US gal) @ ${money2(c.prop_price)}/${c.prop_price_unit === 'gal' ? 'US gal' : 'L'}`;
  }
  const opexK = fuelCost + c.kk_maint;
  // --- comparison ---
  const savings = opexE - opexK;
  const capexDelta = capexK - capexE;
  let payback = null; // years
  if (capexDelta <= 0 && savings >= 0) payback = 0;
  else if (savings > 0) payback = capexDelta / savings;
  const years = Math.max(1, c.analysis_years);
  const tcoE = capexE + opexE * years;
  const tcoK = capexK + opexK * years;
  const tcoSavings = tcoE - tcoK;
  const roiPct = capexK > 0 ? (tcoSavings / capexK) * 100 : 0;
  // --- emissions (tonnes CO2e / yr) ---
  const co2E = kwhYr * gridCo2KgKwh() / 1000;
  const co2K = c.fuel_type === 'ng' ? scfYr * ngCo2KgScf() / 1000 : litresYr * propaneCo2KgL() / 1000;
  return {
    hours, kw, kwhYr, traceCost, kitsCost, cableCost, capexE, energyCost, demandCost, opexE,
    tubeCost, capexK, fuelCost, fuelDetail, scfYr, gjYr, litresYr, opexK,
    savings, capexDelta, payback, years, tcoE, tcoK, tcoSavings, roiPct, co2E, co2K
  };
}

/* ===================== calculator page ===================== */
function fld(label, id, value, opts) {
  const o = opts || {};
  const step = o.step != null ? o.step : 'any';
  return `<div class="field"><label for="${id}">${label}</label>
    <input type="${o.type || 'number'}" id="${id}" value="${esc(value)}" ${o.type === 'text' ? '' : `min="0" step="${step}"`} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''}>
    ${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</div>`;
}

function renderCalc() {
  const c = S.calc;
  const unitOpts = S.units.map(u =>
    `<option value="${u.id}" ${u.id === c.unit_id ? 'selected' : ''}>${esc(u.code)} — ${esc(u.name)}${u.coverage_ft ? ` (${esc(u.coverage_ft)})` : ''}</option>`).join('');
  $('#view').innerHTML = `
  <div class="card neutral">
    <h2>Project</h2>
    <div class="frow3">
      ${fld('Customer / Company', 'customer', c.customer, {type: 'text', ph: 'e.g. Spirit River Energy Ltd.'})}
      ${fld('Site / LSD', 'site', c.site, {type: 'text', ph: 'e.g. 04-21-078-05W6'})}
      ${fld('Prepared By', 'prepared_by', c.prepared_by, {type: 'text', ph: 'Your name'})}
    </div>
    <div class="actions">
      <button class="btn primary" id="btn-save">💾 ${S.quoteId ? 'Update ROI ' + esc(S.quoteNumber || '') : 'Save ROI'}</button>
      <button class="btn dark" id="btn-print">📄 PDF ROI</button>
      <button class="btn ghost" id="btn-new">＋ New Quote</button>
      <button class="btn ghost" id="btn-analyze">✨ Analyze a customer quote</button>
      ${S.quoteId ? `<span class="pill red">Editing ${esc(S.quoteNumber || ('#' + S.quoteId))}</span>` : ''}
    </div>
  </div>

  <div class="grid2">
    <div class="card elec">
      <h2><span class="dot blue"></span> Electric Heat Trace</h2>
      <div class="frow3">
        ${fld('Trace Length (ft)', 'len_ft', c.len_ft)}
        ${fld('Watts per Foot', 'watts_per_ft', c.watts_per_ft)}
        ${fld('Trace Cost ($/ft)', 'trace_cost_ft', c.trace_cost_ft)}
      </div>
      <div class="frow3">
        <div class="field"><label for="voltage">Voltage</label>
          <select id="voltage">${[120, 208, 240, 277].map(vv => `<option value="${vv}" ${c.voltage === vv ? 'selected' : ''}>${vv} V</option>`).join('')}</select>
        </div>
        <div class="field"><label for="breaker_a">Breaker</label>
          <select id="breaker_a">${[15, 20, 30, 40].map(bb => `<option value="${bb}" ${c.breaker_a === bb ? 'selected' : ''}>${bb} A</option>`).join('')}</select>
        </div>
        <div class="field"><label for="startup_f">Start-Up Ambient</label>
          <select id="startup_f">${[[50, '50°F (10°C)'], [0, '0°F (-18°C)'], [-20, '-20°F (-29°C)'], [-40, '-40°F (-40°C)']].map(([tv, tl]) => `<option value="${tv}" ${c.startup_f === tv ? 'selected' : ''}>${tl}</option>`).join('')}</select>
        </div>
      </div>
      <label class="checkline"><input type="checkbox" id="auto_kits" ${c.auto_kits ? 'checked' : ''}> Auto-size power &amp; end kits (Raychem BTV circuit tables)</label>
      <div class="subtotal"><span>Connected load</span><b id="sub-kw">—</b></div>
      <div class="subtotal" style="margin-top:6px"><span>Circuits required</span><b id="sub-circuits">—</b></div>
      <div class="frow" style="margin-top:10px">
        ${fld('Power Kits (qty)', 'pk_qty', c.pk_qty, {step: 1})}
        ${fld('Power Kit Price ($ ea)', 'pk_price', c.pk_price)}
        ${fld('End Kits (qty)', 'ek_qty', c.ek_qty, {step: 1})}
        ${fld('End Kit Price ($ ea)', 'ek_price', c.ek_price)}
        ${fld('Cable to Kits (ft)', 'cable_ft', c.cable_ft)}
        ${fld('Cable Cost ($/ft)', 'cable_cost_ft', c.cable_cost_ft)}
      </div>
      <div class="frow3">
        ${fld('Electrical Install ($)', 'elec_install', c.elec_install, {hint: 'Panel, GFEP breakers (code-required for heat trace), t-stat/controller, labour'})}
        ${fld('Grid / Line Extension ($)', 'grid_ext', c.grid_ext, {hint: 'Use ONLY if freeze protection is why power comes to site (e.g. gas well, no pumpjack). Power coming anyway? Leave $0.'})}
        ${fld('Maintenance ($/yr)', 'elec_maint', c.elec_maint)}
      </div>
      <div class="frow">
        ${fld('All-In Power Cost ($/kWh)', 'power_rate', c.power_rate, {step: 0.01, hint: 'Total bill ÷ kWh incl. T&D — AB oilfield typically ~14¢; use the actual customer bill'})}
        ${fld('Demand Charge ($/kW/mo)', 'demand_charge', c.demand_charge, {step: 0.01, hint: 'Only if on a demand tariff — keep $/kWh volumetric-only then'})}
      </div>
    </div>

    <div class="card kk">
      <h2><span class="dot red"></span> Kold Katcher Glycol Heat Trace</h2>
      <div class="field"><label for="unit_id">Kold Katcher Unit</label>
        <select id="unit_id">${unitOpts}</select>
        <div class="hint" id="unit-desc"></div>
        <div id="unit-suggest"></div>
      </div>
      <div class="frow3">
        ${fld('Unit / Kit Cost ($)', 'kk_kit_cost', c.kk_kit_cost)}
        ${fld('Unit Install ($)', 'kk_install', c.kk_install)}
        ${fld('Maintenance ($/yr)', 'kk_maint', c.kk_maint)}
      </div>
      <div class="frow3">
        ${fld('Tubing ($/ft)', 'tube_cost_ft', c.tube_cost_ft, {step: 0.05, hint: 'Runs the same footage as the trace'})}
        ${fld('Tubing Install ($)', 'tube_install', c.tube_install)}
        ${fld('Fuel Gas Hookup ($)', 'fuel_hookup', c.fuel_hookup)}
      </div>
      <div class="subtotal"><span>Tubing run</span><b id="sub-tube">—</b></div>
      <div class="field"><label>Fuel</label>
        <div class="seg" id="fuel-seg">
          <button data-f="ng" class="${c.fuel_type === 'ng' ? 'on' : ''}">Natural Gas</button>
          <button data-f="propane" class="${c.fuel_type === 'propane' ? 'on' : ''}">Propane</button>
        </div>
      </div>
      <div id="fuel-ng" style="display:${c.fuel_type === 'ng' ? '' : 'none'}">
        <div class="frow">
          <div class="field"><label for="ng_usage">Gas Usage</label>
            <div class="inline-unit">
              <input type="number" id="ng_usage" value="${esc(c.ng_usage)}" min="0" step="any">
              <select id="ng_usage_unit"><option value="scf" ${c.ng_usage_unit === 'scf' ? 'selected' : ''}>scf/hr</option><option value="m3" ${c.ng_usage_unit === 'm3' ? 'selected' : ''}>m³/hr</option></select>
            </div></div>
          <div class="field"><label for="gas_price">Gas Price</label>
            <div class="inline-unit">
              <input type="number" id="gas_price" value="${esc(c.gas_price)}" min="0" step="0.01">
              <select id="gas_price_unit"><option value="GJ" ${c.gas_price_unit === 'GJ' ? 'selected' : ''}>$/GJ</option><option value="Mcf" ${c.gas_price_unit === 'Mcf' ? 'selected' : ''}>$/Mcf</option></select>
            </div></div>
        </div>
        <label class="checkline"><input type="checkbox" id="site_gas" ${c.site_gas ? 'checked' : ''}>
          Runs on site fuel gas (produced gas — no purchase cost)</label>
        <div class="hint" style="margin:-2px 0 8px 24px">If that gas is conserved and could be sold, it isn't free — uncheck and price it at market instead.</div>
      </div>
      <div id="fuel-propane" style="display:${c.fuel_type === 'propane' ? '' : 'none'}">
        <div class="frow">
          <div class="field"><label for="prop_usage">Propane Usage</label>
            <div class="inline-unit">
              <input type="number" id="prop_usage" value="${esc(c.prop_usage)}" min="0" step="any">
              <select id="prop_usage_unit"><option value="L" ${c.prop_usage_unit === 'L' ? 'selected' : ''}>L/hr</option><option value="gal" ${c.prop_usage_unit === 'gal' ? 'selected' : ''}>US gal/hr</option></select>
            </div></div>
          <div class="field"><label for="prop_price">Propane Price</label>
            <div class="inline-unit">
              <input type="number" id="prop_price" value="${esc(c.prop_price)}" min="0" step="0.01">
              <select id="prop_price_unit"><option value="L" ${c.prop_price_unit === 'L' ? 'selected' : ''}>$/L</option><option value="gal" ${c.prop_price_unit === 'gal' ? 'selected' : ''}>$/US gal</option></select>
            </div></div>
        </div>
      </div>
      <div class="subtotal"><span>Annual fuel</span><b id="sub-fuel">—</b></div>
    </div>
  </div>

  <div class="card neutral">
    <h2>Operating Assumptions</h2>
    <div class="grid3">
      ${fld('Freeze Season (months/yr)', 'season_months', c.season_months, {step: 0.5, hint: 'Oct – Apr ≈ 7 months'})}
      ${fld('Duty Cycle (%)', 'duty_cycle_pct', c.duty_cycle_pct, {step: 1, hint: 'Thermostat run-time'})}
      ${fld('Analysis Period (years)', 'analysis_years', c.analysis_years, {step: 1})}
    </div>
    <div class="subtotal"><span>Operating hours per year</span><b id="sub-hours">—</b></div>
  </div>

  <div id="results"></div>`;

  // bindings
  const NUM_IDS = ['len_ft','watts_per_ft','trace_cost_ft','pk_qty','pk_price','ek_qty','ek_price','cable_ft','cable_cost_ft',
    'elec_install','grid_ext','elec_maint','power_rate','demand_charge','season_months','duty_cycle_pct','analysis_years',
    'kk_kit_cost','kk_install','kk_maint','tube_cost_ft','tube_install','fuel_hookup','ng_usage','gas_price','prop_usage','prop_price'];
  NUM_IDS.forEach(idn => { const el = $('#' + idn); if (el) el.addEventListener('input', () => { S.calc[idn] = F(el.value); refreshResults(); }); });
  ['customer','site','prepared_by'].forEach(idn => { const el = $('#' + idn); el.addEventListener('input', () => S.calc[idn] = el.value); });
  ['ng_usage_unit','gas_price_unit','prop_usage_unit','prop_price_unit'].forEach(idn => {
    const el = $('#' + idn); if (el) el.addEventListener('change', () => { S.calc[idn] = el.value; refreshResults(); });
  });
  $('#site_gas').addEventListener('change', e => { S.calc.site_gas = e.target.checked; refreshResults(); });
  $('#voltage').addEventListener('change', e => { S.calc.voltage = F(e.target.value); refreshResults(); });
  $('#breaker_a').addEventListener('change', e => { S.calc.breaker_a = F(e.target.value); refreshResults(); });
  $('#startup_f').addEventListener('change', e => { S.calc.startup_f = F(e.target.value); refreshResults(); });
  $('#auto_kits').addEventListener('change', e => { S.calc.auto_kits = e.target.checked; refreshResults(); });
  $('#unit_id').addEventListener('change', e => { applyUnit(parseInt(e.target.value, 10)); });
  $$('#fuel-seg button').forEach(b => b.addEventListener('click', () => {
    S.calc.fuel_type = b.dataset.f;
    $$('#fuel-seg button').forEach(x => x.classList.toggle('on', x === b));
    $('#fuel-ng').style.display = b.dataset.f === 'ng' ? '' : 'none';
    $('#fuel-propane').style.display = b.dataset.f === 'propane' ? '' : 'none';
    refreshResults();
  }));
  $('#btn-save').addEventListener('click', saveQuote);
  $('#btn-print').addEventListener('click', printQuote);
  $('#btn-new').addEventListener('click', () => { S.quoteId = null; S.quoteNumber = null; S.calc = defaultCalc(); renderCalc(); });
  $('#btn-analyze').addEventListener('click', () => go('ai'));
  showUnitDesc();
  refreshResults();
}

function applyUnit(unitId) {
  const u = S.units.find(x => x.id === unitId);
  if (!u) return;
  const c = S.calc;
  c.unit_id = u.id;
  c.kk_kit_cost = F(u.kit_cost); c.kk_install = F(u.install_cost); c.kk_maint = F(u.maint_per_year);
  c.ng_usage = F(u.ng_scfh); c.ng_usage_unit = 'scf';
  c.prop_usage = F(u.propane_lph); c.prop_usage_unit = 'L';
  ['kk_kit_cost','kk_install','kk_maint','ng_usage','prop_usage'].forEach(idn => { const el = $('#' + idn); if (el) el.value = c[idn]; });
  $('#ng_usage_unit').value = 'scf'; $('#prop_usage_unit').value = 'L';
  showUnitDesc();
  refreshResults();
}
function showUnitDesc() {
  const u = S.units.find(x => x.id === S.calc.unit_id);
  $('#unit-desc').textContent = u ? (u.description || '') : '';
}

function parseCoverage(txt) {
  const m = String(txt || '').match(/(\d[\d,]*)\D+(\d[\d,]*)/);
  if (!m) return null;
  return { lo: parseFloat(m[1].replace(/,/g, '')), hi: parseFloat(m[2].replace(/,/g, '')) };
}
function updateUnitSuggest() {
  const el = $('#unit-suggest');
  if (!el) return;
  const len = S.calc.len_ft;
  const ranged = S.units.map(u => ({ u, r: parseCoverage(u.coverage_ft) })).filter(x => x.r);
  let pick = ranged.find(x => len >= x.r.lo && len <= x.r.hi);
  if (!pick && ranged.length && len > Math.max(...ranged.map(x => x.r.hi))) {
    pick = ranged.reduce((a, b) => (b.r.hi > a.r.hi ? b : a));
  }
  if (!pick || pick.u.id === S.calc.unit_id) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="suggest-pill" id="suggest-apply">💡 ${num(len)} ft run → Unit ${esc(pick.u.code)} (${esc(pick.u.coverage_ft)}) — click to apply</span>`;
  $('#suggest-apply').addEventListener('click', () => { $('#unit_id').value = pick.u.id; applyUnit(pick.u.id); });
}

function refreshResults() {
  const c = S.calc;
  // auto-size power & end kits: one power connection + one end seal per circuit
  const circuits = circuitCount(c);
  if (c.auto_kits) {
    c.pk_qty = circuits; c.ek_qty = circuits;
    const pk = $('#pk_qty'), ek = $('#ek_qty');
    if (pk) { pk.value = circuits; pk.disabled = true; }
    if (ek) { ek.value = circuits; ek.disabled = true; }
  } else {
    const pk = $('#pk_qty'), ek = $('#ek_qty');
    if (pk) pk.disabled = false;
    if (ek) ek.disabled = false;
  }
  const r = compute(c);
  updateUnitSuggest();
  const mx = maxCircuitFt(c);
  $('#sub-circuits').textContent = `${circuits} × ${num(c.voltage, 0)} V circuits — max ${num(mx, 0)} ft each (${nearestBtv(c.watts_per_ft)}BTV @ ${num(c.startup_f, 0)}°F start-up, ${num(c.breaker_a, 0)} A)`;
  $('#sub-tube').textContent = `${num(c.len_ft)} ft × ${money2(c.tube_cost_ft)}/ft = ${money(r.tubeCost)}`;
  $('#sub-kw').textContent = `${num(r.kw, 2)} kW  (${num(c.len_ft)} ft × ${num(c.watts_per_ft)} W/ft)`;
  $('#sub-hours').textContent = `${num(r.hours, 0)} hrs  (${num(c.season_months)} mo × ${num(c.duty_cycle_pct, 0)}% duty)`;
  $('#sub-fuel').textContent = r.fuelDetail + (r.fuelCost || !c.site_gas ? ` = ${money(r.fuelCost)}/yr` : '');

  const pb = r.payback;
  const pbText = pb === 0 ? 'Immediate' : (pb == null ? '—' : (pb > r.years * 2 ? '> ' + r.years * 2 + ' yrs' : num(pb, 1) + ' yrs'));
  const pbSub = pb === 0 ? 'KK wins on day one' : (pb == null ? 'No operating savings at these rates' : (pb <= r.years ? `≈ ${Math.round(pb * 12)} months` : 'Beyond analysis period'));
  const winner = r.tcoSavings >= 0 ? 'kk' : 'elec';

  $('#results').innerHTML = `
  <div class="tiles">
    <div class="tile hero"><div class="t-label">Electric Load Displaced</div><div class="t-value">${num(r.kw, 2)} kW</div><div class="t-sub">${num(r.kwhYr, 0)} kWh / year</div></div>
    <div class="tile"><div class="t-label">Annual Operating Savings</div><div class="t-value ${r.savings >= 0 ? 'good' : 'bad'}">${money(r.savings)}</div><div class="t-sub">Electric ${money(r.opexE)} vs KK ${money(r.opexK)}</div></div>
    <div class="tile"><div class="t-label">Payback</div><div class="t-value ${pb != null && (pb <= r.years) ? 'good' : ''}">${pbText}</div><div class="t-sub">${pbSub}</div></div>
    <div class="tile"><div class="t-label">${r.years}-Year Savings with KK</div><div class="t-value ${r.tcoSavings >= 0 ? 'good' : 'bad'}">${money(r.tcoSavings)}</div><div class="t-sub">Undiscounted · ROI ${num(r.roiPct, 0)}% on KK investment</div></div>
  </div>

  <div class="grid2">
    <div class="card neutral">
      <h2>Cost Comparison</h2>
      <table class="compare">
        <thead><tr><th></th><th class="col-e">Electric</th><th class="col-k">Kold Katcher</th></tr></thead>
        <tbody>
          <tr><td>Heat trace cable (${num(c.len_ft)} ft @ ${num(c.voltage, 0)} V)</td><td>${money(r.traceCost)}</td><td>—</td></tr>
          <tr><td>Power kits (${num(c.pk_qty, 0)}) &amp; end kits (${num(c.ek_qty, 0)})</td><td>${money(r.kitsCost)}</td><td>—</td></tr>
          <tr><td>Cable to kits</td><td>${money(r.cableCost)}</td><td>—</td></tr>
          <tr><td>Electrical install</td><td>${money(c.elec_install)}</td><td>—</td></tr>
          ${c.grid_ext ? `<tr><td>Grid / line extension</td><td>${money(c.grid_ext)}</td><td>—</td></tr>` : ''}
          <tr><td>KK unit &amp; install</td><td>—</td><td>${money(c.kk_kit_cost + c.kk_install)}</td></tr>
          <tr><td>Tubing (${num(c.len_ft)} ft) &amp; install</td><td>—</td><td>${money(r.tubeCost + c.tube_install)}</td></tr>
          <tr><td>Fuel gas hookup</td><td>—</td><td>${money(c.fuel_hookup)}</td></tr>
          <tr class="total"><td>Capital cost</td><td>${money(r.capexE)}</td><td>${money(r.capexK)}</td></tr>
          <tr><td>Energy${r.demandCost ? ' + demand' : ''} / yr</td><td>${money(r.energyCost + r.demandCost)}</td><td>—</td></tr>
          <tr><td>Fuel / yr</td><td>—</td><td>${money(r.fuelCost)}</td></tr>
          <tr><td>Maintenance / yr</td><td>${money(c.elec_maint)}</td><td>${money(c.kk_maint)}</td></tr>
          <tr class="total"><td>Operating cost / yr</td><td>${money(r.opexE)}</td><td>${money(r.opexK)}</td></tr>
          <tr class="total"><td>${r.years}-yr total cost</td><td>${money(r.tcoE)}</td><td>${money(r.tcoK)}</td></tr>
          <tr><td><b>Advantage — ${winner === 'kk' ? 'Kold Katcher' : 'Electric'}</b></td>
            <td colspan="2" class="${r.tcoSavings >= 0 ? 'delta-good' : 'delta-bad'}">${money(Math.abs(r.tcoSavings))} over ${r.years} yrs</td></tr>
        </tbody>
      </table>
    </div>
    <div class="card neutral">
      <h2>Cumulative Cost — Breakeven</h2>
      <div class="legend">
        <span><span class="dot blue"></span> Electric heat trace</span>
        <span><span class="dot red"></span> Kold Katcher</span>
      </div>
      <div class="chart-wrap">
        <canvas id="roiChart"></canvas>
        <div class="chart-tip" id="chart-tip"></div>
      </div>
    </div>
  </div>

  <div class="card neutral">
    <h2>Environmental &amp; Site Notes</h2>
    <div class="grid3">
      <div><b>Electric emissions:</b> ${num(r.co2E, 1)} t CO₂e/yr<div class="hint">Grid @ ${num(gridCo2KgKwh(), 2)} kg/kWh</div></div>
      <div><b>Kold Katcher emissions:</b> ${num(r.co2K, 1)} t CO₂e/yr<div class="hint">${c.fuel_type === 'ng' ? 'Natural gas combustion' : 'Propane combustion'}</div></div>
      <div><b>Difference:</b> ${num(Math.abs(r.co2E - r.co2K), 1)} t CO₂e/yr ${r.co2E >= r.co2K ? 'lower with KK' : 'higher with KK'}</div>
    </div>
    <div class="hint" style="margin-top:8px"><b>Why operators choose KK beyond cost:</b> no grid dependency; no ground faults or nuisance breaker trips (electric heat trace's #1 failure); no voltage-drop limit on long runs; no Class I Div. hazardous-area electrical on the piping; no fire-tube burner risk; and the glycol loop keeps protecting through power outages.</div>
  </div>`;

  attachCumulativeChart('roiChart', 'chart-tip', {
    a: { label: 'Electric', color: '#2563eb', capex: r.capexE, opex: r.opexE },
    b: { label: 'Kold Katcher', color: '#da2727', capex: r.capexK, opex: r.opexK },
    years: r.years, advantage: 'KK advantage'
  });
}

/* ===================== generic cumulative-cost chart ===================== */
// cfg: { a: {label,color,capex,opex}, b: {label,color,capex,opex}, years, advantage: 'b beats a label' }
const activeCharts = {};
// Pure drawing core (logical coordinates). Returns geometry for hover hit-testing.
function drawCumulative(ctx, W, H, cfg, opts) {
  opts = opts || {};
  const bg = opts.bg;
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); } else { ctx.clearRect(0, 0, W, H); }
  const years = Math.max(1, cfg.years);
  const months = years * 12;
  const ptsA = [], ptsB = [];
  for (let m = 0; m <= months; m++) {
    ptsA.push(cfg.a.capex + cfg.a.opex * (m / 12));
    ptsB.push(cfg.b.capex + cfg.b.opex * (m / 12));
  }
  const maxY = Math.max(...ptsA, ...ptsB) * 1.10 || 1;
  const padL = 64, padR = 96, padT = 16, padB = 36;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const X = m => padL + (m / months) * plotW;
  const Y = v => padT + plotH - (v / maxY) * plotH;
  const S = opts.fontScale || 1;

  ctx.font = `${11.5 * S}px Cabin, sans-serif`;
  ctx.fillStyle = '#98918a'; ctx.strokeStyle = '#ece8e2'; ctx.lineWidth = 1 * S;
  for (let i = 0; i <= 5; i++) {
    const v = maxY * i / 5, y = Y(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v), padL - 8, y + 4);
  }
  ctx.textAlign = 'center';
  const xStep = years <= 6 ? 1 : 2;
  for (let yr = 0; yr <= years; yr += xStep) ctx.fillText(yr === 0 ? 'Now' : 'Yr ' + yr, X(yr * 12), H - padB + 20);
  ctx.strokeStyle = '#d8d3cc'; ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.stroke();

  // breakeven marker
  let beM = null;
  if (cfg.a.opex !== cfg.b.opex) {
    const t = (cfg.b.capex - cfg.a.capex) / (cfg.a.opex - cfg.b.opex);
    if (t > 0 && t < years) beM = t * 12;
  }
  if (beM != null) {
    const bx = X(beM);
    ctx.save();
    ctx.strokeStyle = '#b0a89f'; ctx.setLineDash([4 * S, 4 * S]); ctx.lineWidth = 1.4 * S;
    ctx.beginPath(); ctx.moveTo(bx, padT); ctx.lineTo(bx, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#6b655e'; ctx.font = `600 ${11.5 * S}px Cabin, sans-serif`; ctx.textAlign = beM > months / 2 ? 'right' : 'left';
    ctx.fillText('Breakeven ≈ ' + num(beM / 12, 1) + ' yrs', bx + (beM > months / 2 ? -7 : 7), padT + 14 * S);
    ctx.restore();
  }

  // fill the savings wedge between the two lines (subtle)
  if (opts.fill) {
    ctx.save();
    ctx.beginPath();
    ptsA.forEach((v, m) => { const x = X(m), y = Y(v); m === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    for (let m = months; m >= 0; m--) ctx.lineTo(X(m), Y(ptsB[m]));
    ctx.closePath();
    ctx.fillStyle = 'rgba(26,127,55,.07)';
    ctx.fill();
    ctx.restore();
  }

  const line = (pts, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2.4 * S; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((v, m) => { const x = X(m), y = Y(v); m === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();
  };
  line(ptsA, cfg.a.color);
  line(ptsB, cfg.b.color);

  // direct labels at line ends
  ctx.font = `700 ${12 * S}px Cabin, sans-serif`; ctx.textAlign = 'left';
  let lA = Y(ptsA[months]), lB = Y(ptsB[months]);
  if (Math.abs(lA - lB) < 16 * S) { if (lA < lB) { lA -= 8 * S; lB += 8 * S; } else { lA += 8 * S; lB -= 8 * S; } }
  ctx.fillStyle = cfg.a.color; ctx.fillText(cfg.a.label, W - padR + 8, lA + 4);
  ctx.fillStyle = cfg.b.color; ctx.fillText(cfg.b.label, W - padR + 8, lB + 4);

  return { padL, padR, plotW, months, ptsA, ptsB };
}
// High-resolution PNG for the PDF (crisp when enlarged; opaque white background)
function cumulativeChartDataURL(cfg, W, H) {
  const scale = 2;
  const cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  drawCumulative(ctx, W, H, cfg, { bg: '#ffffff', fill: true });
  return cv.toDataURL('image/png');
}
function attachCumulativeChart(cvId, tipId, cfg) {
  const cv = document.getElementById(cvId);
  if (!cv) return;
  activeCharts[cvId] = () => attachCumulativeChart(cvId, tipId, cfg);
  const wrap = cv.parentElement;
  const W = wrap.clientWidth || 560, H = cfg.height || 340;
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const geo = drawCumulative(ctx, W, H, cfg, { fill: true });
  const { padL, plotW, months, ptsA, ptsB } = geo;

  const tip = document.getElementById(tipId);
  cv.onmousemove = ev => {
    const rect = cv.getBoundingClientRect();
    let m = Math.round((ev.clientX - rect.left - padL) / plotW * months);
    m = Math.max(0, Math.min(months, m));
    const vA = ptsA[m], vB = ptsB[m];
    tip.innerHTML = `<div class="tt-t">${m === 0 ? 'Day one' : 'Year ' + num(m / 12, 1)}</div>
      <div class="row"><span style="color:${cfg.a.color}">● ${esc(cfg.a.label)}</span><b>${money(vA)}</b></div>
      <div class="row"><span style="color:${cfg.b.color}">● ${esc(cfg.b.label)}</span><b>${money(vB)}</b></div>
      <div class="row" style="border-top:1px solid #eee;margin-top:3px;padding-top:3px"><span>${esc(cfg.advantage || cfg.b.label + ' advantage')}</span><b style="color:${vA - vB >= 0 ? '#1a7f37' : '#b31f1f'}">${money(vA - vB)}</b></div>`;
    tip.style.display = 'block';
    const wr = wrap.getBoundingClientRect();
    let tx = ev.clientX - wr.left + 14;
    if (tx + 190 > wr.width) tx = ev.clientX - wr.left - 205;
    tip.style.left = tx + 'px';
    tip.style.top = Math.max(0, ev.clientY - wr.top - 40) + 'px';
  };
  cv.onmouseleave = () => { tip.style.display = 'none'; };
}
window.addEventListener('resize', () => {
  for (const [cvId, redraw] of Object.entries(activeCharts)) {
    if (document.getElementById(cvId)) redraw(); else delete activeCharts[cvId];
  }
});

/* ===================== quotes ===================== */
async function saveQuote() {
  const c = S.calc;
  const body = { customer: c.customer, site: c.site, prepared_by: c.prepared_by, payload: c };
  try {
    if (S.quoteId) {
      await api('/api/quotes/' + S.quoteId, { method: 'PUT', body: JSON.stringify(body) });
      toast('ROI ' + (S.quoteNumber || '') + ' updated');
    } else {
      const q = await api('/api/quotes', { method: 'POST', body: JSON.stringify(body) });
      S.quoteId = q.id; S.quoteNumber = q.quote_number;
      toast('Saved as ' + q.quote_number);
      renderCalc();
    }
  } catch (e) { toast('Save failed: ' + e.message); }
}

async function renderQuotes() {
  const gen = S.renderGen;
  const rows = await api('/api/quotes');
  if (gen !== S.renderGen) return; // user navigated away while loading
  $('#view').innerHTML = `
  <div class="card neutral">
    <h2>Saved ROIs</h2>
    ${rows.length === 0 ? '<div class="empty">No saved quotes yet. Build one in the Calculator and hit Save.</div>' : `
    <table class="list">
      <thead><tr><th>Quote #</th><th>Customer</th><th>Site</th><th>Prepared By</th><th>Updated</th><th></th></tr></thead>
      <tbody>${rows.map(q => `
        <tr>
          <td><b>${esc(q.quote_number)}</b></td>
          <td>${esc(q.customer) || '<span class="hint">—</span>'}</td>
          <td>${esc(q.site) || '<span class="hint">—</span>'}</td>
          <td>${esc(q.prepared_by) || '<span class="hint">—</span>'}</td>
          <td>${esc((q.updated_at || '').slice(0, 16))}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn small primary" data-act="open" data-id="${q.id}">Open</button>
            <button class="btn small ghost" data-act="dup" data-id="${q.id}">Duplicate</button>
            <button class="btn small ghost" data-act="pipe" data-id="${q.id}">→ Pipeline</button>
            <button class="btn small danger" data-act="del" data-id="${q.id}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  </div>`;
  $$('#view [data-act]').forEach(b => b.addEventListener('click', async () => {
    const qid = parseInt(b.dataset.id, 10);
    if (b.dataset.act === 'open' || b.dataset.act === 'dup') {
      const q = await api('/api/quotes/' + qid);
      S.calc = Object.assign(defaultCalc(), JSON.parse(q.payload || '{}'));
      if (b.dataset.act === 'open') { S.quoteId = q.id; S.quoteNumber = q.quote_number; }
      else { S.quoteId = null; S.quoteNumber = null; toast('Duplicated — save to get a new quote #'); }
      go('calc');
    } else if (b.dataset.act === 'pipe') {
      const q = await api('/api/quotes/' + qid);
      const existing = await api('/api/pipeline').catch(() => []);
      if (existing.some(x => x.quote_number === q.quote_number && x.stage !== 'lost')) {
        toast(q.quote_number + ' is already in the pipeline');
        S.tool = 'pipeline'; go('tools');
        return;
      }
      let p = {}; try { p = JSON.parse(q.payload || '{}'); } catch (e) {}
      const next = new Date(); next.setDate(next.getDate() + 7);
      await api('/api/pipeline', { method: 'POST', body: JSON.stringify({
        customer: q.customer || 'Unknown', site: q.site, product_line: 'Glycol Heat Trace',
        value_est: (F(p.kk_kit_cost) + F(p.kk_install)) || 0, stage: 'quoted',
        quote_number: q.quote_number, next_action_date: next.toISOString().slice(0, 10),
        notes: 'Created from saved quote ' + q.quote_number
      }) });
      toast(q.quote_number + ' added to pipeline — follow-up set for next week');
      S.tool = 'pipeline'; go('tools');
    } else if (b.dataset.act === 'del') {
      if (!confirm('Delete this quote?')) return;
      await api('/api/quotes/' + qid, { method: 'DELETE' });
      if (S.quoteId === qid) { S.quoteId = null; S.quoteNumber = null; }
      renderQuotes();
    }
  }));
}

/* ===================== unit catalog admin ===================== */
async function renderUnits() {
  const units = await api('/api/units');
  $('#view').innerHTML = `
  <div class="note-banner">⚙️ Loaded from Kold Katcher's official 2026 price sheets: real CDN list pricing and manufacturer burn rates (gas consumption @ maximum output). S-series = complete solar; T-series = customer-supplied power. Propane L/hr is derived from the BTU rating — confirm with KK. Install & maintenance are estimates: set your real numbers.</div>
  <div class="card neutral">
    <h2>Kold Katcher Unit Catalog</h2>
    <table class="list">
      <thead><tr><th></th><th>Name</th><th>Coverage</th><th>Kit Cost</th><th>Install</th><th>NG scf/hr</th><th>Propane L/hr</th><th>Maint/yr</th><th>Active</th><th></th></tr></thead>
      <tbody>${units.map(u => `
        <tr>
          <td><span class="badge-code">${esc(u.code)}</span></td>
          <td>${esc(u.name)}</td>
          <td>${esc(u.coverage_ft)}</td>
          <td>${money(u.kit_cost)}</td>
          <td>${money(u.install_cost)}</td>
          <td>${num(u.ng_scfh)}</td>
          <td>${num(u.propane_lph, 2)}</td>
          <td>${money(u.maint_per_year)}</td>
          <td>${u.active ? '✅' : '—'}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn small ghost" data-edit="${u.id}">Edit</button>
            <button class="btn small danger" data-del="${u.id}">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="actions" style="margin-top:14px"><button class="btn primary" id="btn-add-unit">＋ Add Unit</button></div>
  </div>
  <div id="unit-form"></div>`;
  $('#btn-add-unit').addEventListener('click', () => unitForm(null));
  $$('#view [data-edit]').forEach(b => b.addEventListener('click', () => unitForm(units.find(u => u.id === parseInt(b.dataset.edit, 10)))));
  $$('#view [data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this unit from the catalog?')) return;
    await api('/api/units/' + b.dataset.del, { method: 'DELETE' });
    toast('Unit deleted'); loadBootstrap().then(renderUnits);
  }));
}

function unitForm(u) {
  const isNew = !u;
  u = u || { code: '', name: '', description: '', coverage_ft: '', kit_cost: 0, install_cost: 0, ng_scfh: 0, propane_lph: 0, maint_per_year: 0, sort: 99, active: 1 };
  $('#unit-form').innerHTML = `
  <div class="card kk">
    <h2>${isNew ? 'Add Unit' : 'Edit — ' + esc(u.name)}</h2>
    <div class="frow3">
      ${fld('Code (S10 / T20 …)', 'u-code', u.code, {type: 'text'})}
      ${fld('Name', 'u-name', u.name, {type: 'text'})}
      ${fld('Coverage (e.g. 175 – 350 ft)', 'u-cov', u.coverage_ft, {type: 'text'})}
    </div>
    <div class="frow3">
      ${fld('Kit Cost ($)', 'u-kit', u.kit_cost)}
      ${fld('Install Cost ($)', 'u-inst', u.install_cost)}
      ${fld('Maintenance ($/yr)', 'u-maint', u.maint_per_year)}
    </div>
    <div class="frow3">
      ${fld('Nat Gas Usage (scf/hr)', 'u-ng', u.ng_scfh)}
      ${fld('Propane Usage (L/hr)', 'u-prop', u.propane_lph, {step: 0.01})}
      ${fld('Sort Order', 'u-sort', u.sort, {step: 1})}
    </div>
    <div class="field"><label for="u-desc">Description</label><textarea id="u-desc" rows="2" style="width:100%;font:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 10px">${esc(u.description)}</textarea></div>
    <label class="checkline"><input type="checkbox" id="u-active" ${u.active ? 'checked' : ''}> Active (shown in calculator)</label>
    <div class="actions">
      <button class="btn primary" id="u-save">${isNew ? 'Add Unit' : 'Save Changes'}</button>
      <button class="btn ghost" id="u-cancel">Cancel</button>
    </div>
  </div>`;
  $('#unit-form').scrollIntoView({ behavior: 'smooth' });
  $('#u-cancel').addEventListener('click', () => $('#unit-form').innerHTML = '');
  $('#u-save').addEventListener('click', async () => {
    const body = {
      code: $('#u-code').value.trim() || '?', name: $('#u-name').value.trim() || 'Unit',
      coverage_ft: $('#u-cov').value.trim(), description: $('#u-desc').value,
      kit_cost: F($('#u-kit').value), install_cost: F($('#u-inst').value), maint_per_year: F($('#u-maint').value),
      ng_scfh: F($('#u-ng').value), propane_lph: F($('#u-prop').value), sort: F($('#u-sort').value),
      active: $('#u-active').checked
    };
    try {
      if (isNew) await api('/api/units', { method: 'POST', body: JSON.stringify(body) });
      else await api('/api/units/' + u.id, { method: 'PUT', body: JSON.stringify(body) });
      toast(isNew ? 'Unit added' : 'Unit updated');
      await loadBootstrap(); renderUnits();
    } catch (e) { toast('Save failed: ' + e.message); }
  });
}

/* ===================== settings ===================== */
function renderSettings() {
  const st = S.settings;
  $('#view').innerHTML = `
  <div class="card elec">
    <h2>My Standard Inputs — pre-fill every new quote</h2>
    <div class="grid3">
      ${fld('Watts per Foot', 'sd-wpf', st.def_watts_per_ft, {step: 0.5})}
      ${fld('Trace Cost ($/ft)', 'sd-trace', st.def_trace_cost_ft, {step: 0.25})}
      <div class="field"><label>Voltage</label><select id="sd-volt">${[120, 208, 240, 277].map(vv => `<option value="${vv}" ${String(vv) === String(st.def_voltage) ? 'selected' : ''}>${vv} V</option>`).join('')}</select></div>
      ${fld('Power Kit Price ($ ea)', 'sd-pk', st.def_pk_price)}
      ${fld('End Kit Price ($ ea)', 'sd-ek', st.def_ek_price)}
      ${fld('Cable Cost ($/ft)', 'sd-cable', st.def_cable_cost_ft, {step: 0.25})}
      ${fld('KK Tubing ($/ft)', 'sd-tube', st.def_tube_cost_ft, {step: 0.05})}
      ${fld('KK Tubing Install ($)', 'sd-tubei', st.def_tube_install)}
      ${fld('KK Fuel Gas Hookup ($)', 'sd-hookup', st.def_fuel_hookup)}
    </div>
    <p class="hint">Burn rates per unit size (scf/hr and L/hr for each burner) live in the <b>Unit Catalog</b> tab — picking a unit (S5KX–T40KX) in the calculator pulls them in automatically.</p>
  </div>
  <div class="card neutral">
    <h2>Default Rates &amp; Assumptions</h2>
    <p class="hint" style="margin-top:0">Used to pre-fill every new quote. Individual quotes can always override them.</p>
    <div class="grid3">
      ${fld('Power Cost ($/kWh)', 's-power', st.power_rate_kwh, {step: 0.01})}
      ${fld('Demand Charge ($/kW/mo)', 's-demand', st.demand_charge_kw_mo, {step: 0.01})}
      ${fld('Grid CO₂ (kg/kWh)', 's-co2', st.grid_co2_kg_kwh, {step: 0.01, hint: 'Alberta grid ≈ 0.34 (2024 published)'})}
      <div class="field"><label>Gas Price</label><div class="inline-unit">
        <input type="number" id="s-gas" value="${esc(st.gas_price)}" min="0" step="0.01">
        <select id="s-gas-unit"><option value="GJ" ${st.gas_price_unit === 'GJ' ? 'selected' : ''}>$/GJ</option><option value="Mcf" ${st.gas_price_unit === 'Mcf' ? 'selected' : ''}>$/Mcf</option></select>
      </div></div>
      <div class="field"><label>Propane Price</label><div class="inline-unit">
        <input type="number" id="s-prop" value="${esc(st.propane_price)}" min="0" step="0.01">
        <select id="s-prop-unit"><option value="L" ${st.propane_price_unit === 'L' ? 'selected' : ''}>$/L</option><option value="gal" ${st.propane_price_unit === 'gal' ? 'selected' : ''}>$/US gal</option></select>
      </div></div>
      ${fld('Analysis Period (yrs)', 's-years', st.analysis_years, {step: 1})}
      ${fld('Freeze Season (months)', 's-season', st.season_months, {step: 0.5})}
      ${fld('Duty Cycle (%)', 's-duty', st.duty_cycle_pct, {step: 1})}
    </div>
  </div>
  <div class="card kk">
    <h2>✨ KK AI</h2>
    <p class="hint" style="margin-top:0">Powers the Quote Analyzer, chat, and knowledge-base reading. Pick ONE:</p>
    <div class="grid2">
      <div>
        <b>Option 1 — Google Gemini (free)</b>
        <div class="hint">Get a free key at <b>aistudio.google.com/apikey</b>. Free-tier data may be used by Google for training — don't feed it anything confidential you wouldn't email a vendor.</div>
        ${fld('Gemini API Key', 's-gemini', st.gemini_api_key || '', {type: 'text', ph: 'AIza...'})}
      </div>
      <div>
        <b>Option 2 — Claude API (paid, stronger)</b>
        <div class="hint">Key from <b>console.anthropic.com</b>. Used instead of Gemini when both are set.</div>
        ${fld('Claude API Key', 's-claude', st.anthropic_api_key || '', {type: 'text', ph: 'sk-ant-...'})}
      </div>
    </div>
  </div>
  <div class="card kk">
    <h2>Quote Footer — Kold Katcher Contact</h2>
    <div class="grid3">
      ${fld('Phone', 's-phone', st.company_phone, {type: 'text'})}
      ${fld('Email', 's-email', st.company_email, {type: 'text'})}
      ${fld('Location', 's-city', st.company_city, {type: 'text'})}
    </div>
    <div class="actions"><button class="btn primary" id="s-save">Save Defaults</button></div>
  </div>`;
  $('#s-save').addEventListener('click', async () => {
    const body = {
      power_rate_kwh: $('#s-power').value, demand_charge_kw_mo: $('#s-demand').value,
      grid_co2_kg_kwh: $('#s-co2').value, gas_price: $('#s-gas').value, gas_price_unit: $('#s-gas-unit').value,
      propane_price: $('#s-prop').value, propane_price_unit: $('#s-prop-unit').value,
      analysis_years: $('#s-years').value, season_months: $('#s-season').value, duty_cycle_pct: $('#s-duty').value,
      company_phone: $('#s-phone').value, company_email: $('#s-email').value, company_city: $('#s-city').value,
      gemini_api_key: $('#s-gemini').value.trim(), anthropic_api_key: $('#s-claude').value.trim(),
      def_watts_per_ft: $('#sd-wpf').value, def_trace_cost_ft: $('#sd-trace').value, def_voltage: $('#sd-volt').value,
      def_pk_price: $('#sd-pk').value, def_ek_price: $('#sd-ek').value, def_cable_cost_ft: $('#sd-cable').value,
      def_tube_cost_ft: $('#sd-tube').value, def_tube_install: $('#sd-tubei').value, def_fuel_hookup: $('#sd-hookup').value
    };
    try { await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) }); await loadBootstrap(); toast('Defaults saved'); }
    catch (e) { toast('Save failed: ' + e.message); }
  });
}

/* ===================== print quote ===================== */
function printQuote() { buildPrintQuote(); window.print(); }
// Ctrl+P / File>Print from the calculator gets the current quote, not a stale or blank page
window.addEventListener('beforeprint', () => {
  if (S.page === 'math' && S.calc) buildMathExport();
  else if (S.page === 'calc' && S.calc) buildPrintQuote();
});
function buildPrintQuote() {
  const c = S.calc, r = compute(c), st = S.settings;
  const u = S.units.find(x => x.id === c.unit_id) || {};
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const pb = r.payback;
  const pbText = pb === 0 ? 'Immediate' : (pb == null ? 'N/A' : (pb > r.years ? `Beyond ${r.years} yrs` : (pb < 1 ? Math.round(pb * 12) + ' months' : num(pb, 1) + ' years')));
  const fuelName = c.fuel_type === 'ng' ? (c.site_gas ? 'site fuel gas' : 'natural gas') : 'propane';
  const kkWins = r.tcoSavings >= 0;
  const capexAdv = r.capexE - r.capexK;
  const chartImg = cumulativeChartDataURL({
    a: { label: 'Electric', color: '#2563eb', capex: r.capexE, opex: r.opexE },
    b: { label: 'Kold Katcher', color: '#da2727', capex: r.capexK, opex: r.opexK },
    years: r.years, advantage: 'KK advantage'
  }, 780, 330);
  const green = '#1a7f37', red = '#b31f1f';
  const sign = v => (v >= 0 ? green : red);

  const stat = (label, value, sub) => `
    <div class="pqs">
      <div class="pqs-label">${label}</div>
      <div class="pqs-value">${value}</div>
      <div class="pqs-sub">${sub}</div>
    </div>`;

  const BENEFITS = [
    ['Lower installed cost', capexAdv >= 0 ? `${money(capexAdv)} less capital than electric heat trace on this scope — the win starts on day one.` : `Competitive installed cost against electric on this scope, with no electrical scope growth risk.`],
    ['Lower operating cost', `${money(r.savings)}/yr less to run${c.site_gas ? ' — the burner uses site fuel gas, so there is no fuel bill at all' : ''}. Savings compound every winter.`],
    ['Nothing to trip or ground-fault', "The most common electric heat trace failures are nuisance breaker trips and ground faults from cable damage, moisture and insulation breakdown. A sealed glycol loop has none of them."],
    ['Keeps working through outages', 'The glycol loop keeps protecting lines when site power blinks — electric trace goes cold the moment it loses supply.'],
    ['No hazardous-area electrical on the piping', 'No Class I Div. wiring along the line, no GFEP circuits to certify, and none of the fire-tube burner risk it replaces. Flameless catalytic heater with built-in high-temp shutdown.'],
    ['Sized from manufacturer data', 'Unit selection, burn rate and electric circuit counts all come from published manufacturer tables — every number in this document is auditable in the appendix.']
  ];

  // grouped comparison bars (scaled per pair)
  const barGroup = (label, vE, vK) => {
    const mx = Math.max(vE, vK) || 1;
    return `
    <div class="pqb-group">
      <div class="pqb-glabel">${label}</div>
      <div class="pqb-row"><span class="pqb-name">Electric</span><div class="pqb-track"><div class="pqb-bar e" style="width:${Math.max(2, vE / mx * 100)}%"></div></div><span class="pqb-val">${money(vE)}</span></div>
      <div class="pqb-row"><span class="pqb-name">Kold Katcher</span><div class="pqb-track"><div class="pqb-bar k" style="width:${Math.max(2, vK / mx * 100)}%"></div></div><span class="pqb-val">${money(vK)}</span></div>
    </div>`;
  };

  const runner = `<div class="pq-runner">${esc(S.quoteNumber || 'ROI Analysis')} · Kold Katcher Inc. · ${today}</div>`;

  $('#print-root').innerHTML = `
  <div class="pq">
    <!-- ===== PAGE 1 — SUMMARY ===== -->
    <section class="pq-page">
      <header class="pq-head">
        <img src="kk-logo.png" alt="Kold Katcher">
        <div class="pq-head-meta">
          <div class="pq-doc">Freeze Protection · Cost &amp; ROI Analysis</div>
          <div class="pq-num">${esc(S.quoteNumber || 'ROI ANALYSIS')}</div>
          <div class="pq-date">${today}</div>
        </div>
      </header>

      <div class="pq-verdict ${kkWins ? '' : 'alt'}">
        <div class="pv-eyebrow">${kkWins ? 'Summary result' : 'Cost comparison'}</div>
        <div class="pv-headline">${kkWins
          ? `Kold Katcher delivers the same freeze protection for <em>${money(r.tcoSavings)}</em> less over ${r.years} years`
          : `${r.years}-year total cost of ownership, side by side`}</div>
        <div class="pv-sub">${kkWins
          ? (pb === 0 ? `${capexAdv > 0 ? money(capexAdv) + ' lower installed cost and ' : ''}${money(r.savings)}/yr lower operating cost — ahead from day one.` : `The premium pays back in ${pbText}, then saves ${money(r.savings)} every year.`)
          : 'Full itemized breakdown and basis of calculation follow.'}</div>
      </div>

      <div class="pq-meta">
        <div><span>Prepared for</span>${esc(c.customer) || '—'}</div>
        <div><span>Site</span>${esc(c.site) || '—'}</div>
        <div><span>Proposed system</span>${esc(u.name || 'KK Glycol Heat Trace')} · ${fuelName}</div>
        <div><span>Prepared by</span>${esc(c.prepared_by) || 'Kold Katcher Inc.'}</div>
      </div>

      <div class="pq-sec"><span>01</span>Executive Summary</div>
      <ul class="pq-exec">
        <li><b>${capexAdv >= 0 ? 'Lower installed cost.' : 'Installed cost.'}</b> ${capexAdv >= 0
          ? `The complete Kold Katcher system installs for ${money(r.capexK)} — ${money(capexAdv)} (${num(capexAdv / (r.capexE || 1) * 100, 0)}%) below the electric heat trace scope of ${money(r.capexE)}.`
          : `${money(r.capexK)} installed vs ${money(r.capexE)} for electric; the operating savings below carry the case.`}</li>
        <li><b>Lower operating cost.</b> ${money(r.opexK)}/yr versus ${money(r.opexE)}/yr for electric — ${money(r.savings)} saved every year${c.site_gas ? ', with fuel supplied by the site’s own produced gas' : ''}.</li>
        <li><b>Result.</b> ${pbText === 'Immediate' ? 'No payback period required — Kold Katcher is ahead from the day it is installed' : `Payback in ${pbText}`}, accumulating to ${money(r.tcoSavings)} over ${r.years} years (${num(r.roiPct, 0)}% undiscounted return on the investment).</li>
      </ul>

      <div class="pq-kpis">
        ${stat('Installed Cost Advantage', `<span style="color:${sign(capexAdv)}">${capexAdv >= 0 ? money(capexAdv) : money(capexAdv)}</span>`, `${money(r.capexK)} vs ${money(r.capexE)}`)}
        ${stat('Operating Savings', `<span style="color:${sign(r.savings)}">${money(r.savings)}</span>`, `per year, every year`)}
        ${stat('Payback', pbText, pb === 0 ? 'Ahead from day one' : 'Then pure savings')}
        ${stat(`${r.years}-Year Advantage`, `<span style="color:${sign(r.tcoSavings)}">${money(r.tcoSavings)}</span>`, `${num(r.roiPct, 0)}% ROI, undiscounted`)}
      </div>

      <div class="pq-sec"><span>02</span>Cost Comparison</div>
      <div class="pq-bars">
        ${barGroup('Installed cost', r.capexE, r.capexK)}
        ${barGroup(`${r.years}-year total cost`, r.tcoE, r.tcoK)}
      </div>

      <div class="pq-chart">
        <div class="pq-chart-head">
          <div class="pq-chart-title">Cumulative Cost of Ownership — ${r.years} Years</div>
          <div class="pq-chart-legend"><span class="lg lg-e">Electric heat trace</span><span class="lg lg-k">Kold Katcher</span></div>
        </div>
        <img src="${chartImg}" alt="Cumulative cost comparison over ${r.years} years">
      </div>
    </section>

    <!-- ===== PAGE 2 — DETAIL ===== -->
    <section class="pq-page pq-page-2">
      ${runner}
      <div class="pq-sec"><span>03</span>Itemized Cost Breakdown</div>
      <table class="pq-table">
        <thead><tr><th>Line item</th><th>Electric Heat Trace</th><th>Kold Katcher</th></tr></thead>
        <tbody>
          <tr class="grp"><td colspan="3">Installed capital</td></tr>
          <tr><td>Heat trace cable — ${num(c.len_ft)} ft @ ${money2(c.trace_cost_ft)}/ft (${num(c.watts_per_ft)} W/ft, ${num(c.voltage, 0)} V)</td><td>${money(r.traceCost)}</td><td>—</td></tr>
          <tr><td>Power kits (${num(c.pk_qty, 0)}) &amp; end kits (${num(c.ek_qty, 0)}) — ${num(c.pk_qty, 0)} circuit${c.pk_qty === 1 ? '' : 's'} <sup>1</sup></td><td>${money(r.kitsCost)}</td><td>—</td></tr>
          <tr><td>Power cable to trace — ${num(c.cable_ft)} ft @ ${money2(c.cable_cost_ft)}/ft</td><td>${money(r.cableCost)}</td><td>—</td></tr>
          <tr><td>Electrical installation — panel, GFEP, controls, certified labour${c.grid_ext ? ' + line extension' : ''}</td><td>${money(c.elec_install + c.grid_ext)}</td><td>—</td></tr>
          <tr><td>${esc(u.name || 'KK unit')} — supplied &amp; installed <sup>2</sup></td><td>—</td><td>${money(c.kk_kit_cost + c.kk_install)}</td></tr>
          <tr><td>Tubing loop — ${num(c.len_ft)} ft @ ${money2(c.tube_cost_ft)}/ft, installed</td><td>—</td><td>${money(r.tubeCost + c.tube_install)}</td></tr>
          <tr><td>Fuel gas hookup</td><td>—</td><td>${money(c.fuel_hookup)}</td></tr>
          <tr class="sum"><td>Installed capital</td><td>${money(r.capexE)}</td><td>${money(r.capexK)}${capexAdv > 0 ? ` <span class="win">${money(capexAdv)} lower</span>` : ''}</td></tr>
          <tr class="grp"><td colspan="3">Annual operating</td></tr>
          <tr><td>Energy${r.demandCost ? ' + demand charges' : ''} — ${num(r.kwhYr, 0)} kWh @ ${money2(c.power_rate)}/kWh all-in <sup>3</sup></td><td>${money(r.energyCost + r.demandCost)}</td><td>—</td></tr>
          <tr><td>Fuel — ${r.fuelDetail}</td><td>—</td><td>${money(r.fuelCost)}</td></tr>
          <tr><td>Maintenance</td><td>${money(c.elec_maint)}</td><td>${money(c.kk_maint)}</td></tr>
          <tr class="sum"><td>Operating cost per year</td><td>${money(r.opexE)}</td><td>${money(r.opexK)}${r.savings > 0 ? ` <span class="win">${money(r.savings)} lower</span>` : ''}</td></tr>
          <tr class="grand"><td>${r.years}-year total cost of ownership <sup>4</sup></td><td>${money(r.tcoE)}</td><td>${money(r.tcoK)}</td></tr>
        </tbody>
      </table>
      <div class="pq-notes">
        <div><sup>1</sup> Circuit count from the published Raychem BTV maximum-circuit-length tables (H51086) at ${num(c.startup_f, 0)}°F cold start, ${num(c.breaker_a, 0)} A breakers.</div>
        <div><sup>2</sup> ${esc(u.code || 'Unit')} pricing per Kold Katcher 2026 CDN list; burn rate is the manufacturer's rated gas consumption at maximum output.</div>
        <div><sup>3</sup> All-in delivered rate including transmission, distribution and riders, as entered from the customer's bill.</div>
        <div><sup>4</sup> Undiscounted; no price escalation assumed on either side. Complete formulas in the Appendix.</div>
      </div>

      <div class="pq-sec"><span>04</span>Why Operators Choose Kold Katcher</div>
      <div class="pq-benefits">
        ${BENEFITS.map(([t, d]) => `<div class="pqb"><b>${t}</b><p>${d}</p></div>`).join('')}
      </div>

      <div class="pq-sec"><span>05</span>Basis of Analysis &amp; Sources</div>
      <table class="pq-table pq-assume">
        <thead><tr><th>Assumption</th><th>Value used</th><th>Source</th></tr></thead>
        <tbody>
          <tr><td>Operating season</td><td>${num(c.season_months)} months × ${num(c.duty_cycle_pct, 0)}% duty = ${num(r.hours, 0)} hrs/yr</td><td>Applied identically to both systems</td></tr>
          <tr><td>Unit pricing &amp; burn rate</td><td>${esc(u.code || '—')} · ${money(c.kk_kit_cost)} · ${num(c.ng_usage)} ${c.ng_usage_unit === 'm3' ? 'm³' : 'scf'}/hr max</td><td>Kold Katcher 2026 price &amp; spec sheets</td></tr>
          <tr><td>Electric circuit sizing</td><td>${num(c.pk_qty, 0)} × ${num(c.voltage, 0)} V circuits</td><td>Raychem BTV datasheet H51086</td></tr>
          <tr><td>Gas energy content</td><td>${ngGjScf()} GJ/scf (1,020 BTU/scf)</td><td>Alberta GHG Quantification Methodology</td></tr>
          <tr><td>Emissions</td><td>Electric ${num(r.co2E, 1)} · KK ${num(r.co2K, 1)} t CO₂e/yr</td><td>EPA combustion factors · AB grid ${num(gridCo2KgKwh(), 3)} kg/kWh (2024)</td></tr>
          <tr><td>Financial convention</td><td>Simple payback, undiscounted totals</td><td>Symmetric treatment; NPV available on request</td></tr>
        </tbody>
      </table>

      <footer class="pq-foot">
        <div class="foot-brand">KOLD KATCHER INC.<span> — field-proven freeze protection for remote oil &amp; gas, since 2003</span></div>
        <div class="foot-contact">${esc(st.company_city || 'Drumheller, Alberta')} &nbsp;·&nbsp; ${esc(st.company_phone || '')} &nbsp;·&nbsp; ${esc(st.company_email || '')} &nbsp;·&nbsp; koldkatcher.com</div>
        <div class="foot-disc">Comparison estimate prepared with customer-specific inputs; confirm final pricing with a formal Kold Katcher quotation.</div>
      </footer>
    </section>

    <!-- ===== APPENDIX — THE RECEIPTS ===== -->
    <section class="pq-page pq-page-2 pq-appendix">
      ${runner}
      <div class="pq-sec"><span>A</span>Appendix — Complete Calculation Detail</div>
      <div class="md-intro">Every figure in this document is produced by the formulas below, shown with the exact inputs used for ${esc(c.customer) || 'this analysis'}. Circuit counts reference the published Raychem BTV datasheet; unit pricing and burn rates are Kold Katcher's 2026 published figures. Nothing is hidden — challenge any line and it can be recomputed on the spot.</div>
      <div class="mathdoc">${mathContentHTML(c, r)}</div>
    </section>
  </div>`;
}

/* ===================== other tools ===================== */
const localDateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => localDateStr(new Date());
function daysUntilFreezeUp() {
  const now = new Date();
  const d = Math.ceil((new Date(now.getFullYear(), 9, 1) - now) / 86400000);
  return d > 0 ? d : 0; // 0 = freeze-up is here (Oct-Dec)
}

function renderTools() {
  S.renderGen = (S.renderGen || 0) + 1;
  if (S.tool === 'vent') return renderVentTool();
  if (S.tool === 'solar') return renderSolarTool();
  if (S.tool === 'pipeline') return renderPipeline().catch(e => toast('Could not load pipeline: ' + e.message));
  if (S.tool === 'installs') return renderInstalls().catch(e => toast('Could not load installs: ' + e.message));
  $('#view').innerHTML = `
  <div class="tool-cards">
    <div class="tool-card" data-tool="vent">
      <div class="tc-icon">🌱</div>
      <h3>Vent-Gas Elimination ROI</h3>
      <p>Replace pneumatic pumps with a KK solar pumping system — methane eliminated, carbon value, retained fuel gas, payback.</p>
      <span class="tc-go">Open →</span>
    </div>
    <div class="tool-card" data-tool="solar">
      <div class="tc-icon">☀️</div>
      <h3>Solar Power Sizer</h3>
      <p>Build a load list for a well site and size the KK solar power skid — panels, battery bank, winter-rated for Alberta.</p>
      <span class="tc-go">Open →</span>
    </div>
    <div class="tool-card" data-tool="pipeline">
      <div class="tc-icon">📋</div>
      <h3>Sales Pipeline</h3>
      <p>Track quote requests from first call to won — follow-up dates, deal value, and a freeze-up countdown to keep urgency.</p>
      <span class="tc-go">Open →</span>
    </div>
    <div class="tool-card" data-tool="installs">
      <div class="tc-icon">🔧</div>
      <h3>Install Base &amp; Service</h3>
      <p>Every unit in the field — where it is, when glycol service is due, what's overdue. Recurring service revenue on autopilot.</p>
      <span class="tc-go">Open →</span>
    </div>
  </div>`;
  $$('.tool-card').forEach(cd => cd.addEventListener('click', () => { S.tool = cd.dataset.tool; renderTools(); }));
}
function toolBack() {
  return `<a class="tool-back" id="tool-back">← All Tools</a>`;
}
function wireToolBack() {
  $('#tool-back').addEventListener('click', () => { S.tool = null; renderTools(); });
}

/* ---------- 1. vent-gas elimination ROI ---------- */
const SCF_KG_CH4 = 0.0192;     // kg CH4 per scf of methane
function defaultVent() {
  return {
    pumps: 4, vent_scfd: 250, ch4_pct: 90,
    gas_conserved: true, gas_price: F(S.settings.gas_price) || 2.5,
    carbon_credit: true, carbon_price: F(S.settings.carbon_price_t) || 95, gwp: F(S.settings.ch4_gwp) || 28,
    old_maint: 500, skid_cost: 8131, skid_install: 1500, skid_maint: 300,
    days: 365, years: 10
  };
}
function computeVent(v) {
  const scfYr = v.pumps * v.vent_scfd * v.days;
  const gjYr = scfYr * ngGjScf();
  const gasValue = v.gas_conserved ? gjYr * v.gas_price : 0;
  const ch4T = scfYr * (v.ch4_pct / 100) * SCF_KG_CH4 / 1000;
  const co2eT = ch4T * v.gwp;
  const carbonValue = v.carbon_credit ? co2eT * v.carbon_price : 0;
  const statusQuoOpex = gasValue + carbonValue + v.old_maint;  // annual cost of continuing to vent
  const skidCapex = v.skid_cost + v.skid_install;
  const annualValue = statusQuoOpex - v.skid_maint;
  const payback = annualValue > 0 ? skidCapex / annualValue : null;
  const totalValue = annualValue * v.years - skidCapex;
  const cars = co2eT / 4.6; // avg passenger vehicle t CO2e/yr
  return { scfYr, gjYr, gasValue, ch4T, co2eT, carbonValue, statusQuoOpex, skidCapex, annualValue, payback, totalValue, cars };
}
function renderVentTool() {
  if (!S.vent) S.vent = defaultVent();
  const v = S.vent;
  $('#view').innerHTML = `
  ${toolBack()}
  <div class="grid2">
    <div class="card elec">
      <h2><span class="dot blue"></span> Today — Pneumatic Pumps Venting Gas</h2>
      <div class="frow3">
        ${fld('Pneumatic Pumps (#)', 'v_pumps', v.pumps, {step: 1})}
        ${fld('Vent Rate (scf/day per pump)', 'v_vent_scfd', v.vent_scfd, {hint: 'Chemical injection pumps: typ. 100–500'})}
        ${fld('Methane Content (%)', 'v_ch4_pct', v.ch4_pct, {step: 1})}
      </div>
      <div class="frow3">
        ${fld('Gas Price ($/GJ)', 'v_gas_price', v.gas_price, {step: 0.01})}
        ${fld('Carbon Value ($/t CO₂e)', 'v_carbon_price', v.carbon_price, {step: 1, hint: 'AB TIER fund $95/t — offsets trade below; confirm protocol eligibility'})}
        ${fld('CH₄ GWP', 'v_gwp', v.gwp, {step: 1, hint: 'AB TIER uses 25'})}
      </div>
      <div class="frow">
        ${fld('Pneumatic Maint. ($/yr)', 'v_old_maint', v.old_maint)}
        ${fld('Operating Days / yr', 'v_days', v.days, {step: 1})}
      </div>
      <label class="checkline"><input type="checkbox" id="v_gas_conserved" ${v.gas_conserved ? 'checked' : ''}> Vented gas would otherwise be conserved / sold (count its value)</label>
      <label class="checkline"><input type="checkbox" id="v_carbon_credit" ${v.carbon_credit ? 'checked' : ''}> Site can monetize emission reductions (offsets / TIER compliance)</label>
    </div>
    <div class="card kk">
      <h2><span class="dot red"></span> Kold Katcher Solar Pumping System</h2>
      <p class="hint" style="margin-top:0">Magnetically-coupled, stainless, brushless variable-speed — circulates chemical/glycol with zero vent gas and no compressed-air infrastructure.</p>
      <div class="frow3">
        ${fld('Skid Cost ($)', 'v_skid_cost', v.skid_cost, {hint: 'SPSX-280-SP CDN list $8,131 · 560-SP $10,845 · 560-DP $12,127 · FPS-1040 pump box $3,453'})}
        ${fld('Install ($)', 'v_skid_install', v.skid_install)}
        ${fld('Maintenance ($/yr)', 'v_skid_maint', v.skid_maint)}
      </div>
      ${fld('Analysis Period (years)', 'v_years', v.years, {step: 1})}
    </div>
  </div>
  <div id="vent-results"></div>`;
  wireToolBack();
  ['v_pumps','v_vent_scfd','v_ch4_pct','v_gas_price','v_carbon_price','v_gwp','v_old_maint','v_days','v_skid_cost','v_skid_install','v_skid_maint','v_years'].forEach(idn => {
    $('#' + idn).addEventListener('input', e => { S.vent[idn.slice(2)] = F(e.target.value); refreshVent(); });
  });
  $('#v_gas_conserved').addEventListener('change', e => { S.vent.gas_conserved = e.target.checked; refreshVent(); });
  $('#v_carbon_credit').addEventListener('change', e => { S.vent.carbon_credit = e.target.checked; refreshVent(); });
  refreshVent();
}
function refreshVent() {
  const v = S.vent, r = computeVent(v);
  $('#vent-results').innerHTML = `
  <div class="tiles">
    <div class="tile hero"><div class="t-label">Methane Eliminated</div><div class="t-value">${num(r.co2eT, 1)} t</div><div class="t-sub">CO₂e/yr — like taking ${num(r.cars, 1)} cars off the road</div></div>
    <div class="tile"><div class="t-label">Gas Kept in the Pipe</div><div class="t-value">${num(r.gjYr, 0)} GJ</div><div class="t-sub">${v.gas_conserved ? money(r.gasValue) + '/yr retained value' : 'value not counted'}</div></div>
    <div class="tile"><div class="t-label">Annual Value</div><div class="t-value ${r.annualValue >= 0 ? 'good' : 'bad'}">${money(r.annualValue)}</div><div class="t-sub">gas + carbon + maintenance</div></div>
    <div class="tile"><div class="t-label">Payback</div><div class="t-value ${r.payback != null && r.payback <= v.years ? 'good' : ''}">${r.payback == null ? '—' : num(r.payback, 1) + ' yrs'}</div><div class="t-sub">${r.payback != null ? '≈ ' + Math.round(r.payback * 12) + ' months' : 'No monetized value at these settings'}</div></div>
  </div>
  <div class="grid2">
    <div class="card neutral">
      <h2>Annual Value Breakdown</h2>
      <table class="compare">
        <tbody>
          <tr><td>Gas vented today</td><td>${num(r.scfYr / 1000, 1)} Mcf/yr (${num(r.gjYr, 0)} GJ)</td></tr>
          <tr><td>Methane released</td><td>${num(r.ch4T, 2)} t CH₄ = ${num(r.co2eT, 1)} t CO₂e @ GWP ${num(v.gwp, 0)}</td></tr>
          <tr><td>Retained gas value</td><td>${money(r.gasValue)}/yr</td></tr>
          <tr><td>Carbon value</td><td>${money(r.carbonValue)}/yr @ ${money(v.carbon_price)}/t</td></tr>
          <tr><td>Pneumatic maintenance avoided</td><td>${money(v.old_maint)}/yr</td></tr>
          <tr><td>KK skid maintenance</td><td>−${money(v.skid_maint)}/yr</td></tr>
          <tr class="total"><td>Net annual value</td><td>${money(r.annualValue)}</td></tr>
          <tr class="total"><td>${v.years}-yr net value (after ${money(r.skidCapex)} capex)</td><td>${money(r.totalValue)}</td></tr>
        </tbody>
      </table>
      <div class="hint" style="margin-top:8px">Alberta context: federal/AB rules are phasing out routine venting from pneumatics; each converted site is emissions compliance + revenue, not just cost avoidance.</div>
    </div>
    <div class="card neutral">
      <h2>Cost of Doing Nothing</h2>
      <div class="legend">
        <span><span class="dot blue"></span> Keep venting (lost value)</span>
        <span><span class="dot red"></span> KK solar pumping</span>
      </div>
      <div class="chart-wrap">
        <canvas id="ventChart"></canvas>
        <div class="chart-tip" id="vent-tip"></div>
      </div>
    </div>
  </div>`;
  attachCumulativeChart('ventChart', 'vent-tip', {
    a: { label: 'Keep venting', color: '#2563eb', capex: 0, opex: r.statusQuoOpex },
    b: { label: 'KK solar pump', color: '#da2727', capex: r.skidCapex, opex: v.skid_maint },
    years: v.years, advantage: 'KK advantage'
  });
}

/* ---------- 2. solar power sizer ---------- */
function defaultSolar() {
  return {
    loads: [
      { name: 'RTU / SCADA', watts: 15, hrs: 24, qty: 1 },
      { name: 'Level / flow measurement', watts: 8, hrs: 24, qty: 2 },
      { name: 'LED area lighting', watts: 40, hrs: 6, qty: 2 },
      { name: 'Gas detection', watts: 10, hrs: 24, qty: 1 }
    ],
    sys_loss_pct: 15, sun_hrs: 1.8, derate_pct: 70, autonomy_days: 5,
    batt_dod_pct: 50, panel_w: 450
  };
}
function computeSolar(s) {
  const rawWh = s.loads.reduce((t, L) => t + F(L.watts) * F(L.hrs) * F(L.qty), 0);
  const dailyWh = rawWh * (1 + s.sys_loss_pct / 100);
  const battKwh = s.batt_dod_pct > 0 ? dailyWh * s.autonomy_days / (s.batt_dod_pct / 100) / 1000 : 0;
  const pvW = (s.sun_hrs > 0 && s.derate_pct > 0) ? dailyWh / (s.sun_hrs * (s.derate_pct / 100)) : 0;
  const panels = s.panel_w > 0 ? Math.ceil(pvW / s.panel_w) : 0;
  return { rawWh, dailyWh, battKwh, pvW, panels };
}
function renderSolarTool() {
  if (!S.solar) S.solar = defaultSolar();
  const s = S.solar;
  $('#view').innerHTML = `
  ${toolBack()}
  <div class="card kk">
    <h2><span class="dot red"></span> Well-Site Load List</h2>
    <table class="list" id="load-table">
      <thead><tr><th>Device</th><th>Watts</th><th>Hours/day</th><th>Qty</th><th>Wh/day</th><th></th></tr></thead>
      <tbody>${s.loads.map((L, i) => `
        <tr>
          <td><input type="text" data-li="${i}" data-lf="name" value="${esc(L.name)}" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:5px 8px;font:inherit"></td>
          <td><input type="number" data-li="${i}" data-lf="watts" value="${esc(L.watts)}" min="0" style="width:80px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;font:inherit"></td>
          <td><input type="number" data-li="${i}" data-lf="hrs" value="${esc(L.hrs)}" min="0" max="24" style="width:80px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;font:inherit"></td>
          <td><input type="number" data-li="${i}" data-lf="qty" value="${esc(L.qty)}" min="0" style="width:64px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;font:inherit"></td>
          <td class="load-wh" data-whi="${i}">${num(F(L.watts) * F(L.hrs) * F(L.qty), 0)}</td>
          <td><button class="btn small danger" data-ldel="${i}">✕</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="actions" style="margin-top:10px"><button class="btn small ghost" id="load-add">＋ Add Load</button></div>
  </div>
  <div class="card neutral">
    <h2>Site &amp; System Assumptions</h2>
    <div class="grid3">
      ${fld('Winter Peak Sun (hrs/day)', 'sp_sun', s.sun_hrs, {step: 0.1, hint: 'Alberta December ≈ 1.5–2.2'})}
      ${fld('System Losses (%)', 'sp_loss', s.sys_loss_pct, {step: 1, hint: 'Wiring, controller, inverter'})}
      ${fld('Panel Derate (%)', 'sp_derate', s.derate_pct, {step: 1, hint: 'Snow, soiling, cold-cloud — winter-safe 70%'})}
      ${fld('Days of Autonomy', 'sp_auto', s.autonomy_days, {step: 0.5, hint: 'Battery-only days — northern AB practice: 5-7'})}
      ${fld('Battery Depth of Discharge (%)', 'sp_dod', s.batt_dod_pct, {step: 5, hint: 'AGM 50% · Lithium 80%'})}
      ${fld('Panel Size (W)', 'sp_panel', s.panel_w, {step: 5})}
    </div>
  </div>
  <div id="solar-results"></div>`;
  wireToolBack();
  $$('#load-table input').forEach(inp => inp.addEventListener('input', () => {
    const i = parseInt(inp.dataset.li, 10), f = inp.dataset.lf;
    S.solar.loads[i][f] = f === 'name' ? inp.value : F(inp.value);
    const L = S.solar.loads[i];
    $(`[data-whi="${i}"]`).textContent = num(F(L.watts) * F(L.hrs) * F(L.qty), 0);
    refreshSolar();
  }));
  $$('#load-table [data-ldel]').forEach(b => b.addEventListener('click', () => { S.solar.loads.splice(parseInt(b.dataset.ldel, 10), 1); renderSolarTool(); }));
  $('#load-add').addEventListener('click', () => { S.solar.loads.push({ name: 'New device', watts: 10, hrs: 24, qty: 1 }); renderSolarTool(); });
  [['sp_sun','sun_hrs'],['sp_loss','sys_loss_pct'],['sp_derate','derate_pct'],['sp_auto','autonomy_days'],['sp_dod','batt_dod_pct'],['sp_panel','panel_w']].forEach(([idn, key]) => {
    $('#' + idn).addEventListener('input', e => { S.solar[key] = F(e.target.value); refreshSolar(); });
  });
  refreshSolar();
}
function refreshSolar() {
  const s = S.solar, r = computeSolar(s);
  $('#solar-results').innerHTML = `
  <div class="tiles">
    <div class="tile hero"><div class="t-label">Design Load</div><div class="t-value">${num(r.dailyWh / 1000, 2)} kWh</div><div class="t-sub">per day incl. ${num(s.sys_loss_pct, 0)}% losses (${num(r.rawWh, 0)} Wh raw)</div></div>
    <div class="tile"><div class="t-label">Solar Array</div><div class="t-value">${num(r.pvW, 0)} W</div><div class="t-sub">${r.panels} × ${num(s.panel_w, 0)} W panels (winter-sized)</div></div>
    <div class="tile"><div class="t-label">Battery Bank</div><div class="t-value">${num(r.battKwh, 1)} kWh</div><div class="t-sub">${num(s.autonomy_days, 1)} days autonomy @ ${num(s.batt_dod_pct, 0)}% DoD</div></div>
    <div class="tile"><div class="t-label">Freeze Season Ready</div><div class="t-value" style="font-size:19px">Dec-safe ✓</div><div class="t-sub">Sized on ${num(s.sun_hrs, 1)} winter sun-hrs, ${num(s.derate_pct, 0)}% derate</div></div>
  </div>
  <div class="card neutral">
    <h2>Spec Summary — for the KK Solar Power Skid quote</h2>
    <table class="compare"><tbody>
      <tr><td>Continuous + duty loads</td><td>${s.loads.filter(L => F(L.qty) > 0).map(L => `${esc(L.name)} (${num(F(L.watts) * F(L.qty), 0)} W × ${num(L.hrs, 0)} h)`).join(' · ') || '—'}</td></tr>
      <tr><td>Daily energy (with losses)</td><td>${num(r.dailyWh, 0)} Wh/day</td></tr>
      <tr><td>PV array required</td><td>${num(r.pvW, 0)} W → <b>${r.panels} × ${num(s.panel_w, 0)} W panels</b></td></tr>
      <tr><td>Battery bank required</td><td><b>${num(r.battKwh, 1)} kWh</b> nameplate (${num(r.battKwh * 1000 / 12, 0)} Ah @ 12 V equiv.) — cold-weather capacity loss not included; size up for AGM below 0 °C</td></tr>
      <tr class="total"><td>Recommendation</td><td>Confirm final skid sizing with Kold Katcher — ${esc(S.settings.company_phone || '')}</td></tr>
    </tbody></table>
    <div class="actions" style="margin-top:12px"><button class="btn dark" id="solar-copy">📋 Copy Spec to Clipboard</button></div>
  </div>`;
  $('#solar-copy').addEventListener('click', () => copySolarSpec());
}
function copyText(txt) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy') ? resolve() : reject(new Error('blocked')); }
    catch (e) { reject(e); }
    finally { ta.remove(); }
  });
}
function copySolarSpec() {
  const s = S.solar, r = computeSolar(s);
  const txt = `KK SOLAR POWER SKID — SIZING REQUEST
Loads: ${s.loads.map(L => `${L.name}: ${L.watts}W x ${L.hrs}h/day x ${L.qty}`).join('; ')}
Daily energy incl ${s.sys_loss_pct}% losses: ${Math.round(r.dailyWh)} Wh/day
Winter sun: ${s.sun_hrs} h/day, derate ${s.derate_pct}%
PV required: ${Math.round(r.pvW)} W (${r.panels} x ${s.panel_w} W panels)
Battery: ${r.battKwh.toFixed(1)} kWh @ ${s.batt_dod_pct}% DoD, ${s.autonomy_days} days autonomy`;
  copyText(txt)
    .then(() => toast('Spec copied — paste into an email or quote'))
    .catch(() => toast('Copy blocked by the browser — select the table and copy manually'));
}

/* ---------- 3. sales pipeline ---------- */
const STAGES = [['new', 'New Lead'], ['quoted', 'Quoted'], ['follow_up', 'Follow-Up'], ['won', 'Won'], ['lost', 'Lost']];
const PRODUCT_LINES = ['Glycol Heat Trace', 'Solar Pumping', 'Power Systems', 'Accessories'];
async function renderPipeline() {
  const gen = S.renderGen;
  const rows = await api('/api/pipeline');
  if (gen !== S.renderGen) return;
  const open = rows.filter(x => x.stage !== 'won' && x.stage !== 'lost');
  const openValue = open.reduce((t, x) => t + (x.value_est || 0), 0);
  const overdue = open.filter(x => x.next_action_date && x.next_action_date < todayStr());
  const wonYtd = rows.filter(x => x.stage === 'won' && (x.updated_at || '').startsWith(String(new Date().getFullYear())));
  const wonValue = wonYtd.reduce((t, x) => t + (x.value_est || 0), 0);
  const fu = daysUntilFreezeUp();
  $('#view').innerHTML = `
  ${toolBack()}
  ${fu <= 120 ? `<div class="note-banner">🥶 <b>${fu} days until freeze-up (Oct 1).</b> Every open deal below needs an answer before then — that's the close.</div>` : ''}
  <div class="tiles">
    <div class="tile hero"><div class="t-label">Open Pipeline</div><div class="t-value">${money(openValue)}</div><div class="t-sub">${open.length} active deals</div></div>
    <div class="tile"><div class="t-label">Overdue Follow-Ups</div><div class="t-value ${overdue.length ? 'bad' : 'good'}">${overdue.length}</div><div class="t-sub">${overdue.length ? 'call them today' : 'all caught up'}</div></div>
    <div class="tile"><div class="t-label">Won This Year</div><div class="t-value good">${money(wonValue)}</div><div class="t-sub">${wonYtd.length} deals</div></div>
    <div class="tile"><div class="t-label">Freeze-Up Countdown</div><div class="t-value">${fu} days</div><div class="t-sub">to Oct 1</div></div>
  </div>
  <div class="card neutral">
    <h2>Pipeline</h2>
    ${rows.length === 0 ? '<div class="empty">No leads yet — add the first one below, or use "Add to Pipeline" on a saved quote.</div>' : `
    <table class="list">
      <thead><tr><th>Customer</th><th>Product</th><th>Value</th><th>Stage</th><th>Next Action</th><th>Quote</th><th></th></tr></thead>
      <tbody>${rows.map(x => {
        const od = x.stage !== 'won' && x.stage !== 'lost' && x.next_action_date && x.next_action_date < todayStr();
        return `<tr${od ? ' style="background:#fdf3f0"' : ''}>
          <td><b>${esc(x.customer)}</b>${x.contact ? `<div class="hint">${esc(x.contact)}${x.phone ? ' · ' + esc(x.phone) : ''}</div>` : ''}</td>
          <td>${esc(x.product_line)}</td>
          <td>${x.value_est ? money(x.value_est) : '—'}</td>
          <td><span class="pill stage-${esc(x.stage)}">${esc((STAGES.find(s => s[0] === x.stage) || [x.stage, x.stage])[1])}</span></td>
          <td>${od ? '⚠️ ' : ''}${esc(x.next_action_date) || '—'}</td>
          <td>${esc(x.quote_number) || '—'}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn small ghost" data-pedit="${x.id}">Edit</button>
            <button class="btn small danger" data-pdel="${x.id}">✕</button>
          </td>
        </tr>`; }).join('')}
      </tbody>
    </table>`}
    <div class="actions" style="margin-top:14px"><button class="btn primary" id="p-add">＋ Add Lead</button></div>
  </div>
  <div id="p-form"></div>`;
  wireToolBack();
  $('#p-add').addEventListener('click', () => pipelineForm(null));
  $$('[data-pedit]').forEach(b => b.addEventListener('click', () => pipelineForm(rows.find(x => x.id === parseInt(b.dataset.pedit, 10)))));
  $$('[data-pdel]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this lead?')) return;
    await api('/api/pipeline/' + b.dataset.pdel, { method: 'DELETE' });
    renderPipeline();
  }));
}
function pipelineForm(x) {
  const isNew = !x;
  x = x || { customer: '', contact: '', phone: '', email: '', site: '', product_line: 'Glycol Heat Trace', value_est: 0, stage: 'new', quote_number: '', next_action_date: '', notes: '', lost_reason: '' };
  $('#p-form').innerHTML = `
  <div class="card kk">
    <h2>${isNew ? 'Add Lead' : 'Edit — ' + esc(x.customer)}</h2>
    <div class="frow3">
      ${fld('Customer / Company', 'p-cust', x.customer, {type: 'text'})}
      ${fld('Contact Name', 'p-contact', x.contact, {type: 'text'})}
      ${fld('Phone', 'p-phone', x.phone, {type: 'text'})}
    </div>
    <div class="frow3">
      ${fld('Email', 'p-email', x.email, {type: 'text'})}
      ${fld('Site / LSD', 'p-site', x.site, {type: 'text'})}
      <div class="field"><label>Product Line</label><select id="p-line">${PRODUCT_LINES.map(pl => `<option ${pl === x.product_line ? 'selected' : ''}>${pl}</option>`).join('')}</select></div>
    </div>
    <div class="frow3">
      ${fld('Est. Value ($)', 'p-value', x.value_est)}
      <div class="field"><label>Stage</label><select id="p-stage">${STAGES.map(s => `<option value="${s[0]}" ${s[0] === x.stage ? 'selected' : ''}>${s[1]}</option>`).join('')}</select></div>
      <div class="field"><label>Next Action Date</label><input type="date" id="p-next" value="${esc(x.next_action_date)}" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:inherit"></div>
    </div>
    <div class="frow">
      ${fld('Linked ROI #', 'p-quote', x.quote_number, {type: 'text', ph: 'ROI-2026-001'})}
      ${fld('Lost Reason (if lost)', 'p-lost', x.lost_reason, {type: 'text'})}
    </div>
    <div class="field"><label for="p-notes">Notes</label><textarea id="p-notes" rows="2" style="width:100%;font:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 10px">${esc(x.notes)}</textarea></div>
    <div class="actions">
      <button class="btn primary" id="p-save">${isNew ? 'Add Lead' : 'Save'}</button>
      <button class="btn ghost" id="p-cancel">Cancel</button>
    </div>
  </div>`;
  $('#p-form').scrollIntoView({ behavior: 'smooth' });
  $('#p-cancel').addEventListener('click', () => $('#p-form').innerHTML = '');
  $('#p-save').addEventListener('click', async () => {
    const body = {
      customer: $('#p-cust').value.trim() || 'Unknown', contact: $('#p-contact').value, phone: $('#p-phone').value,
      email: $('#p-email').value, site: $('#p-site').value, product_line: $('#p-line').value,
      value_est: F($('#p-value').value), stage: $('#p-stage').value, quote_number: $('#p-quote').value,
      next_action_date: $('#p-next').value, notes: $('#p-notes').value, lost_reason: $('#p-lost').value
    };
    try {
      if (isNew) await api('/api/pipeline', { method: 'POST', body: JSON.stringify(body) });
      else await api('/api/pipeline/' + x.id, { method: 'PUT', body: JSON.stringify(body) });
      toast(isNew ? 'Lead added' : 'Lead updated');
      renderPipeline();
    } catch (e) { toast('Save failed: ' + e.message); }
  });
}

/* ---------- 4. install base & service ---------- */
function serviceDue(inst) {
  const base = inst.last_service || inst.install_date;
  if (!base) return null;
  const d = new Date(base + 'T00:00:00');
  if (isNaN(d)) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + Math.round(inst.service_interval_months || 12));
  if (d.getDate() < day) d.setDate(0); // clamp month-end overflow (e.g. Jan 31 + 1 mo)
  return localDateStr(d);
}
async function renderInstalls() {
  const gen = S.renderGen;
  const rows = await api('/api/installs');
  if (gen !== S.renderGen) return;
  const active = rows.filter(x => x.status === 'active');
  const today = todayStr();
  const soon = new Date(); soon.setDate(soon.getDate() + 30);
  const soonStr = soon.toISOString().slice(0, 10);
  const withDue = active.map(x => ({ x, due: serviceDue(x) }));
  const overdue = withDue.filter(w => w.due && w.due < today);
  const dueSoon = withDue.filter(w => w.due && w.due >= today && w.due <= soonStr);
  $('#view').innerHTML = `
  ${toolBack()}
  <div class="tiles">
    <div class="tile hero"><div class="t-label">Units in the Field</div><div class="t-value">${active.length}</div><div class="t-sub">${rows.length - active.length} retired</div></div>
    <div class="tile"><div class="t-label">Service Overdue</div><div class="t-value ${overdue.length ? 'bad' : 'good'}">${overdue.length}</div><div class="t-sub">${overdue.length ? 'book these first' : 'nothing overdue'}</div></div>
    <div class="tile"><div class="t-label">Due in 30 Days</div><div class="t-value ${dueSoon.length ? '' : 'good'}">${dueSoon.length}</div><div class="t-sub">glycol / annual service window</div></div>
    <div class="tile"><div class="t-label">Service Revenue Potential</div><div class="t-value">${money((overdue.length + dueSoon.length) * 250)}</div><div class="t-sub">@ $250 avg service call</div></div>
  </div>
  <div class="card neutral">
    <h2>Install Base</h2>
    ${rows.length === 0 ? '<div class="empty">No installs recorded yet — add every unit in the field and the service schedule builds itself.</div>' : `
    <table class="list">
      <thead><tr><th>Customer / Site</th><th>Unit</th><th>Fuel</th><th>Last Service</th><th>Next Due</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(x => {
        const due = serviceDue(x);
        const od = x.status === 'active' && due && due < today;
        const ds = x.status === 'active' && due && due >= today && due <= soonStr;
        return `<tr${od ? ' style="background:#fdf3f0"' : ''}>
          <td><b>${esc(x.customer)}</b><div class="hint">${esc(x.site)}${x.region ? ' · ' + esc(x.region) : ''}</div></td>
          <td>${esc(x.unit_name) || '—'}${x.serial ? `<div class="hint">S/N ${esc(x.serial)}</div>` : ''}</td>
          <td>${esc(x.fuel)}</td>
          <td>${esc(x.last_service) || '<span class="hint">never</span>'}</td>
          <td>${due ? (od ? '🔴 ' : ds ? '🟡 ' : '') + esc(due) : '—'}</td>
          <td>${x.status === 'active' ? '✅' : '💤'}</td>
          <td style="text-align:right;white-space:nowrap">
            ${x.status === 'active' ? `<button class="btn small primary" data-iserv="${x.id}">Serviced Today</button>` : ''}
            <button class="btn small ghost" data-iedit="${x.id}">Edit</button>
            <button class="btn small danger" data-idel="${x.id}">✕</button>
          </td>
        </tr>`; }).join('')}
      </tbody>
    </table>`}
    <div class="actions" style="margin-top:14px"><button class="btn primary" id="i-add">＋ Add Install</button></div>
  </div>
  <div id="i-form"></div>`;
  wireToolBack();
  $('#i-add').addEventListener('click', () => installForm(null));
  $$('[data-iedit]').forEach(b => b.addEventListener('click', () => installForm(rows.find(x => x.id === parseInt(b.dataset.iedit, 10)))));
  $$('[data-iserv]').forEach(b => b.addEventListener('click', async () => {
    await api('/api/installs/' + b.dataset.iserv, { method: 'PUT', body: JSON.stringify({ last_service: todayStr() }) });
    toast('Marked serviced today'); renderInstalls();
  }));
  $$('[data-idel]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this install record?')) return;
    await api('/api/installs/' + b.dataset.idel, { method: 'DELETE' });
    renderInstalls();
  }));
}
function installForm(x) {
  const isNew = !x;
  x = x || { customer: '', site: '', region: '', unit_name: (S.units[0] || {}).name || '', serial: '', fuel: 'Natural Gas', install_date: todayStr(), last_service: '', service_interval_months: 12, status: 'active', notes: '' };
  $('#i-form').innerHTML = `
  <div class="card kk">
    <h2>${isNew ? 'Add Install' : 'Edit — ' + esc(x.customer)}</h2>
    <div class="frow3">
      ${fld('Customer', 'i-cust', x.customer, {type: 'text'})}
      ${fld('Site / LSD', 'i-site', x.site, {type: 'text'})}
      ${fld('Region', 'i-region', x.region, {type: 'text', ph: 'e.g. Grande Prairie'})}
    </div>
    <div class="frow3">
      <div class="field"><label>Unit</label><select id="i-unit">
        <option value="">— Other / Unknown —</option>
        ${S.units.map(u => `<option ${u.name === x.unit_name ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
        ${x.unit_name && !S.units.some(u => u.name === x.unit_name) ? `<option selected>${esc(x.unit_name)}</option>` : ''}
      </select></div>
      ${fld('Serial #', 'i-serial', x.serial, {type: 'text'})}
      <div class="field"><label>Fuel</label><select id="i-fuel">${['Natural Gas', 'Propane', 'Site Fuel Gas', 'Solar'].map(fu => `<option ${fu === x.fuel ? 'selected' : ''}>${fu}</option>`).join('')}</select></div>
    </div>
    <div class="frow3">
      <div class="field"><label>Install Date</label><input type="date" id="i-idate" value="${esc(x.install_date)}" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:inherit"></div>
      <div class="field"><label>Last Service</label><input type="date" id="i-lserv" value="${esc(x.last_service)}" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:inherit"></div>
      ${fld('Service Interval (months)', 'i-interval', x.service_interval_months, {step: 1})}
    </div>
    <div class="field"><label for="i-notes">Notes</label><textarea id="i-notes" rows="2" style="width:100%;font:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 10px">${esc(x.notes)}</textarea></div>
    <label class="checkline"><input type="checkbox" id="i-active" ${x.status === 'active' ? 'checked' : ''}> Active in the field</label>
    <div class="actions">
      <button class="btn primary" id="i-save">${isNew ? 'Add Install' : 'Save'}</button>
      <button class="btn ghost" id="i-cancel">Cancel</button>
    </div>
  </div>`;
  $('#i-form').scrollIntoView({ behavior: 'smooth' });
  $('#i-cancel').addEventListener('click', () => $('#i-form').innerHTML = '');
  $('#i-save').addEventListener('click', async () => {
    const body = {
      customer: $('#i-cust').value.trim() || 'Unknown', site: $('#i-site').value, region: $('#i-region').value,
      unit_name: $('#i-unit').value, serial: $('#i-serial').value, fuel: $('#i-fuel').value,
      install_date: $('#i-idate').value, last_service: $('#i-lserv').value,
      service_interval_months: F($('#i-interval').value) || 12,
      status: $('#i-active').checked ? 'active' : 'retired', notes: $('#i-notes').value
    };
    try {
      if (isNew) await api('/api/installs', { method: 'POST', body: JSON.stringify(body) });
      else await api('/api/installs/' + x.id, { method: 'PUT', body: JSON.stringify(body) });
      toast(isNew ? 'Install added' : 'Install updated');
      renderInstalls();
    } catch (e) { toast('Save failed: ' + e.message); }
  });
}

/* ===================== KK AI ===================== */
const aiState = { history: [], provider: null, lastExtract: null };

async function renderAI() {
  const gen = S.renderGen;
  try { aiState.provider = (await api('/api/ai/status')).provider; } catch (e) { aiState.provider = null; }
  const kb = await api('/api/kb').catch(() => []);
  if (gen !== S.renderGen) return;
  const on = !!aiState.provider;
  $('#view').innerHTML = `
  ${on ? '' : `<div class="note-banner">🔑 KK AI needs an API key. Easiest: free Google Gemini key at <b>aistudio.google.com/apikey</b> — paste it in <b>Defaults → KK AI</b>. (Claude API key also supported.)</div>`}
  <div class="card kk">
    <h2><span class="dot red"></span> Quote &amp; Document Analyzer
      <span style="margin-left:auto"><span class="ai-status ${on ? 'on' : 'off'}">${on ? 'AI ACTIVE — ' + aiState.provider.toUpperCase() : 'NO API KEY'}</span></span></h2>
    <p class="hint" style="margin-top:0">Drop a customer's electric heat trace quote, a materials list, or an invoice. KK AI pulls out the numbers, flags what's worth challenging, and can push everything straight into the calculator.</p>
    <div class="dropzone" id="dz">
      <div class="dz-icon">📄</div>
      <div class="dz-main">Drop a quote here — or click to browse</div>
      <div class="dz-sub">PDF, photo/scan, CSV or text · up to ~15 MB</div>
      <input type="file" id="dz-file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.md" style="display:none">
    </div>
    <div id="analyze-out"></div>
  </div>

  <div class="grid2">
    <div class="card neutral">
      <h2>💬 Ask KK AI</h2>
      <div class="chat-thread" id="chat-thread">${aiState.history.length ? '' : `<div class="bubble ai">Hey — I'm KK AI. I know the unit catalog, your saved quotes, your default rates, and everything in the knowledge base. Ask me to size a system, compare against electric, or draft something for a customer.</div>`}</div>
      <div class="chat-input">
        <input type="text" id="chat-q" placeholder="e.g. Which unit for a 400 ft run on propane?">
        <button class="btn primary" id="chat-send">Ask</button>
      </div>
      <div class="chips">
        <span class="chip" data-q="Which Kold Katcher unit should I quote for a 400 ft trace run, and what would we charge?">Size a 400 ft run</span>
        <span class="chip" data-q="Give me 3 strong talking points to win against electric heat trace at a site that already has grid power.">Beat electric at a powered site</span>
        <span class="chip" data-q="Draft a short follow-up email to a customer we quoted last week, friendly but direct, asking if they're ready to move ahead before freeze-up.">Draft a follow-up email</span>
      </div>
    </div>

    <div class="card neutral">
      <h2>📚 Knowledge Base</h2>
      <div class="field"><label for="ai-notes">Company Notes — teach the AI your numbers</label>
        <textarea id="ai-notes" rows="5" style="width:100%;font:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 10px" placeholder="Real unit pricing, margins, install day rates, freight, dealer discounts, who your competitors are, anything the AI should know...">${esc(S.settings.ai_notes || '')}</textarea>
        <div class="actions" style="margin-top:8px"><button class="btn small dark" id="notes-save">Save Notes</button></div>
      </div>
      <div class="field"><label>Reference Documents</label>
        <div class="hint" style="margin-bottom:8px">Price lists, spec sheets, past quotes — anything dropped here gets read by the AI and its numbers become part of every future answer.</div>
        <div class="dropzone" id="kbz" style="padding:16px">
          <div class="dz-main" style="font-size:13.5px">＋ Add document to knowledge base</div>
          <input type="file" id="kbz-file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.md" style="display:none">
        </div>
        <div id="kb-list">${renderKbRows(kb)}</div>
      </div>
    </div>
  </div>`;

  // analyzer dropzone
  wireDropzone($('#dz'), $('#dz-file'), analyzeFile);
  wireDropzone($('#kbz'), $('#kbz-file'), kbUpload);
  // chat
  aiState.history.forEach(m => appendBubble(m.role, m.text));
  $('#chat-send').addEventListener('click', () => sendChat());
  $('#chat-q').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  $$('.chip').forEach(ch => ch.addEventListener('click', () => { $('#chat-q').value = ch.dataset.q; sendChat(); }));
  $('#notes-save').addEventListener('click', async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ai_notes: $('#ai-notes').value }) });
      S.settings.ai_notes = $('#ai-notes').value;
      toast('Notes saved — KK AI will use them from now on');
    } catch (e) { toast('Save failed: ' + e.message); }
  });
  $$('#kb-list [data-kbdel]').forEach(b => b.addEventListener('click', () => kbDelete(parseInt(b.dataset.kbdel, 10))));
}

async function refreshKbList() {
  const kb = await api('/api/kb').catch(() => []);
  const el = $('#kb-list');
  if (!el) return;
  el.innerHTML = renderKbRows(kb);
  $$('#kb-list [data-kbdel]').forEach(b => b.addEventListener('click', () => kbDelete(parseInt(b.dataset.kbdel, 10))));
}

function renderKbRows(kb) {
  if (!kb.length) return '<div class="hint" style="padding:10px 2px">No documents yet.</div>';
  return `<table class="list"><tbody>${kb.map(d => `
    <tr>
      <td>📎 <b>${esc(d.name)}</b><div class="hint">${esc((d.created_at || '').slice(0, 10))}${d.has_text ? ' · ✓ read by AI' : ' · stored (not yet read)'}</div></td>
      <td style="text-align:right;white-space:nowrap">
        ${d.data_len > 0 ? `<a class="btn small ghost" href="/api/kb/${d.id}/file" target="_blank" style="text-decoration:none">View</a>` : ''}
        <button class="btn small danger" data-kbdel="${d.id}">Delete</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
}

function wireDropzone(zone, fileInput, handler) {
  zone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handler(fileInput.files[0]); fileInput.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag');
    if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
  });
}

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 15e6) return reject(new Error('File is over 15 MB — trim it down first.'));
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result).split(',')[1] || '');
    rd.onerror = () => reject(new Error('Could not read file'));
    rd.readAsDataURL(file);
  });
}

async function analyzeFile(file) {
  const out = $('#analyze-out');
  out.innerHTML = `<div class="subtotal" style="margin-top:12px"><span><span class="spinner"></span>KK AI is reading <b>${esc(file.name)}</b>…</span><span></span></div>`;
  try {
    const data_b64 = await fileToB64(file);
    const res = await api('/api/ai/analyze-doc', { method: 'POST', body: JSON.stringify({ name: file.name, mime: file.type || 'application/pdf', data_b64 }) });
    const x = res.extracted;
    aiState.lastExtract = { x, file: { name: file.name, mime: file.type, data_b64 } };
    const fields = [
      ['Trace length', x.trace_length_ft, ' ft'], ['Watts / ft', x.watts_per_ft, ' W'],
      ['Trace cost', x.trace_cost_per_ft, ' $/ft'], ['Power kits', x.power_kits_qty, ''],
      ['Power kit $', x.power_kit_price, ''], ['End kits', x.end_kits_qty, ''],
      ['End kit $', x.end_kit_price, ''], ['Cable', x.cable_ft, ' ft'],
      ['Cable $/ft', x.cable_cost_per_ft, ''], ['Install', x.elec_install, ' $'],
      ['Line ext.', x.grid_ext, ' $'], ['Power rate', x.power_rate_kwh, ' $/kWh'],
      ['Total quoted', x.total_quoted, ' $']
    ].filter(f => f[1] != null && f[1] !== 0);
    out.innerHTML = `
      <div style="margin-top:14px">
        <b>${esc(x.doc_type || 'Document')}</b>${x.customer ? ' — ' + esc(x.customer) : ''}
        <p style="margin:6px 0">${esc(x.summary || '')}</p>
        ${fields.length ? `<div class="extract-grid">${fields.map(f => `<div class="xg"><b>${f[0]}</b>${num(f[1], 2)}${f[2]}</div>`).join('')}</div>` : '<div class="hint">No calculator numbers found in this document.</div>'}
        ${(x.red_flags || []).length ? `<b style="font-size:13px">⛔ Worth noting:</b><ul class="flag-list">${x.red_flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        <div class="actions" style="margin-top:12px">
          ${fields.length ? `<button class="btn primary" id="apply-extract">→ Apply to Calculator</button>` : ''}
          <button class="btn ghost" id="kb-save-extract">📚 Save to Knowledge Base</button>
        </div>
      </div>`;
    const ap = $('#apply-extract');
    if (ap) ap.addEventListener('click', applyExtract);
    $('#kb-save-extract').addEventListener('click', async () => {
      const f = aiState.lastExtract.file;
      try {
        await api('/api/kb', { method: 'POST', body: JSON.stringify({ name: f.name, mime: f.mime, data_b64: f.data_b64, notes: x.summary || '' }) });
        toast('Saved to knowledge base'); refreshKbList();
      } catch (e) { toast('Save failed: ' + e.message); }
    });
  } catch (e) {
    out.innerHTML = `<div class="note-banner" style="margin-top:12px">⚠️ ${esc(e.message)}</div>`;
  }
}

function applyExtract() {
  const x = aiState.lastExtract && aiState.lastExtract.x;
  if (!x) return;
  const c = S.calc;
  const map = { customer: 'customer', site: 'site', trace_length_ft: 'len_ft', watts_per_ft: 'watts_per_ft',
    trace_cost_per_ft: 'trace_cost_ft', power_kits_qty: 'pk_qty', power_kit_price: 'pk_price',
    end_kits_qty: 'ek_qty', end_kit_price: 'ek_price', cable_ft: 'cable_ft', cable_cost_per_ft: 'cable_cost_ft',
    elec_install: 'elec_install', grid_ext: 'grid_ext', power_rate_kwh: 'power_rate' };
  let applied = 0;
  for (const [from, to] of Object.entries(map)) {
    if (x[from] != null && x[from] !== '') { c[to] = typeof c[to] === 'string' ? String(x[from]) : F(x[from]); applied++; }
  }
  const wasEditing = S.quoteId;
  if (wasEditing) { S.quoteId = null; S.quoteNumber = null; } // never arm "Update" against someone else's saved quote
  go('calc');
  toast(`✨ ${applied} fields filled from ${(aiState.lastExtract.file || {}).name || 'document'}${wasEditing ? ' — started as a NEW quote' : ''}`);
}

async function kbUpload(file) {
  toast('Uploading' + (aiState.provider ? ' — AI is reading it…' : '…'));
  try {
    const data_b64 = await fileToB64(file);
    const res = await api('/api/kb', { method: 'POST', body: JSON.stringify({ name: file.name, mime: file.type || 'application/pdf', data_b64 }) });
    toast(res.digested ? `✓ ${file.name} read — its numbers are now in KK AI's head` : `✓ ${file.name} stored`);
    refreshKbList();
  } catch (e) { toast('Upload failed: ' + e.message); }
}
async function kbDelete(kbId) {
  if (!confirm('Remove this document from the knowledge base?')) return;
  await api('/api/kb/' + kbId, { method: 'DELETE' });
  refreshKbList();
}

function appendBubble(role, text, thinking, threadSel) {
  const th = $(threadSel || '#chat-thread');
  if (!th) return { remove: () => {} };
  const div = document.createElement('div');
  div.className = 'bubble ' + (role === 'user' ? 'user' : 'ai') + (thinking ? ' thinking' : '');
  div.textContent = text;
  th.appendChild(div);
  th.scrollTop = th.scrollHeight;
  return div;
}
async function sendChat(inputSel, threadSel) {
  inputSel = inputSel || '#chat-q'; threadSel = threadSel || '#chat-thread';
  const inp = $(inputSel);
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  appendBubble('user', q, false, threadSel);
  aiState.history.push({ role: 'user', text: q });
  const wait = appendBubble('ai', 'Thinking…', true, threadSel);
  try {
    const res = await api('/api/ai/ask', { method: 'POST', body: JSON.stringify({ question: q, history: aiState.history.slice(0, -1) }) });
    wait.remove();
    appendBubble('ai', res.answer, false, threadSel);
    aiState.history.push({ role: 'assistant', text: res.answer });
  } catch (e) {
    aiState.history.pop(); // failed turn must not corrupt the conversation history
    wait.remove();
    appendBubble('ai', '⚠️ ' + e.message, false, threadSel);
  }
}

/* ---------- floating KK AI widget ---------- */
function initAiWidget() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <button id="kkw-fab" title="Ask KK AI"><span class="kkw-spark">✨</span><span class="kkw-k">KK</span></button>
  <div id="kkw-panel">
    <div class="kkw-head">
      <span class="kkw-title">✨ KK <span>AI</span></span>
      <span class="kkw-sub">knows your catalog, quotes &amp; pipeline</span>
      <button id="kkw-close" title="Close">✕</button>
    </div>
    <div class="chat-thread kkw-thread" id="kkw-thread"></div>
    <div class="chat-input kkw-input">
      <input type="text" id="kkw-q" placeholder="Ask anything…">
      <button class="btn primary" id="kkw-send">Ask</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  $('#kkw-fab').addEventListener('click', () => {
    const p = $('#kkw-panel');
    const opening = p.style.display !== 'flex';
    p.style.display = opening ? 'flex' : 'none';
    if (opening) {
      const th = $('#kkw-thread');
      th.innerHTML = '';
      if (!aiState.history.length) appendBubble('ai', "Hey — KK AI here. Ask me to size a unit, check the pipeline, or draft something for a customer.", false, '#kkw-thread');
      aiState.history.forEach(m => appendBubble(m.role, m.text, false, '#kkw-thread'));
      $('#kkw-q').focus();
    }
  });
  $('#kkw-close').addEventListener('click', () => $('#kkw-panel').style.display = 'none');
  $('#kkw-send').addEventListener('click', () => sendChat('#kkw-q', '#kkw-thread'));
  $('#kkw-q').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat('#kkw-q', '#kkw-thread'); });
}

/* ===================== nav drag-to-reorder ===================== */
const NAV_ORDER_KEY = 'kkroi_nav_order';
function applyNavOrder() {
  const tabs = $('#tabs');
  if (!tabs) return;
  let order;
  try { order = JSON.parse(localStorage.getItem(NAV_ORDER_KEY) || '[]'); } catch (e) { order = []; }
  if (!order.length) return;
  const btns = $$('#tabs button');
  // saved pages first (in saved order), then any new pages not yet in the saved list
  order.forEach(pg => { const b = btns.find(x => x.dataset.page === pg); if (b) tabs.appendChild(b); });
  btns.forEach(b => { if (!order.includes(b.dataset.page)) tabs.appendChild(b); });
}
function saveNavOrder() {
  const order = $$('#tabs button').map(b => b.dataset.page);
  try { localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order)); } catch (e) {}
}
function initNavReorder() {
  applyNavOrder();
  let dragEl = null;
  $$('#tabs button').forEach(b => {
    b.setAttribute('draggable', 'true');
    b.addEventListener('dragstart', e => { dragEl = b; b.classList.add('nav-dragging'); e.dataTransfer.effectAllowed = 'move'; });
    b.addEventListener('dragend', () => { b.classList.remove('nav-dragging'); dragEl = null; saveNavOrder(); });
    b.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragEl || dragEl === b) return;
      const tabs = $('#tabs');
      const btns = $$('#tabs button');
      // insert dragged element before or after the hovered one based on pointer position
      const after = e.clientX > b.getBoundingClientRect().left + b.offsetWidth / 2;
      tabs.insertBefore(dragEl, after ? b.nextSibling : b);
    });
  });
}

/* ===================== math / transparency tab ===================== */
// Shared content — used by BOTH the on-screen tab and the PDF export so they can't drift.
function mathContentHTML(c, r) {
  const u = S.units.find(x => x.id === c.unit_id) || {};
  const circuits = circuitCount(c), mx = maxCircuitFt(c), wpf = nearestBtv(c.watts_per_ft);
  const scfh = r.hours ? r.scfYr / r.hours : 0;
  const lph = r.hours ? r.litresYr / r.hours : 0;
  const hoursStr = num(r.hours, 1); // show the exact 730.5-based value so multiplications verify
  const gridF = gridCo2KgKwh();
  const pbLine = r.payback === 0 ? 'Capital is already ≤ electric with lower operating cost → <b>immediate</b>'
    : (r.payback == null ? 'No operating savings at these inputs → <b>no payback</b>'
      : `(${money(r.capexK)} − ${money(r.capexE)}) ÷ ${money(r.savings)}/yr = <b>${num(r.payback, 1)} years</b>`);

  // one formula block: label, symbolic, substituted (with bold result)
  const mf = (label, eq, sub) => `
    <div class="mf">
      <div class="mf-label">${label}</div>
      <div class="mf-eq">${eq}</div>
      <div class="mf-sub">${sub}</div>
    </div>`;

  // Raychem BTV table with the active cell highlighted
  const temps = [[50, '50°F'], [0, '0°F'], [-20, '-20°F'], [-40, '-40°F']];
  const family = c.voltage <= 130 ? 120 : 240;
  const bIdx = { 15: 0, 20: 1, 30: 2, 40: 3 }[c.breaker_a];
  let btvRows = '';
  [3, 5, 8, 10].forEach(cable => {
    temps.forEach(([tv, tl], ti) => {
      const row120 = BTV_TABLE[cable][String(tv)][120];
      const row240 = BTV_TABLE[cable][String(tv)][240];
      const cell = (arr, fam, bi) => arr.map((v, i) => {
        const active = cable === wpf && tv === c.startup_f && fam === family && i === bIdx;
        return `<td class="${active ? 'btv-active' : ''}">${v}</td>`;
      }).join('');
      btvRows += `<tr>
        ${ti === 0 ? `<td class="btv-cable" rowspan="4">${cable}BTV</td>` : ''}
        <td class="btv-temp">${tl}</td>
        ${cell(row120, 120)}${cell(row240, 240)}
      </tr>`;
    });
  });

  const fuelBlock = c.fuel_type === 'ng'
    ? mf('Natural gas — annual fuel',
        `scf/yr = usage(scf/hr) × hours &nbsp;·&nbsp; GJ/yr = scf/yr × ${ngGjScf()} &nbsp;·&nbsp; cost = ${c.site_gas ? '0 (site gas)' : (c.gas_price_unit === 'GJ' ? 'GJ/yr × $/GJ' : '(scf/yr ÷ 1000) × $/Mcf')}`,
        `${num(scfh, 1)} × ${hoursStr} = ${num(r.scfYr, 0)} scf/yr → ${num(r.gjYr, 1)} GJ/yr → <b>${money(r.fuelCost)}/yr</b>${c.site_gas ? ' (runs on produced site gas)' : ` @ ${money2(c.gas_price)}/${c.gas_price_unit}`}`)
    : mf('Propane — annual fuel',
        `L/yr = usage(L/hr) × hours &nbsp;·&nbsp; cost = L/yr × $/L`,
        `${num(lph, 2)} × ${hoursStr} = ${num(r.litresYr, 0)} L/yr × ${money2(c.prop_price_unit === 'gal' ? c.prop_price / GAL_L : c.prop_price)}/L = <b>${money(r.fuelCost)}/yr</b>`);

  const co2K = c.fuel_type === 'ng'
    ? `${num(r.scfYr, 0)} scf × ${ngCo2KgScf()} ÷ 1000 = <b>${num(r.co2K, 1)} t/yr</b>`
    : `${num(r.litresYr, 0)} L × ${propaneCo2KgL()} ÷ 1000 = <b>${num(r.co2K, 1)} t/yr</b>`;

  return `
  <div class="card neutral">
    <h2>Current Scenario</h2>
    <div class="grid3" style="font-size:13.5px">
      <div><b>Trace:</b> ${num(c.len_ft)} ft · ${num(c.watts_per_ft)} W/ft · ${num(c.voltage, 0)} V</div>
      <div><b>KK unit:</b> ${esc(u.name || '—')} · ${c.fuel_type === 'ng' ? (c.site_gas ? 'site gas' : 'natural gas') : 'propane'}</div>
      <div><b>Season:</b> ${num(c.season_months)} mo · ${num(c.duty_cycle_pct, 0)}% duty · ${num(c.analysis_years, 0)} yr horizon</div>
    </div>
  </div>

  <div class="card neutral">
    <h2>1 · Operating Hours (both systems)</h2>
    ${mf('Annual operating hours', 'hours = season months × 730.5 × (duty cycle ÷ 100)',
      `${num(c.season_months)} × 730.5 × ${num(c.duty_cycle_pct, 0)}% = <b>${hoursStr} hrs/yr</b>`)}
    <div class="mf-note">730.5 = average hours in a month (8,766 ÷ 12). Duty cycle applies to both the electric trace and the KK burner, so the comparison stays fair. For self-regulating cable (whose output varies with pipe temperature by design) and for the modulating KK burner alike, duty% × maximum rating is the standard seasonal-average energy model.</div>
  </div>

  <div class="card elec">
    <h2><span class="dot blue"></span> 2 · Electric Heat Trace</h2>
    ${mf('Connected load', 'kW = length × watts/ft ÷ 1000',
      `${num(c.len_ft)} × ${num(c.watts_per_ft)} ÷ 1000 = <b>${num(r.kw, 2)} kW</b>`)}
    ${mf('Circuits (→ power &amp; end kits)', 'circuits = ⌈ length ÷ max circuit length ⌉',
      `⌈ ${num(c.len_ft)} ÷ ${num(mx, 0)} ft ⌉ = <b>${circuits} circuit${circuits === 1 ? '' : 's'}</b> → ${circuits} power kit${circuits === 1 ? '' : 's'} + ${circuits} end kit${circuits === 1 ? '' : 's'}`)}
    <div class="mf-note">Max circuit length (${num(mx, 0)} ft) is read from the published Raychem BTV table below: ${wpf}BTV, ${num(c.startup_f, 0)}°F cold start, ${num(c.voltage, 0)} V, ${num(c.breaker_a, 0)} A breaker. Entered W/ft snaps to the nearest standard cable (3/5/8/10 BTV); other manufacturers' tables differ slightly — swap in their values if the customer specifies a brand.</div>
    ${mf('Capital cost', 'capex = trace + kits + cable + install + line extension',
      `${money(r.traceCost)} + ${money(r.kitsCost)} + ${money(r.cableCost)} + ${money(c.elec_install)} + ${money(c.grid_ext)} = <b>${money(r.capexE)}</b>`)}
    ${mf('Annual energy', 'kWh/yr = kW × hours &nbsp;·&nbsp; cost = kWh/yr × $/kWh',
      `${num(r.kw, 2)} × ${hoursStr} = ${num(r.kwhYr, 0)} kWh × ${money2(c.power_rate)} = <b>${money(r.energyCost)}/yr</b>`)}
    ${r.demandCost ? mf('Demand charge', 'cost = $/kW/mo × kW × season months', `${money2(c.demand_charge)} × ${num(r.kw, 2)} × ${num(c.season_months)} = <b>${money(r.demandCost)}/yr</b>`) : ''}
    ${mf('Annual operating cost', 'opex = energy + demand + maintenance',
      `${money(r.energyCost)} + ${money(r.demandCost)} + ${money(c.elec_maint)} = <b>${money(r.opexE)}/yr</b>`)}
  </div>

  <div class="card kk">
    <h2><span class="dot red"></span> 3 · Kold Katcher</h2>
    ${mf('Tubing (runs the same footage as the trace)', 'tubing = length × $/ft',
      `${num(c.len_ft)} × ${money2(c.tube_cost_ft)} = <b>${money(r.tubeCost)}</b>`)}
    ${mf('Capital cost', 'capex = unit + unit install + tubing + tubing install + fuel hookup',
      `${money(c.kk_kit_cost)} + ${money(c.kk_install)} + ${money(r.tubeCost)} + ${money(c.tube_install)} + ${money(c.fuel_hookup)} = <b>${money(r.capexK)}</b>`)}
    ${fuelBlock}
    ${mf('Annual operating cost', 'opex = fuel + maintenance',
      `${money(r.fuelCost)} + ${money(c.kk_maint)} = <b>${money(r.opexK)}/yr</b>`)}
  </div>

  <div class="card neutral">
    <h2>4 · The Comparison — where the ROI comes from</h2>
    ${mf('Annual operating savings', 'savings = electric opex − KK opex',
      `${money(r.opexE)} − ${money(r.opexK)} = <b class="${r.savings >= 0 ? 'pos' : 'neg'}">${money(r.savings)}/yr</b>`)}
    ${mf('Payback period', 'payback = (KK capex − electric capex) ÷ annual savings',
      pbLine)}
    ${mf(`${r.years}-year total cost of ownership`, 'TCO = capex + opex × years',
      `Electric ${money(r.capexE)} + ${money(r.opexE)}×${num(r.years,0)} = <b>${money(r.tcoE)}</b> &nbsp;vs&nbsp; KK ${money(r.capexK)} + ${money(r.opexK)}×${num(r.years,0)} = <b>${money(r.tcoK)}</b>`)}
    ${mf(`${r.years}-year savings`, 'savings = electric TCO − KK TCO',
      `${money(r.tcoE)} − ${money(r.tcoK)} = <b class="${r.tcoSavings >= 0 ? 'pos' : 'neg'}">${money(r.tcoSavings)}</b>`)}
    ${mf('Return on investment', 'ROI = TCO savings ÷ KK capital × 100',
      `${money(r.tcoSavings)} ÷ ${money(r.capexK)} × 100 = <b class="${r.roiPct >= 0 ? 'pos' : 'neg'}">${num(r.roiPct, 0)}%</b>`)}
    <div class="mf-note">All comparison figures are <b>undiscounted</b> — future dollars at par, no power/gas/carbon price escalation. That treatment is applied identically to both systems; an NPV view can be added if a customer requires it.</div>
  </div>

  <div class="card neutral">
    <h2>5 · Emissions</h2>
    ${mf('Electric (grid)', 'tonnes CO₂e/yr = kWh/yr × grid factor ÷ 1000',
      `${num(r.kwhYr, 0)} × ${num(gridF, 2)} ÷ 1000 = <b>${num(r.co2E, 1)} t/yr</b>`)}
    ${mf('Kold Katcher (combustion)', c.fuel_type === 'ng' ? `tonnes/yr = scf/yr × ${ngCo2KgScf()} ÷ 1000` : `tonnes/yr = L/yr × ${propaneCo2KgL()} ÷ 1000`, co2K)}
    <div class="mf-note">Combustion CO₂ only — CH₄/N₂O by-products add roughly 1–2% CO₂e and are excluded on both sides for simplicity.</div>
  </div>

  <div class="card neutral">
    <h2>6 · Constants &amp; Assumptions</h2>
    <div class="mf-note" style="margin-top:0"><b>✎ = editable assumption</b> — change it (button up top) and every formula above recalculates. Unit conversions are fixed mathematical definitions and stay locked so no one can slip a unit error in.</div>
    <table class="list math-consts">
      <tbody>
        <tr><td>✎ Natural gas energy</td><td>${ngGjScf()} GJ/scf</td><td>≈ ${num(ngGjScf() / GJ_PER_SCF * 1000, 0)} BTU/scf (HHV) — raise for richer gas</td></tr>
        <tr><td>✎ Natural gas CO₂</td><td>${ngCo2KgScf()} kg/scf</td><td>combustion emission factor</td></tr>
        <tr><td>✎ Propane CO₂</td><td>${propaneCo2KgL()} kg/L</td><td>combustion emission factor</td></tr>
        <tr><td>✎ Grid CO₂ (Alberta)</td><td>${num(gridF, 2)} kg/kWh</td><td>grid intensity</td></tr>
        <tr><td>Hours per month</td><td>730.5</td><td>fixed — 8,766 hrs/yr ÷ 12</td></tr>
        <tr><td>Gas volume</td><td>${SCF_PER_M3} scf/m³</td><td>fixed unit conversion</td></tr>
        <tr><td>Propane volume</td><td>${GAL_L} L/US gal</td><td>fixed unit conversion</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card neutral">
    <h2>7 · Raychem BTV Circuit-Length Table <span style="font-weight:400;font-size:12px;color:var(--ink-3)">— max feet per circuit (source: Pentair/nVent H51086)</span></h2>
    <div class="mf-note" style="margin-top:0">The highlighted cell is what your current inputs use. Cross-check it against the manufacturer datasheet any time.</div>
    <div style="overflow-x:auto">
    <table class="list btv-table">
      <thead>
        <tr><th rowspan="2">Cable</th><th rowspan="2">Cold start</th><th colspan="4">120 V</th><th colspan="4">240 V</th></tr>
        <tr><th>15A</th><th>20A</th><th>30A</th><th>40A</th><th>15A</th><th>20A</th><th>30A</th><th>40A</th></tr>
      </thead>
      <tbody>${btvRows}</tbody>
    </table>
    </div>
    ${c.voltage === 208 || c.voltage === 277 ? `<div class="mf-note">Your ${num(c.voltage,0)} V supply applies the datasheet length adjustment factor (×${c.voltage === 208 ? LEN_ADJ_208[wpf] : LEN_ADJ_277[wpf]}) to the ${family} V column.</div>` : ''}
  </div>`;
}

function renderMath() {
  const c = S.calc, r = compute(c);
  $('#view').innerHTML = `
  <div class="note-banner">🧮 Every formula below is the <b>exact</b> calculation the tool runs — live with your current calculator inputs. Nothing is hidden. Export it as a PDF anytime someone wants to see the receipts.</div>
  <div class="actions" style="margin-bottom:16px">
    <button class="btn primary" id="math-edit">✏️ Edit Assumptions</button>
    <button class="btn dark" id="math-export">📄 Export Math (PDF)</button>
    <button class="btn ghost" id="math-to-calc">← Change inputs on the Calculator</button>
  </div>
  <div id="assume-form"></div>
  ${mathContentHTML(c, r)}`;
  $('#math-to-calc').addEventListener('click', () => go('calc'));
  $('#math-export').addEventListener('click', exportMath);
  $('#math-edit').addEventListener('click', showAssumeForm);
}

function showAssumeForm() {
  const st = S.settings;
  $('#assume-form').innerHTML = `
  <div class="card kk">
    <h2>Edit Assumptions</h2>
    <p class="hint" style="margin-top:0">These factors feed every formula. Change one and the whole ROI recalculates everywhere — calculator, PDF, and this page. Unit conversions (scf/m³, L/gal, hrs/month) are fixed definitions and can't be edited.</p>
    <div class="grid2">
      ${fld('Natural gas energy (GJ/scf)', 'as-nggj', st.ng_energy_gj_scf || GJ_PER_SCF, {step: 0.000001, hint: '0.001076 = 1,020 BTU/scf (AB GHG default); raise for richer gas'})}
      ${fld('Natural gas CO₂ (kg/scf)', 'as-ngco2', st.ng_co2_kg_scf || KG_CO2_PER_SCF_NG, {step: 0.0001})}
      ${fld('Propane CO₂ (kg/L)', 'as-propco2', st.propane_co2_kg_l || KG_CO2_PER_L_PROPANE, {step: 0.01})}
      ${fld('Grid CO₂ (kg/kWh)', 'as-grid', st.grid_co2_kg_kwh || 0.335, {step: 0.01, hint: 'Alberta grid intensity (0.335 = 2024 published)'})}
    </div>
    <div class="actions">
      <button class="btn primary" id="as-save">Save Assumptions</button>
      <button class="btn ghost" id="as-reset">Reset to Standard Values</button>
      <button class="btn ghost" id="as-cancel">Cancel</button>
    </div>
  </div>`;
  $('#assume-form').scrollIntoView({ behavior: 'smooth' });
  $('#as-cancel').addEventListener('click', () => $('#assume-form').innerHTML = '');
  $('#as-reset').addEventListener('click', () => {
    $('#as-nggj').value = GJ_PER_SCF; $('#as-ngco2').value = KG_CO2_PER_SCF_NG;
    $('#as-propco2').value = KG_CO2_PER_L_PROPANE; $('#as-grid').value = 0.335;
  });
  $('#as-save').addEventListener('click', async () => {
    const body = {
      ng_energy_gj_scf: $('#as-nggj').value, ng_co2_kg_scf: $('#as-ngco2').value,
      propane_co2_kg_l: $('#as-propco2').value, grid_co2_kg_kwh: $('#as-grid').value
    };
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      await loadBootstrap();
      toast('Assumptions saved — all formulas updated');
      renderMath();
    } catch (e) { toast('Save failed: ' + e.message); }
  });
}

function buildMathExport() {
  const c = S.calc, r = compute(c), st = S.settings;
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  $('#print-root').innerHTML = `
  <div class="pq mathdoc">
    <section class="pq-page">
      <header class="pq-head">
        <img src="kk-logo.png" alt="Kold Katcher">
        <div class="pq-head-meta">
          <div class="pq-doc">ROI Methodology &amp; Basis of Calculation</div>
          <div class="pq-num">${esc(S.quoteNumber || 'ROI ANALYSIS')}</div>
          <div class="pq-date">${today}</div>
        </div>
      </header>
      <div class="md-intro">Every figure in ${esc(S.quoteNumber || 'this ROI analysis')}${c.customer ? ' for ' + esc(c.customer) : ''} is derived by the formulas below, shown with the exact inputs used. Circuit counts are read from the published Raychem BTV datasheet (Pentair/nVent H51086). This is the complete, auditable basis of the comparison.</div>
      ${mathContentHTML(c, r)}
      <footer class="pq-foot">
        <div class="foot-brand">KOLD KATCHER INC.<span> — field-proven freeze protection for remote oil &amp; gas, since 2003</span></div>
        <div class="foot-contact">${esc(st.company_city || 'Drumheller, Alberta')} &nbsp;·&nbsp; ${esc(st.company_phone || '')} &nbsp;·&nbsp; ${esc(st.company_email || '')} &nbsp;·&nbsp; koldkatcher.com</div>
        <div class="foot-disc">Conversion and emission factors are industry-standard values; unit pricing and fuel usage are as entered by Kold Katcher. Generated by Kold Kalc.</div>
      </footer>
    </section>
  </div>`;
}
function exportMath() { buildMathExport(); window.print(); }

/* ===================== nav & boot ===================== */
function go(page) {
  S.page = page;
  S.renderGen = (S.renderGen || 0) + 1; // invalidate in-flight async renders
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const fab = $('#kkw-fab'), panel = $('#kkw-panel');
  if (fab) fab.style.display = page === 'ai' ? 'none' : 'flex';
  if (panel) panel.style.display = 'none';
  if (page === 'calc') renderCalc();
  else if (page === 'ai') renderAI().catch(e => toast(e.message));
  else if (page === 'tools') renderTools();
  else if (page === 'math') renderMath();
  else if (page === 'quotes') renderQuotes().catch(e => toast(e.message));
  else if (page === 'units') renderUnits().catch(e => toast(e.message));
  else if (page === 'settings') renderSettings();
}
async function loadBootstrap() {
  const b = await api('/api/bootstrap');
  S.settings = b.settings; S.units = b.units;
}
async function boot() {
  await loadBootstrap();
  S.calc = defaultCalc();
  S.tool = null;
  $$('#tabs button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.page === 'tools') S.tool = null; // tab click always returns to the tool hub
    go(b.dataset.page);
  }));
  initNavReorder();
  initAiWidget();
  go('calc');
}
boot().catch(e => { console.error(e); toast('Failed to load: ' + e.message); });
