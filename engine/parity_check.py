#!/usr/bin/env python3
"""Cross-check the browser physics (web/physics.js) against the Python engine.

The physics is deliberately implemented twice -- once in Python for the thesis
deliverables, once in JavaScript so the browser app can recompute live without a
server. This test sweeps the full option space and fails if the two ever disagree.

    python engine/parity_check.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import model as M

ROOT = Path(__file__).resolve().parent.parent
TOLERANCE = 1e-9

NODE_SCRIPT = """
const physics = require(process.argv[1]);
const MC = require(process.argv[2]);
const grid = JSON.parse(process.argv[3]);
const phys = physics.make(MC);
// Keyed by grid index: composing keys from numbers is unsafe across languages
// (JS renders 4.0 as "4", Python as "4.0").
const out = grid.map(c =>
  phys.runMatrix({ qst: c.qst, T: c.T, model: c.model,
                   basis: c.basis, approach: c.approach, pMax: 10 })
      .map(r => r.wt_pct));
process.stdout.write(JSON.stringify(out));
"""


def main() -> int:
    web = ROOT / "web"
    if not (web / "model-constants.json").exists():
        print("model-constants.json missing — run: python engine/run.py --emit-web-constants")
        return 2

    grid = [
        {"basis": b, "approach": a, "model": m, "qst": q, "T": t}
        for b, a, m, q, t in product(
            ["literature", "pure_framework"], ["A", "B"], ["sips", "langmuir"],
            [4.0, 5.5, 6.0, 8.0], [77.0, 150.0, 195.0],
        )
    ]

    proc = subprocess.run(
        ["node", "-e", NODE_SCRIPT, str(web / "physics.js"),
         str(web / "model-constants.json"), json.dumps(grid)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print("node failed:\n" + proc.stderr)
        return 2
    js = json.loads(proc.stdout)

    worst, worst_key, checked, failures = 0.0, None, 0, []
    for idx, c in enumerate(grid):
        key = f"{c['basis']}|{c['approach']}|{c['model']}|q{c['qst']}|{c['T']}K"
        opts = M.Options(q_st=c["qst"], temperature=c["T"], isotherm_model=c["model"],
                         basis=c["basis"], composite_approach=c["approach"])
        py = [r["wt_pct"] for r in M.run_matrix(opts)]
        for run_i, (prow, jrow) in enumerate(zip(py, js[idx]), start=1):
            for p_i, (pv, jv) in enumerate(zip(prow, jrow)):
                checked += 1
                denom = max(abs(pv), 1e-30)
                rel = abs(pv - jv) / denom
                if rel > worst:
                    worst, worst_key = rel, f"{key} run{run_i} P{M.PRESSURES[p_i]}"
                if rel > TOLERANCE:
                    failures.append((key, run_i, M.PRESSURES[p_i], pv, jv, rel))

    print(f"Parity check — {len(grid)} option combinations, {checked} values compared")
    print(f"  worst relative difference: {worst:.3e}  ({worst_key})")
    if failures:
        print(f"  FAIL — {len(failures)} value(s) exceed {TOLERANCE:g}")
        for f in failures[:10]:
            print(f"    {f[0]} run{f[1]} @{f[2]} bar: python={f[3]:.12g} js={f[4]:.12g} rel={f[5]:.2e}")
        return 1
    print(f"  PASS — Python and JavaScript agree to within {TOLERANCE:g}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
