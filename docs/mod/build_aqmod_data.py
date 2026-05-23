#!/usr/bin/env python3
"""
build_aqmod_data.py — regenerate AQmod's holes_data.js from the master.

Reads:  all_holes_data_v3_59_9.py  (sibling file)
Writes: holes_data.js              (sibling file)

Sector descriptions are stored in the DESCRIPTIONS dict below, authored
hole-by-hole during Phase 2 review. Any sector not listed there renders
as "TBD" in the picker. Re-running this script is idempotent and
preserves all authored descriptions.

Output schema per hole (str-keyed):
  pin_labels    {pin_str: label}
  pin_pos       {pin_str: [x, y]}
  sectors       {sector_key: [[x, y], ...]}
  sector_order  [sector_key, ...]
  xlim          [xmin, xmax]
  ylim          [ymin, ymax]
  descriptions  {sector_key: text}
  entries       [{entry_num, master_code, description}, ...] in sector_order
  photo_b64     bare base64 (no "data:..." prefix)
  photo_dims    [W, H]

Scores are intentionally omitted from this build (per project decision —
AQmod records sectors only; the rubric lookup happens in R post-round).
The generator can be extended later by emitting `scores` from the master.
"""
import json
import re
import importlib.util
from pathlib import Path

HERE = Path(__file__).parent
SRC_PY = HERE / "all_holes_data_v3_59_9.py"
OUT_JS = HERE / "holes_data.js"


