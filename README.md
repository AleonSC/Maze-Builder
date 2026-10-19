# Maze Builder

A browser tool for drafting mazes by hand, by algorithm, or both. Draw every
wall yourself, generate a maze and then edit it, or regenerate one area while
keeping the rest.

No build step and no dependencies. Open `index.html` in a browser, or serve
the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## What you can do

**Sheet**
- Any size from 2 × 2 up to 400 × 400 cells. Resizing keeps what is drawn.
- Start from a full grid of walls or from an open sheet with just a border.
- Shape masks (circle, ring, diamond, hexagon, triangle, cross, heart) turn
  cells outside the outline into void, on the whole sheet or a selection.

**Drawing tools** (keyboard shortcut in brackets)

| Tool | What it does |
| --- | --- |
| Draw walls `W` | Drag across grid corners to lay walls; click an edge to toggle it |
| Erase walls `E` | Same motion, removes walls |
| Straight wall `L` | Corner-to-corner straight line |
| Room outline `R` | Walls a rectangle |
| Carve passage `C` | Drag cell to cell to open a path through walls |
| Void cells `V` | Paint cells out of the maze for any outline |
| Paint cells `P` | Colour individual cells |
| Fill area `B` | Paint everything reachable without crossing a wall |
| Start `S` / End `X` | Place the entrance and exit |
| Select area `M` | Limit generate, shapes and wall actions to a rectangle |
| Pan `H` | Move the sheet (also Space + drag or middle drag) |

Hold **Shift** or use the **right mouse button** to reverse any tool (erase,
un-void, clear paint, build instead of carve).

**Wall pens.** Every wall is drawn with a pen that has its own name, colour,
width and line style (solid, dashed, dotted). Change a pen and every wall
drawn with it updates. Keys `1`–`9` switch pens. Base thickness and line
ends (round, square, flat) are global.

**Generators.** Recursive backtracker, Prim's, Kruskal's, Wilson's,
Aldous–Broder, hunt and kill, growing tree, binary tree, sidewinder and
recursive division. All of them work on irregular shapes and inside a
selection. Options:
- **Seed** for reproducible mazes (blank picks a random one you can keep).
- **Loops** removes that share of dead ends, turning a perfect maze into a
  braided one.
- **Start and end on the outer edge** places them as far apart as possible
  and cuts the entrance and exit.
- **Animate** shows the algorithm at work, at an adjustable speed.

Generating inside a selection re-joins the new section to the surrounding
maze, so the whole thing stays solvable.

**Checking.** Overlay the solution, a distance-from-start heat map, and dead
end markers. Live stats: open cells, wall segments, dead ends, junctions,
loops, separate areas, and solution length.

**Paper.** Presets (vellum, blueprint, graphite, kraft, night) plus custom
paper, grid, paint, solution and marker colours; grid and ruler toggles;
cell size; how void cells look.

**Files**
- **Save draft / Open** a `.json` file holding the whole drawing, pens and
  settings. You can also drop a draft file onto the page.
- **PNG** at 1×, 2× or 4×.
- **SVG** with each pen on its own path and collinear walls merged into long
  strokes, ready for print, plotters or laser cutters.
- The current draft autosaves in the browser.

Undo and redo cover every edit (`Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y`).

## Files

- `index.html` page layout and controls
- `styles.css` styles, light and dark
- `js/maze.js` maze model, generators, solver and stats (no DOM; usable on its own)
- `js/app.js` the editor: rendering, tools, history, import and export
