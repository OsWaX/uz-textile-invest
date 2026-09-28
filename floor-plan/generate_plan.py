#!/usr/bin/env python3
"""Apartment floor plan at 1:50 — generator.

Builds one geometric model of the apartment (all coordinates in real
millimetres) and writes:

  plan_1-50.svg  — A2 sheet, true scale (1 mm on paper = 50 mm real)
  plan_1-50.pdf  — same sheet as PDF, print at 100 % on A2 (594 x 420)
  plan_1-50.png  — raster preview of the sheet
  plan.dxf       — CAD file, model space in real mm (plot 1:50 on A2)

Wall thickness is 320 mm for every wall; the right and the bottom
facades are continuous panoramic glazing over their full length.  All
clear room dimensions of the source sales plan are kept exactly;
everything the source does not dimension (doors, windows, shafts, niche,
chamfers) was measured from the source image (~14.2 mm per pixel) and
rounded.  Every size is dimensioned once (no duplicated dimensions).

Model coordinates: origin = top-left outer corner of the apartment,
X to the right, Y downwards (as on the sheet).

Usage:  python3 generate_plan.py        (needs shapely, ezdxf, cairosvg)
"""

import math
import os

from shapely.geometry import Polygon, box
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
SCALE = 50                      # 1:50
SQ2 = math.sqrt(2.0)

# ---------------------------------------------------------------------------
# 1. Input data
# ---------------------------------------------------------------------------
T = 320                         # wall thickness (all walls), mm
COL = 500                       # column section (assumed), mm
THIN = 120                      # shaft / niche enclosure walls, mm

# Clear room dimensions given on the source plan (kept exactly)
HALL_W, HALL_D = 3600, 2000     # Прихожая
LIV_W, LIV_D = 4970, 3000       # Гостиная
KIT_W, KIT_D = 4200, 2900       # Кухня
COR_W, COR_L = 1850, 4350       # Коридор
WC_D, WC_W_SHAFT = 2450, 1665   # С/У (depth; width from shaft to wall)
BR1_W, BR1_D = 2900, 6300       # Спальня 1
BR2_W, BR2_D = 3150, 5850       # Спальня 2
LOG_D = 1650                    # Лоджия

# Values not dimensioned on the source (measured from the image, rounded)
WC_W = 1900                     # WC clear width above the shaft
WC_CHAMFER = 850                # WC 45° corner, legs on the WC side
SHAFT_H = 1050                  # ventilation shaft, outer size along Y
NICHE_W = 610                   # technical niche, clear width
NICHE_OVER = 280                # niche projection into the living room
NICHE_BOTTOM = 4700             # niche door line (Y)
ENTRY = (620, 1580)             # entrance door opening (Y on hall wall)
LIV_DOOR = (1000, 2200)         # living-room double door (Y)
WC_DOOR = (3650, 4400)          # WC door (Y)
KIT_DOOR = (4340, 5240)         # kitchen door (Y)
BR2_DOOR_JAMB = 150             # jambs of bedroom-2 door
BR1_DOOR_JAMB = 290             # left jamb of bedroom-1 door
DOOR = 900                      # interior door opening
LOG_WALL = 1220                 # solid part of the loggia partition
LOG_GLASS = 630                 # fixed glazing of the loggia partition
LOG_DOOR = 800                  # loggia door
KSHAFT = (700, 550)             # kitchen ventilation shaft, outer X x Y
LEFT_WIN_END = 14450            # end of the side window of bedroom 1 (Y)

# ---------------------------------------------------------------------------
# 2. Key coordinates (derived)
# ---------------------------------------------------------------------------
X_OUT_L = 0
X_HALL_IN = X_OUT_L + T                 # 320
X_HALL_R = X_HALL_IN + HALL_W           # 3920  hall / corridor boundary
X_CW_O = X_HALL_R                       # corridor-left wall, outer face
X_COR_L = X_CW_O + T                    # 4240
X_COR_R = X_COR_L + COR_W               # 6090
X_KIT_L = X_COR_R + T                   # 6410
X_F = X_KIT_L + KIT_W                   # 10610 facade, inner face
X_OUT = X_F + T                         # 10930
X_LIV_L = X_F - LIV_W                   # 5640
X_LW_O = X_LIV_L - T                    # 5320
X_BR1_R = X_COR_L + BR1_W               # 7140
X_BR2_L = X_BR1_R + T                   # 7460
assert X_BR2_L + BR2_W == X_F, "bedroom widths must close on the facade"
X_WC_R = X_CW_O                         # 3920
X_WC_L = X_WC_R - WC_W                  # 2020
X_WCW_O = X_WC_L - T                    # 1700
X_SHAFT_R = X_WC_R - WC_W_SHAFT         # 2255
X_NICHE_I = X_F - NICHE_W               # 10000
X_NICHE_O = X_NICHE_I - THIN            # 9880
X_NICHE_DOOR = X_NICHE_I + 500          # 10500
X_COL_L = (X_CW_O, X_CW_O + COL)        # left column line
X_COL_R = (X_F - COL, X_F)              # right column line (inside)
X_BR1_DOOR = (X_COR_L + BR1_DOOR_JAMB, X_COR_L + BR1_DOOR_JAMB + DOOR)
X_LOG_G = X_BR2_L + LOG_WALL            # 8680
X_LOG_D = X_LOG_G + LOG_GLASS           # 9310
X_KSH_R = X_KIT_L + KSHAFT[0]           # 7110  kitchen shaft
assert X_LOG_D + LOG_DOOR == X_COL_R[0]

Y_OUT_T = 0
Y_TOP_IN = T                            # 320
Y_HALL_B = Y_TOP_IN + HALL_D            # 2320
Y_WC_T = Y_HALL_B + T                   # 2640
Y_WC_B = Y_WC_T + WC_D                  # 5090
Y_WCW_B = Y_WC_B + T                    # 5410
Y_LIV_B = Y_TOP_IN + LIV_D              # 3320
Y_KIT_T = Y_LIV_B + T                   # 3640
Y_KIT_B = Y_KIT_T + KIT_D               # 6540
Y_BR2_T = Y_KIT_B + T                   # 6860
Y_BR2_B = Y_BR2_T + BR2_D               # 12710
Y_LOG_T = Y_BR2_B + T                   # 13030
Y_BOT = Y_LOG_T + LOG_D                 # 14680
Y_OUT = Y_BOT + T                       # 15000
Y_BR1_T = Y_BOT - BR1_D                 # 8380
Y_BR1W_T = Y_BR1_T - T                  # 8060
Y_COR_DIAG = Y_BR1W_T - COR_L           # 3710  corridor length origin
Y_SHAFT_T = Y_WC_B - SHAFT_H            # 4040
Y_NICHE_O = Y_LIV_B - NICHE_OVER        # 3040
Y_NICHE_I = Y_NICHE_O + THIN            # 3160
Y_NICHE_JAMB = 4150
Y_KSH_B = Y_KIT_T + KSHAFT[1]           # 4190  kitchen shaft
Y_COL_T = (0, COL)                      # top column row
Y_COL_M = (Y_BR2_T - COL, Y_BR2_T)      # middle row (6360..6860)
Y_COL_B = (Y_LOG_T - COL, Y_LOG_T)      # bottom row (12530..13030)
Y_BR2_DOOR = (Y_BR2_T + BR2_DOOR_JAMB, Y_BR1W_T - BR2_DOOR_JAMB)
assert Y_BR2_DOOR[1] - Y_BR2_DOOR[0] == DOOR

# 45° walls: lines x - y = c
C_WC_IN = (X_WC_R - WC_CHAMFER) - Y_WC_T          # WC face
C_WC_OUT = C_WC_IN + T * SQ2                      # corridor face
C_LIV_OUT = X_COR_R - Y_COR_DIAG                  # corridor face
C_LIV_IN = C_LIV_OUT + T * SQ2                    # living-room face

