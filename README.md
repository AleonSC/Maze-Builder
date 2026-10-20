# Maze Builder

A browser tool for drafting mazes by hand, by algorithm, or both. Draw every
wall yourself, generate a maze and then edit it, or regenerate one area while
keeping the rest.

There are two builders, linked from the header:

- **2D** (`index.html`): single-level mazes.
- **3D** (`3d.html`): multi-level mazes with floors, stairs, a live 3D view
  and a first-person walk mode. See [3D builder](#3d-builder) below.

No build step. The 2D builder has no dependencies; the 3D builder loads
three.js from cdnjs. Open either page in a browser, or serve the folder:

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

## 3D builder

A maze of columns × rows × levels (up to 120 × 120 × 32, 120,000 cells).
You edit one level at a time as a floor plan, with a live 3D model beside it.
**Plan / Split / 3D** switches the layout, and `[` `]` (or Page Up / Page Down)
change the level.

**Editing.** All the 2D tools work on the current level, plus a **Stairs**
tool (`T`): click a cell to open stairs to the level above, Shift-click for
the level below. Stairs show as triangles on the plan and ladders in 3D. The
level below shows faintly on the plan so you can line things up.
Add, duplicate or delete levels from the Size panel.

**Shapes.** Every 2D outline works, plus shapes that change with height:
pyramid, cone, sphere, hourglass and stepped tower.

**Generators.** Recursive backtracker, growing tree, hunt and kill, Prim's,
Kruskal's, Wilson's and Aldous–Broder, all working in three dimensions.
- **Stair use** sets how often the maze moves between levels.
- **Build each level on its own** makes a separate maze on every level and
  then joins them with the fewest stairs.
- **Extra stairs** adds more stairwells per level, which creates loops.
- **Start on the bottom level, end on the top** places the route through
  the whole building.
- With a selection, generation can reach through all levels or only the
  current one.

**Pens in 3D.** On top of colour, thickness and plan line style, each pen
has a **height** (hedges, low rails) and **solidity** (glass walls).

**3D view.** Drag to orbit, right-drag or Shift-drag to pan, and use the
wheel or a pinch to zoom. Show all levels, levels up to the current one, or
only the current one. Wall height, the gap between levels, floor colour and
opacity, stair colour and backdrop are all adjustable.

**Walk.** First-person mode starting at the start marker. W A S D or the
arrow keys move, drag to look, E climbs and Q goes down at stairs. Phones and
tablets get on-screen buttons. Your position shows on the plan.

**Files.** Save and open `.json` drafts (separate from 2D drafts), export
the 3D view as PNG, every level's plan on one SVG sheet, and an **STL** of
walls and floors for 3D printing at a chosen millimetres per cell.

## Files

- `index.html`, `3d.html` page layouts and controls
- `styles.css` styles for both builders, light and dark
- `js/maze.js` 2D maze model, generators, solver and stats (no DOM; usable on its own)
- `js/maze3d.js` multi-level model, generators and analysis (no DOM)
- `js/app.js` the 2D editor
- `js/app3d.js` the 3D editor: plan, three.js view, walk mode and exports
