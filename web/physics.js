/* Shared physics core. Mirrors engine/model.py.
   Loaded by the browser app and by engine/parity_check.py via node, so the two
   implementations are tested against each other rather than trusted to agree. */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.H2Physics = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const sips = (P, ns, b, m) => { const x = Math.pow(b * P, m); return ns * x / (1 + x); };
  const langmuir = (P, ns, b) => ns * b * P / (1 + b * P);

  function make(MC) {
    const R = MC.constants.R, T_BENCH = MC.constants.T_BENCH;

    /** Uptake in wt% for a bare zeolite framework at temperature T. */
    function uptake(zeolite, T, P, qst, model) {
      const f = MC.fits[model][zeolite].params;
      const bT = f.b * Math.exp((qst * 1000 / R) * (1 / T - 1 / T_BENCH));
      return model === "sips" ? sips(P, f.n_sat, bT, f.m) : langmuir(P, f.n_sat, bT);
    }

    /** Granular/powder correction. [SPEC-DEV-1] */
    function formFactor(cfg, basis) {
      if (cfg.form === "powder") return MC.factors.powder;
      return basis === "literature" ? 1.0 : (1 - MC.materials[cfg.zeolite].binder_fraction);
    }

    /** Estimated nano-AC isotherm, used only by composite Approach A. */
    function nanoAcUptake(T, P, qst, model) {
      const src = MC.nano_ac.area_scaling_from;
      const f = MC.fits[model][src].params;
      const scale = MC.nano_ac.bet_area / MC.materials[src].bet_area;
      const bT = f.b * Math.exp((qst * 1000 / R) * (1 / T - 1 / T_BENCH));
      return model === "sips"
        ? sips(P, f.n_sat * scale, bT, f.m)
        : langmuir(P, f.n_sat * scale, bT);
    }

    /** One configuration across a pressure series. Returns wt% plus derived units. */
    function runConfig(cfg, s) {
      const P = MC.constants.PRESSURES.filter(p => p <= (s.pMax != null ? s.pMax : Infinity));
      const wt = P.map(p => {
        let v = uptake(cfg.zeolite, s.T, p, s.qst, s.model) * formFactor(cfg, s.basis);
        if (cfg.composite) {
          if (s.approach === "A") {
            const c = nanoAcUptake(s.T, p, MC.nano_ac.q_st_default, s.model);
            v = (MC.factors.zeolite_fraction * v + MC.factors.nano_ac_fraction * c)
                * MC.factors.composite;
          } else {
            v *= MC.factors.composite;
          }
        }
        return v;
      });
      return Object.assign({}, cfg, {
        pressures: P, wt_pct: wt,
        mg_per_g: wt.map(v => v * 10),
        grams: wt.map(v => v / 100 * MC.factors.bed_loading_g),
      });
    }

    const runMatrix = s => MC.configs.map(c => runConfig(c, s));

    /** 77 K comparison against Langmi. Fit-quality, not independent validation. */
    function benchmarkCheck(s) {
      const rows = [];
      for (const z of ["13X", "5A"]) {
        const tgts = MC.benchmark.data[z];
        MC.constants.PRESSURES.forEach((p, i) => {
          const pred = uptake(z, T_BENCH, p, s.qst, s.model);
          const err = (pred - tgts[i]) / tgts[i] * 100;
          rows.push({ zeolite: z, P: p, pred, target: tgts[i], err,
                      pass: Math.abs(err) <= MC.benchmark.tolerance * 100 });
        });
      }
      return { rows, passed: rows.filter(r => r.pass).length, total: rows.length };
    }

    /** Adsorbed H2 vs free compressed gas in the same vessel. */
    function storageBalance(wt, P, T) {
      const v = MC.vessel;
      const freeCm3 = v.active_bed_cm3 * v.void_fraction + v.dead_total_cm3;
      const free = (P * 1e5) * (freeCm3 * 1e-6) / (R * T) * MC.constants.M_H2;
      const ads = wt / 100 * MC.factors.bed_loading_g;
      return { ads, free, frac: ads / (ads + free) };
    }

    return { uptake, formFactor, nanoAcUptake, runConfig, runMatrix,
             benchmarkCheck, storageBalance, MC };
  }

  return { make, sips, langmuir };
});