WC_DIAG_TOP = (Y_HALL_B + C_WC_OUT, Y_HALL_B)     # corridor face at hall
WC_DIAG_COR = (X_COR_L, X_COR_L - C_WC_OUT)       # corridor face at wall
WC_DIAG_A = (X_WC_R - WC_CHAMFER, Y_WC_T)         # WC face, top
WC_DIAG_B = (X_WC_R, Y_WC_T + WC_CHAMFER)         # WC face, right
LIV_DIAG_A = (X_LW_O, X_LW_O - C_LIV_OUT)         # corridor face, top
LIV_DIAG_B = (X_COR_R, Y_COR_DIAG)                # corridor face, bottom
LIV_DIAG_C = (X_LIV_L, X_LIV_L - C_LIV_IN)        # living face, top
LIV_DIAG_D = (Y_LIV_B + C_LIV_IN, Y_LIV_B)        # living face, bottom

# ---------------------------------------------------------------------------
# 3. Building elements
# ---------------------------------------------------------------------------
wall_parts = [
    box(0, 0, X_OUT, Y_TOP_IN),                               # top wall
    box(0, 0, X_HALL_IN, Y_WC_T),                             # hall left wall
    Polygon([(0, Y_HALL_B), WC_DIAG_TOP, WC_DIAG_COR,         # hall bottom
             (X_COR_L, WC_DOOR[0]), (X_WC_R, WC_DOOR[0]),     # + WC chamfer
             WC_DIAG_B, WC_DIAG_A, (0, Y_WC_T)]),
    box(X_WCW_O, Y_HALL_B, X_WC_L, Y_SHAFT_T),                # WC left wall
    box(X_WCW_O, Y_WC_B, X_COR_L, Y_WCW_B),                   # WC bottom wall
    box(X_CW_O, WC_DOOR[1], X_COR_L, Y_OUT),                  # corridor left
    Polygon([(X_LW_O, 0), (X_LIV_L, 0), LIV_DIAG_C, LIV_DIAG_D,
             (X_NICHE_O, Y_LIV_B), (X_NICHE_O, Y_KIT_T),
             (X_KIT_L, Y_KIT_T), (X_KIT_L, KIT_DOOR[0]),
             (X_COR_R, KIT_DOOR[0]), LIV_DIAG_B, LIV_DIAG_A]),
    box(X_COR_R, KIT_DOOR[1], X_KIT_L, Y_BR2_DOOR[0]),        # corridor right
    box(X_COR_R, Y_BR2_DOOR[1], X_KIT_L, Y_BR1_T),
    box(X_COR_R, Y_KIT_B, X_F, Y_BR2_T),                      # kitchen bottom
    box(X_CW_O, Y_BR1W_T, X_BR2_L, Y_BR1_T),                  # bedroom-1 top
    box(X_BR1_R, Y_BR1W_T, X_BR2_L, Y_BOT),                   # partition
    box(X_BR2_L, Y_BR2_B, X_LOG_G, Y_LOG_T),                  # loggia wall
    # shaft and niche enclosures (thin)
    box(X_WCW_O, Y_SHAFT_T, X_SHAFT_R, Y_WC_B).difference(
        box(X_WCW_O + THIN, Y_SHAFT_T + THIN, X_SHAFT_R - THIN, Y_WC_B)),
    box(X_NICHE_O, Y_NICHE_O, X_NICHE_I, NICHE_BOTTOM),
    box(X_NICHE_O, Y_NICHE_O, X_F, Y_NICHE_I),
    box(X_NICHE_DOOR, Y_NICHE_JAMB, X_F, NICHE_BOTTOM),
    box(X_KIT_L, Y_KIT_T, X_KSH_R, Y_KSH_B).difference(       # kitchen shaft
        box(X_KIT_L, Y_KIT_T, X_KSH_R - THIN, Y_KSH_B - THIN)),
]

columns = [
    box(X_COL_L[0], Y_COL_T[0], X_COL_L[1], Y_COL_T[1]),
    box(X_COL_R[0], Y_COL_T[0], X_COL_R[1], Y_COL_T[1]),
    box(X_COL_L[0], Y_COL_M[0], X_COL_L[1], Y_COL_M[1]),
    box(X_COL_R[0], Y_COL_M[0], X_COL_R[1], Y_COL_M[1]),
    box(X_COL_L[0], Y_COL_B[0], X_COL_L[1], Y_COL_B[1]),
    box(X_COL_R[0], Y_COL_B[0], X_COL_R[1], Y_COL_B[1]),
]

# Windows: (axis, fixed-range, span)  axis 'v' = in a vertical wall
windows = [
    ('v', (X_CW_O, X_COR_L), (Y_COL_B[1], LEFT_WIN_END)),      # bedroom 1 side
    ('h', (Y_BR2_B, Y_LOG_T), (X_LOG_G, X_LOG_D)),             # loggia glazing
]
# Right and bottom facades: continuous panoramic glazing (витраж), 320 mm
# zone, from the top wall round the corner to the left wall.
PANO_OUT = [(X_OUT, Y_TOP_IN), (X_OUT, Y_OUT), (X_COR_L, Y_OUT)]
PANO_IN = [(X_F, Y_TOP_IN), (X_F, Y_BOT), (X_COR_L, Y_BOT)]
PANO_GLASS = [[(X_F + d, Y_TOP_IN), (X_F + d, Y_BOT + d), (X_COR_L, Y_BOT + d)]
              for d in (T / 2 - 30, T / 2 + 30)]

door_cuts = [
    box(0, ENTRY[0], X_HALL_IN, ENTRY[1]),
    box(X_LW_O, LIV_DOOR[0], X_LIV_L, LIV_DOOR[1]),
    box(X_BR1_DOOR[0], Y_BR1W_T, X_BR1_DOOR[1], Y_BR1_T),
]


def _win_box(w):
    ax, (a0, a1), (s0, s1) = w
    return box(a0, s0, a1, s1) if ax == 'v' else box(s0, a0, s1, a1)


WALLS = unary_union(wall_parts + columns).difference(
    unary_union(door_cuts + [_win_box(w) for w in windows]))
COLUMNS = unary_union(columns)

# Rooms (clear contours).  Areas = contour minus walls/columns.
ROOMS = [
    (1, 'Прихожая', 'Entrance hall',
     box(X_HALL_IN, Y_TOP_IN, X_HALL_R, Y_HALL_B)),
    (2, 'Коридор', 'Corridor',
     Polygon([(X_HALL_R, Y_TOP_IN), (X_LW_O, Y_TOP_IN), LIV_DIAG_A,
              LIV_DIAG_B, (X_COR_R, Y_BR1W_T), (X_COR_L, Y_BR1W_T),
              WC_DIAG_COR, WC_DIAG_TOP, (X_HALL_R, Y_HALL_B)])),
    (3, 'С/У', 'Bathroom (WC)',
     Polygon([(X_WC_L, Y_WC_T), WC_DIAG_A, WC_DIAG_B, (X_WC_R, Y_WC_B),
              (X_SHAFT_R, Y_WC_B), (X_SHAFT_R, Y_SHAFT_T),
              (X_WC_L, Y_SHAFT_T)])),
    (4, 'Гостиная', 'Living room',
     Polygon([(X_LIV_L, Y_TOP_IN), (X_F, Y_TOP_IN), (X_F, Y_NICHE_O),
              (X_NICHE_O, Y_NICHE_O), (X_NICHE_O, Y_LIV_B), LIV_DIAG_D,
              LIV_DIAG_C])),
    (5, 'Кухня', 'Kitchen',
     Polygon([(X_KIT_L, Y_KIT_T), (X_NICHE_O, Y_KIT_T),
              (X_NICHE_O, NICHE_BOTTOM), (X_F, NICHE_BOTTOM),
              (X_F, Y_KIT_B), (X_KIT_L, Y_KIT_B)])),
    (6, 'Спальня', 'Bedroom 1',
     box(X_COR_L, Y_BR1_T, X_BR1_R, Y_BOT)),
    (7, 'Спальня', 'Bedroom 2',
     Polygon([(X_KIT_L, Y_BR2_T), (X_F, Y_BR2_T), (X_F, Y_BR2_B),
              (X_BR2_L, Y_BR2_B), (X_BR2_L, Y_BR1W_T),
              (X_KIT_L, Y_BR1W_T)])),
    (8, 'Лоджия', 'Loggia',
     box(X_BR2_L, Y_LOG_T, X_F, Y_BOT)),
]
SHAFTS = unary_union([box(X_WCW_O, Y_SHAFT_T, X_SHAFT_R, Y_WC_B),
                      box(X_KIT_L, Y_KIT_T, X_KSH_R, Y_KSH_B)])