# Sector descriptions, authored hole-by-hole during Phase 2 review.
# Any sector not listed here renders as "TBD" in the picker.
DESCRIPTIONS = {
    1: {
        '1':  'Front apron / short',
        '2':  'Long-left bunker',
        '3l': 'Green, front-left',
        '3r': 'Green, front-right',
        '4l': 'Green, back-left',
        '4r': 'Green, back-right',
        '5':  'Left, long grass',
        '6':  'Right, long grass',
        '7':  'Over back, long grass',
    },
    2: {
        '1':   'Front apron',
        '2':   'Left bunker',
        '3':   'Large mid-right bunker',
        '4':   'Small back-right bunker',
        '5l':  'Green, front-left',
        '5r':  'Green, front-right',
        '6l':  'Green, back-left',
        '6r':  'Green, back-right',
        '7l':  'Close miss left',
        '7r':  'Close miss right',
        '9o':  'Over back',
    },
    3: {
        '1':  'Front apron',
        '2':  'Front-left bunker',
        '3':  'Front-right bunker',
        '4l': 'Green, front-left',
        '4r': 'Green, front-right',
        '5l': 'Green, back-left',
        '5r': 'Green, back-right',
        '6':  'Just off back (puttable)',
        '6o': 'Off back, long grass',
        '7l': 'Close miss left',
        '7r': 'Close miss right',
        '8l': 'Far miss left',
        '8r': 'Far miss right',
    },
    4: {
        '1':   'Front apron',
        '2':   'Front-left bunker',
        '3':   'Front-right bunker',
        '4l':  'Green, front-left',
        '4r':  'Green, front-right',
        '5l':  'Green, back-left',
        '5r':  'Green, back-right',
        '6l':  'Close miss left',
        '6r':  'Close miss right',
        '6ob': 'Over back',
    },
    5: {
        '1':  'Front apron',
        '2':  'Miss left',
        '3':  'Bunker, right',
        '4l': 'Green, front-left',
        '4r': 'Green, front-right',
        '5l': 'Green, back-left',
        '5r': 'Green, back-right',
        '6':  'Over back',
        '7':  'Miss right',
    },
    6: {
        '1':   'Front apron',
        '2':   'Left bunker',
        '3':   'Front-right bunker',
        '4l':  'Green, front-left',
        '4r':  'Green, front-right',
        '5l':  'Green, back-left',
        '5r':  'Green, back-right',
        '7l':  'Close miss, left-front',
        '7r':  'Close miss front-right',
        '8l':  'Close miss, left-back',
        '8r':  'Close miss back-right',
        '9r':  'Far miss right',
        '9o':  'Over back',
    },
    7: {
        '1':   'Front apron',
        '2':   'Left bunker above green',
        '2b':  'Front-left bunker',
        '3':   'Front-right bunker',
        '4l':  'Green, front-left',
        '4r':  'Green, front-right',
        '5l':  'Green, back-left',
        '5r':  'Green, back-right',
        '7l':  'Close miss left',
        '7r':  'Close miss right',
        '9l':  'Far miss left',
        '9r':  'Far miss right',
        '9o':  'Over back',
    },
    8: {
        '1':   'Front apron',
        '2':   'Front-left bunker',
        '3':   'Right bunker',
        '4l':  'Green, front-left',
        '4r':  'Green, front-right',
        '5l':  'Green, back-left',
        '5r':  'Green, back-right',
        '6':   'Long, near the green',
        '7l':  'Close miss left',
        '7r':  'Close miss right',
        '7ob': 'Very long, deep grass',
    },
    9: {
        '1':   'Front apron',
        '3':   'Front-right bunker',
        '4l':  'Green, front-left',
        '4r':  'Green, front-right',
        '5l':  'Green, back-left',
        '5r':  'Green, back-right',
        '6':   'Over back, near green',
        '7l':  'Close miss left',
        '7r':  'Close miss right',
        '7ob': 'Very long',
        '8l':  'Far miss left',
        '8r':  'Far miss right',
    },
    10: {
        '1':  'Front apron',
        '2':  'Front bunker',
        '3':  'Front-right bunker',
        '4l': 'Green, front-left',
        '4r': 'Green, front-right',
        '5l': 'Green, back-left',
        '5r': 'Green, back-right',
        '7':  'Close miss left',
        '8':  'Over back, near green',
        '9l': 'Far miss left',
        '9r': 'Far miss right',
        '9o': 'Way over back, down hill',
    },
    11: {
        '1':  'Front apron',
        '2':  'Front-left bunker',
        '3':  'Front-right bunker',
        '4l': 'Green, front-left',
        '4r': 'Green, front-right',
        '5l': 'Green, back-left',
        '5r': 'Green, back-right',
        '7l': 'Close miss left',
        '7r': 'Close miss right',
        '8':  'Over back, near green',
        '9l': 'Far miss left',
        '9r': 'Far miss right',
        '9o': 'Way over back, down hill',
    },
    12: {
        '1':  'Front apron',
        '2':  'Left bunker',
        '3':  'Front-right bunker',
        '4l': 'Green, front-left',
        '4r': 'Green, front-right',
        '5l': 'Green, back-left',
        '5r': 'Green, back-right',
        '6':  'Over green',
        '7l': 'Close miss, front-left',
        '7r': 'Close miss right',
        '8l': 'Close miss, back-left',
        '8r': 'Far miss right',
    },
    13: {
        '1':  'Front apron',
        '2':  'Back-left bunker',
        '3':  'Front-right bunker',
        '4l': 'Green, front-left',
        '4r': 'Green, front-right',
        '5l': 'Green, back-left',
        '5r': 'Green, back-right',
        '6':  'Over green',
        '6r': 'Close miss right-back',
        '7l': 'Close miss left',
        '7r': 'Close miss right-front',
        '8':  'Far miss short',
        '9':  'Far over green',
    },
    14: {
        '1':  'Front apron',
        '2':  'Front-left bunker',
        '3':  'Back bunker',
        '4':  'Front-right bunker',
        '5l': 'Green, front-left',
        '5r': 'Green, front-right',
        '6l': 'Green, back-left',
        '6r': 'Green, back-right',
        '7l': 'Close miss left',
        '7r': 'Close miss right',
        '7o': 'Over back, near green',
        '8l': 'Far miss left',
        '8r': 'Far miss right',
    },
    15: {
        '1':  'Front hillside',
        '2':  'Close miss left',
        '3':  'Close miss back-left',
        '4':  'Close miss right',
        '5':  'Close miss back-right',
        '6l': 'Green, front-left',
        '6r': 'Green, front-right',
        '7l': 'Green, back-left',
        '7r': 'Green, back-right',
        '8':  'Over green',
    },
    16: {
        '1':   'Front apron',
        '2':   'Left bunker',
        '3':   'Right bunker',
        '4l':  'Green, front-left',
        '4r':  'Green, front-right',
        '5l':  'Green, mid-left',
        '5r':  'Green, mid-right',
        '6l':  'Green, back-left',
        '6r':  'Green, back-right',
        '7l':  'Close miss front-left',
        '7r':  'Close miss front-right',
        '8l':  'Close miss back-left',
        '8r':  'Close miss back-right',
        '8ob': 'Over back',
        '9l':  'Far miss left',
        '9r':  'Far miss right',
    },
    17: {
        '1':  'Front apron',
        '2':  'Left bunker',
        '3':  'Right bunker',
        '4l': 'Green, front-left',
        '4r': 'Green, front-right',
        '5l': 'Green, back-left',
        '5r': 'Green, back-right',
        '7l': 'Close miss front-left',
        '7r': 'Close miss front-right',
        '8l': 'Close miss back-left',
        '8r': 'Close miss back-right',
        '9l': 'Far miss left',
        '9r': 'Far miss right',
        '9o': 'Over back',
    },
    18: {
        '1':  'Front apron',
        '2':  'Front-left bunker',
        '3':  'Front-right bunker',
        '4l': 'Green, front-left',
        '4r': 'Green, front-right',
        '5l': 'Green, back-left',
        '5r': 'Green, back-right',
        '6':  'Long, near the green',
        '7l': 'Close miss left',
        '7r': 'Close miss right',
        '8l': 'Far miss left',
        '8r': 'Far miss right',
        '9':  'Way over back, down hill',
    },
}


