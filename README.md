# H₂ Adsorption Storage Simulator

Simulation tool for a prototype zeolite–nano-activated-carbon physisorption hydrogen
storage system (drawing PID-ZHS-FAB-002, Rev C1).

> The source specification document is unpublished academic material and is not included
> in this repository. Every parameter the engine needs is encoded in `engine/model.py`.

Two halves, one physics core:

- **`engine/`** — Python. Computes the 8-configuration matrix and writes the deliverables
  the specification's Section 7.3 requires (.xlsx, .docx, 300 dpi PNG).
- **`web/`** — browser app. Same physics, recomputed live so parameters can be explored
  before committing to an export.

## Quick start

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Generate the deliverables:

```bash
.venv/bin/python engine/run.py
```

Open the interactive app:

```bash
python3 -m http.server 8791 --directory web
```

Then visit <http://localhost:8791>. The app also opens directly from `web/index.html` —
model constants are emitted as plain JS so no server is required.

## The 8 configurations (spec Section 4)

| Run | Zeolite | Form | Nano-AC | Priority |
|-----|---------|------|---------|----------|
| 1 | 13X | Granular | — | HIGH |
| 2 | 13X | Powder | — | HIGH |
| 3 | 5A | Granular | — | MEDIUM |
| 4 | 5A | Powder | — | MEDIUM |
| 5 | 13X | Granular | 15 wt% | HIGH |
| 6 | 13X | Powder | 15 wt% | HIGH |
| 7 | 5A | Granular | 15 wt% | MEDIUM |
| 8 | 5A | Powder | 15 wt% | MEDIUM |

Composite runs carry 15 wt% nano-activated carbon at an 85:15 ratio, 90 g total bed loading.

## Method

This is the specification's **second-choice route** (Section 1.2): a calibrated analytical
surrogate, not Grand Canonical Monte Carlo. A Sips (Langmuir–Freundlich) isotherm is fitted
to the Langmi et al. (2003) 77 K benchmark for each zeolite, then transferred to the
production temperature through the affinity constant:

```
b(T) = b(77 K) × exp[(q_st / R) × (1/T − 1/77)]
```

Saturation capacity is held temperature-independent, since it counts adsorption sites.

No crystal structures or force fields are involved, so no GCMC convergence data applies.
If you later produce real GCMC or ML output, validate it independently:

```bash
.venv/bin/python engine/run.py --validate your_77K_results.csv
```

CSV columns: `zeolite,pressure_bar,wt_pct` — 10 rows (13X and 5A at 1, 3, 5, 7, 10 bar).
The same import exists on the app's Validation screen.

## Deviations from the specification

Following the specification literally produces internally inconsistent or physically
invalid results in five places. Each deviation is tagged `SPEC-DEV-n` in the code, surfaced
in the app, and written into `out/methodology_and_deviations.docx` so it can be defended
in the methodology chapter.

| Tag | Issue | What this tool does |
|-----|-------|---------------------|
| **1** | Section 4.1 mandates a ×0.825 granular binder correction, but Table 11.1 was generated without it. The benchmark is measured on binder-containing material, so applying it again double-counts. | Default `literature` basis omits it. `--basis pure_framework` reproduces Section 4.1 literally. The powder advantage is ×1.15 one way, ×1.394 the other — pick one and state it. |
| **2** | Section 6.1 scales 77 K → 195 K by a constant 0.0228. That is the Henry's-law limit, but 13X is ~95% saturated at 77 K / 10 bar where it cannot apply. | Temperature is carried in b(T). The 195 K isotherm comes out near-linear in pressure (correct) rather than inheriting 77 K curvature, and the 195/77 ratio is pressure-dependent (0.030 → 0.088), not constant. |
| **3** | q_st is fixed at 4 kJ/mol and the sensitivity sweep is marked optional. Over the spec's own 4–8 kJ/mol range the answer moves ~19×, against a factor-of-3 sanity gate. | q_st is a primary input and the sweep is a standard output. Note 4 kJ/mol is the *optimistic* bound, not conservative as Section 2.1 says. |
| **4** | Section 4.1 Approach A applies Hauli's 1.40× on top of a mass-weighted zeolite+carbon average, but that factor already contains the carbon's contribution. | Approach B is the default, matching how Table 11.1 was built. Approach A remains selectable. |
| **5** | Section 3 states 484 cm³ for π·(25 mm)²·250 mm (actually 490.9), labels dead volume "60 cm³ (30 cm³ × 2)" but subtracts 120 to reach 364 cm³. | Geometry recomputed: 490.9 cm³ total, 58.9 cm³ per end, 373.1 cm³ active. |

Two further points the specification does not raise:

- **Excess vs absolute adsorption.** Langmi's values are excess; GCMC reports absolute.
  At 77 K / 10 bar the gap is ~0.09 wt% (~6% of the benchmark), always one direction.
- **Storage balance.** At 195 K the vessel holds more hydrogen as ordinary compressed gas
  than the bed captures by adsorption. Better stated in Chapter 4 than found by an examiner.

## The 77 K check is not independent validation

Section 6 makes the Langmi benchmark a non-negotiable gate. Because this model is *fitted*
to those same points, its 77 K agreement measures fit quality, not correctness — the app
labels it as such. Genuine validation needs external results through `--validate`.

## Commands

```bash
.venv/bin/python engine/run.py                      # deliverables at spec defaults
.venv/bin/python engine/run.py --q-st 6             # different isosteric heat
.venv/bin/python engine/run.py --unit wt_pct        # wt% instead of mg/g
.venv/bin/python engine/run.py --basis pure_framework
.venv/bin/python engine/run.py --model langmuir
.venv/bin/python engine/run.py --approach A
.venv/bin/python engine/run.py --validate results.csv
.venv/bin/python engine/run.py --emit-web-constants # after changing the engine
.venv/bin/python engine/parity_check.py             # Python vs JavaScript agreement
```

## Layout

```
engine/model.py          physics core, material data, 8-run matrix
engine/deliverables.py   xlsx / docx / 300 dpi png export
engine/run.py            CLI
engine/parity_check.py   sweeps 96 option combinations, diffs Python against JavaScript
web/physics.js           same physics, shared by browser and parity test
web/model-constants.js   fitted parameters, generated — do not edit by hand
out/                     generated deliverables
```

The physics exists in two languages so the browser can recompute without a server.
`parity_check.py` compares 3,840 values across the full option space and fails on any
disagreement; run it after touching either implementation.

## Units

Default is **mg H₂ / g adsorbent**. At 195 K the values are ~0.5–2.8 mg/g; in wt% that is
0.00005–0.00028, which is unreadable on a chart axis. wt% remains available via
`--unit wt_pct` and the app's unit toggle.