ROOM_AREAS = {n: round(poly.difference(WALLS).difference(SHAFTS).area / 1e6,
                       2)
              for n, _, _, poly in ROOMS}
NICHE_AREA = round(box(X_NICHE_I, Y_NICHE_I, X_F, NICHE_BOTTOM)
                   .difference(WALLS).area / 1e6, 2)

# ---------------------------------------------------------------------------
# 4. Drawing primitives (model mm, Y down) -> SVG and DXF back-ends
# ---------------------------------------------------------------------------
FONT = 'DejaVu Sans'
CHAR_W = 0.60                   # average glyph advance / height (estimate)

LAYERS = {                      # name: (DXF colour, lineweight 1/100 mm)
    'A-WALL': (8, 50), 'A-WALL-FILL': (253, 0), 'A-COLS': (7, 50),
    'A-GLAZ': (5, 18), 'A-DOOR': (7, 18), 'A-EQPM': (8, 13),
    'A-FURN': (9, 13), 'A-DIMS': (7, 18), 'A-DIMS-SRC': (1, 18),
    'A-TEXT': (7, 25), 'A-AREA': (7, 25), 'A-SHEET': (7, 25),
}


class Sheet:
    """Collects primitives in model millimetres."""

    def __init__(self):
        self.items = []

    def geom(self, g, layer, fill=None, lw=0.5, stroke='#000', hatch=None):
        self.items.append(('geom', g, layer, fill, lw, stroke, hatch))

    def line(self, p, q, layer, lw=0.18, stroke='#000', dash=None):
        self.items.append(('line', p, q, layer, lw, stroke, dash))

    def pline(self, pts, layer, lw=0.18, stroke='#000', closed=False,
              fill=None, dash=None):
        self.items.append(('pline', pts, layer, lw, stroke, closed, fill,
                           dash))

    def arc(self, c, p, q, layer, lw=0.18, stroke='#000', dash=None):
        self.items.append(('arc', c, p, q, layer, lw, stroke, dash))

    def circle(self, c, r, layer, lw=0.18, stroke='#000', fill=None):
        self.items.append(('circle', c, r, layer, lw, stroke, fill))

    def text(self, p, s, h, layer='A-TEXT', anchor='middle', rot=0,
             bold=False, fill='#000', valign='baseline'):
        """h = text height on paper, mm.  rot in degrees, visual CCW."""
        self.items.append(('text', p, s, h, layer, anchor, rot, bold, fill,
                           valign))

    # --- dimensions --------------------------------------------------------
    def dim(self, axis, a, b, pos, org=(None, None), text=None, src=False,
            lift=0.0, shift=0.0, h=2.5):
        """Linear dimension.

        axis 'h': measures X between a and b, dimension line at Y = pos.
        axis 'v': measures Y between a and b, dimension line at X = pos.
        org: object coordinates (Y for 'h', X for 'v') where the extension
             lines start; None = no extension line.
        lift/shift: extra text offset on paper (mm) across/along the line.
        src: dimension given on the source plan (drawn bold).
        """
        self.items.append(('dim', axis, a, b, pos, org, text, src, lift,
                           shift, h))

    def chain(self, axis, pos, pts, src=(), tweaks=None, h=2.5):
        """Chain of consecutive dimensions.  pts: [(coord, origin), ...]."""
        tweaks = tweaks or {}
        for i in range(len(pts) - 1):
            (a, oa), (b, ob) = pts[i], pts[i + 1]
            lift, shift = tweaks.get(i, (0.0, 0.0))
            self.dim(axis, a, b, pos, (oa, ob), src=(i in src), lift=lift,
                     shift=shift, h=h)


def fmt_mm(v):
    return str(int(round(abs(v))))


def text_w(s, h):
    return len(s) * CHAR_W * h


# ---------------------------------------------------------------------------
# 5. The plan
# ---------------------------------------------------------------------------
S = Sheet()

# --- walls, columns --------------------------------------------------------
S.geom(WALLS, 'A-WALL', fill='#bdbdbd', lw=0.5)
S.geom(COLUMNS, 'A-COLS', fill='#1a1a1a', lw=0.5)
# ventilation shaft void: crossed
sv = (X_WCW_O + THIN, Y_SHAFT_T + THIN, X_SHAFT_R - THIN, Y_WC_B)
S.line((sv[0], sv[1]), (sv[2], sv[3]), 'A-WALL', 0.18)
S.line((sv[2], sv[1]), (sv[0], sv[3]), 'A-WALL', 0.18)
kv = (X_KIT_L, Y_KIT_T, X_KSH_R - THIN, Y_KSH_B - THIN)
S.line((kv[0], kv[1]), (kv[2], kv[3]), 'A-WALL', 0.18)
S.line((kv[2], kv[1]), (kv[0], kv[3]), 'A-WALL', 0.18)


# --- windows ---------------------------------------------------------------
def draw_window(w):
    ax, (a0, a1), (s0, s1) = w
    mid = (a0 + a1) / 2
    for k, lw in ((a0, 0.25), (a1, 0.25), (mid - 30, 0.18), (mid + 30, 0.18)):
        if ax == 'v':
            S.line((k, s0), (k, s1), 'A-GLAZ', lw)
        else:
            S.line((s0, k), (s1, k), 'A-GLAZ', lw)


for w in windows:
    draw_window(w)
S.pline(PANO_OUT, 'A-GLAZ', 0.25)
S.pline(PANO_IN, 'A-GLAZ', 0.25)
for g in PANO_GLASS:
    S.pline(g, 'A-GLAZ', 0.18)


# --- doors -----------------------------------------------------------------
def door(hinge, closed_end, open_end, layer='A-DOOR'):
    """Leaf drawn open (hinge -> open_end) plus the swing arc."""
    hx, hy = hinge
    ox, oy = open_end
    # leaf as a thin rectangle 40 mm thick
    dx, dy = ox - hx, oy - hy
    L = math.hypot(dx, dy)
    nx, ny = -dy / L * 40, dx / L * 40
    cx, cy = closed_end
    # put leaf thickness on the side away from the closed position
    if (cx - hx) * nx + (cy - hy) * ny > 0:
        nx, ny = -nx, -ny
    S.pline([(hx, hy), (ox, oy), (ox + nx, oy + ny), (hx + nx, hy + ny)],
            layer, lw=0.25, closed=True, fill='#ffffff')
    S.arc(hinge, open_end, closed_end, layer, lw=0.13)


# entrance: opens outward, hinge at top jamb
door((0, ENTRY[0]), (0, ENTRY[1]), (-(ENTRY[1] - ENTRY[0]), ENTRY[0]))
# living room: double door, opens into the corridor
lh = (LIV_DOOR[1] - LIV_DOOR[0]) / 2
door((X_LW_O, LIV_DOOR[0]), (X_LW_O, LIV_DOOR[0] + lh),
     (X_LW_O - lh, LIV_DOOR[0]))
door((X_LW_O, LIV_DOOR[1]), (X_LW_O, LIV_DOOR[1] - lh),
     (X_LW_O - lh, LIV_DOOR[1]))
# WC: opens into the WC, hinge at the top jamb
wd = WC_DOOR[1] - WC_DOOR[0]
door((X_WC_R, WC_DOOR[0]), (X_WC_R, WC_DOOR[1]), (X_WC_R - wd, WC_DOOR[0]))
# kitchen: opens into the kitchen
kd = KIT_DOOR[1] - KIT_DOOR[0]
door((X_KIT_L, KIT_DOOR[0]), (X_KIT_L, KIT_DOOR[1]),
     (X_KIT_L + kd, KIT_DOOR[0]))
# bedroom 2: opens into the bedroom, hinge at the lower jamb
door((X_KIT_L, Y_BR2_DOOR[1]), (X_KIT_L, Y_BR2_DOOR[0]),
     (X_KIT_L + DOOR, Y_BR2_DOOR[1]))