def to_jsonable(v):
    """Convert numpy arrays, tuples, and nested containers to plain lists/dicts."""
    if hasattr(v, "tolist"):
        return v.tolist()
    if isinstance(v, (tuple, list)):
        return [to_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {str(k): to_jsonable(x) for k, x in v.items()}
    return v


def strip_data_prefix(b64):
    """Remove leading 'data:image/...;base64,' if present."""
    if isinstance(b64, str) and b64.startswith("data:"):
        comma = b64.find(",")
        if comma != -1:
            return b64[comma + 1:]
    return b64


def sort_key(sk):
    """Natural sort for sector codes: digit first, then suffix priority.

    Suffix order within a digit: bare > b > f > l > r > o > ob > anything else.
    This keeps left/right pairs together (l, r) before back/over variants
    (o, ob), and keeps fringe/back variants (f, b) adjacent to the bare digit.
    """
    m = re.match(r"^(\d+)(.*)$", sk)
    if not m:
        return (999, 99, sk)
    num = int(m.group(1))
    suf = m.group(2)
    priority = {'': 0, 'b': 1, 'f': 2, 'l': 3, 'r': 4, 'o': 5, 'ob': 6}
    return (num, priority.get(suf, 99), suf)


def main():
    spec = importlib.util.spec_from_file_location("master", SRC_PY)
    master = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(master)
    HOLES = master.HOLES

    out = {}
    for hnum in sorted(HOLES.keys()):
        h = HOLES[hnum]
        sector_order = list(h["sector_order"])        # geometry priority — keep as-is
        entry_order = sorted(sector_order, key=sort_key)  # UX order for picker
        hole_descs = DESCRIPTIONS.get(hnum, {})

        descriptions = {sk: hole_descs.get(sk, "TBD") for sk in sector_order}
        entries = [
            {"entry_num": i + 1, "master_code": sk, "description": hole_descs.get(sk, "TBD")}
            for i, sk in enumerate(entry_order)
        ]

        out[str(hnum)] = {
            "pin_labels":   {str(k): v for k, v in h["pin_labels"].items()},
            "pin_pos":      {str(k): to_jsonable(v) for k, v in h["pin_pos"].items()},
            "sectors":      {sk: to_jsonable(h["sectors"][sk]) for sk in sector_order},
            "sector_order": sector_order,
            "xlim":         to_jsonable(h["xlim"]),
            "ylim":         to_jsonable(h["ylim"]),
            "descriptions": descriptions,
            "entries":      entries,
            "photo_b64":    strip_data_prefix(h["photo_b64"]),
            "photo_dims":   to_jsonable(h["photo_dims"]),
        }

    with open(OUT_JS, "w") as f:
        f.write("// Auto-generated by build_aqmod_data.py from all_holes_data_v3_59_9.py\n")
        f.write("// Sector descriptions sourced from DESCRIPTIONS dict in the generator.\n")
        f.write("const HOLES_DATA = ")
        json.dump(out, f, indent=1)
        f.write(";\n")

    print(f"Wrote {OUT_JS}  ({OUT_JS.stat().st_size:,} bytes)")
    print(f"Holes: {sorted(int(k) for k in out.keys())}")


if __name__ == "__main__":
    main()
