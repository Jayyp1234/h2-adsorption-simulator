/* H2 Adsorption Storage Simulator — browser app.
   Physics mirrors engine/model.py; fitted parameters come from model-constants.js,
   which engine/run.py --emit-web-constants regenerates. Keep the two in step. */
(() => {
"use strict";
const MC = window.MODEL_CONSTANTS;
if (!MC) { document.body.innerHTML = "<p style='padding:2rem'>model-constants.js failed to load. Run <code>python engine/run.py --emit-web-constants</code>.</p>"; return; }

const { R, T_BENCH, T_PROD, PRESSURES } = MC.constants;
const COLORS = ["#1f4e79","#2e75b6","#843c0c","#c55a11","#548235","#70ad47","#7030a0","#a56ad6"];
/* Viridis samples matching matplotlib's q_st sensitivity figure. */
const VIRIDIS = ["#440154","#3b528b","#21918c","#5ec962","#fde725"];

/** Initial parameter values, taken from whatever engine/run.py last emitted so the
 *  app and the deliverables never disagree about the operating point. */
function specDefaults() {
  const d = MC.defaults || {};
  return {
    qst: d.q_st != null ? d.q_st : 4.0,
    T: d.temperature != null ? d.temperature : T_PROD,
    model: d.isotherm_model || "sips",
    basis: d.basis || "literature",
    approach: d.composite_approach || "B",
    pMax: d.pressures ? Math.max(...d.pressures) : 10,
  };
}

const state = { screen: "setup", unit: "mg_per_g", external: null, ...specDefaults() };

/* ------------------------------------------------------------------ physics */
/* Delegated to web/physics.js so the browser and engine/parity_check.py exercise
   the same code. Regenerate constants with: python engine/run.py --emit-web-constants */
const PHYS = window.H2Physics.make(MC);
const { uptake, formFactor, runConfig, runMatrix, benchmarkCheck, storageBalance } = PHYS;
const pressures = () => PRESSURES.filter(p => p <= state.pMax);
const val = r => r[state.unit];
const unitLabel = () => state.unit === "mg_per_g" ? "mg H\u2082 / g adsorbent" : "Uptake (wt%)";
const unitShort = () => state.unit === "mg_per_g" ? "mg/g" : "wt%";

/* ------------------------------------------------------------------- charts */
/* SVG charts mirror engine/deliverables.py matplotlib figures (titles, markers,
   dash styles, viridis sensitivity palette, dual-panel validation layout). */
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = (v,d=4) => Number(v).toFixed(d);

function markerAt(shape, x, y, color, r = 4) {
  const cx = x.toFixed(1), cy = y.toFixed(1);
  if (shape === "square") {
    const s = (r * 1.7).toFixed(1);
    return `<rect x="${(x - r * 0.85).toFixed(1)}" y="${(y - r * 0.85).toFixed(1)}" width="${s}" height="${s}" fill="${color}" stroke="#fff" stroke-width="0.6"/>`;
  }
  if (shape === "none") return "";
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="0.6"/>`;
}

function lineChart(series, opts = {}) {
  const hasTitle = !!(opts.title || opts.subtitle);
  const W = opts.width || 760;
  const H = opts.height || (hasTitle ? 420 : 380);
  const m = {
    t: hasTitle ? (opts.subtitle ? 52 : 36) : 18,
    r: opts.marginRight || 18,
    b: 52,
    l: opts.marginLeft || 74,
  };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const logY = !!opts.logY;
  const xs = series.flatMap(s => s.x);
  const ys = series.flatMap(s => {
    const vals = (s.y || []).slice();
    if (s.band) { vals.push(...s.band.up, ...s.band.lo); }
    return vals;
  }).filter(v => logY ? v > 0 : Number.isFinite(v));
  const xMax = opts.xMax != null ? opts.xMax : Math.max(...xs) * 1.05;
  const xMin = opts.xMin != null ? opts.xMin : 0;
  let yMax = Math.max(...ys), yMin = logY ? Math.min(...ys) : (opts.yMin != null ? opts.yMin : Math.min(0, Math.min(...ys)));
  if (logY) {
    yMax = Math.pow(10, Math.ceil(Math.log10(yMax)));
    yMin = Math.pow(10, Math.floor(Math.log10(yMin)));
  } else if (opts.yMax != null) {
    yMax = opts.yMax;
  } else {
    const pad = (yMax - yMin) * 0.08 || 0.05;
    if (opts.yMin == null && Math.min(...ys) > 0) yMin = Math.max(0, Math.min(...ys) - pad);
    yMax = yMax + pad || 1;
  }
  const px = v => m.l + (v - xMin) / (xMax - xMin || 1) * iw;
  const py = v => logY
    ? m.t + ih - (Math.log10(Math.max(v, yMin)) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin) || 1) * ih
    : m.t + ih - (v - yMin) / (yMax - yMin || 1) * ih;

  let g = "";
  /* Plot frame + dotted grid (matplotlib alpha≈0.3, linestyle=':') */
  g += `<rect class="plot-frame" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="var(--panel)" stroke="var(--ink)" stroke-width="1.1"/>`;

  const yTicks = [];
  if (logY) {
    for (let e = Math.log10(yMin); e <= Math.log10(yMax) + 1e-9; e++) yTicks.push(Math.pow(10, e));
  } else {
    const n = opts.yTicks || 6;
    for (let i = 0; i < n; i++) yTicks.push(yMin + (yMax - yMin) * i / (n - 1));
  }
  yTicks.forEach(t => {
    g += `<line class="grid" x1="${m.l}" y1="${py(t).toFixed(1)}" x2="${m.l + iw}" y2="${py(t).toFixed(1)}"/>`;
    const label = logY
      ? (t >= 1 || t === 0.1 ? String(t) : t.toExponential(0).replace("e-", "e−"))
      : (yMax < 1 ? t.toFixed(2) : yMax < 10 ? t.toFixed(2) : t.toFixed(1));
    g += `<text class="tick" x="${m.l - 9}" y="${(py(t) + 4).toFixed(1)}" text-anchor="end">${label}</text>`;
  });
  const xTicks = opts.xTicks || PRESSURES.filter(p => p <= Math.max(...xs));
  xTicks.forEach(t => {
    g += `<line class="grid" x1="${px(t).toFixed(1)}" y1="${m.t}" x2="${px(t).toFixed(1)}" y2="${m.t + ih}"/>`;
    g += `<text class="tick" x="${px(t).toFixed(1)}" y="${m.t + ih + 18}" text-anchor="middle">${t}</text>`;
  });

  let paths = "";
  series.forEach(s => {
    const pts = s.x.map((x, i) => [px(x), py(s.y[i])]);
    if (s.band) {
      const up = s.band.up.map((v, i) => `${px(s.x[i]).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
      const dn = [...s.band.lo].map((v, i) => `${px(s.x[i]).toFixed(1)},${py(v).toFixed(1)}`).reverse().join(" ");
      paths += `<polygon points="${up} ${dn}" fill="${s.band.color || s.color}" opacity="${s.band.opacity != null ? s.band.opacity : 0.18}"/>`;
    }
    if (s.bandOnly || s.hideLine) return;
    paths += `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width || 1.8}"
      stroke-linejoin="round" stroke-linecap="round"
      ${s.dash ? 'stroke-dasharray="7 4"' : ""}
      points="${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}"/>`;
    const shape = s.marker || "circle";
    pts.forEach(p => { paths += markerAt(shape, p[0], p[1], s.color, s.markerSize || 4); });
  });

  /* In-plot legend matching matplotlib framealpha≈0.95, upper left */
  let legendSvg = "";
  if (opts.legendInPlot !== false) {
    const rows = series.filter(s => !s.hideLegend);
    const lw = opts.legendWidth || Math.min(280, 36 + Math.max(...rows.map(s => s.label.length)) * 6.2);
    const lh = 10 + rows.length * 16;
    const lx = m.l + 10, ly = m.t + 10;
    legendSvg += `<rect class="legend-box" x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="2"/>`;
    rows.forEach((s, i) => {
      const y = ly + 14 + i * 16;
      const x0 = lx + 10;
      if (s.band && s.bandOnly) {
        legendSvg += `<rect x="${x0}" y="${y - 6}" width="22" height="10" fill="${s.band.color || s.color}" opacity="0.35"/>`;
      } else {
        legendSvg += `<line x1="${x0}" y1="${y}" x2="${x0 + 22}" y2="${y}" stroke="${s.color}" stroke-width="1.8"
          ${s.dash ? 'stroke-dasharray="5 3"' : ""}/>`;
        legendSvg += markerAt(s.marker || "circle", x0 + 11, y, s.color, 3.2);
      }
      legendSvg += `<text class="legend-label" x="${x0 + 30}" y="${y + 3.5}">${esc(s.label)}</text>`;
    });
  }

  let titleSvg = "";
  if (opts.title) {
    titleSvg += `<text class="chart-title" x="${W / 2}" y="18" text-anchor="middle">${esc(opts.title)}</text>`;
  }
  if (opts.subtitle) {
    titleSvg += `<text class="chart-subtitle" x="${W / 2}" y="34" text-anchor="middle">${esc(opts.subtitle)}</text>`;
  }

  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || opts.yLabel || "chart")}">
    ${titleSvg}${g}${paths}${legendSvg}
    <text class="axis-title" x="${m.l + iw / 2}" y="${H - 10}" text-anchor="middle">${esc(opts.xLabel || "Pressure (bar)")}</text>
    <text class="axis-title" x="${-(m.t + ih / 2)}" y="14" text-anchor="middle" transform="rotate(-90)">${esc(opts.yLabel || "")}</text>
  </svg></div>`;
}

function barChart(items, opts = {}) {
  const W = 760, H = 330, m = { t: 18, r: 18, b: 96, l: 74 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const yMax = Math.max(...items.map(i => i.value)) * 1.12 || 1;
  const bw = iw / items.length;
  let g = "";
  g += `<rect class="plot-frame" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="var(--panel)" stroke="var(--ink)" stroke-width="1.1"/>`;
  for (let i = 0; i <= 5; i++) {
    const v = yMax * i / 5, y = m.t + ih - (v / yMax) * ih;
    g += `<line class="grid" x1="${m.l}" y1="${y.toFixed(1)}" x2="${m.l + iw}" y2="${y.toFixed(1)}"/>`;
    g += `<text class="tick" x="${m.l - 9}" y="${(y + 4).toFixed(1)}" text-anchor="end">${v.toFixed(2)}</text>`;
  }
  items.forEach((it, i) => {
    const h = (it.value / yMax) * ih, x = m.l + i * bw + bw * 0.18, w = bw * 0.64, y = m.t + ih - h;
    g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" fill="${it.color}" rx="2"/>`;
    g += `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" style="font-weight:650;fill:var(--ink)">${fmt(it.value, 3)}</text>`;
    g += `<text class="tick" x="${(x + w / 2).toFixed(1)}" y="${m.t + ih + 16}" text-anchor="middle">Run ${it.run}</text>`;
    const words = it.label.split(" "); let ln = [], lines = [];
    words.forEach(wd => { if ((ln.join(" ") + " " + wd).length > 16) { lines.push(ln.join(" ")); ln = [wd]; } else ln.push(wd); });
    lines.push(ln.join(" "));
    lines.slice(0, 3).forEach((L, k) => g += `<text class="tick" x="${(x + w / 2).toFixed(1)}" y="${m.t + ih + 30 + k * 12}" text-anchor="middle" style="font-size:9.5px">${esc(L)}</text>`);
  });
  return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}">${g}
    <text class="axis-title" x="${-(m.t + ih / 2)}" y="14" text-anchor="middle" transform="rotate(-90)">${esc(opts.yLabel || "")}</text></svg></div>`;
}

/* ------------------------------------------------------------------ screens */
const SCREENS = [
  ["setup","Setup","Test matrix"],
  ["vessel","Vessel","3D + animation"],
  ["validation","Validation","77 K gate"],
  ["results","Results","Master table"],
  ["comparison","Comparison","Rank configs"],
  ["sensitivity","Sensitivity","qₛₜ sweep"],
];

function screenSetup() {
  const mat = runMatrix(state);
  const rows = mat.map(r => `<tr>
    <td><span class="swatch" style="background:${COLORS[r.run-1]}"></span>${r.run}</td>
    <td>${esc(r.label)}</td>
    <td>${esc(MC.materials[r.zeolite].label)}</td>
    <td style="text-align:left">${r.form === "powder" ? "Powder" : "Granular"}</td>
    <td style="text-align:left">${r.composite ? "15 wt% nano-AC" : "—"}</td>
    <td>×${fmt(formFactor(r, state.basis),3)}</td>
    <td>×${r.composite ? fmt(MC.factors.composite,2) : "1.00"}</td>
    <td><span class="pill ${r.priority==="HIGH"?"ok":"warn"}">${r.priority}</span></td></tr>`).join("");

  const m13 = MC.materials["13X"], m5a = MC.materials["5A"];
  const props = (m,k) => m[k];
  const propRows = [
    ["Framework","framework"],["BET surface area (m²/g)","bet_area"],
    ["Micropore volume (cm³/g)","micropore_volume"],["Crystal density (g/cm³)","crystal_density"],
    ["Bulk density, granular (g/cm³)","bulk_density"],["Binder fraction","binder_fraction"],
  ].map(([lab,k]) => `<tr><td>${esc(lab)}</td><td>${esc(props(m13,k))}</td><td>${esc(props(m5a,k))}</td></tr>`).join("");

  const v = MC.vessel;
  return `
  <div class="card"><h3>Test matrix — 8 configurations (spec Section 4)</h3><div class="body">
    <div class="note info">Two zeolites × two physical forms × plain/composite. Composite runs
      carry 15 wt% nano-activated carbon at an 85:15 ratio, ${MC.factors.bed_loading_g} g total bed loading.</div>
    <div class="tbl-wrap"><table><thead><tr>
      <th>Run</th><th>Configuration</th><th style="text-align:left">Zeolite</th>
      <th style="text-align:left">Form</th><th style="text-align:left">Nano-AC</th>
      <th>Form factor</th><th>Composite</th><th>Priority</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div></div>

  <div class="grid2">
    <div class="card"><h3>Adsorbent properties (spec Section 2)</h3><div class="body">
      <div class="tbl-wrap"><table><thead><tr><th style="text-align:left">Property</th>
        <th>13X</th><th>5A</th></tr></thead><tbody>${propRows}</tbody></table></div>
      <p class="hint">Nano-AC: BET ≥ ${MC.nano_ac.bet_area} m²/g, micropore volume
        ≥ ${MC.nano_ac.micropore_volume} cm³/g, true density ${MC.nano_ac.true_density} g/cm³.</p>
    </div></div>

    <div class="card"><h3>Vessel geometry (recomputed)</h3><div class="body">
      <div class="note warn"><span class="dev-tag">SPEC-DEV-5</span>
        <span>Section 3 states 484 cm³ for π·(25 mm)²·250 mm, which is
        ${fmt(v.total_cm3,1)} cm³. It labels dead volume “60 cm³ (30 cm³ × 2)”
        but subtracts 120 cm³ to reach 364 cm³. A 30 mm end space at ID 50 mm is
        ${fmt(v.dead_per_end_cm3,1)} cm³ <em>per end</em>.</span></div>
      <div class="tbl-wrap"><table><tbody>
        <tr><td>Internal volume</td><td>${fmt(v.total_cm3,1)} cm³</td>
          <td style="color:var(--ink-2)">spec: ${v.spec_stated_total_cm3}</td></tr>
        <tr><td>Dead volume per end</td><td>${fmt(v.dead_per_end_cm3,1)} cm³</td>
          <td style="color:var(--ink-2)">spec: 30</td></tr>
        <tr><td>Dead volume total</td><td>${fmt(v.dead_total_cm3,1)} cm³</td>
          <td style="color:var(--ink-2)">spec: 60</td></tr>
        <tr><td>Active bed volume</td><td>${fmt(v.active_bed_cm3,1)} cm³</td>
          <td style="color:var(--ink-2)">spec: ${v.spec_stated_active_cm3}</td></tr>
      </tbody></table></div>
    </div></div>
  </div>`;
}

function screenValidation() {
  const c = benchmarkCheck(state);
  const byZ = z => c.rows.filter(r => r.zeolite === z);
  const rows = c.rows.map(r => `<tr>
    <td>${r.zeolite}</td><td>${r.P}</td><td>${fmt(r.pred,4)}</td><td>${fmt(r.target,2)}</td>
    <td>${fmt(r.target*0.85,3)} – ${fmt(r.target*1.15,3)}</td>
    <td style="color:${Math.abs(r.err)>15?"var(--bad)":"var(--ink)"}">${r.err>=0?"+":""}${fmt(r.err,2)}%</td>
    <td><span class="pill ${r.pass?"ok":"bad"}">${r.pass?"PASS":"FAIL"}</span></td></tr>`).join("");

  /* Dual-panel layout matching out/validation_77K.png */
  const panel = z => {
    const rs = byZ(z);
    const P = rs.map(r => r.P), tgt = rs.map(r => r.target), pred = rs.map(r => r.pred);
    const series = [
      { label: "±15% tolerance", color: "#70ad47", x: P, y: tgt, bandOnly: true,
        band: { up: tgt.map(t => t * 1.15), lo: tgt.map(t => t * 0.85), color: "#70ad47", opacity: 0.18 } },
      { label: "Langmi et al. (2003)", color: "#548235", dash: true, marker: "circle", x: P, y: tgt },
      { label: "Model", color: "#1f4e79", marker: "square", x: P, y: pred },
    ];
    return lineChart(series, {
      title: `Zeolite ${z} at 77 K`,
      xLabel: "Pressure (bar)", yLabel: "Uptake (wt%)",
      width: 520, height: 360, legendWidth: 168, xMax: 10.5,
    });
  };

  const fits = ["13X","5A"].map(z => {
    const f = MC.fits[state.model][z];
    return `<tr><td>${z}</td>
      <td style="text-align:left">${Object.entries(f.params).map(([k,v])=>`${k}=${fmt(v,4)}`).join(", ")}</td>
      <td>${fmt(f.max_abs_error_pct,2)}%</td><td>${fmt(f.rmse_pct,2)}%</td></tr>`;
  }).join("");

  return `
  <div class="card"><h3>77 K benchmark gate — Langmi et al. (2003)</h3><div class="body">
    <div class="note warn"><span class="dev-tag">NOT INDEPENDENT</span>
      <span>The model is <b>fitted to these same points</b>, so this measures fit quality, not
      independent validation. Section 6 calls the 77 K check non-negotiable — to satisfy it
      properly, import external GCMC or ML output below.</span></div>
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="lab">Points within ±15%</div>
        <div class="val">${c.passed} / ${c.total}</div>
        <div class="sub">Section 10 requires 10/10</div></div>
      <div class="kpi"><div class="lab">Section 6 verdict</div>
        <div class="val">${["13X","5A"].every(z=>byZ(z).filter(r=>!r.pass).length<=2)?"PASS":"FAIL"}</div>
        <div class="sub">allows 2 of 5 failures per zeolite</div></div>
      <div class="kpi"><div class="lab">Worst deviation</div>
        <div class="val">${fmt(Math.max(...c.rows.map(r=>Math.abs(r.err))),2)}%</div>
        <div class="sub">${esc(MC.models[state.model].label)}</div></div>
    </div>
    <p class="chart-suptitle">Benchmark check against Langmi et al. (2003) at 77 K</p>
    <div class="grid2 chart-pair">${panel("13X")}${panel("5A")}</div>
  </div></div>

  <div class="grid2">
    <div class="card"><h3>Point-by-point comparison</h3><div class="body"><div class="tbl-wrap">
      <table><thead><tr><th style="text-align:left">Zeolite</th><th>P (bar)</th><th>Model</th>
        <th>Langmi</th><th>±15% band</th><th>Error</th><th>Verdict</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div></div>

    <div class="card"><h3>Fit quality &amp; independent validation</h3><div class="body">
      <div class="tbl-wrap"><table><thead><tr><th style="text-align:left">Zeolite</th>
        <th style="text-align:left">Fitted parameters</th><th>Max error</th><th>RMSE</th></tr></thead>
        <tbody>${fits}</tbody></table></div>
      <p class="hint" style="margin-top:10px">${esc(MC.models[state.model].note)}</p>
      <div class="note info" style="margin-top:12px"><span>⚠️ ${esc(MC.notes.excess_vs_absolute)}</span></div>
      <h4 style="margin:14px 0 6px;font-size:12.5px">Import external 77 K results</h4>
      <p class="hint">CSV columns <code>zeolite,pressure_bar,wt_pct</code> — 10 rows
        (13X and 5A at 1, 3, 5, 7, 10 bar). This runs a genuinely independent check.</p>
      <input type="file" id="extFile" accept=".csv" style="margin-top:8px"/>
      <div id="extResult"></div>
    </div></div>
  </div>`;
}

function screenResults() {
  const mat = runMatrix(state);
  const P = pressures();
  const best = mat.reduce((a,b) => val(b)[val(b).length-1] > val(a)[val(a).length-1] ? b : a);
  const rows = mat.map(r => `<tr class="${r.run===best.run?"best":""}">
    <td><span class="swatch" style="background:${COLORS[r.run-1]}"></span>${r.run}</td>
    <td>${esc(r.label)}</td>
    ${val(r).map(v=>`<td>${fmt(v,4)}</td>`).join("")}
    <td>${fmt(r.grams[r.grams.length-1],4)} g</td></tr>`).join("");

  const series = mat.map(r => ({
    label: `Run ${r.run} — ${r.label}`, color: COLORS[r.run - 1],
    dash: r.composite, marker: "circle", x: r.pressures, y: val(r),
  }));
  const sb = storageBalance(best.wt_pct[best.wt_pct.length-1], P[P.length-1], state.T);
  const ratio = PRESSURES.map(p => uptake("13X", state.T, p, state.qst, state.model) /
                                   uptake("13X", T_BENCH, p, state.qst, state.model));

  return `
  <div class="card"><h3>Master isotherm table — spec Section 7.1</h3><div class="body">
    <div class="note info"><span>Equilibrium uptake at <b>${state.T} K</b>, q<sub>st</sub> =
      <b>${state.qst} kJ/mol</b>, ${esc(MC.models[state.model].label)} model,
      ${state.basis === "literature" ? "literature" : "pure-framework"} basis, composite
      Approach ${state.approach}. Units: <b>${unitShort()}</b>.</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Run</th><th>Configuration</th>
      ${P.map(p=>`<th>${p} bar</th>`).join("")}
      <th>In ${MC.factors.bed_loading_g} g bed</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint" style="margin-top:9px">Highlighted row is the best performer.
      The specification predicted Run 6 would lead.</p>
  </div></div>

  <div class="card"><h3>Predicted isotherms — all 8 runs</h3><div class="body">
    ${lineChart(series, {
      title: `Predicted H₂ Adsorption Isotherms at ${state.T} K`,
      subtitle: `qst = ${state.qst} kJ/mol, ${MC.models[state.model].label} model`,
      xLabel: "Pressure (bar)", yLabel: unitLabel(),
      height: 460, legendWidth: 250, xMax: Math.max(...P) * 1.05, yMin: 0,
    })}
    <p class="hint" style="margin-top:8px">Dashed lines are composite (+ Nano-AC) runs — same styling as
      <code>out/isotherms_all_runs.png</code>.</p>
  </div></div>

  <div class="grid2">
    <div class="card"><h3>Storage reality check</h3><div class="body">
      <div class="note warn"><span class="dev-tag">NOT IN SPEC</span>
        <span>At ${state.T} K the vessel holds more hydrogen as ordinary compressed gas than
        the bed captures by adsorption. Worth stating in Chapter 4 before an examiner raises it.</span></div>
      <div class="kpis">
        <div class="kpi"><div class="lab">Adsorbed (Run ${best.run})</div>
          <div class="val">${fmt(sb.ads,4)} g</div><div class="sub">in ${MC.factors.bed_loading_g} g bed</div></div>
        <div class="kpi"><div class="lab">Free compressed gas</div>
          <div class="val">${fmt(sb.free,4)} g</div>
          <div class="sub">${fmt(MC.vessel.active_bed_cm3*MC.vessel.void_fraction+MC.vessel.dead_total_cm3,0)} cm³ void</div></div>
        <div class="kpi"><div class="lab">Stored by adsorption</div>
          <div class="val">${fmt(sb.frac*100,1)}%</div><div class="sub">of total in vessel</div></div>
      </div>
    </div></div>

    <div class="card"><h3>Temperature ratio n(${state.T} K) / n(77 K)</h3><div class="body">
      <div class="note warn"><span class="dev-tag">SPEC-DEV-2</span>
        <span>Section 6.1 gates this ratio at a constant <b>0.0228</b>. It is not constant —
        13X is ~95% saturated at 77 K / 10 bar, where the Henry's-law limit that produced
        0.0228 does not apply. A correct run fails that gate.</span></div>
      <div class="tbl-wrap"><table><thead><tr><th style="text-align:left">Pressure</th>
        ${PRESSURES.map(p=>`<th>${p} bar</th>`).join("")}</tr></thead><tbody>
        <tr><td>This model</td>${ratio.map(r=>`<td>${fmt(r,4)}</td>`).join("")}</tr>
        <tr><td>Spec Section 6.1</td>${PRESSURES.map(()=>`<td style="color:var(--ink-2)">0.0228</td>`).join("")}</tr>
      </tbody></table></div>
    </div></div>
  </div>`;
}

function screenComparison() {
  const mat = runMatrix(state);
  const last = a => a[a.length-1];
  const ranked = [...mat].sort((a,b) => last(val(b)) - last(val(a)));
  const P = pressures(), pTop = last(P);
  const items = mat.map(r => ({ run:r.run, label:r.label, value:last(val(r)), color:COLORS[r.run-1] }));

  const base = mat.find(r => r.run === 1);
  const rows = ranked.map((r,i) => {
    const vsBase = (last(val(r))/last(val(base)) - 1)*100;
    return `<tr class="${i===0?"best":""}"><td>${i+1}</td>
      <td><span class="swatch" style="background:${COLORS[r.run-1]}"></span>Run ${r.run}</td>
      <td style="text-align:left">${esc(r.label)}</td>
      <td>${fmt(last(val(r)),4)}</td>
      <td style="color:${vsBase>=0?"var(--ok)":"var(--bad)"}">${vsBase>=0?"+":""}${fmt(vsBase,1)}%</td>
      <td>${fmt(last(r.grams),4)} g</td></tr>`;
  }).join("");

  const pairs = [
    ["Powder vs granular (13X plain)", last(val(mat[1]))/last(val(mat[0]))],
    ["Powder vs granular (5A plain)",  last(val(mat[3]))/last(val(mat[2]))],
    ["Composite vs plain (13X gran.)", last(val(mat[4]))/last(val(mat[0]))],
    ["13X vs 5A (granular plain)",     last(val(mat[0]))/last(val(mat[2]))],
  ].map(([lab,r]) => `<tr><td style="text-align:left">${esc(lab)}</td>
      <td>×${fmt(r,3)}</td><td>${r>=1?"+":""}${fmt((r-1)*100,1)}%</td></tr>`).join("");

  return `
  <div class="card"><h3>Ranking at ${pTop} bar</h3><div class="body">
    ${barChart(items, { yLabel:unitLabel() })}
  </div></div>
  <div class="grid2">
    <div class="card"><h3>Ranked configurations</h3><div class="body"><div class="tbl-wrap">
      <table><thead><tr><th>#</th><th>Run</th><th style="text-align:left">Configuration</th>
        <th>${unitShort()}</th><th>vs Run 1</th><th>In bed</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div></div>
    <div class="card"><h3>Effect of each variable</h3><div class="body">
      <div class="tbl-wrap"><table><thead><tr><th style="text-align:left">Comparison</th>
        <th>Ratio</th><th>Change</th></tr></thead><tbody>${pairs}</tbody></table></div>
      <div class="note warn" style="margin-top:12px"><span class="dev-tag">SPEC-DEV-1</span>
        <span>On the <b>literature</b> basis the powder advantage is
        ×${fmt(MC.factors.powder,2)}. Switching to <b>pure-framework</b> makes it
        ×${fmt(MC.factors.powder/(1-MC.materials["13X"].binder_fraction),3)}, because
        Section 4.1's ×0.825 binder term then applies to granular runs. Table 11.1 was
        generated without it — pick one and state it.</span></div>
    </div></div>
  </div>`;
}

function screenSensitivity() {
  const qs = [4,5,6,7,8];
  const sweeps = qs.map(q => ({ q, mat: runMatrix({ ...state, qst:q }) }));
  const run6Cfg = sweeps[0].mat[5];
  const run6 = sweeps.map((s, i) => {
    const r = s.mat[5];
    return {
      label: `qst = ${s.q} kJ/mol`, color: VIRIDIS[i],
      marker: "square", x: r.pressures, y: val(r),
    };
  });
  const last = a => a[a.length-1];
  const hi = last(val(sweeps[0].mat[5])), lo = last(val(sweeps[sweeps.length-1].mat[5]));

  const rows = sweeps.map(s => `<tr><td>${s.q}</td>
    ${val(s.mat[5]).map(v=>`<td>${fmt(v,4)}</td>`).join("")}
    <td>${fmt(last(val(s.mat[5]))/lo,1)}×</td></tr>`).join("");

  return `
  <div class="card"><h3>Isosteric heat sensitivity — Run 6</h3><div class="body">
    <div class="note bad"><span class="dev-tag">SPEC-DEV-3</span>
      <span>Across the specification's own 4–8 kJ/mol range the answer moves by
      <b>${fmt(hi/lo,0)}×</b>. Section 11's sanity gate is a factor of 3, and Section 5
      lists this sweep as <b>optional</b>. It is the dominant uncertainty in every number
      the model produces — fix q<sub>st</sub> before anything else.</span></div>
    ${lineChart(run6, {
      title: `Isosteric Heat Sensitivity — Run 6: ${run6Cfg.label}`,
      subtitle: `at ${state.T} K`,
      xLabel: "Pressure (bar)", yLabel: unitLabel(),
      logY: true, height: 440, legendWidth: 140,
    })}
  </div></div>
  <div class="card"><h3>Run 6 across qₛₜ</h3><div class="body">
    <div class="tbl-wrap"><table><thead><tr><th>qₛₜ (kJ/mol)</th>
      ${pressures().map(p=>`<th>${p} bar</th>`).join("")}<th>vs 8 kJ/mol</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="note warn" style="margin-top:12px"><span>Section 2.1 calls 4 kJ/mol the
      “conservative estimate”. It is the <b>optimistic</b> bound — the exponent
      is negative, so lower q<sub>st</sub> gives higher uptake at ${state.T} K.</span></div>
  </div></div>`;
}


/* ------------------------------------------------------- 3D vessel screen */
let V3D = null, v3dAnim = { playing: true, stageIdx: 0, t: 0 };
const V3D_STAGES = [
  { name: "Evacuate",      P: 0,  T: 195, sat: 0.00 },
  { name: "Pressurise",    P: 5,  T: 195, sat: 0.25 },
  { name: "Adsorption",    P: 10, T: 195, sat: 0.70 },
  { name: "Equilibrium",   P: 10, T: 195, sat: 1.00 },
  { name: "Depressurise",  P: 2,  T: 195, sat: 0.55 },
  { name: "Desorption",    P: 1,  T: 353, sat: 0.05 },
];

function screenVessel() {
  const mat = runMatrix(state);
  const best = mat.reduce((x,y) => y[state.unit].slice(-1)[0] > x[state.unit].slice(-1)[0] ? y : x);
  return `
  <div class="card"><h3>3D vessel — V-101 with CB-101 cooling bath</h3><div class="body">
    <div class="note info"><span>Geometry is built from the P&amp;ID dimensions:
      ID ${MC.vessel ? 50 : 50}&nbsp;mm &times; 250&nbsp;mm, ${fmt(MC.vessel.dead_per_end_cm3,1)}&nbsp;cm&sup3;
      dead space at each end, retainer screens bounding the bed. Bed particles are drawn at
      the 85:15 zeolite / nano-AC ratio. Drag to orbit, scroll to zoom.</span></div>
    <div class="v3d-wrap" id="v3dHost">
      <div class="v3d-stage"><span class="dot"></span><span id="v3dStage">Adsorption</span></div>
      <div class="v3d-hint">drag to orbit &middot; scroll to zoom &middot; right-drag to pan</div>
    </div>
    <div class="v3d-bar">
      <button id="v3dPlay" class="on">Pause</button>
      <button id="v3dCut" class="on">Cutaway</button>
      <button id="v3dLabels" class="on">Labels</button>
      <button id="v3dReset">Reset view</button>
      <button id="v3dShot">Save PNG</button>
      <span style="flex:1"></span>
      <span class="hint" style="margin:0">Showing Run ${best.run} — ${esc(best.label)}</span>
    </div>
    <div class="v3d-layers" id="v3dLayers"></div>
  </div></div>

  <div class="grid2">
    <div class="card"><h3>Process cycle</h3><div class="body">
      <div class="tbl-wrap"><table><thead><tr><th style="text-align:left">Stage</th>
        <th>Pressure</th><th>Temperature</th><th>Bed saturation</th></tr></thead><tbody>
        ${V3D_STAGES.map((s,i)=>`<tr id="v3dRow${i}"><td style="text-align:left">${s.name}</td>
          <td>${s.P} bar</td><td>${s.T} K</td><td>${(s.sat*100).toFixed(0)}%</td></tr>`).join("")}
      </tbody></table></div>
      <p class="hint" style="margin-top:9px">Saturation drives how many bed sites fill in the
        animation. Desorption needs the bath removed and the heating tape energised (E-101),
        which is why that row sits at 353&nbsp;K.</p>
    </div></div>
    <div class="card"><h3>What the animation is showing</h3><div class="body">
      <div class="note warn"><span class="dev-tag">READ THIS</span><span>
        Particle counts are <b>illustrative, not quantitative</b>. At
        ${state.T}&nbsp;K the bed holds ${fmt(best.grams.slice(-1)[0],4)}&nbsp;g of H&#8322; across
        ~90&nbsp;g of adsorbent — roughly 10&sup1;&sup2;&sup2; molecules. The scene draws a few hundred so
        the mechanism reads; do not count them.</span></div>
      <div class="kpis">
        <div class="kpi"><div class="lab">Bed particles drawn</div><div class="val">2,600</div>
          <div class="sub">85:15 zeolite / nano-AC</div></div>
        <div class="kpi"><div class="lab">Vessel internal</div>
          <div class="val">${fmt(MC.vessel.total_cm3,0)}</div><div class="sub">cm&sup3;</div></div>
        <div class="kpi"><div class="lab">Active bed</div>
          <div class="val">${fmt(MC.vessel.active_bed_cm3,0)}</div><div class="sub">cm&sup3;</div></div>
      </div>
    </div></div>
  </div>`;
}

function mountVessel3D() {
  const host = document.getElementById("v3dHost");
  if (!host || !window.__createVesselView) return;
  if (V3D) { V3D.dispose(); V3D = null; }
  V3D = window.__createVesselView(host, {
    dims: { innerDiaMm: 50, lengthMm: 250, wallMm: 4, deadSpaceMm: 30,
            showCarbon: true, carbonFraction: MC.factors.nano_ac_fraction, heatingTape: true },
    bedLabel: "Composite bed · 85:15 zeolite / nano-AC",
    bathLabel: "CB-101 · dry ice + acetone, 195 K",
  });

  const layerNames = { shell:"Vessel shell", caps:"End caps", bed:"Adsorbent bed",
                       screens:"Retainer screens", bath:"Cooling bath",
                       piping:"Piping & instruments", tape:"Heating tape", flow:"H₂ molecules" };
  document.getElementById("v3dLayers").innerHTML = V3D.getLayers().map(k =>
    `<label><input type="checkbox" data-layer="${k}" checked> ${layerNames[k]||k}</label>`).join("");
  document.querySelectorAll("[data-layer]").forEach(cb =>
    cb.onchange = () => V3D.setLayer(cb.dataset.layer, cb.checked));

  const btn = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = () => fn(e); };
  btn("v3dPlay", e => { v3dAnim.playing = !v3dAnim.playing;
    e.textContent = v3dAnim.playing ? "Pause" : "Play"; e.classList.toggle("on", v3dAnim.playing); });
  btn("v3dCut", e => e.classList.toggle("on", V3D.toggleCutaway()));
  btn("v3dLabels", e => { const on = !e.classList.contains("on");
    e.classList.toggle("on", on); V3D.setLabels(on); });
  btn("v3dReset", () => V3D.resetView());
  btn("v3dShot", () => { const a = document.createElement("a");
    a.href = V3D.snapshot(); a.download = "vessel_3d.png"; a.click(); });

  clearInterval(mountVessel3D._timer);
  let i = 2;
  const apply = () => {
    const s = V3D_STAGES[i];
    V3D.setState({ pressure: s.P, temperature: s.T, saturation: s.sat, flowing: s.sat > 0.02 });
    if (s.sat === 0 || i === 0) V3D.resetAdsorption();
    const el = document.getElementById("v3dStage"); if (el) el.textContent = s.name;
    V3D_STAGES.forEach((_, k) => {
      const row = document.getElementById("v3dRow" + k);
      if (row) row.className = k === i ? "best" : "";
    });
  };
  apply();
  mountVessel3D._timer = setInterval(() => {
    if (!v3dAnim.playing || state.screen !== "vessel") return;
    i = (i + 1) % V3D_STAGES.length; apply();
  }, 4200);
}

const RENDERERS = { setup:screenSetup, vessel:screenVessel, validation:screenValidation, results:screenResults,
                    comparison:screenComparison, sensitivity:screenSensitivity };

/* ------------------------------------------------------------------- render */
function renderRails() {
  const mat = runMatrix(state), best = mat.reduce((a,b) =>
    val(b)[val(b).length-1] > val(a)[val(a).length-1] ? b : a);
  const c = benchmarkCheck(state);
  const sb = storageBalance(best.wt_pct[best.wt_pct.length-1], pressures().slice(-1)[0], state.T);

  document.getElementById("rail-right").innerHTML = `
    <div class="card"><h3>Live readings</h3><div class="body">
      <div class="readout"><div class="k">Temperature<b>Bath, fixed by spec</b></div>
        <div class="v">${state.T} K</div></div>
      <div class="readout"><div class="k">Isosteric heat<b>qₛₜ</b></div>
        <div class="v">${state.qst} <small>kJ/mol</small></div></div>
      <div class="readout"><div class="k">Best config<b>Run ${best.run} — ${esc(best.label)}</b></div>
        <div class="v">${fmt(best[state.unit].slice(-1)[0],3)}</div></div>
      <div class="readout"><div class="k">H₂ in ${MC.factors.bed_loading_g} g bed<b>at ${pressures().slice(-1)[0]} bar</b></div>
        <div class="v">${fmt(sb.ads,4)} g</div></div>
      <div class="readout"><div class="k">Benchmark fit<b>${c.passed}/${c.total} within ±15%</b></div>
        <div class="v"><span class="pill ${c.passed===c.total?"ok":"bad"}">${c.passed===c.total?"PASS":"CHECK"}</span></div></div>
    </div></div>
    <div class="card"><h3>Export</h3><div class="body">
      <button class="btn ghost" id="csvBtn">Download master table (CSV)</button>
      <p class="hint">For the .xlsx, .docx and 300 dpi figures the specification requires,
        run the engine:</p>
      <code style="display:block;background:var(--panel-2);border:1px solid var(--line);
        border-radius:6px;padding:8px;font-size:11px;margin-top:6px;overflow-x:auto">python engine/run.py --q-st ${state.qst}</code>
    </div></div>`;
  document.getElementById("csvBtn").onclick = downloadCsv;
}

function render() {
  document.querySelectorAll(".step").forEach(el =>
    el.classList.toggle("active", el.dataset.screen === state.screen));
  document.getElementById("main").innerHTML = RENDERERS[state.screen]();
  renderRails();
  if (state.screen === "vessel") mountVessel3D();
  else if (V3D) { clearInterval(mountVessel3D._timer); V3D.dispose(); V3D = null; }
  const f = document.getElementById("extFile");
  if (f) f.onchange = handleExternal;
}

function downloadCsv() {
  const mat = runMatrix(state), P = pressures();
  const lines = [`# H2 adsorption master isotherm table`,
    `# T=${state.T} K, q_st=${state.qst} kJ/mol, model=${state.model}, basis=${state.basis}, approach=${state.approach}`,
    `# units=${unitShort()}`,
    ["run","configuration",...P.map(p=>`${p}_bar`)].join(",")];
  mat.forEach(r => lines.push([r.run, `"${r.label}"`, ...val(r).map(v=>v.toFixed(6))].join(",")));
  const blob = new Blob([lines.join("\n")], { type:"text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `master_isotherm_${state.T}K_qst${state.qst}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

function handleExternal(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const out = {};
    reader.result.split(/\r?\n/).slice(1).forEach(line => {
      const [z,p,w] = line.split(",").map(s => (s||"").trim());
      if (!z || !w) return;
      (out[z] = out[z] || []).push(parseFloat(w));
    });
    const rows = [];
    for (const z of Object.keys(out)) {
      const tg = MC.benchmark.data[z]; if (!tg) continue;
      out[z].forEach((v,i) => { if (i >= tg.length) return;
        const err = (v-tg[i])/tg[i]*100;
        rows.push({ z, P:PRESSURES[i], v, t:tg[i], err, pass:Math.abs(err)<=15 }); });
    }
    const el = document.getElementById("extResult");
    if (!rows.length) { el.innerHTML = `<div class="note bad" style="margin-top:10px">
      <span>No usable rows. Expected <code>zeolite,pressure_bar,wt_pct</code> with a header line.</span></div>`; return; }
    const passed = rows.filter(r=>r.pass).length;
    const perZ = {};
    rows.forEach(r => { perZ[r.z] = (perZ[r.z]||0) + (r.pass?0:1); });
    el.innerHTML = `<div class="note ${passed===rows.length?"ok":"bad"}" style="margin-top:10px">
        <span><b>Independent validation: ${passed}/${rows.length} within ±15%.</b>
        Section 6 verdict (≤2 failures per zeolite):
        ${Object.entries(perZ).map(([z,f])=>`${z} ${f<=2?"PASS":"FAIL"}`).join(", ")}.
        Section 10 checklist (10/10): ${passed===rows.length?"PASS":"FAIL"}.</span></div>
      <div class="tbl-wrap"><table><thead><tr><th style="text-align:left">Zeolite</th><th>P</th>
        <th>Result</th><th>Target</th><th>Error</th><th>Verdict</th></tr></thead><tbody>
        ${rows.map(r=>`<tr><td>${esc(r.z)}</td><td>${r.P}</td><td>${fmt(r.v,4)}</td>
          <td>${fmt(r.t,2)}</td><td>${r.err>=0?"+":""}${fmt(r.err,1)}%</td>
          <td><span class="pill ${r.pass?"ok":"bad"}">${r.pass?"PASS":"FAIL"}</span></td></tr>`).join("")}
      </tbody></table></div>`;
  };
  reader.readAsText(file);
}

/* --------------------------------------------------------------------- init */
/** Push the current defaults into state and into every form control. */
function syncControls() {
  Object.assign(state, specDefaults(), { unit: "mg_per_g" });
  document.getElementById("qst").value = state.qst;
  document.getElementById("qstVal").textContent = Number(state.qst).toFixed(1);
  document.getElementById("temp").value = state.T;
  document.getElementById("pmax").value = String(state.pMax);
  document.getElementById("model").value = state.model;
  document.getElementById("basis").value = state.basis;
  document.getElementById("approach").value = state.approach;
  document.querySelectorAll("#unitSeg button").forEach(x =>
    x.classList.toggle("on", x.dataset.unit === state.unit));
}

function init() {
  document.getElementById("steps").innerHTML = SCREENS.map(([k,t,s],i) =>
    `<button class="step" data-screen="${k}"><span class="n">${i+1}</span>
      <span><b style="display:block;font-size:12.5px">${t}</b>
      <span style="font-size:10.5px;opacity:.8">${s}</span></span></button>`).join("");
  document.querySelectorAll(".step").forEach(el =>
    el.onclick = () => { state.screen = el.dataset.screen; render(); });

  const bind = (id, key, cast = v => v) =>
    document.getElementById(id).addEventListener("input", e => {
      state[key] = cast(e.target.value);
      if (id === "qst") document.getElementById("qstVal").textContent = state.qst.toFixed(1);
      render();
    });
  bind("qst", "qst", parseFloat);
  bind("temp", "T", parseFloat);
  bind("pmax", "pMax", parseFloat);
  bind("model", "model");
  bind("basis", "basis");
  bind("approach", "approach");

  document.querySelectorAll("#unitSeg button").forEach(b => b.onclick = () => {
    state.unit = b.dataset.unit;
    document.querySelectorAll("#unitSeg button").forEach(x => x.classList.toggle("on", x === b));
    render();
  });
  document.getElementById("resetBtn").onclick = () => { syncControls(); render(); };

  window.addEventListener("vessel3d-ready", () => {
    if (state.screen === "vessel") mountVessel3D();
  });
  syncControls();
  document.getElementById("themeBtn").onclick = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    document.getElementById("themeBtn").textContent = dark ? "☾" : "☀";
  };
  render();
}
document.addEventListener("DOMContentLoaded", init);
})();