# bedroom 1: opens into the corridor, hinge at the left jamb
door((X_BR1_DOOR[0], Y_BR1W_T), (X_BR1_DOOR[1], Y_BR1W_T),
     (X_BR1_DOOR[0], Y_BR1W_T - DOOR))
# loggia: glazed door, opens into the loggia, hinge at the column
door((X_LOG_D + LOG_DOOR, Y_LOG_T), (X_LOG_D, Y_LOG_T),
     (X_LOG_D + LOG_DOOR, Y_LOG_T + LOG_DOOR))
S.line((X_LOG_D, Y_BR2_B + T / 2), (X_LOG_D + LOG_DOOR, Y_BR2_B + T / 2),
       'A-DOOR', 0.13, dash='1,1')
# niche door: opens into the kitchen
nd = X_NICHE_DOOR - X_NICHE_I
door((X_NICHE_DOOR, NICHE_BOTTOM), (X_NICHE_I, NICHE_BOTTOM),
     (X_NICHE_DOOR, NICHE_BOTTOM + nd))

# --- built-in wardrobes, equipment, furniture (thin, grey) -----------------
EQ, FU = '#555555', '#8a8a8a'


def wardrobe(x0, y0, x1, y1, along='h'):
    S.pline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], 'A-EQPM', 0.18, EQ,
            closed=True)
    step = 150
    if along == 'h':
        x = x0 + step
        while x < x1 - 20:
            S.line((x, y0), (x, y1), 'A-EQPM', 0.09, EQ)
            x += step
    else:
        y = y0 + step
        while y < y1 - 20:
            S.line((x0, y), (x1, y), 'A-EQPM', 0.09, EQ)
            y += step


def rect(x0, y0, x1, y1, layer='A-FURN', col=FU, lw=0.13):
    S.pline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], layer, lw, col,
            closed=True)


def chair(cx, cy, w=450, d=450, back='n'):
    rect(cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2)
    t = 80
    if back == 'n':
        rect(cx - w / 2, cy - d / 2, cx + w / 2, cy - d / 2 + t)
    elif back == 's':
        rect(cx - w / 2, cy + d / 2 - t, cx + w / 2, cy + d / 2)
    elif back == 'w':
        rect(cx - w / 2, cy - d / 2, cx - w / 2 + t, cy + d / 2)
    else:
        rect(cx + w / 2 - t, cy - d / 2, cx + w / 2, cy + d / 2)


def bed(x0, y0, x1, y1, head):
    rect(x0, y0, x1, y1)
    if head == 'e':
        rect(x1 - 80, y0, x1, y1)
        pw = x1 - 80 - 500
        mid = (y0 + y1) / 2
        rect(pw, y0 + 100, x1 - 130, mid - 50)
        rect(pw, mid + 50, x1 - 130, y1 - 100)
        S.line((pw - 500, y0), (pw - 500, y1), 'A-FURN', 0.13, FU)
    else:
        rect(x0, y0, x0 + 80, y1)
        pw = x0 + 80 + 500
        mid = (y0 + y1) / 2
        rect(x0 + 130, y0 + 100, pw, mid - 50)
        rect(x0 + 130, mid + 50, pw, y1 - 100)
        S.line((pw + 500, y0), (pw + 500, y1), 'A-FURN', 0.13, FU)


# hall wardrobe
wardrobe(X_HALL_IN, Y_HALL_B - 450, 3100, Y_HALL_B)
# bedroom wardrobes
wardrobe(5530, Y_BR1_T, X_BR1_R, Y_BR1_T + 600)
wardrobe(8680, Y_BR2_T, X_F, Y_BR2_T + 600)

# WC: shower zone with glass screen, toilet, wash basin
S.line((X_WC_L, 3450), (X_WC_R - 40, 3450), 'A-EQPM', 0.13, EQ, dash='2,1')
S.line((X_WC_L, 3450), (2830, 3450), 'A-GLAZ', 0.35)
S.circle((2450, 3040), 50, 'A-EQPM', 0.13, EQ)
tx = 2530
rect(tx - 190, Y_WC_B - 180, tx + 190, Y_WC_B, 'A-EQPM', EQ)       # cistern
S.pline([(tx - 180, Y_WC_B - 180), (tx - 180, Y_WC_B - 450),
         (tx - 120, Y_WC_B - 600), (tx, Y_WC_B - 650), (tx + 120, Y_WC_B - 600),
         (tx + 180, Y_WC_B - 450), (tx + 180, Y_WC_B - 180)], 'A-EQPM',
        0.13, EQ)
rect(3170, Y_WC_B - 450, 3770, Y_WC_B, 'A-EQPM', EQ)               # basin
S.pline([(3230, Y_WC_B - 60), (3230, Y_WC_B - 330), (3470, Y_WC_B - 400),
         (3710, Y_WC_B - 330), (3710, Y_WC_B - 60)], 'A-EQPM', 0.13, EQ)

# kitchen: worktop 600 deep, sink, hob, fridge, table
rect(X_KSH_R, Y_KIT_T, X_NICHE_O, Y_KIT_T + 600, 'A-EQPM', EQ, 0.18)
rect(7700, Y_KIT_T + 80, 8250, Y_KIT_T + 520, 'A-EQPM', EQ)
S.circle((7975, Y_KIT_T + 300), 40, 'A-EQPM', 0.13, EQ)
rect(8750, Y_KIT_T + 40, 9330, Y_KIT_T + 560, 'A-EQPM', EQ)
for cx, cy, r in ((8900, 3830, 90), (9180, 3830, 110), (8900, 4150, 110),
                  (9180, 4150, 90)):
    S.circle((cx, cy), r, 'A-EQPM', 0.13, EQ)
rect(X_KIT_L, Y_KIT_B - 600, X_KIT_L + 700, Y_KIT_B, 'A-EQPM', EQ, 0.18)
fx, fy = X_KIT_L + 350, Y_KIT_B - 300          # fridge: asterisk mark
for ang in (0, 60, 120):
    dx, dy = 110 * math.cos(math.radians(ang)), 110 * math.sin(math.radians(ang))
    S.line((fx - dx, fy - dy), (fx + dx, fy + dy), 'A-EQPM', 0.13, EQ)
rect(7980, 5840, 9380, Y_KIT_B)
chair(8330, 5560, back='n')
chair(9030, 5560, back='n')
chair(7700, 6190, back='w')
chair(9660, 6190, back='e')

# living room: dining table, 10 chairs
rect(6725, 1270, 9525, 2370)
for cx in (7150, 7800, 8450, 9100):
    chair(cx, 1020, 480, 450, 'n')
    chair(cx, 2620, 480, 450, 's')
chair(6450, 1820, 450, 480, 'w')
chair(9800, 1820, 450, 480, 'e')

# bedroom 1: bed at the partition, nightstands, desk at the facade
bed(5040, 10230, X_BR1_R, 12030, 'e')
rect(X_BR1_R - 450, 9730, X_BR1_R, 10180)
rect(X_BR1_R - 450, 12080, X_BR1_R, 12530)
rect(6490, 13130, X_BR1_R, 14530)
chair(6150, 13830, 500, 500, 'w')

# bedroom 2
bed(X_BR2_L, 9910, 9560, 11710, 'w')
rect(X_BR2_L, 9410, X_BR2_L + 450, 9860)
rect(X_BR2_L, 11760, X_BR2_L + 450, 12210)
# loggia desk
rect(X_BR2_L, 13130, 8110, 14530)
chair(8400, 13830, 500, 500, 'e')

# --- room labels -----------------------------------------------------------
LABEL_POS = {
    1: (2150, 1180), 2: (4980, 5000), 3: (2900, 4160), 4: (8125, 1760),
    5: (8300, 4950), 6: (5700, 9500), 7: (8900, 8450), 8: (9150, 14100),
}
for n, ru, en, poly in ROOMS:
    x, y = LABEL_POS[n]
    area = f'{ROOM_AREAS[n]:.2f}'.replace('.', ',')
    S.text((x, y - 60), f'{n}. {ru}', 3.5, 'A-TEXT', bold=False)
    s = f'{area} м²'
    S.text((x, y + 150), s, 3.5, 'A-AREA', bold=True)
    w = text_w(s, 3.5) * SCALE * 0.95
    S.line((x - w / 2, y + 190), (x + w / 2, y + 190), 'A-AREA', 0.25)

