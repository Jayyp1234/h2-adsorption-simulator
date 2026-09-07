"""
Physics core for the H2 Adsorption Storage Simulator.

Implements the specification in Simulation_Specification.docx (PID-ZHS-FAB-002 Rev C1)
with four documented corrections to the analytical method described there. Each
correction is marked [SPEC-DEV-n] and is surfaced in the UI and in the exported
methodology note, so the thesis can state and defend it.

  [SPEC-DEV-1] Section 4.1 mandates a granular binder correction (x0.825) that was
               never applied when Table 11.1 was generated. Applying it on top of a
               baseline anchored to Langmi's binder-containing samples double-counts
               the dilution. Default: 'literature' basis (no 0.825). The
               'pure_framework' basis reproduces Section 4.1 literally.

  [SPEC-DEV-2] Section 6.1 scales 77 K -> 195 K by a single constant 0.0228. That
               factor is the Henry's-law limit, but 13X is ~95% saturated at
               77 K / 10 bar, so it cannot apply there. We instead carry the
               temperature dependence in the affinity constant b(T), which makes
               the 195 K isotherm near-linear in P (correct) rather than inheriting
               77 K saturation curvature.

  [SPEC-DEV-3] q_st is a free parameter, not a fixed 4 kJ/mol. Over the spec's own
               4-8 kJ/mol range the 195 K answer moves by ~40x, so it is exposed as
               a first-class input and swept by the sensitivity run.

  [SPEC-DEV-4] Section 4.1 Approach A applies Hauli's 1.40x on top of a mass-weighted
               zeolite+carbon average. That factor was measured as a composite/plain
               ratio and already contains the carbon's contribution, so Approach A
               double-counts it. Default is Approach B.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict

import numpy as np
from scipy.optimize import curve_fit

R = 8.314                 # J/mol/K
M_H2 = 2.016              # g/mol
T_BENCH = 77.0            # K, Langmi benchmark temperature
T_PROD = 195.0            # K, dry-ice/acetone bath (spec Section 3)
PRESSURES = (1.0, 3.0, 5.0, 7.0, 10.0)      # bar, spec Section 3

# ---------------------------------------------------------------- benchmark data
# Langmi et al. (2003) J. Alloys Compd. 356-357, 710-715. Spec Table 6.1.
# These are EXCESS adsorption values measured on commercial (binder-containing)
# material -- see EXCESS_NOTE and the 'literature' basis below.
LANGMI_77K = {
    "13X": (0.48, 0.87, 1.12, 1.28, 1.42),
    "5A":  (0.32, 0.58, 0.74, 0.85, 0.94),
}
VALIDATION_TOLERANCE = 0.15     # spec Section 6

EXCESS_NOTE = (
    "Langmi's values are EXCESS adsorption; a GCMC run reports ABSOLUTE adsorption. "
    "At 77 K / 10 bar the gap is ~0.09 wt% (~6% of the benchmark), always in the same "
    "direction. Subtract rho_bulk x V_pore from GCMC output before comparing."
)

# ------------------------------------------------------------- material constants
@dataclass(frozen=True)
class Material:
    key: str
    label: str
    framework: str
    bet_area: float          # m2/g
    micropore_volume: float  # cm3/g
    crystal_density: float   # g/cm3
    bulk_density: float      # g/cm3
    binder_fraction: float   # mass fraction of binder in granular form
    q_st_range: tuple        # kJ/mol, spec-stated range
    q_st_default: float      # kJ/mol

MATERIALS = {
    "13X": Material("13X", "Zeolite 13X", "FAU (Faujasite)", 800.0, 0.30, 1.92,
                    0.60, 0.175, (4.0, 8.0), 4.0),
    "5A":  Material("5A",  "Zeolite 5A",  "LTA (Linde Type A)", 680.0, 0.25, 1.52,
                    0.70, 0.175, (4.0, 7.0), 4.0),
}

# Nano-activated carbon (spec Section 2.3). No experimental isotherm is given in the
# specification, so its capacity is ESTIMATED by scaling 13X's fitted saturation by
# the BET-area ratio. Used only by composite Approach A, which is not the default.
NANO_AC = {
    "label": "Nano-Activated Carbon",
    "bet_area": 1000.0,
    "micropore_volume": 0.40,
    "true_density": 2.1,
    "q_st_default": 6.0,
    "area_scaling_from": "13X",
    "estimated": True,
}

# ------------------------------------------------------------- correction factors
POWDER_ENHANCEMENT = 1.15    # Erdogan et al. (2024), spec Section 4.1
COMPOSITE_ENHANCEMENT = 1.40 # Hauli et al. (2025), spec Section 4.1
ZEOLITE_FRACTION = 0.85      # spec Section 2.4
NANO_AC_FRACTION = 0.15
BED_LOADING_G = 90.0         # spec Section 2.4

# ------------------------------------------------------------------ vessel (Sec 3)
VESSEL_ID_MM = 50.0
VESSEL_L_MM = 250.0
END_SPACE_MM = 30.0
VOID_FRACTION = 0.38

def vessel_geometry() -> dict:
    """Recomputed from the P&ID dimensions.

    [SPEC-DEV-5] Section 3 states 484 cm3 for pi*(25mm)^2*250mm (actually 490.9 cm3),
    labels the dead volume '60 cm3 (30 cm3 x 2)' but subtracts 120 cm3 to reach its
    stated 364 cm3 active volume. The 30 mm end space at ID 50 mm is 58.9 cm3 PER END.
    """
    r_cm, l_cm, e_cm = VESSEL_ID_MM / 20.0, VESSEL_L_MM / 10.0, END_SPACE_MM / 10.0
    total = math.pi * r_cm ** 2 * l_cm
    dead_each = math.pi * r_cm ** 2 * e_cm
    return {
        "total_cm3": total,
        "dead_per_end_cm3": dead_each,
        "dead_total_cm3": 2 * dead_each,
        "active_bed_cm3": total - 2 * dead_each,
        "spec_stated_total_cm3": 484.0,
        "spec_stated_active_cm3": 364.0,
    }

# ------------------------------------------------------------------ isotherm models
def langmuir(P, n_sat, b):
    return n_sat * b * P / (1.0 + b * P)

def sips(P, n_sat, b, m):
    bp = np.power(np.asarray(b) * np.asarray(P), m)
    return n_sat * bp / (1.0 + bp)

ISOTHERM_MODELS = {
    "sips": {
        "label": "Sips (Langmuir-Freundlich)",
        "fn": sips, "p0": [1.6, 0.5, 1.0], "params": ("n_sat", "b", "m"),
        "note": "3-parameter. Fits the Langmi benchmark to within ~1.6%, leaving the "
                "+/-15% tolerance for physics rather than fit error. Default.",
    },
    "langmuir": {
        "label": "Langmuir",
        "fn": langmuir, "p0": [1.6, 0.5], "params": ("n_sat", "b"),
        "note": "2-parameter, referenced directly by the specification. Fits the "
                "benchmark to ~8%, consuming half the +/-15% validation budget.",
    },
}

@dataclass
class IsothermFit:
    zeolite: str
    model: str
    params: dict
    residuals_pct: list
    max_abs_error_pct: float
    rmse_pct: float

def fit_benchmark(zeolite: str, model: str = "sips") -> IsothermFit:
    """Fit the chosen isotherm model to the Langmi 77 K benchmark."""
    spec = ISOTHERM_MODELS[model]
    P = np.array(PRESSURES, float)
    n = np.array(LANGMI_77K[zeolite], float)
    popt, _ = curve_fit(spec["fn"], P, n, p0=spec["p0"], maxfev=40000)
    resid = (spec["fn"](P, *popt) - n) / n * 100.0
    return IsothermFit(
        zeolite=zeolite, model=model,
        params=dict(zip(spec["params"], (float(x) for x in popt))),
        residuals_pct=[round(float(x), 3) for x in resid],
        max_abs_error_pct=float(np.abs(resid).max()),
        rmse_pct=float(np.sqrt((resid ** 2).mean())),
    )

def uptake(fit: IsothermFit, T: float, P, q_st_kj: float):
    """Evaluate the fitted isotherm at temperature T. [SPEC-DEV-2]

    The affinity constant carries the temperature dependence:
        b(T) = b(77) * exp[(q_st/R) * (1/T - 1/77)]
    Saturation capacity n_sat is a site count and is held temperature-independent.
    Returns wt% (g H2 per 100 g adsorbent).
    """
    P = np.asarray(P, float)
    p = fit.params
    b_T = p["b"] * math.exp((q_st_kj * 1000.0 / R) * (1.0 / T - 1.0 / T_BENCH))
    if fit.model == "sips":
        return sips(P, p["n_sat"], b_T, p["m"])
    return langmuir(P, p["n_sat"], b_T)

# ------------------------------------------------------------ the 8-run test matrix
@dataclass(frozen=True)
class Config:
    run: int
    zeolite: str
    form: str          # "granular" | "powder"
    composite: bool
    priority: str

    @property
    def label(self) -> str:
        base = f"{MATERIALS[self.zeolite].label.replace('Zeolite ','')} {self.form.title()}"
        return f"{base} + Nano-AC" if self.composite else f"{base} (plain)"

CONFIGS = [
    Config(1, "13X", "granular", False, "HIGH"),
    Config(2, "13X", "powder",   False, "HIGH"),
    Config(3, "5A",  "granular", False, "MEDIUM"),
    Config(4, "5A",  "powder",   False, "MEDIUM"),
    Config(5, "13X", "granular", True,  "HIGH"),
    Config(6, "13X", "powder",   True,  "HIGH"),
    Config(7, "5A",  "granular", True,  "MEDIUM"),
    Config(8, "5A",  "powder",   True,  "MEDIUM"),
]

def form_factor(cfg: Config, basis: str) -> float:
    """Granular/powder correction. [SPEC-DEV-1]

    basis='literature'     : benchmark already includes binder -> granular x1.0
    basis='pure_framework' : Section 4.1 read literally        -> granular x0.825
    """
    if cfg.form == "powder":
        return POWDER_ENHANCEMENT
    return 1.0 if basis == "literature" else (1.0 - MATERIALS[cfg.zeolite].binder_fraction)

def composite_factor(cfg: Config) -> float:
    return COMPOSITE_ENHANCEMENT if cfg.composite else 1.0

@dataclass
class Options:
    q_st: float = 4.0                 # kJ/mol
    temperature: float = T_PROD       # K
    pressures: tuple = PRESSURES
    isotherm_model: str = "sips"
    basis: str = "literature"         # "literature" | "pure_framework"
    composite_approach: str = "B"     # "A" | "B"

def nano_ac_uptake(T, P, q_st_kj, model="sips"):
    """Estimated nano-AC isotherm for composite Approach A. See NANO_AC."""
    base = fit_benchmark(NANO_AC["area_scaling_from"], model)
    scale = NANO_AC["bet_area"] / MATERIALS[NANO_AC["area_scaling_from"]].bet_area
    scaled = IsothermFit(base.zeolite, base.model,
                         {**base.params, "n_sat": base.params["n_sat"] * scale},
                         base.residuals_pct, base.max_abs_error_pct, base.rmse_pct)
    return uptake(scaled, T, P, q_st_kj)

def run_config(cfg: Config, opts: Options) -> dict:
    """Compute one configuration across the pressure series. Returns wt%."""
    fit = fit_benchmark(cfg.zeolite, opts.isotherm_model)
    P = np.asarray(opts.pressures, float)
    base = uptake(fit, opts.temperature, P, opts.q_st)
    values = base * form_factor(cfg, opts.basis)

    if cfg.composite:
        if opts.composite_approach == "A":
            # [SPEC-DEV-4] weighted mixture, then Hauli's factor -- double-counts.
            carbon = nano_ac_uptake(opts.temperature, P, NANO_AC["q_st_default"],
                                    opts.isotherm_model)
            values = (ZEOLITE_FRACTION * values + NANO_AC_FRACTION * carbon) \
                     * COMPOSITE_ENHANCEMENT
        else:
            values = values * COMPOSITE_ENHANCEMENT

    return {
        "run": cfg.run, "label": cfg.label, "zeolite": cfg.zeolite,
        "form": cfg.form, "composite": cfg.composite, "priority": cfg.priority,
        "pressures_bar": [float(x) for x in P],
        "wt_pct": [float(x) for x in values],
        "mg_per_g": [float(x) * 10.0 for x in values],
        "grams_in_bed": [float(x) / 100.0 * BED_LOADING_G for x in values],
        "form_factor": form_factor(cfg, opts.basis),
        "composite_factor": composite_factor(cfg),
    }

def run_matrix(opts: Options) -> list:
    return [run_config(c, opts) for c in CONFIGS]

# ------------------------------------------------------------------- fit check (77K)
def benchmark_check(opts: Options) -> dict:
    """Compare the model at 77 K against Langmi's targets. Spec Section 6.

    HONESTY NOTE: the model is FITTED to these same values, so this measures fit
    quality, not independent validation. Genuine validation requires external GCMC
    or ML output -- use validate_external() for that.
    """
    rows = []
    for z in ("13X", "5A"):
        fit = fit_benchmark(z, opts.isotherm_model)
        pred = uptake(fit, T_BENCH, np.array(PRESSURES, float), opts.q_st)
        for P, pr, tgt in zip(PRESSURES, pred, LANGMI_77K[z]):
            err = (pr - tgt) / tgt * 100.0
            rows.append({
                "zeolite": z, "pressure_bar": P, "predicted_wt_pct": float(pr),
                "target_wt_pct": tgt,
                "lower_wt_pct": tgt * (1 - VALIDATION_TOLERANCE),
                "upper_wt_pct": tgt * (1 + VALIDATION_TOLERANCE),
                "error_pct": float(err),
                "pass": bool(abs(err) <= VALIDATION_TOLERANCE * 100),
            })
    passed = sum(r["pass"] for r in rows)
    return {
        "rows": rows, "passed": passed, "total": len(rows),
        "all_pass": passed == len(rows),
        "is_independent": False,
        "note": "Fit-quality check: the model is calibrated on these same points. "
                "Not independent validation. Import external GCMC/ML results to "
                "validate properly.",
    }

def validate_external(results: dict) -> dict:
    """Validate externally-produced 77 K results against Langmi. Genuinely independent.

    results: {"13X": [5 wt% values], "5A": [...]} aligned to PRESSURES.
    """
    rows = []
    for z, vals in results.items():
        for P, v, tgt in zip(PRESSURES, vals, LANGMI_77K[z]):
            err = (v - tgt) / tgt * 100.0
            rows.append({"zeolite": z, "pressure_bar": P, "predicted_wt_pct": float(v),
                         "target_wt_pct": tgt, "error_pct": float(err),
                         "pass": bool(abs(err) <= VALIDATION_TOLERANCE * 100)})
    passed = sum(r["pass"] for r in rows)
    per_z = {}
    for z in results:
        fails = sum(1 for r in rows if r["zeolite"] == z and not r["pass"])
        per_z[z] = {"failures": fails, "section6_pass": fails <= 2}
    return {
        "rows": rows, "passed": passed, "total": len(rows),
        "all_pass": passed == len(rows), "per_zeolite": per_z,
        "is_independent": True,
        "note": "Spec Section 6 allows up to 2 of 5 failures per zeolite; the "
                "Section 10 checklist demands 10/10. Both verdicts are reported.",
    }

# --------------------------------------------------------------------- sensitivity
def q_st_sensitivity(opts: Options, q_values=(4.0, 5.0, 6.0, 7.0, 8.0)) -> dict:
    """Sweep q_st. [SPEC-DEV-3] The spec calls this optional; it dominates everything."""
    out = []
    for q in q_values:
        o = Options(**{**asdict(opts), "q_st": q})
        out.append({"q_st": q, "matrix": run_matrix(o)})
    hi = out[0]["matrix"][5]["wt_pct"][-1]
    lo = out[-1]["matrix"][5]["wt_pct"][-1]
    return {"sweeps": out, "spread_factor": hi / lo if lo else float("inf"),
            "note": f"Across {q_values[0]}-{q_values[-1]} kJ/mol the Run 6 answer at "
                    f"10 bar moves by {hi/lo:.0f}x. The spec's sanity gate is 3x."}

# ------------------------------------------------------- storage reality check
def storage_balance(wt_pct_at_P: float, P_bar: float, T: float = T_PROD) -> dict:
    """Adsorbed H2 vs free compressed gas in the same vessel.

    Surfaces the finding the spec never states: at 195 K the bed stores far less by
    adsorption than the vessel holds as ordinary compressed gas.
    """
    g = vessel_geometry()
    v_free_cm3 = g["active_bed_cm3"] * VOID_FRACTION + g["dead_total_cm3"]
    n_mol = (P_bar * 1e5) * (v_free_cm3 * 1e-6) / (R * T)
    free_g = n_mol * M_H2
    ads_g = wt_pct_at_P / 100.0 * BED_LOADING_G
    total = ads_g + free_g
    return {
        "adsorbed_g": ads_g, "free_gas_g": free_g, "total_g": total,
        "adsorbed_fraction": ads_g / total if total else 0.0,
        "free_volume_cm3": v_free_cm3,
    }

# ------------------------------------------------- spec Section 7.2 deliverables
def convergence_evidence(opts: Options, blocks: int = 12, seed: int = 20260907) -> dict:
    """Spec Section 7.2 requires convergence evidence.

    [SPEC-DEV-7] A GCMC run converges by accumulating Monte Carlo cycles; this is a
    closed-form analytical model, so there is nothing to converge and no cycle count to
    report. Reporting a fabricated convergence trace would be dishonest. What CAN be
    shown is that the underlying isotherm fit is stable: the benchmark is refitted on
    bootstrap resamples of the Langmi points and the spread in the resulting prediction
    is reported. That is a genuine stability statement about this method, and the
    distinction is stated in the deliverable so an examiner is not misled.
    """
    rng = np.random.default_rng(seed)
    P = np.array(PRESSURES, float)
    spec = ISOTHERM_MODELS[opts.isotherm_model]
    out = {}
    for z in ("13X", "5A"):
        n = np.array(LANGMI_77K[z], float)
        preds, running = [], []
        for b in range(blocks):
            # perturb within the benchmark's own +/-15% tolerance and refit
            pert = n * (1 + rng.normal(0, VALIDATION_TOLERANCE / 3, size=n.shape))
            try:
                popt, _ = curve_fit(spec["fn"], P, pert, p0=spec["p0"], maxfev=40000)
            except RuntimeError:
                continue
            # A resample can land on a non-physical fit (negative affinity or capacity);
            # a fractional exponent over a negative base then yields NaN. Discard those.
            if not np.all(np.isfinite(popt)) or np.any(np.asarray(popt) <= 0):
                continue
            f = IsothermFit(z, opts.isotherm_model,
                            dict(zip(spec["params"], (float(x) for x in popt))), [], 0.0, 0.0)
            preds.append(float(uptake(f, opts.temperature, P[-1], opts.q_st)))
            running.append(float(np.mean(preds)))
        out[z] = {
            "blocks": len(preds),
            "block_values_wt_pct": preds,
            "running_mean_wt_pct": running,
            "final_mean_wt_pct": running[-1] if running else 0.0,
            "std_wt_pct": float(np.std(preds, ddof=1)) if len(preds) > 1 else 0.0,
            "relative_std_pct": (float(np.std(preds, ddof=1)) / running[-1] * 100.0)
                                if running and running[-1] else 0.0,
        }
    return {
        "method": "bootstrap refit of the 77 K benchmark within its +/-15% tolerance",
        "is_gcmc_convergence": False,
        "note": "This model is closed-form and has no Monte Carlo cycles to converge. "
                "The figures below report FIT STABILITY, not GCMC convergence. If the "
                "specification's first-choice GCMC route is used instead, replace this "
                "with the production cycle count and a real uptake-vs-cycles trace.",
        "per_zeolite": out,
    }


def uncertainty_by_configuration(opts: Options, blocks: int = 12) -> dict:
    """Spec Section 7.2: per-configuration uncertainty in wt%.

    Two contributions are separated because they are of wildly different size:
      - fit uncertainty, from the benchmark bootstrap above
      - q_st uncertainty, from the specification's own 4-8 kJ/mol range
    """
    conv = convergence_evidence(opts, blocks)
    rows = []
    for cfg in CONFIGS:
        base = run_config(cfg, opts)["wt_pct"][-1]
        rel_fit = conv["per_zeolite"][cfg.zeolite]["relative_std_pct"] / 100.0
        lo_q = Options(**{**asdict(opts), "q_st": MATERIALS[cfg.zeolite].q_st_range[1]})
        hi_q = Options(**{**asdict(opts), "q_st": MATERIALS[cfg.zeolite].q_st_range[0]})
        lo = run_config(cfg, lo_q)["wt_pct"][-1]
        hi = run_config(cfg, hi_q)["wt_pct"][-1]
        rows.append({
            "run": cfg.run, "label": cfg.label,
            "value_wt_pct": base,
            "fit_sd_wt_pct": base * rel_fit,
            "fit_sd_pct": rel_fit * 100.0,
            "q_st_low_wt_pct": lo, "q_st_high_wt_pct": hi,
            "q_st_span_factor": (hi / lo) if lo else float("inf"),
        })
    return {
        "pressure_bar": opts.pressures[-1],
        "rows": rows,
        "note": "Fit uncertainty is small; q_st uncertainty dominates by more than an "
                "order of magnitude. Quoting a single standard deviation without the "
                "q_st span would understate the real uncertainty severely.",
    }
