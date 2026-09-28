# План квартиры, М 1:50 / Apartment floor plan, scale 1:50

| File | What it is |
|---|---|
| `plan_1-50.pdf` | Sheet A2 (594 × 420 mm), true scale 1:50. Print at **100 %** (no "fit to page"). |
| `plan_1-50.svg` | The same sheet as vector SVG (units: mm on paper). |
| `plan_1-50.png` | Raster preview of the sheet (150 dpi). |
| `plan.dxf` | CAD drawing (AutoCAD R2013). Model space is in real millimetres, and the dimensions are real DIMENSION entities (style `PLAN50`, DIMSCALE 50). Plot 1:50 on A2. |
| `generate_plan.py` | Generator. All geometry is defined once, in real mm. |

Check the print scale with the scale bar on the sheet: 0–5 m must measure 100 mm.

## Basis

* **Wall thickness is 320 mm** for every wall. The enclosures of the two
  ventilation shafts (WC and kitchen) and of the technical niche are 120 mm.
* **The right and bottom sides are fully panoramic glazing** (витраж):
  one continuous 320 mm glazing zone running from the top wall, round
  the corner, to the left wall. There are no solid piers.
* Every clear room size from the source plan is kept exactly. These are
  drawn **bold** on the sheet:
  hall 3600 × 2000, living room 4970 × 3000, kitchen 4200 × 2900,
  corridor 1850 / 4350, WC 2450 / 1665, bedroom 2900 × 6300,
  bedroom 3150 × 5850, loggia 1650.
* The source dimensions are consistent with each other:
  1850 + 320 + 4200 = 2900 + 320 + 3150 = 6370.
  With 320 mm walls the apartment measures **10 930 × 15 000 mm** overall.
* The source plan does not dimension doors, windows, piers, the shaft,
  the niche or the 45° corners. These were measured from the source image
  (about 14.2 mm per pixel) and rounded.
* The source does not give column sizes. The drawing assumes 500 × 500
  columns. Along walls they are flush with the outer face of the wall.
  Along the glazing they stand inside the rooms, against the glass, as on
  the source plan.
* Every size is dimensioned exactly once. Perimeter rooms are dimensioned
  on the outer chains; inner rooms, openings and details inside the plan.
  The kitchen shaft is labelled with its size (700 × 550).

## Areas (calculated from the drawing)

Areas are clear floor areas. Columns and shafts are subtracted, and door
openings are not counted.

| № | Room | m² |
|---|---|---|
| 1 | Прихожая / Entrance hall | 7.20 |
| 2 | Коридор / Corridor | 13.00 |
| 3 | С/У / WC | 4.05 |
| 4 | Гостиная / Living room | 14.48 |
| 5 | Кухня / Kitchen | 10.93 |
| 6 | Спальня / Bedroom 1 | 18.18 |
| 7 | Спальня / Bedroom 2 | 19.60 |
| 8 | Лоджия / Loggia | 5.20 |
| | Living area (4, 6, 7) | 52.26 |
| | Total area (1–7) | 87.44 |
| | Total incl. loggia (1–8) | 92.64 |

## Regenerate

```sh
pip install shapely ezdxf cairosvg
python3 generate_plan.py
```

To change the wall thickness, the column size or any assumed value, edit
the constants in section 1 of `generate_plan.py`. The drawing, the
dimensions and the areas are all recalculated from them.