S.text((10305, 3700), 'Тех.', 2.5)
S.text((10305, 3850), 'ниша', 2.5)
S.text((1977, 4520), 'Вент-', 2.0, rot=90)
S.text((2087, 4520), 'шахта', 2.0, rot=90)
kx, ky = (kv[0] + kv[2]) / 2, (kv[1] + kv[3]) / 2
S.pline([(kx - 260, ky - 130), (kx + 260, ky - 130), (kx + 260, ky + 120),
         (kx - 260, ky + 120)], 'A-MASK', 0.01, '#ffffff', closed=True,
        fill='#ffffff')
S.text((kx, ky - 20), 'Вентшахта', 1.8)
S.text((kx, ky + 100), f'{KSHAFT[0]}×{KSHAFT[1]}', 1.8)

# --- dimensions ------------------------------------------------------------
# Every size is dimensioned exactly once: rooms on the perimeter on the
# outer chains, inner rooms, openings and details inside the plan.
D1, D2 = 700, 1100                      # offsets of the outer chains

# top: walls and rooms; overall width
S.chain('h', -D1, [(0, 0), (X_HALL_IN, 0), (X_HALL_R, 0), (X_LW_O, 0),
                   (X_LIV_L, 0), (X_F, 0), (X_OUT, 0)], src={1, 4})
S.dim('h', 0, X_OUT, -D2, (0, 0))

# right: walls and rooms; overall height
yr = [0, Y_TOP_IN, Y_LIV_B, Y_KIT_T, Y_KIT_B, Y_BR2_T, Y_BR2_B, Y_LOG_T,
      Y_BOT, Y_OUT]
S.chain('v', X_OUT + D1, [(y, X_OUT) for y in yr], src={1, 3, 5, 7})
S.dim('v', 0, Y_OUT, X_OUT + D2, (X_OUT, X_OUT))

# bottom: walls and rooms (glazing depth is on the top chain); overall
xb = [X_CW_O, X_COR_L, X_BR1_R, X_BR2_L, X_F]
S.chain('h', Y_OUT + D1, [(x, Y_OUT) for x in xb], src={1, 3})
S.dim('h', X_CW_O, X_OUT, Y_OUT + D2, (Y_OUT, Y_OUT))

# left — hall wall: entrance door, hall bottom wall
S.chain('v', -1300, [(0, 0), (ENTRY[0], 0), (ENTRY[1], 0), (Y_HALL_B, 0),
                     (Y_WC_T, 0)])
# left — WC wall: WC depth, bottom wall, shaft
S.chain('v', X_WCW_O - 700, [(Y_WC_T, X_WCW_O), (Y_WC_B, X_WCW_O),
                             (Y_WCW_B, X_WCW_O)], src={0})
S.dim('v', Y_SHAFT_T, Y_WC_B, X_WCW_O - 350, (X_WCW_O, X_WCW_O))
S.dim('h', 0, X_WCW_O, Y_WCW_B + 500, (Y_WC_T, Y_WCW_B))
# left — corridor / bedroom-1 wall: columns and side window; rooms
S.chain('v', X_CW_O - 700, [(Y_WCW_B, X_CW_O), (Y_COL_M[0], X_CW_O),
                            (Y_COL_M[1], X_CW_O), (Y_COL_B[0], X_CW_O),
                            (Y_COL_B[1], X_CW_O), (LEFT_WIN_END, X_CW_O),
                            (Y_OUT, X_CW_O)])
S.chain('v', X_CW_O - 1100, [(Y_WCW_B, X_CW_O), (Y_BR1W_T, X_CW_O),
                             (Y_BR1_T, X_CW_O), (Y_BOT, X_CW_O)], src={2})

# --- interior dimensions ---------------------------------------------------
# hall depth (width is on the top chain)
S.dim('v', Y_TOP_IN, Y_HALL_B, 3700, src=True)
# living room: position of the niche
S.dim('v', Y_TOP_IN, Y_NICHE_O, 10050, shift=18)
# corridor / kitchen row
S.chain('h', 5700, [(X_COR_L, None), (X_COR_R, None), (X_KIT_L, None),
                    (X_F, None)], src={0, 2})
# corridor: top width, living-room door, 45° wall, length, doors
S.dim('h', X_COR_L, X_LW_O, 2900)
S.chain('v', 4550, [(Y_TOP_IN, X_LW_O), (LIV_DOOR[0], X_LW_O),
                    (LIV_DOOR[1], X_LW_O), (LIV_DIAG_A[1], X_LW_O)])
S.text((5520, 3480), '45°', 2.5)
S.text((3330, 3120), '45°', 2.5)
S.dim('h', X_LW_O, X_COR_R, 3950, (LIV_DIAG_A[1], Y_COR_DIAG))
S.dim('v', Y_COR_DIAG, Y_BR1W_T, 5650, src=True, shift=10)
S.chain('v', 5850, [(Y_COR_DIAG, None), (KIT_DOOR[0], None),
                    (KIT_DOOR[1], None), (Y_BR2_DOOR[0], None),
                    (Y_BR2_DOOR[1], None), (Y_BR1W_T, None)],
        tweaks={4: (-4.4, -1.5)})
S.chain('h', 7750, [(X_COR_L, None), (X_BR1_DOOR[0], None),
                    (X_BR1_DOOR[1], None), (X_COR_R, None)])
# WC: width, width at the shaft, start of the 45° corner, door, shaft
S.dim('h', X_WC_L, X_WC_R, 3900, shift=-8)
S.dim('h', X_SHAFT_R, X_WC_R, 4560, src=True)
S.dim('h', X_WC_L, WC_DIAG_A[0], 2800)
S.chain('v', 4600, [(WC_DIAG_COR[1], X_COR_L), (WC_DOOR[0], X_COR_L),
                    (WC_DOOR[1], X_COR_L)])
S.dim('h', X_WCW_O, X_SHAFT_R, Y_SHAFT_T - 250, (Y_SHAFT_T, Y_SHAFT_T))
# technical niche
S.dim('h', X_NICHE_I, X_F, Y_NICHE_I + 200)
S.dim('v', Y_NICHE_I, NICHE_BOTTOM, 9700, (X_NICHE_O, X_NICHE_O))
S.dim('h', X_NICHE_I, X_NICHE_DOOR, NICHE_BOTTOM + 650)
# bedroom 2 entrance part
S.dim('h', X_KIT_L, X_BR2_L, 7050)
S.dim('v', Y_BR2_T, Y_BR1W_T, 7380)
# loggia partition: wall, glazing, door
S.chain('h', Y_LOG_T + 350, [(X_BR2_L, None), (X_LOG_G, None),
                             (X_LOG_D, None), (X_COL_R[0], None)])

# ---------------------------------------------------------------------------
# 6. Sheet (A2 landscape): frame, title, explication, notes, stamp
# ---------------------------------------------------------------------------
PAPER_W, PAPER_H = 594.0, 420.0
OX, OY = 76.0, 70.0                     # paper position of model origin


def to_model(px, py):
    return ((px - OX) * SCALE, (py - OY) * SCALE)


def P(px, py):
    return to_model(px, py)


def sheet_rect(x0, y0, x1, y1, lw=0.25):
    S.pline([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], 'A-SHEET', lw,
            closed=True)


def sheet_line(x0, y0, x1, y1, lw=0.25):
    S.line(P(x0, y0), P(x1, y1), 'A-SHEET', lw)


def sheet_text(x, y, s, h, anchor='start', bold=False):
    S.text(P(x, y), s, h, 'A-SHEET', anchor=anchor, bold=bold)


# frame (GOST 2.301: 20 mm left, 5 mm other margins)
sheet_rect(20, 5, PAPER_W - 5, PAPER_H - 5, 0.7)

# plan title
sheet_text(OX + X_OUT / 2 / SCALE, 20, 'ПЛАН КВАРТИРЫ   М 1:50', 7,
           anchor='middle', bold=True)
sheet_text(OX + X_OUT / 2 / SCALE, 27,
           'стены 320 мм, справа и снизу — панорамное остекление; размеры в мм',
           3.5, anchor='middle')

# explication of rooms
EX, EY = 352.0, 20.0
cols = [0, 12, 72, 132, 162]           # x offsets, width 162
row_h = 8.0
sheet_text(EX + cols[-1] / 2, EY - 3, 'ЭКСПЛИКАЦИЯ ПОМЕЩЕНИЙ', 5,
           anchor='middle', bold=True)
head = ['№', 'Наименование', 'Room', 'Площадь, м²']
rows = [[str(n), ru, en, f'{ROOM_AREAS[n]:.2f}'.replace('.', ',')]
        for n, ru, en, _ in ROOMS]
living = sum(ROOM_AREAS[n] for n in (4, 6, 7))
total = sum(ROOM_AREAS[n] for n in range(1, 8))
total_l = total + ROOM_AREAS[8]
fmt = lambda v: f'{v:.2f}'.replace('.', ',')   # noqa: E731
rows += [['', 'Жилая площадь (4, 6, 7)', 'Living area', fmt(living)],
         ['', 'Общая площадь (1–7)', 'Total area', fmt(total)],
         ['', 'Итого с лоджией (1–8)', 'Total incl. loggia', fmt(total_l)]]
all_rows = [head] + rows
for i, r in enumerate(all_rows):
    y0 = EY + i * row_h
    for j, s in enumerate(r):
        cx = EX + (cols[j] + cols[j + 1]) / 2 if j in (0, 3) else \
            EX + cols[j] + 2
        anchor = 'middle' if j in (0, 3) else 'start'
        sheet_text(cx, y0 + 5.6, s, 3.5, anchor=anchor,
                   bold=(i == 0 or i > len(ROOMS)))
tbl_h = len(all_rows) * row_h
sheet_rect(EX, EY, EX + cols[-1], EY + tbl_h, 0.5)
for i in range(1, len(all_rows)):
    sheet_line(EX, EY + i * row_h, EX + cols[-1], EY + i * row_h,
               0.5 if i in (1, len(ROOMS) + 1) else 0.18)
for c in cols[1:-1]:
    sheet_line(EX + c, EY, EX + c, EY + tbl_h, 0.5)

# notes
NY = EY + tbl_h + 14
sheet_text(EX, NY, 'ПРИМЕЧАНИЯ', 5, bold=True)
notes = [
    '1. Все размеры в миллиметрах, площади в м². Масштаб 1:50 —',
    '    печатать на листе А2 в масштабе 100 % (без подгонки).',
    '2. Толщина всех стен 320 мм. Стенки вентшахт и тех. ниши 120 мм.',
    '3. Правая и нижняя наружные стороны — сплошное панорамное',
    '    остекление (витраж) на всю длину, зона 320 мм.',
    '4. Жирным шрифтом — размеры помещений в чистоте по исходному',
    '    плану (сохранены без изменений). Остальные размеры получены',
    '    расчётом или обмером исходного плана с округлением.',
    '    Каждый размер указан один раз.',
    '5. Колонны 500×500 приняты условно (в исходном плане не указаны):',
    '    у стен — заподлицо с наружной гранью, у витража — внутри',
    '    помещений, вплотную к остеклению.',
    '6. Площади подсчитаны по чертежу (в чистоте, за вычетом колонн',
    '    и вентшахт, без площади проёмов). Площадь тех. ниши '
    f'{NICHE_AREA:.2f}'.replace('.', ',') + ' м² не учтена.',
    '7. Мебель показана условно, по исходному плану.',
    '8. Контроль масштаба: отрезок 0–5 м на шкале = 100 мм.',
]
for i, s in enumerate(notes):
    sheet_text(EX, NY + 8 + i * 5.2, s, 3.0)

# graphic scale bar, 0..5 m (1 m = 20 mm)
BX, BY = EX, NY + 8 + len(notes) * 5.2 + 10
for i in range(5):
    x0 = BX + i * 20
    S.pline([P(x0, BY), P(x0 + 20, BY), P(x0 + 20, BY + 3), P(x0, BY + 3)],
            'A-SHEET', 0.25, closed=True,
            fill='#000000' if i % 2 == 0 else '#ffffff')
for i in range(6):
    sheet_text(BX + i * 20, BY + 8, str(i), 3.0, anchor='middle')
sheet_text(BX + 104, BY + 3, 'м  (М 1:50)', 3.0)

# legend
LY = BY + 20
sheet_text(EX, LY, 'УСЛОВНЫЕ ОБОЗНАЧЕНИЯ', 5, bold=True)
lg = [('wall', 'Стена 320 мм'), ('col', 'Колонна 500×500'),
      ('win', 'Окно, панорамное остекление (витраж)'),
      ('shaft', 'Вентшахта'), ('src', 'Размер по исходному плану')]
for i, (k, s) in enumerate(lg):
    y = LY + 6 + i * 8
    if k == 'wall':
        S.pline([P(EX, y), P(EX + 16, y), P(EX + 16, y + 4), P(EX, y + 4)],
                'A-SHEET', 0.5, closed=True, fill='#bdbdbd')
    elif k == 'col':
        S.pline([P(EX + 5, y - 1), P(EX + 11, y - 1), P(EX + 11, y + 5),
                 P(EX + 5, y + 5)], 'A-SHEET', 0.5, closed=True,
                fill='#1a1a1a')
    elif k == 'win':
        for dy, lw in ((0, 0.25), (1.4, 0.18), (2.6, 0.18), (4, 0.25)):
            sheet_line(EX, y + dy, EX + 16, y + dy, lw)
    elif k == 'shaft':
        S.pline([P(EX + 4, y - 1), P(EX + 12, y - 1), P(EX + 12, y + 5),
                 P(EX + 4, y + 5)], 'A-SHEET', 0.5, closed=True)
        sheet_line(EX + 4, y - 1, EX + 12, y + 5, 0.18)
        sheet_line(EX + 12, y - 1, EX + 4, y + 5, 0.18)
    else:
        sheet_text(EX + 8, y + 4, '4350', 3.0, anchor='middle', bold=True)
    sheet_text(EX + 22, y + 3.5, s, 3.5)

# title block (GOST 21.101 form 3 outline, 185 x 55)
TX0, TY0 = PAPER_W - 5 - 185, PAPER_H - 5 - 55
sheet_rect(TX0, TY0, TX0 + 185, TY0 + 55, 0.7)
for yy in (TY0 + 15, TY0 + 30):
    sheet_line(TX0 + 65, yy, TX0 + 185, yy, 0.5)
sheet_line(TX0 + 65, TY0, TX0 + 65, TY0 + 55, 0.7)
sheet_line(TX0 + 135, TY0 + 30, TX0 + 135, TY0 + 55, 0.5)
for xx in (TX0 + 150, TX0 + 165):
    sheet_line(xx, TY0 + 30, xx, TY0 + 40, 0.5)
sheet_line(TX0 + 135, TY0 + 35, TX0 + 185, TY0 + 35, 0.25)
sheet_line(TX0 + 135, TY0 + 40, TX0 + 185, TY0 + 40, 0.5)
for i in range(1, 11):
    sheet_line(TX0, TY0 + i * 5, TX0 + 65, TY0 + i * 5, 0.18)
for xx in (TX0 + 7, TX0 + 17, TX0 + 23, TX0 + 38, TX0 + 53):
    sheet_line(xx, TY0, xx, TY0 + 55, 0.18)
for s, x in (('Изм.', 3.5), ('Кол.', 12), ('Лист', 20), ('№док', 30.5),
             ('Подп.', 45.5), ('Дата', 59)):
    sheet_text(TX0 + x, TY0 + 29, s, 2.2, anchor='middle')
sheet_text(TX0 + 125, TY0 + 9.5, 'Квартира: 3 комнаты, лоджия', 4.5,
           anchor='middle', bold=True)
sheet_text(TX0 + 125, TY0 + 24, 'Архитектурные решения', 4.0,
           anchor='middle')
sheet_text(TX0 + 100, TY0 + 41, 'План квартиры', 4.5, anchor='middle',
           bold=True)
sheet_text(TX0 + 100, TY0 + 48, 'Стены 320 мм', 3.5, anchor='middle')
for s, x in (('Стадия', 142.5), ('Лист', 157.5), ('Листов', 175)):
    sheet_text(TX0 + x, TY0 + 34, s, 2.5, anchor='middle')
for s, x in (('Р', 142.5), ('1', 157.5), ('1', 175)):
    sheet_text(TX0 + x, TY0 + 39, s, 3.0, anchor='middle')
sheet_text(TX0 + 160, TY0 + 47, 'М 1:50', 5, anchor='middle', bold=True)
sheet_text(TX0 + 160, TY0 + 53, 'Формат А2', 3.0, anchor='middle')


# ---------------------------------------------------------------------------
# 7. SVG back-end
# ---------------------------------------------------------------------------
def sp(p):
    return OX + p[0] / SCALE, OY + p[1] / SCALE


def svg_num(v):
    return f'{v:.3f}'.rstrip('0').rstrip('.')


def svg_poly_path(g):
    polys = [g] if g.geom_type == 'Polygon' else list(g.geoms)
    d = []
    for pg in polys:
        for ring in [pg.exterior] + list(pg.interiors):
            pts = [sp(c) for c in ring.coords]
            d.append('M' + ' L'.join(f'{svg_num(x)},{svg_num(y)}'
                                     for x, y in pts) + ' Z')
    return ' '.join(d)


def svg_text(p, s, h, anchor, rot, bold, fill, valign='baseline'):
    x, y = sp(p)
    if valign == 'middle':
        # shift baseline so the text is centred on p (before rotation)
        dx = math.sin(math.radians(rot)) * 0.36 * h
        dy = math.cos(math.radians(rot)) * 0.36 * h
        x, y = x - dx, y + dy
    s = (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
    tr = f' transform="rotate({svg_num(-rot)} {svg_num(x)} {svg_num(y)})"' \
        if rot else ''
    fw = ' font-weight="bold"' if bold else ''
    return (f'<text x="{svg_num(x)}" y="{svg_num(y)}" font-size="{h}" '
            f'text-anchor="{anchor}"{fw} fill="{fill}"{tr}>{s}</text>')


def svg_dim(out, axis, a, b, pos, org, text, src, lift, shift, h):
    a, b = min(a, b), max(a, b)
    lw_d, lw_t = 0.18, 0.4
    over, dle, tick = 100.0, 75.0, 1.1          # model mm / paper mm
    col = '#000'
    txt = text if text is not None else fmt_mm(b - a)
    seg_paper = (b - a) / SCALE
    tw = text_w(txt, h)
    if lift == 0 and shift == 0 and tw + 1.2 > seg_paper:
        lift = h + 0.6
    gap = 0.7 + lift
    if axis == 'h':
        # extension lines
        for x, o in ((a, org[0]), (b, org[1])):
            if o is None:
                continue
            sgn = 1 if pos > o else -1
            p1, p2 = sp((x, o)), sp((x, pos + sgn * over))
            out.append(f'<line x1="{svg_num(p1[0])}" y1="{svg_num(p1[1])}" '
                       f'x2="{svg_num(p2[0])}" y2="{svg_num(p2[1])}" '
                       f'stroke="{col}" stroke-width="{lw_d}"/>')
        p1, p2 = sp((a - dle, pos)), sp((b + dle, pos))
        out.append(f'<line x1="{svg_num(p1[0])}" y1="{svg_num(p1[1])}" '
                   f'x2="{svg_num(p2[0])}" y2="{svg_num(p2[1])}" '
                   f'stroke="{col}" stroke-width="{lw_d}"/>')
        for x in (a, b):
            cx, cy = sp((x, pos))
            out.append(f'<line x1="{svg_num(cx - tick)}" '
                       f'y1="{svg_num(cy + tick)}" x2="{svg_num(cx + tick)}" '
                       f'y2="{svg_num(cy - tick)}" stroke="{col}" '
                       f'stroke-width="{lw_t}"/>')
        tx, ty = sp(((a + b) / 2, pos))
        out.append(svg_text(((tx + shift - OX) * SCALE,
                             (ty - gap - OY) * SCALE), txt, h, 'middle', 0,
                            src, col))
    else:
        for y, o in ((a, org[0]), (b, org[1])):
            if o is None:
                continue
            sgn = 1 if pos > o else -1
            p1, p2 = sp((o, y)), sp((pos + sgn * over, y))
            out.append(f'<line x1="{svg_num(p1[0])}" y1="{svg_num(p1[1])}" '
                       f'x2="{svg_num(p2[0])}" y2="{svg_num(p2[1])}" '
                       f'stroke="{col}" stroke-width="{lw_d}"/>')
        p1, p2 = sp((pos, a - dle)), sp((pos, b + dle))
        out.append(f'<line x1="{svg_num(p1[0])}" y1="{svg_num(p1[1])}" '
                   f'x2="{svg_num(p2[0])}" y2="{svg_num(p2[1])}" '
                   f'stroke="{col}" stroke-width="{lw_d}"/>')
        for y in (a, b):
            cx, cy = sp((pos, y))
            out.append(f'<line x1="{svg_num(cx - tick)}" '
                       f'y1="{svg_num(cy + tick)}" x2="{svg_num(cx + tick)}" '
                       f'y2="{svg_num(cy - tick)}" stroke="{col}" '
                       f'stroke-width="{lw_t}"/>')
        tx, ty = sp((pos, (a + b) / 2))
        out.append(svg_text(((tx - gap - OX) * SCALE,
                             (ty + shift - OY) * SCALE), txt, h, 'middle',
                            90, src, col))


def write_svg(path):
    out = [f'<?xml version="1.0" encoding="UTF-8"?>',
           f'<svg xmlns="http://www.w3.org/2000/svg" '
           f'width="{PAPER_W}mm" height="{PAPER_H}mm" '
           f'viewBox="0 0 {PAPER_W} {PAPER_H}" '
           f'font-family="{FONT}">',
           '<title>План квартиры М 1:50</title>',
           '<defs><pattern id="hatch" patternUnits="userSpaceOnUse" '
           'width="1.6" height="1.6" patternTransform="rotate(45)">'
           '<rect width="1.6" height="1.6" fill="#c8c8c8"/>'
           '<line x1="0" y1="0" x2="0" y2="1.6" stroke="#5a5a5a" '
           'stroke-width="0.15"/></pattern></defs>',
           f'<rect width="{PAPER_W}" height="{PAPER_H}" fill="#ffffff"/>']
    order = {'geom': 0, 'pline': 1, 'line': 1, 'arc': 1, 'circle': 1,
             'dim': 2, 'text': 3}
    items = sorted(S.items, key=lambda it: order[it[0]])
    for it in items:
        k = it[0]
        if k == 'geom':
            _, g, layer, fill, lw, stroke, hatch = it
            f = 'url(#hatch)' if hatch else (fill or 'none')
            out.append(f'<path d="{svg_poly_path(g)}" fill="{f}" '
                       f'fill-rule="evenodd" stroke="{stroke}" '
                       f'stroke-width="{lw}" stroke-linejoin="miter"/>')
        elif k == 'line':
            _, p, q, layer, lw, stroke, dash = it
            p1, p2 = sp(p), sp(q)
            da = f' stroke-dasharray="{dash}"' if dash else ''
            out.append(f'<line x1="{svg_num(p1[0])}" y1="{svg_num(p1[1])}" '
                       f'x2="{svg_num(p2[0])}" y2="{svg_num(p2[1])}" '
                       f'stroke="{stroke}" stroke-width="{lw}"{da}/>')
        elif k == 'pline':
            _, pts, layer, lw, stroke, closed, fill, dash = it
            pp = ' '.join(f'{svg_num(x)},{svg_num(y)}'
                          for x, y in (sp(p) for p in pts))
            tag = 'polygon' if closed else 'polyline'
            da = f' stroke-dasharray="{dash}"' if dash else ''
            out.append(f'<{tag} points="{pp}" fill="{fill or "none"}" '
                       f'stroke="{stroke}" stroke-width="{lw}"{da}/>')
        elif k == 'arc':
            _, c, p, q, layer, lw, stroke, dash = it
            r = math.hypot(p[0] - c[0], p[1] - c[1]) / SCALE
            v1 = (p[0] - c[0], p[1] - c[1])
            v2 = (q[0] - c[0], q[1] - c[1])
            sweep = 1 if v1[0] * v2[1] - v1[1] * v2[0] > 0 else 0
            p1, p2 = sp(p), sp(q)
            out.append(f'<path d="M{svg_num(p1[0])},{svg_num(p1[1])} '
                       f'A{svg_num(r)},{svg_num(r)} 0 0 {sweep} '
                       f'{svg_num(p2[0])},{svg_num(p2[1])}" fill="none" '
                       f'stroke="{stroke}" stroke-width="{lw}"/>')
        elif k == 'circle':
            _, c, r, layer, lw, stroke, fill = it
            cx, cy = sp(c)
            out.append(f'<circle cx="{svg_num(cx)}" cy="{svg_num(cy)}" '
                       f'r="{svg_num(r / SCALE)}" fill="{fill or "none"}" '
                       f'stroke="{stroke}" stroke-width="{lw}"/>')
        elif k == 'text':
            _, p, s, h, layer, anchor, rot, bold, fill, valign = it
            out.append(svg_text(p, s, h, anchor, rot, bold, fill, valign))
        elif k == 'dim':
            svg_dim(out, *it[1:])
    out.append('</svg>')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(out))


# ---------------------------------------------------------------------------
# 8. DXF back-end (model space, real millimetres, Y up)
# ---------------------------------------------------------------------------
def write_dxf(path):
    import ezdxf
    from ezdxf.enums import TextEntityAlignment

    doc = ezdxf.new('R2013', setup=True)
    doc.units = ezdxf.units.MM
    doc.header['$INSUNITS'] = 4
    doc.header['$LWDISPLAY'] = 1
    doc.styles.new('PLAN', dxfattribs={'font': 'arial.ttf'})
    for name, (color, lwt) in LAYERS.items():
        doc.layers.add(name, color=color, lineweight=lwt)
    ds = doc.dimstyles.new('PLAN50')
    ds.dxf.dimscale = SCALE
    ds.dxf.dimtxt = 2.5
    ds.dxf.dimtsz = 1.5            # oblique ticks instead of arrows
    ds.dxf.dimasz = 1.5
    ds.dxf.dimexe = 2.0
    ds.dxf.dimexo = 0.0
    ds.dxf.dimdle = 1.5
    ds.dxf.dimgap = 0.7
    ds.dxf.dimtad = 1
    ds.dxf.dimtih = 0
    ds.dxf.dimtoh = 0
    ds.dxf.dimdec = 0
    ds.dxf.dimtxsty = 'PLAN'
    ds.dxf.dimtmove = 2
    msp = doc.modelspace()

    def fp(p):
        return (p[0], -p[1])

    def lw_attr(layer, lw):
        return {'layer': layer, 'lineweight': int(round(lw * 100))}

    TA = TextEntityAlignment
    for it in S.items:
        k = it[0]
        if k == 'geom':
            _, g, layer, fill, lw, stroke, hatch = it
            polys = [g] if g.geom_type == 'Polygon' else list(g.geoms)
            fill_layer = 'A-WALL-FILL' if layer == 'A-WALL' else layer
            h = msp.add_hatch(color=253 if layer == 'A-WALL' else 250,
                              dxfattribs={'layer': fill_layer})
            for pg in polys:
                h.paths.add_polyline_path([fp(c) for c in
                                           pg.exterior.coords[:-1]],
                                          is_closed=True, flags=1)
                for ring in pg.interiors:
                    h.paths.add_polyline_path([fp(c) for c in
                                               ring.coords[:-1]],
                                              is_closed=True, flags=0)
                for ring in [pg.exterior] + list(pg.interiors):
                    msp.add_lwpolyline([fp(c) for c in ring.coords[:-1]],
                                       close=True,
                                       dxfattribs=lw_attr(layer, lw))
        elif k == 'line':
            _, p, q, layer, lw, stroke, dash = it
            msp.add_line(fp(p), fp(q), dxfattribs=lw_attr(layer, lw))
        elif k == 'pline':
            _, pts, layer, lw, stroke, closed, fill, dash = it
            if layer == 'A-MASK':
                continue
            msp.add_lwpolyline([fp(p) for p in pts], close=closed,
                               dxfattribs=lw_attr(layer, lw))
        elif k == 'arc':
            _, c, p, q, layer, lw, stroke, dash = it
            r = math.hypot(p[0] - c[0], p[1] - c[1])
            a1 = math.degrees(math.atan2(-(p[1] - c[1]), p[0] - c[0]))
            a2 = math.degrees(math.atan2(-(q[1] - c[1]), q[0] - c[0]))
            if (a2 - a1) % 360 > 180:
                a1, a2 = a2, a1
            msp.add_arc(fp(c), r, a1, a2, dxfattribs=lw_attr(layer, lw))
        elif k == 'circle':
            _, c, r, layer, lw, stroke, fill = it
            msp.add_circle(fp(c), r, dxfattribs=lw_attr(layer, lw))
        elif k == 'text':
            _, p, s, h, layer, anchor, rot, bold, fill, valign = it
            al = {('start', 'baseline'): TA.LEFT,
                  ('middle', 'baseline'): TA.CENTER,
                  ('end', 'baseline'): TA.RIGHT,
                  ('middle', 'middle'): TA.MIDDLE_CENTER,
                  ('start', 'middle'): TA.MIDDLE_LEFT}[(anchor, valign)]
            t = msp.add_text(s, height=h * SCALE, rotation=rot,
                             dxfattribs={'layer': layer, 'style': 'PLAN'})
            t.set_placement(fp(p), align=al)
        elif k == 'dim':
            _, axis, a, b, pos, org, text, src, lift, shift, h = it
            a, b = min(a, b), max(a, b)
            layer = 'A-DIMS-SRC' if src else 'A-DIMS'
            ov = {}
            if axis == 'h':
                p1 = (a, org[0] if org[0] is not None else pos)
                p2 = (b, org[1] if org[1] is not None else pos)
                base, angle = (a, pos), 0
            else:
                p1 = (org[0] if org[0] is not None else pos, a)
                p2 = (org[1] if org[1] is not None else pos, b)
                base, angle = (pos, a), 90
            if org[0] is None:
                ov['dimse1'] = 1
            if org[1] is None:
                ov['dimse2'] = 1
            txt = text if text is not None else fmt_mm(b - a)
            tw = text_w(txt, h)
            if lift == 0 and shift == 0 and tw + 1.2 > (b - a) / SCALE:
                lift = h + 0.6
            loc = None
            if lift or shift:
                g = (0.7 + lift + h / 2) * SCALE
                if axis == 'h':
                    loc = fp(((a + b) / 2 + shift * SCALE, pos - g))
                else:
                    loc = fp((pos - g, (a + b) / 2 + shift * SCALE))
            d = msp.add_linear_dim(base=fp(base), p1=fp(p1), p2=fp(p2),
                                   angle=-angle if angle else 0,
                                   dimstyle='PLAN50', location=loc,
                                   override=ov,
                                   dxfattribs={'layer': layer})
            d.render()
    doc.saveas(path)


# ---------------------------------------------------------------------------
def main():
    svg = os.path.join(HERE, 'plan_1-50.svg')
    write_svg(svg)
    try:
        import cairosvg
        cairosvg.svg2pdf(url=svg, write_to=os.path.join(HERE,
                                                        'plan_1-50.pdf'))
        cairosvg.svg2png(url=svg, write_to=os.path.join(HERE,
                                                        'plan_1-50.png'),
                         dpi=150, output_width=int(PAPER_W / 25.4 * 150))
    except ImportError:
        print('cairosvg not installed: PDF/PNG skipped')
    write_dxf(os.path.join(HERE, 'plan.dxf'))

    print('Room areas, m²:')
    for n, ru, en, _ in ROOMS:
        print(f'  {n}. {ru:10s} {en:15s} {ROOM_AREAS[n]:6.2f}')
    print(f'  living {living:.2f}  total {total:.2f}  '
          f'with loggia {total_l:.2f}  (niche {NICHE_AREA:.2f})')
    print(f'Overall: {X_OUT} x {Y_OUT} mm')


if __name__ == '__main__':
    main()
