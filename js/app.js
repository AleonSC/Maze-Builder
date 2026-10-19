/* Maze Builder — editor UI. Depends on js/maze.js (window.MazeKit). */
(function () {
  'use strict';

  const K = window.MazeKit;
  const { Maze, N, E, S, W, DC, DR } = K;
  const STORE_KEY = 'maze-builder:draft:v1';
  const MAX_HISTORY = 80;
  const MAX_SIZE = 400;

  // ------------------------------------------------------------ defaults

  const PAPERS = {
    vellum: { name: 'Vellum', paper: '#eef2f3', grid: '#cfdadf', ink: '#1b2732' },
    blueprint: { name: 'Blueprint', paper: '#1c4f86', grid: '#3a6ca3', ink: '#eef5fc' },
    graphite: { name: 'Graphite on white', paper: '#ffffff', grid: '#e4e4e4', ink: '#2d2d2d' },
    kraft: { name: 'Kraft', paper: '#c7a676', grid: '#b5925f', ink: '#2a1c0e' },
    night: { name: 'Night', paper: '#12171c', grid: '#252e36', ink: '#d6e2ea' },
  };

  const defaultPens = () => [
    { name: 'Ink', color: PAPERS.vellum.ink, width: 1, style: 'solid' },
    { name: 'Heavy', color: '#1b2732', width: 2, style: 'solid' },
    { name: 'Gate', color: '#c4532a', width: 1, style: 'dashed' },
    { name: 'Hedge', color: '#3d7a4a', width: 1.5, style: 'solid' },
    { name: 'Guide', color: '#7f8f9b', width: 0.6, style: 'dotted' },
  ];

  const defaultLook = () => ({
    paperKey: 'vellum',
    paper: PAPERS.vellum.paper,
    grid: PAPERS.vellum.grid,
    showGrid: true,
    showRulers: true,
    cellSize: 28,
    thickness: 0.14,
    cap: 'round',
    voidStyle: 'hatch',
    path: '#e0662f',
    start: '#2f9a68',
    end: '#c93b3b',
    paint: '#f2cf5b',
    exportScale: 2,
  });

  // ------------------------------------------------------------ state

  const state = {
    maze: new Maze(24, 16),
    pens: defaultPens(),
    pen: 1,
    look: defaultLook(),
    view: { zoom: 1, x: 0, y: 0 },
    tool: 'wall',
    selection: null, // {c0, r0, c1, r1}
    show: { solution: false, heat: false, dead: false },
    gen: { algorithm: 'backtracker', seed: '', braid: 0, animate: true, speed: 40, borderEnds: true },
    lastSeed: '',
  };

  const history = { undo: [], redo: [] };
  let anim = null;      // running generation
  let stroke = null;    // pointer gesture in progress
  let hover = null;     // {x, y} grid coords under the pointer
  let spaceDown = false;
  let analysisCache = null;
  let needsRender = false;

  // ------------------------------------------------------------ DOM

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  // ------------------------------------------------------------ tools

  const ICONS = {
    wall: '<path d="M3 17V3h14"/><path d="M8 17V8h9"/><circle cx="3" cy="17" r="1.2"/><circle cx="17" cy="3" r="1.2"/>',
    erase: '<path d="M7 16h10"/><path d="M4.5 12.5l7-7a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L10 15.5H7.5z"/><path d="M8 9l4 4"/>',
    line: '<path d="M3 10h14"/><circle cx="3" cy="10" r="1.6"/><circle cx="17" cy="10" r="1.6"/>',
    rect: '<rect x="3.5" y="4.5" width="13" height="11"/><circle cx="3.5" cy="4.5" r="1.2"/><circle cx="16.5" cy="15.5" r="1.2"/>',
    carve: '<path d="M3 6h5v8h9"/><path d="M14 11l3 3-3 3"/>',
    void: '<rect x="3.5" y="3.5" width="13" height="13"/><path d="M3.5 9.5l6-6M3.5 15.5l12-12M9.5 16.5l7-7"/>',
    paint: '<path d="M4 13c0-3 3-4 3-7a3 3 0 0 1 6 0c0 3 3 4 3 7a6 6 0 0 1-12 0z"/>',
    flood: '<path d="M10 3l6 6-6 6-6-6z"/><path d="M16 13c0 1.5 1 2 1 3a1 1 0 0 1-2 0c0-1 1-1.5 1-3z"/>',
    start: '<circle cx="10" cy="10" r="6"/><path d="M8.5 7.5l4 2.5-4 2.5z"/>',
    end: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"/>',
    select: '<path d="M3.5 6V3.5H6M14 3.5h2.5V6M16.5 14v2.5H14M6 16.5H3.5V14"/><path d="M9 3.5h2M9 16.5h2M3.5 9v2M16.5 9v2"/>',
    hand: '<path d="M7 10V4.5a1.3 1.3 0 0 1 2.6 0V9"/><path d="M9.6 9V3.5a1.3 1.3 0 0 1 2.6 0V9"/><path d="M12.2 9V5a1.3 1.3 0 0 1 2.6 0v6.5c0 3-2 5.5-5 5.5S5 15.5 4 13l-1-2.6a1.3 1.3 0 0 1 2.3-1.1L7 12"/>',
  };

  const TOOLS = [
    { id: 'wall', key: 'W', label: 'Draw walls', hint: 'Drag across grid corners to draw walls with the current pen. Click an edge to toggle it. Shift or right button erases.' },
    { id: 'erase', key: 'E', label: 'Erase walls', hint: 'Drag across grid corners to remove walls. Click an edge to clear it.' },
    { id: 'line', key: 'L', label: 'Straight wall', hint: 'Drag from corner to corner for a straight wall. Shift erases along the line.' },
    { id: 'rect', key: 'R', label: 'Room outline', hint: 'Drag a rectangle to wall it in. Shift removes the outline.' },
    { id: 'carve', key: 'C', label: 'Carve passage', hint: 'Drag from cell to cell to open a passage. Shift builds walls between the cells instead.' },
    'sep',
    { id: 'void', key: 'V', label: 'Void cells', hint: 'Paint cells out of the maze to make any outline. Shift brings cells back.' },
    { id: 'paint', key: 'P', label: 'Paint cells', hint: 'Paint cells with the paint colour (set under Paper). Shift clears paint.' },
    { id: 'flood', key: 'B', label: 'Fill area', hint: 'Click to paint every cell you can reach without crossing a wall. Shift clears.' },
    'sep',
    { id: 'start', key: 'S', label: 'Place start', hint: 'Click a cell to place the start. Shift removes it.' },
    { id: 'end', key: 'X', label: 'Place end', hint: 'Click a cell to place the end. Shift removes it.' },
    { id: 'select', key: 'M', label: 'Select area', hint: 'Drag to select cells. Generate, shapes and wall actions then work only inside it. Esc clears.' },
    { id: 'hand', key: 'H', label: 'Pan', hint: 'Drag to move the sheet. Wheel or pinch to zoom.' },
  ];
  const TOOL_BY_KEY = {};
  TOOLS.forEach((t) => { if (t !== 'sep') TOOL_BY_KEY[t.key.toLowerCase()] = t.id; });

  function buildTools() {
    const nav = $('tools');
    nav.innerHTML = '';
    for (const t of TOOLS) {
      if (t === 'sep') { const s = document.createElement('span'); s.className = 'tool-sep'; nav.appendChild(s); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.dataset.tool = t.id;
      b.title = t.label + ' (' + t.key + ')';
      b.setAttribute('aria-label', t.label);
      b.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true">' + ICONS[t.id] + '</svg><span class="key">' + t.key + '</span>';
      b.addEventListener('click', () => setTool(t.id));
      nav.appendChild(b);
    }
  }

  function setTool(id) {
    state.tool = id;
    document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
    const t = TOOLS.find((x) => x.id === id);
    $('hint').textContent = t ? t.hint : '';
    updateCursor();
    requestRender();
  }

  function updateCursor() {
    canvas.style.cursor = spaceDown || state.tool === 'hand' ? (stroke && stroke.pan ? 'grabbing' : 'grab') : 'crosshair';
  }

  // ------------------------------------------------------------ history

  function snapshot() { return state.maze.clone(); }

  function pushHistory() {
    history.undo.push(snapshot());
    if (history.undo.length > MAX_HISTORY) history.undo.shift();
    history.redo.length = 0;
    updateHistoryButtons();
  }

  function dropLastHistory() {
    history.undo.pop();
    updateHistoryButtons();
  }

  function undo() {
    finishAnimation();
    if (!history.undo.length) return;
    history.redo.push(snapshot());
    restore(history.undo.pop());
  }

  function redo() {
    finishAnimation();
    if (!history.redo.length) return;
    history.undo.push(snapshot());
    restore(history.redo.pop());
  }

  function restore(m) {
    const sizeChanged = m.cols !== state.maze.cols || m.rows !== state.maze.rows;
    state.maze = m;
    if (sizeChanged) { state.selection = null; syncSizeInputs(); fitView(); }
    changed();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $('undoBtn').disabled = !history.undo.length;
    $('redoBtn').disabled = !history.redo.length;
  }

  // Call after any edit to the maze.
  function changed() {
    analysisCache = null;
    requestRender();
    scheduleStats();
    scheduleSave();
    renderPenCounts();
  }

  // ------------------------------------------------------------ geometry

  const cs = () => state.look.cellSize;

  function toGrid(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left, sy = clientY - rect.top;
    return { x: (sx - state.view.x) / state.view.zoom / cs(), y: (sy - state.view.y) / state.view.zoom / cs() };
  }

  function nearestCorner(p) {
    const m = state.maze;
    return { x: clamp(Math.round(p.x), 0, m.cols), y: clamp(Math.round(p.y), 0, m.rows) };
  }

  function cellAt(p) {
    const c = Math.floor(p.x), r = Math.floor(p.y);
    return state.maze.inBounds(c, r) ? { c, r } : null;
  }

  // Closest wall edge to a point: {k: 'h'|'v', c, r}
  function nearestEdge(p) {
    const m = state.maze;
    const dy = Math.abs(p.y - Math.round(p.y));
    const dx = Math.abs(p.x - Math.round(p.x));
    if (dy <= dx) {
      return { k: 'h', c: clamp(Math.floor(p.x), 0, m.cols - 1), r: clamp(Math.round(p.y), 0, m.rows) };
    }
    return { k: 'v', c: clamp(Math.round(p.x), 0, m.cols), r: clamp(Math.floor(p.y), 0, m.rows - 1) };
  }

  function edgeGet(e) {
    const m = state.maze;
    return e.k === 'h' ? m.h[e.r * m.cols + e.c] : m.v[e.r * (m.cols + 1) + e.c];
  }

  function edgeSet(e, val) {
    const m = state.maze;
    const arr = e.k === 'h' ? m.h : m.v;
    const i = e.k === 'h' ? e.r * m.cols + e.c : e.r * (m.cols + 1) + e.c;
    if (arr[i] === val) return false;
    arr[i] = val;
    return true;
  }

  // Edges walked from corner a to corner b, one grid step at a time.
  function cornerPath(a, b) {
    const out = [];
    let x = a.x, y = a.y;
    while (x !== b.x || y !== b.y) {
      const dx = b.x - x, dy = b.y - y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const nx = x + Math.sign(dx);
        out.push({ k: 'h', c: Math.min(x, nx), r: y });
        x = nx;
      } else {
        const ny = y + Math.sign(dy);
        out.push({ k: 'v', c: x, r: Math.min(y, ny) });
        y = ny;
      }
    }
    return out;
  }

  // Cells walked from a to b in orthogonal steps: [[cell, dirFromPrev], ...]
  function cellPath(a, b) {
    const out = [];
    let c = a.c, r = a.r;
    while (c !== b.c || r !== b.r) {
      const dc = b.c - c, dr = b.r - r;
      let d;
      if (Math.abs(dc) >= Math.abs(dr)) d = dc > 0 ? E : W; else d = dr > 0 ? S : N;
      out.push({ c, r, d });
      c += DC[d]; r += DR[d];
    }
    return out;
  }

  function rectEdges(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (x0 === x1 || y0 === y1) return cornerPath({ x: x0, y: y0 }, { x: x1, y: y1 });
    const out = [];
    for (let c = x0; c < x1; c++) out.push({ k: 'h', c, r: y0 }, { k: 'h', c, r: y1 });
    for (let r = y0; r < y1; r++) out.push({ k: 'v', c: x0, r }, { k: 'v', c: x1, r });
    return out;
  }

  function lineEnd(a, b) {
    return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  }

  function cellRect(a, b) {
    return { c0: Math.min(a.c, b.c), r0: Math.min(a.r, b.r), c1: Math.max(a.c, b.c), r1: Math.max(a.r, b.r) };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ------------------------------------------------------------ view

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const r = stage.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    requestRender();
  }

  function fitView() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const m = state.maze;
    const pad = state.look.showRulers ? 2.2 : 1.2;
    const w = (m.cols + pad * 2) * cs(), h = (m.rows + pad * 2) * cs();
    const zoom = clamp(Math.min(r.width / w, (r.height - 28) / h), 0.05, 8);
    state.view.zoom = zoom;
    state.view.x = (r.width - m.cols * cs() * zoom) / 2;
    state.view.y = (r.height - 28 - m.rows * cs() * zoom) / 2;
    updateZoomLabel();
    requestRender();
  }

  function zoomAt(factor, sx, sy) {
    const v = state.view;
    const z = clamp(v.zoom * factor, 0.05, 12);
    const f = z / v.zoom;
    v.x = sx - (sx - v.x) * f;
    v.y = sy - (sy - v.y) * f;
    v.zoom = z;
    updateZoomLabel();
    requestRender();
  }

  function zoomCenter(factor) {
    const r = stage.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  }

  function updateZoomLabel() { $('zoomLabel').textContent = Math.round(state.view.zoom * 100) + '%'; }

  // ------------------------------------------------------------ analysis

  function analysis() {
    if (analysisCache) return analysisCache;
    const m = state.maze;
    const a = { path: null, dist: null, maxDist: 0 };
    if (state.show.solution) a.path = K.solve(m);
    if (state.show.heat && m.start) {
      a.dist = K.bfs(m, m.start).dist;
      for (let i = 0; i < a.dist.length; i++) if (a.dist[i] > a.maxDist) a.maxDist = a.dist[i];
    }
    analysisCache = a;
    return a;
  }

  let statsTimer = 0;
  function scheduleStats() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(renderStats, anim ? 400 : 60);
  }

  function renderStats() {
    const m = state.maze;
    const s = K.stats(m);
    const path = K.solve(m);
    const rows = [
      ['Open cells', s.cells.toLocaleString()],
      ['Wall segments', s.walls.toLocaleString()],
      ['Dead ends', s.deadEnds.toLocaleString()],
      ['Junctions', s.junctions.toLocaleString()],
      ['Loops', s.loops.toLocaleString()],
      ['Separate areas', s.parts.toLocaleString(), s.parts > 1],
      ['Solution length', !m.start || !m.end ? 'place start and end' : path ? path.length + ' cells' : 'no route', !!(m.start && m.end && !path)],
    ];
    if (path && s.cells) rows.push(['Route covers', Math.round((path.length / s.cells) * 100) + '% of cells']);
    $('stats').innerHTML = rows.map(([k, v, bad]) => '<dt>' + k + '</dt><dd' + (bad ? ' class="bad"' : '') + '>' + v + '</dd>').join('');
  }

  // ------------------------------------------------------------ drawing

  function requestRender() {
    if (needsRender) return;
    needsRender = true;
    requestAnimationFrame(() => { needsRender = false; render(); });
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function penDash(pen, size) {
    if (pen.style === 'dashed') return [size * 0.42, size * 0.26];
    if (pen.style === 'dotted') return [0.001, size * 0.22];
    return [];
  }

  // Merge neighbouring edges with the same pen into longer runs, so dashes
  // and line ends look right and SVG output stays compact.
  function wallRuns(m, range) {
    const runs = [];
    const { c0, r0, c1, r1 } = range || { c0: 0, r0: 0, c1: m.cols - 1, r1: m.rows - 1 };
    for (let r = r0; r <= r1 + 1; r++) {
      let runPen = 0, runStart = 0;
      for (let c = c0; c <= c1 + 1; c++) {
        const p = c <= c1 ? m.h[r * m.cols + c] : 0;
        if (p !== runPen) {
          if (runPen) runs.push({ pen: runPen, x1: runStart, y1: r, x2: c, y2: r });
          runPen = p; runStart = c;
        }
      }
    }
    for (let c = c0; c <= c1 + 1; c++) {
      let runPen = 0, runStart = 0;
      for (let r = r0; r <= r1 + 1; r++) {
        const p = r <= r1 ? m.v[r * (m.cols + 1) + c] : 0;
        if (p !== runPen) {
          if (runPen) runs.push({ pen: runPen, x1: c, y1: runStart, x2: c, y2: r });
          runPen = p; runStart = r;
        }
      }
    }
    return runs;
  }

  let hatchCache = null;
  function hatchPattern(g, color) {
    const key = color;
    if (hatchCache && hatchCache.key === key && hatchCache.g === g) return hatchCache.pattern;
    const t = document.createElement('canvas');
    t.width = t.height = 12;
    const h = t.getContext('2d');
    h.strokeStyle = color;
    h.lineWidth = 1.2;
    h.beginPath();
    h.moveTo(0, 12); h.lineTo(12, 0);
    h.moveTo(-6, 6); h.lineTo(6, -6);
    h.moveTo(6, 18); h.lineTo(18, 6);
    h.stroke();
    const pattern = g.createPattern(t, 'repeat');
    hatchCache = { key, g, pattern };
    return pattern;
  }

  function heatColor(t) {
    const hue = 200 - 180 * t;
    return 'hsla(' + hue + ', 75%, 55%, 0.5)';
  }

  // Draw the maze onto g in world units (1 cell = size). `opts.range` limits
  // drawing to visible cells; `opts.exporting` skips editor-only overlays.
  function drawMaze(g, size, opts) {
    const m = state.maze, L = state.look;
    const range = opts.range || { c0: 0, r0: 0, c1: m.cols - 1, r1: m.rows - 1 };
    const { c0, r0, c1, r1 } = range;
    const W_ = m.cols * size, H_ = m.rows * size;

    g.fillStyle = L.paper;
    g.fillRect(0, 0, W_, H_);

    // painted cells
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const f = m.fill[r * m.cols + c];
        if (f && m.fillColors[f]) { g.fillStyle = m.fillColors[f]; g.fillRect(c * size, r * size, size, size); }
      }
    }

    const a = analysis();
    if (a.dist && a.maxDist > 0) {
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const d = a.dist[r * m.cols + c];
          if (d < 0) continue;
          g.fillStyle = heatColor(d / a.maxDist);
          g.fillRect(c * size, r * size, size, size);
        }
      }
    }

    // grid
    if (L.showGrid) {
      g.strokeStyle = L.grid;
      g.lineWidth = Math.max(size * 0.03, opts.hair || 0);
      g.setLineDash([]);
      g.beginPath();
      for (let c = c0; c <= c1 + 1; c++) { g.moveTo(c * size, r0 * size); g.lineTo(c * size, (r1 + 1) * size); }
      for (let r = r0; r <= r1 + 1; r++) { g.moveTo(c0 * size, r * size); g.lineTo((c1 + 1) * size, r * size); }
      g.stroke();
    }

    // voids
    if (L.voidStyle !== 'hidden' || !opts.exporting) {
      const surround = opts.surround;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (!m.voids[r * m.cols + c]) continue;
          if (L.voidStyle === 'solid') g.fillStyle = L.grid;
          else if (L.voidStyle === 'hidden') g.fillStyle = surround;
          else g.fillStyle = L.paper;
          g.fillRect(c * size - 0.5, r * size - 0.5, size + 1, size + 1);
          if (L.voidStyle === 'hatch') {
            g.fillStyle = hatchPattern(g, L.grid);
            g.fillRect(c * size, r * size, size, size);
          }
        }
      }
    }

    // dead ends
    if (state.show.dead) {
      g.fillStyle = L.path;
      g.globalAlpha = 0.55;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (m.isVoid(c, r) || K.degree(m, c, r) !== 1) continue;
          if ((m.start && m.start.c === c && m.start.r === r) || (m.end && m.end.c === c && m.end.r === r)) continue;
          g.beginPath();
          g.arc((c + 0.5) * size, (r + 0.5) * size, size * 0.14, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    }

    // solution
    if (a.path && a.path.length > 1) {
      g.strokeStyle = L.path;
      g.lineWidth = size * 0.22;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.setLineDash([]);
      g.beginPath();
      a.path.forEach((i, k) => {
        const x = ((i % m.cols) + 0.5) * size, y = (((i / m.cols) | 0) + 0.5) * size;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.stroke();
    }

    // walls, batched by pen. Small sheets draw every run so dash patterns
    // stay put while panning; huge ones only draw what is visible.
    const runs = wallRuns(m, m.cols * m.rows > 40000 ? range : null);
    const byPen = new Map();
    for (const run of runs) {
      if (!byPen.has(run.pen)) byPen.set(run.pen, []);
      byPen.get(run.pen).push(run);
    }
    const base = L.thickness * size;
    for (const [penId, list] of byPen) {
      const pen = state.pens[penId - 1] || state.pens[0];
      const lw = Math.max(base * pen.width, opts.hair || 0);
      g.strokeStyle = pen.color;
      g.lineWidth = lw;
      g.lineCap = pen.style === 'dotted' ? 'round' : L.cap;
      g.lineJoin = 'round';
      g.setLineDash(penDash(pen, size).map((d) => d));
      g.beginPath();
      for (const r of list) { g.moveTo(r.x1 * size, r.y1 * size); g.lineTo(r.x2 * size, r.y2 * size); }
      g.stroke();
    }
    g.setLineDash([]);

    // markers
    const marker = (p, color, isEnd) => {
      if (!p) return;
      const x = (p.c + 0.5) * size, y = (p.r + 0.5) * size, rad = size * 0.3;
      g.fillStyle = color;
      g.beginPath();
      if (isEnd) {
        const s = rad * 1.6;
        if (g.roundRect) g.roundRect(x - s / 2, y - s / 2, s, s, s * 0.22); else g.rect(x - s / 2, y - s / 2, s, s);
      } else {
        g.arc(x, y, rad, 0, Math.PI * 2);
      }
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = '600 ' + Math.round(size * 0.36) + 'px ' + 'IBM Plex Sans, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(isEnd ? 'E' : 'S', x, y + size * 0.02);
    };
    marker(m.start, L.start, false);
    marker(m.end, L.end, true);
  }

  function drawRulers(g, size, color) {
    const m = state.maze;
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1 / state.view.zoom, size * 0.03);
    g.font = '500 ' + Math.max(7, size * 0.36) + 'px IBM Plex Mono, ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const step = size * state.view.zoom < 14 ? 10 : 5;
    const off = size * 0.75;
    g.beginPath();
    for (let c = 0; c <= m.cols; c++) {
      const len = c % step === 0 ? size * 0.35 : size * 0.15;
      g.moveTo(c * size, -size * 0.1); g.lineTo(c * size, -size * 0.1 - len);
    }
    for (let r = 0; r <= m.rows; r++) {
      const len = r % step === 0 ? size * 0.35 : size * 0.15;
      g.moveTo(-size * 0.1, r * size); g.lineTo(-size * 0.1 - len, r * size);
    }
    g.stroke();
    for (let c = step; c <= m.cols; c += step) g.fillText(String(c), (c - 0.5) * size, -off - size * 0.2);
    g.textAlign = 'right';
    for (let r = step; r <= m.rows; r += step) g.fillText(String(r), -off + size * 0.05, (r - 0.5) * size);
    g.textAlign = 'left';
    g.fillText(m.cols + ' × ' + m.rows + ' cells', 0, (m.rows + 0.7) * size);
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    const v = state.view, size = cs(), m = state.maze;
    const surround = cssVar('--bg') || '#e4e9ec';
    const muted = cssVar('--muted') || '#5a6975';
    const accent = cssVar('--accent') || '#0b7593';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = surround;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.x, dpr * v.y);

    // Only draw cells that are on screen.
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const range = {
      c0: clamp(Math.floor(-v.x / v.zoom / size) - 1, 0, m.cols - 1),
      r0: clamp(Math.floor(-v.y / v.zoom / size) - 1, 0, m.rows - 1),
      c1: clamp(Math.ceil((cw - v.x) / v.zoom / size) + 1, 0, m.cols - 1),
      r1: clamp(Math.ceil((ch - v.y) / v.zoom / size) + 1, 0, m.rows - 1),
    };

    // sheet shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 18 / v.zoom;
    ctx.shadowOffsetY = 3 / v.zoom;
    ctx.fillStyle = state.look.paper;
    ctx.fillRect(0, 0, m.cols * size, m.rows * size);
    ctx.restore();

    const hair = 1 / (v.zoom * dpr);
    drawMaze(ctx, size, { range, hair, surround });
    if (state.look.showRulers) drawRulers(ctx, size, muted);

    // generation cursor
    if (anim && anim.cursor >= 0) {
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.6;
      ctx.fillRect((anim.cursor % m.cols) * size, ((anim.cursor / m.cols) | 0) * size, size, size);
      ctx.globalAlpha = 1;
    }

    // selection
    const sel = stroke && stroke.tool === 'select' && stroke.rect ? stroke.rect : state.selection;
    if (sel) {
      const x = sel.c0 * size, y = sel.r0 * size, w = (sel.c1 - sel.c0 + 1) * size, h = (sel.r1 - sel.r0 + 1) * size;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 / v.zoom;
      ctx.setLineDash([6 / v.zoom, 4 / v.zoom]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    drawToolPreview(size, accent);
  }

  function drawEdges(edges, size, color, width, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    for (const e of edges) {
      if (e.k === 'h') { ctx.moveTo(e.c * size, e.r * size); ctx.lineTo((e.c + 1) * size, e.r * size); }
      else { ctx.moveTo(e.c * size, e.r * size); ctx.lineTo(e.c * size, (e.r + 1) * size); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawToolPreview(size, accent) {
    const z = state.view.zoom;
    const t = state.tool;
    if (stroke && (stroke.tool === 'line' || stroke.tool === 'rect') && stroke.preview) {
      const pen = state.pens[state.pen - 1];
      drawEdges(stroke.preview, size, stroke.erase ? accent : pen.color, Math.max(state.look.thickness * size * pen.width, 2 / z), stroke.erase ? [4 / z, 4 / z] : null);
      return;
    }
    if (!hover || stroke || spaceDown || t === 'hand') return;
    ctx.globalAlpha = 0.5;
    if (t === 'wall' || t === 'erase') {
      drawEdges([nearestEdge(hover)], size, accent, Math.max(state.look.thickness * size, 3 / z));
    } else if (t === 'line' || t === 'rect') {
      const p = nearestCorner(hover);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(p.x * size, p.y * size, Math.max(size * 0.12, 3 / z), 0, Math.PI * 2);
      ctx.fill();
    } else {
      const c = cellAt(hover);
      if (c) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2 / z;
        ctx.strokeRect(c.c * size, c.r * size, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ pointer input

  const pointers = new Map();
  let pinch = null;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // Second finger: switch to pinch zoom and cancel any stroke.
      cancelStroke();
      const [p1, p2] = [...pointers.values()];
      pinch = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
      return;
    }
    if (pointers.size > 2) return;
    finishAnimation();
    const p = toGrid(e.clientX, e.clientY);
    const panning = e.button === 1 || spaceDown || state.tool === 'hand';
    if (panning) {
      stroke = { pan: true, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
      updateCursor();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const invert = e.shiftKey || e.button === 2;
    beginStroke(p, invert);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const rect = canvas.getBoundingClientRect();
      state.view.x += mid.x - pinch.mid.x;
      state.view.y += mid.y - pinch.mid.y;
      if (pinch.dist > 0) zoomAt(dist / pinch.dist, mid.x - rect.left, mid.y - rect.top);
      pinch = { dist, mid };
      requestRender();
      return;
    }
    const p = toGrid(e.clientX, e.clientY);
    hover = p;
    showCoords(p);
    if (stroke && stroke.pan) {
      state.view.x = stroke.vx + e.clientX - stroke.sx;
      state.view.y = stroke.vy + e.clientY - stroke.sy;
      requestRender();
      return;
    }
    if (stroke) moveStroke(p);
    requestRender();
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (stroke) endStroke(stroke.pan ? null : toGrid(e.clientX, e.clientY));
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; cancelStroke(); });
  canvas.addEventListener('pointerleave', () => { hover = null; $('coords').textContent = '—'; requestRender(); });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(-delta * 0.0018), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  function showCoords(p) {
    const c = cellAt(p);
    $('coords').textContent = c ? 'col ' + (c.c + 1) + ' · row ' + (c.r + 1) : '—';
  }

  function beginStroke(p, invert) {
    const t = state.tool;
    const s = { tool: t, erase: invert, changed: false, start: p };
    stroke = s;
    if (t === 'select') {
      const c = cellAt(clampToGrid(p));
      s.anchor = c;
      s.rect = c ? cellRect(c, c) : null;
      s.moved = false;
      return;
    }
    pushHistory();
    if (t === 'wall' || t === 'erase') {
      s.last = nearestCorner(p);
      s.downEdge = nearestEdge(p);
      s.drew = false;
    } else if (t === 'line' || t === 'rect') {
      s.a = nearestCorner(p);
      s.preview = [];
    } else {
      s.lastCell = cellAt(p);
      if (s.lastCell) applyCellTool(s.lastCell, null);
    }
    requestRender();
  }

  function clampToGrid(p) {
    const m = state.maze;
    return { x: clamp(p.x, 0, m.cols - 0.001), y: clamp(p.y, 0, m.rows - 0.001) };
  }

  function moveStroke(p) {
    const s = stroke, t = s.tool;
    if (t === 'select') {
      const c = cellAt(clampToGrid(p));
      if (c && s.anchor) { s.rect = cellRect(s.anchor, c); s.moved = s.moved || c.c !== s.anchor.c || c.r !== s.anchor.r; }
      return;
    }
    if (t === 'wall' || t === 'erase') {
      const corner = nearestCorner(p);
      if (corner.x === s.last.x && corner.y === s.last.y) return;
      const val = t === 'erase' || s.erase ? 0 : state.pen;
      for (const e of cornerPath(s.last, corner)) if (edgeSet(e, val)) s.changed = true;
      s.last = corner;
      s.drew = true;
      if (s.changed) changed();
    } else if (t === 'line' || t === 'rect') {
      const b = nearestCorner(p);
      s.preview = t === 'line' ? cornerPath(s.a, lineEnd(s.a, b)) : rectEdges(s.a, b);
    } else {
      const c = cellAt(p);
      if (!c || !s.lastCell || (c.c === s.lastCell.c && c.r === s.lastCell.r)) {
        if (c && !s.lastCell) { s.lastCell = c; applyCellTool(c, null); }
        return;
      }
      const steps = cellPath(s.lastCell, c);
      for (const st of steps) applyCellTool({ c: st.c + DC[st.d], r: st.r + DR[st.d] }, st);
      s.lastCell = c;
    }
  }

  function endStroke(p) {
    const s = stroke;
    stroke = null;
    updateCursor();
    if (!s || s.pan) { requestRender(); return; }
    const t = s.tool;
    if (t === 'select') {
      state.selection = s.moved ? s.rect : null;
      updateSelectionUI();
      requestRender();
      return;
    }
    if (t === 'wall' || t === 'erase') {
      if (!s.drew) {
        const e = s.downEdge;
        let val;
        if (t === 'erase' || s.erase) val = 0;
        else val = edgeGet(e) === state.pen ? 0 : state.pen;
        if (edgeSet(e, val)) s.changed = true;
      }
    } else if (t === 'line' || t === 'rect') {
      if (p) {
        const b = nearestCorner(p);
        const edges = t === 'line' ? cornerPath(s.a, lineEnd(s.a, b)) : rectEdges(s.a, b);
        const val = s.erase ? 0 : state.pen;
        for (const e of edges) if (edgeSet(e, val)) s.changed = true;
      }
    }
    if (!s.changed) dropLastHistory();
    else changed();
    requestRender();
  }

  function cancelStroke() {
    if (!stroke) return;
    const s = stroke;
    stroke = null;
    if (!s.pan && s.tool !== 'select') {
      if (s.changed) state.maze = history.undo[history.undo.length - 1] || state.maze;
      dropLastHistory();
      changed();
    }
    updateCursor();
  }

  // Cell tools. `step` is the move that reached this cell ({c, r, d} of the
  // previous cell), or null for the first cell of a stroke.
  function applyCellTool(cell, step) {
    const s = stroke, m = state.maze, t = s.tool;
    const i = cell.r * m.cols + cell.c;
    let did = false;
    if (t === 'carve') {
      if (step && !m.isVoid(cell.c, cell.r) && !m.isVoid(step.c, step.r)) {
        const val = s.erase ? state.pen : 0;
        if (m.getWall(step.c, step.r, step.d) !== val) { m.setWall(step.c, step.r, step.d, val); did = true; }
      }
    } else if (t === 'void') {
      const val = s.erase ? 0 : 1;
      if (m.voids[i] !== val) {
        m.voids[i] = val;
        if (val) {
          m.fill[i] = 0;
          if (m.start && m.start.c === cell.c && m.start.r === cell.r) m.start = null;
          if (m.end && m.end.c === cell.c && m.end.r === cell.r) m.end = null;
        }
        K.fixVoidEdges(m, cell.c, cell.r, state.pen);
        did = true;
      }
    } else if (t === 'paint') {
      const val = s.erase ? 0 : m.fillIndexFor(state.look.paint);
      if (!m.voids[i] && m.fill[i] !== val) { m.fill[i] = val; did = true; }
    } else if (t === 'flood') {
      if (!step) did = floodPaint(cell, s.erase ? 0 : m.fillIndexFor(state.look.paint));
    } else if (t === 'start' || t === 'end') {
      const val = s.erase || m.isVoid(cell.c, cell.r) ? null : { c: cell.c, r: cell.r };
      const cur = m[t];
      if (s.erase && !step) { if (cur) { m[t] = null; did = true; } }
      else if (val && (!cur || cur.c !== val.c || cur.r !== val.r)) { m[t] = val; did = true; }
    }
    if (did) { s.changed = true; changed(); }
  }

  function floodPaint(cell, val) {
    const m = state.maze;
    if (m.isVoid(cell.c, cell.r)) return false;
    const { dist } = K.bfs(m, cell);
    let did = false;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] >= 0 && m.fill[i] !== val) { m.fill[i] = val; did = true; }
    }
    return did;
  }

  // ------------------------------------------------------------ keyboard

  function typingTarget(e) {
    const el = e.target;
    if (!el) return false;
    if (el.tagName === 'INPUT') return ['text', 'number', 'search'].includes(el.type);
    return el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  window.addEventListener('keydown', (e) => {
    if (typingTarget(e)) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); saveDraft(); return; }
    if (mod || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; updateCursor(); requestRender(); } return; }
    if (e.key === 'Escape') { state.selection = null; updateSelectionUI(); requestRender(); return; }
    if (k === 'f') { fitView(); return; }
    if (k === 'g') { generate(); return; }
    if (k === '+' || k === '=') { zoomCenter(1.25); return; }
    if (k === '-' || k === '_') { zoomCenter(0.8); return; }
    if (/^[1-9]$/.test(k) && state.pens[+k - 1]) { setPen(+k); return; }
    if (TOOL_BY_KEY[k]) setTool(TOOL_BY_KEY[k]);
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; updateCursor(); requestRender(); }
  });

  window.addEventListener('blur', () => { spaceDown = false; updateCursor(); });

  // ------------------------------------------------------------ generation

  function fullRegion() { return { c0: 0, r0: 0, c1: state.maze.cols - 1, r1: state.maze.rows - 1 }; }

  function generate() {
    finishAnimation();
    pushHistory();
    const typed = $('seedInput').value.trim();
    const seed = typed || K.randomSeed();
    state.lastSeed = seed;
    const rng = K.makeRng(seed + ':' + state.gen.algorithm);
    const region = state.selection || fullRegion();
    const g = K.makeContext(state.maze, region, rng, state.pen);
    K.prepare(g);
    const algo = K.ALGORITHMS[state.gen.algorithm] || K.ALGORITHMS.backtracker;
    const iter = algo.run(g);
    const finish = () => {
      K.connectAll(g);
      K.braid(g, state.gen.braid / 100);
      // A partial regeneration keeps the start and end the user already has.
      if (state.selection) K.stitchRegion(g);
      else K.placeEnds(g, state.gen.borderEnds);
      anim = null;
      changed();
      showSeedNote(seed, !typed);
      $('genBtn').textContent = generateLabel();
    };
    if (!state.gen.animate) {
      while (!iter.next().done);
      finish();
      return;
    }
    anim = { iter, finish, cursor: -1 };
    $('genBtn').textContent = 'Finish now';
    const tick = () => {
      if (!anim || anim.iter !== iter) return;
      for (let k = 0; k < state.gen.speed; k++) {
        const r = iter.next();
        if (r.done) { anim.finish(); return; }
        anim.cursor = r.value;
      }
      changed();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function finishAnimation() {
    if (!anim) return;
    const a = anim;
    while (!a.iter.next().done);
    a.finish();
  }

  function showSeedNote(seed, wasRandom) {
    const note = $('seedNote');
    note.textContent = 'Seed ' + seed + ' · ' + (K.ALGORITHMS[state.gen.algorithm] || {}).name + ' ';
    if (wasRandom) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Keep this seed';
      b.addEventListener('click', () => { $('seedInput').value = seed; note.textContent = 'Seed ' + seed + ' kept. Generate again for the same maze.'; scheduleSave(); });
      note.appendChild(b);
    }
  }

  function generateLabel() { return state.selection ? 'Generate in selection' : 'Generate maze'; }

  function updateSelectionUI() {
    if (!anim) $('genBtn').textContent = generateLabel();
    const sel = state.selection;
    $('sheetLabel').textContent = 'Sheet ' + state.maze.cols + ' × ' + state.maze.rows +
      (sel ? ' · selection ' + (sel.c1 - sel.c0 + 1) + ' × ' + (sel.r1 - sel.r0 + 1) : '');
  }

  // ------------------------------------------------------------ bulk wall edits

  // Visit every edge touching a cell in the region.
  function forRegionEdges(region, fn) {
    const m = state.maze;
    const { c0, r0, c1, r1 } = region;
    for (let r = r0; r <= r1 + 1; r++) for (let c = c0; c <= c1; c++) fn(m.h, r * m.cols + c, { k: 'h', c, r });
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1 + 1; c++) fn(m.v, r * (m.cols + 1) + c, { k: 'v', c, r });
  }

  function edgeTouchesWalkable(e) {
    const m = state.maze;
    if (e.k === 'h') return !m.isVoid(e.c, e.r - 1) || !m.isVoid(e.c, e.r);
    return !m.isVoid(e.c - 1, e.r) || !m.isVoid(e.c, e.r);
  }

  function bulk(fn, msg) {
    finishAnimation();
    pushHistory();
    const region = state.selection || fullRegion();
    let n = 0;
    forRegionEdges(region, (arr, i, e) => { const v = fn(arr[i], e); if (v !== arr[i]) { arr[i] = v; n++; } });
    if (!n) { dropLastHistory(); toast('Nothing to change'); return; }
    changed();
    if (msg) toast(msg.replace('{n}', n.toLocaleString()));
  }

  function addBorder() {
    const m = state.maze;
    bulk((cur, e) => {
      if (!edgeTouchesWalkable(e)) return cur;
      let a, b;
      if (e.k === 'h') { a = m.isVoid(e.c, e.r - 1); b = m.isVoid(e.c, e.r); }
      else { a = m.isVoid(e.c - 1, e.r); b = m.isVoid(e.c, e.r); }
      if (a !== b && !cur) return state.pen;
      return cur;
    }, 'Added {n} border walls');
  }

  function newMaze(cols, rows, mode) {
    finishAnimation();
    pushHistory();
    const m = new Maze(cols, rows);
    if (mode === 'grid') { m.h.fill(state.pen); m.v.fill(state.pen); }
    else {
      for (let c = 0; c < cols; c++) { m.h[c] = state.pen; m.h[rows * cols + c] = state.pen; }
      for (let r = 0; r < rows; r++) { m.v[r * (cols + 1)] = state.pen; m.v[r * (cols + 1) + cols] = state.pen; }
    }
    state.maze = m;
    state.selection = null;
    afterResize();
  }

  function resizeMaze(cols, rows) {
    finishAnimation();
    if (cols === state.maze.cols && rows === state.maze.rows) { toast('Sheet is already ' + cols + ' × ' + rows); return; }
    pushHistory();
    const m = state.maze.resized(cols, rows);
    // Close the new outer edge.
    for (let c = 0; c < cols; c++) {
      if (!m.isVoid(c, 0) && !m.h[c]) m.h[c] = state.pen;
      if (!m.isVoid(c, rows - 1) && !m.h[rows * cols + c]) m.h[rows * cols + c] = state.pen;
    }
    for (let r = 0; r < rows; r++) {
      if (!m.isVoid(0, r) && !m.v[r * (cols + 1)]) m.v[r * (cols + 1)] = state.pen;
      if (!m.isVoid(cols - 1, r) && !m.v[r * (cols + 1) + cols]) m.v[r * (cols + 1) + cols] = state.pen;
    }
    state.maze = m;
    state.selection = null;
    afterResize();
  }

  function afterResize() {
    syncSizeInputs();
    updateSelectionUI();
    fitView();
    changed();
  }

  function readSize() {
    const cols = clamp(parseInt($('colsInput').value, 10) || 2, 2, MAX_SIZE);
    const rows = clamp(parseInt($('rowsInput').value, 10) || 2, 2, MAX_SIZE);
    $('colsInput').value = cols;
    $('rowsInput').value = rows;
    return [cols, rows];
  }

  function syncSizeInputs() {
    $('colsInput').value = state.maze.cols;
    $('rowsInput').value = state.maze.rows;
    updateSelectionUI();
  }

  // ------------------------------------------------------------ pens

  function setPen(id) {
    state.pen = id;
    renderPens();
    scheduleSave();
  }

  function penCounts() {
    const m = state.maze, counts = new Array(state.pens.length + 1).fill(0);
    for (let i = 0; i < m.h.length; i++) counts[m.h[i]]++;
    for (let i = 0; i < m.v.length; i++) counts[m.v[i]]++;
    return counts;
  }

  function drawPenSample(cv, pen) {
    const dpr = window.devicePixelRatio || 1;
    cv.width = 54 * dpr; cv.height = 18 * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = state.look.paper;
    g.fillRect(0, 0, 54, 18);
    g.strokeStyle = pen.color;
    g.lineWidth = Math.max(1, 14 * state.look.thickness * pen.width);
    g.lineCap = pen.style === 'dotted' ? 'round' : state.look.cap;
    g.setLineDash(penDash(pen, 14));
    g.beginPath();
    g.moveTo(8, 9); g.lineTo(46, 9);
    g.stroke();
  }

  let editingPen = 0;

  function renderPens() {
    const ul = $('pens');
    ul.innerHTML = '';
    const counts = penCounts();
    state.pens.forEach((pen, k) => {
      const id = k + 1;
      const li = document.createElement('li');
      li.className = 'pen' + (id === state.pen ? ' active' : '');
      li.dataset.pen = id;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = id;
      const cv = document.createElement('canvas');
      drawPenSample(cv, pen);
      const name = document.createElement('input');
      name.className = 'name';
      name.value = pen.name;
      name.setAttribute('aria-label', 'Pen ' + id + ' name');
      name.id = 'pen-name-' + id;
      name.addEventListener('input', () => { pen.name = name.value; scheduleSave(); });
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = counts[id] ? counts[id].toLocaleString() : '';
      count.title = 'Walls drawn with this pen';
      li.append(num, cv, name, count);
      li.addEventListener('click', (e) => {
        if (e.target.closest('.pen-edit')) return;
        if (state.pen === id && e.target !== name) editingPen = editingPen === id ? 0 : id;
        else editingPen = id;
        setPen(id);
      });
      if (editingPen === id) li.appendChild(penEditor(pen, id, cv));
      ul.appendChild(li);
    });
    $('addPenBtn').disabled = state.pens.length >= 9;
  }

  function renderPenCounts() {
    const counts = penCounts();
    document.querySelectorAll('.pen').forEach((li) => {
      const c = li.querySelector('.count');
      const n = counts[+li.dataset.pen];
      if (c) c.textContent = n ? n.toLocaleString() : '';
    });
  }

  function penEditor(pen, id, sample) {
    const box = document.createElement('div');
    box.className = 'pen-edit';
    const color = document.createElement('input');
    color.type = 'color';
    color.value = pen.color;
    color.id = 'pen-color-' + id;
    color.setAttribute('aria-label', 'Colour');
    const width = document.createElement('input');
    width.type = 'number';
    width.min = '0.2'; width.max = '6'; width.step = '0.1';
    width.value = pen.width;
    width.id = 'pen-width-' + id;
    width.title = 'Width relative to the base thickness';
    width.setAttribute('aria-label', 'Width multiplier');
    const style = document.createElement('select');
    style.id = 'pen-style-' + id;
    style.setAttribute('aria-label', 'Line style');
    for (const [v, label] of [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = label; style.appendChild(o);
    }
    style.value = pen.style;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn ghost danger';
    del.textContent = 'Delete';
    del.disabled = state.pens.length <= 1;
    del.title = 'Delete this pen. Its walls move to pen 1.';
    const update = () => {
      pen.color = color.value;
      pen.width = clamp(parseFloat(width.value) || 1, 0.2, 6);
      pen.style = style.value;
      drawPenSample(sample, pen);
      requestRender();
      scheduleSave();
    };
    color.addEventListener('input', update);
    width.addEventListener('input', update);
    style.addEventListener('change', update);
    del.addEventListener('click', () => deletePen(id));
    box.append(color, width, style, del);
    return box;
  }

  function addPen() {
    if (state.pens.length >= 9) return;
    const hues = ['#6b4fa3', '#2a7f9e', '#a3683a', '#8a2f5c', '#4f6b2a'];
    state.pens.push({ name: 'Pen ' + (state.pens.length + 1), color: hues[state.pens.length % hues.length], width: 1, style: 'solid' });
    editingPen = state.pens.length;
    setPen(state.pens.length);
  }

  function deletePen(id) {
    if (state.pens.length <= 1) return;
    finishAnimation();
    const remap = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === id) arr[i] = 1;
        else if (arr[i] > id) arr[i]--;
      }
    };
    remap(state.maze.h);
    remap(state.maze.v);
    // History snapshots refer to pen ids too; keep them consistent.
    for (const m of history.undo.concat(history.redo)) { remap(m.h); remap(m.v); }
    state.pens.splice(id - 1, 1);
    editingPen = 0;
    state.pen = clamp(state.pen > id ? state.pen - 1 : state.pen, 1, state.pens.length);
    renderPens();
    changed();
  }

  // ------------------------------------------------------------ paper & look

  function applyPaper(key) {
    const p = PAPERS[key];
    if (!p) return;
    state.look.paperKey = key;
    state.look.paper = p.paper;
    state.look.grid = p.grid;
    state.pens[0].color = p.ink;
    if (state.pens[1]) state.pens[1].color = p.ink;
    syncLookInputs();
    renderPens();
    requestRender();
    scheduleSave();
  }

  function syncLookInputs() {
    const L = state.look;
    $('paperSelect').value = PAPERS[L.paperKey] ? L.paperKey : 'custom';
    $('paperColor').value = L.paper;
    $('gridColor').value = L.grid;
    $('paintColor').value = L.paint;
    $('pathColor').value = L.path;
    $('startColor').value = L.start;
    $('endColor').value = L.end;
    $('gridToggle').checked = L.showGrid;
    $('rulerToggle').checked = L.showRulers;
    $('voidSelect').value = L.voidStyle;
    $('scaleSelect').value = String(L.exportScale);
    $('cellInput').value = L.cellSize;
    $('cellOut').textContent = L.cellSize + 'px';
    $('thickInput').value = Math.round(L.thickness * 100);
    $('thickOut').textContent = Math.round(L.thickness * 100) + '%';
    $('capSelect').value = L.cap;
  }

  // ------------------------------------------------------------ export

  function exportRect() {
    const m = state.maze, size = cs() * state.look.exportScale;
    const margin = size;
    return { size, margin, w: m.cols * size + margin * 2, h: m.rows * size + margin * 2 };
  }

  function exportPNG() {
    finishAnimation();
    const { size, margin, w, h } = exportRect();
    if (w * h > 16384 * 16384 || w > 16384 || h > 16384) { toast('That is too large for a PNG. Lower the export scale or cell size.'); return; }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = state.look.paper;
    g.fillRect(0, 0, w, h);
    g.translate(margin, margin);
    drawMaze(g, size, { exporting: true, surround: state.look.paper });
    c.toBlob((blob) => {
      if (!blob) { toast('The browser could not create the image.'); return; }
      saveFile(fileBase() + '.png', blob, 'image/png');
    }, 'image/png');
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  function exportSVG() {
    finishAnimation();
    const m = state.maze, L = state.look, size = cs();
    const margin = size, w = m.cols * size + margin * 2, h = m.rows * size + margin * 2;
    const f = (n) => +n.toFixed(2);
    const out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">');
    out.push('<title>' + esc(m.cols + ' × ' + m.rows + ' maze') + '</title>');
    out.push('<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="' + L.grid + '" stroke-width="1.5"/></pattern></defs>');
    out.push('<rect width="100%" height="100%" fill="' + L.paper + '"/>');
    out.push('<g transform="translate(' + margin + ' ' + margin + ')">');

    const cellRects = (test, fill) => {
      const parts = [];
      for (let r = 0; r < m.rows; r++) {
        // merge horizontal runs of matching cells
        let c = 0;
        while (c < m.cols) {
          const k = test(c, r);
          if (k === null) { c++; continue; }
          let c2 = c + 1;
          while (c2 < m.cols && test(c2, r) === k) c2++;
          parts.push('<rect x="' + c * size + '" y="' + r * size + '" width="' + (c2 - c) * size + '" height="' + size + '" fill="' + fill(k) + '"/>');
          c = c2;
        }
      }
      return parts.join('');
    };

    out.push('<g id="paint">' + cellRects((c, r) => { const i = r * m.cols + c; return m.fill[i] && !m.voids[i] ? m.fill[i] : null; }, (k) => m.fillColors[k]) + '</g>');

    const a = analysis();
    if (a.dist && a.maxDist > 0) {
      out.push('<g id="distance">' + cellRects((c, r) => { const d = a.dist[r * m.cols + c]; return d >= 0 ? d : null; }, (d) => heatColor(d / a.maxDist)) + '</g>');
    }

    if (L.showGrid) {
      const d = [];
      for (let c = 0; c <= m.cols; c++) d.push('M' + c * size + ' 0V' + m.rows * size);
      for (let r = 0; r <= m.rows; r++) d.push('M0 ' + r * size + 'H' + m.cols * size);
      out.push('<path id="grid" d="' + d.join('') + '" stroke="' + L.grid + '" stroke-width="' + f(size * 0.03) + '" fill="none"/>');
    }

    if (L.voidStyle !== 'hidden') {
      const fill = L.voidStyle === 'solid' ? L.grid : 'url(#hatch)';
      out.push('<g id="void">' + cellRects((c, r) => (m.voids[r * m.cols + c] ? 1 : null), () => fill) + '</g>');
    }

    if (state.show.dead) {
      const dots = [];
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        if (m.isVoid(c, r) || K.degree(m, c, r) !== 1) continue;
        if ((m.start && m.start.c === c && m.start.r === r) || (m.end && m.end.c === c && m.end.r === r)) continue;
        dots.push('<circle cx="' + f((c + 0.5) * size) + '" cy="' + f((r + 0.5) * size) + '" r="' + f(size * 0.14) + '"/>');
      }
      out.push('<g id="dead-ends" fill="' + L.path + '" fill-opacity="0.55">' + dots.join('') + '</g>');
    }

    if (a.path && a.path.length > 1) {
      const pts = a.path.map((i) => f(((i % m.cols) + 0.5) * size) + ',' + f((((i / m.cols) | 0) + 0.5) * size)).join(' ');
      out.push('<polyline id="solution" points="' + pts + '" fill="none" stroke="' + L.path + '" stroke-width="' + f(size * 0.22) + '" stroke-linecap="round" stroke-linejoin="round"/>');
    }

    const runs = wallRuns(m);
    state.pens.forEach((pen, k) => {
      const list = runs.filter((r) => r.pen === k + 1);
      if (!list.length) return;
      const d = list.map((r) => 'M' + r.x1 * size + ' ' + r.y1 * size + (r.x1 === r.x2 ? 'V' + r.y2 * size : 'H' + r.x2 * size)).join('');
      const dash = penDash(pen, size);
      out.push('<path id="pen-' + (k + 1) + '" data-name="' + esc(pen.name) + '" d="' + d + '" fill="none" stroke="' + pen.color +
        '" stroke-width="' + f(L.thickness * size * pen.width) + '" stroke-linecap="' + (pen.style === 'dotted' ? 'round' : L.cap) +
        '" stroke-linejoin="round"' + (dash.length ? ' stroke-dasharray="' + dash.map(f).join(' ') + '"' : '') + '/>');
    });

    const mark = (p, color, isEnd) => {
      if (!p) return '';
      const x = (p.c + 0.5) * size, y = (p.r + 0.5) * size, rad = size * 0.3;
      const shape = isEnd
        ? '<rect x="' + f(x - rad * 0.8) + '" y="' + f(y - rad * 0.8) + '" width="' + f(rad * 1.6) + '" height="' + f(rad * 1.6) + '" rx="' + f(rad * 0.35) + '" fill="' + color + '"/>'
        : '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(rad) + '" fill="' + color + '"/>';
      return shape + '<text x="' + f(x) + '" y="' + f(y) + '" fill="#fff" font-family="IBM Plex Sans, Arial, sans-serif" font-weight="600" font-size="' + f(size * 0.36) + '" text-anchor="middle" dominant-baseline="central">' + (isEnd ? 'E' : 'S') + '</text>';
    };
    out.push('<g id="markers">' + mark(m.start, L.start, false) + mark(m.end, L.end, true) + '</g>');
    out.push('</g></svg>');
    saveFile(fileBase() + '.svg', out.join('\n'), 'image/svg+xml');
  }

  function fileBase() {
    const m = state.maze;
    return 'maze-' + m.cols + 'x' + m.rows + (state.lastSeed ? '-' + state.lastSeed : '');
  }

  function draftJSON() {
    return {
      app: 'maze-builder',
      version: 1,
      maze: state.maze.toJSON(),
      pens: state.pens,
      pen: state.pen,
      look: state.look,
      gen: state.gen,
      show: state.show,
      seed: $('seedInput').value,
    };
  }

  function loadDraft(o) {
    if (!o || o.app !== 'maze-builder' || !o.maze) throw new Error('This file is not a Maze Builder draft');
    const maze = Maze.fromJSON(o.maze);
    const pens = Array.isArray(o.pens) && o.pens.length
      ? o.pens.slice(0, 9).map((p) => ({
        name: String(p.name || 'Pen'),
        color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#1b2732',
        width: clamp(+p.width || 1, 0.2, 6),
        style: ['solid', 'dashed', 'dotted'].includes(p.style) ? p.style : 'solid',
      }))
      : defaultPens();
    // Walls pointing at a missing pen fall back to pen 1.
    const fix = (arr) => { for (let i = 0; i < arr.length; i++) if (arr[i] > pens.length) arr[i] = 1; };
    fix(maze.h); fix(maze.v);
    state.maze = maze;
    state.pens = pens;
    state.pen = clamp(o.pen | 0 || 1, 1, pens.length);
    state.look = Object.assign(defaultLook(), o.look || {});
    state.look.cellSize = clamp(+state.look.cellSize || 28, 8, 64);
    state.look.thickness = clamp(+state.look.thickness || 0.14, 0.02, 0.6);
    state.gen = Object.assign(state.gen, o.gen || {});
    state.show = Object.assign({ solution: false, heat: false, dead: false }, o.show || {});
    $('seedInput').value = o.seed || '';
    state.selection = null;
  }

  function saveDraft() {
    saveFile(fileBase() + '.json', JSON.stringify(draftJSON(), null, 1), 'application/json');
  }

  // In the Claude artifact viewer, downloads go through the `downloads`
  // capability; everywhere else a normal browser download is used.
  let downloadsCap;
  async function getDownloads() {
    if (downloadsCap !== undefined) return downloadsCap;
    downloadsCap = null;
    try {
      if (window.claude && typeof window.claude.use === 'function') downloadsCap = await window.claude.use('downloads');
    } catch (e) { downloadsCap = null; }
    return downloadsCap;
  }

  async function saveFile(filename, data, mime) {
    const dl = await getDownloads();
    if (dl) {
      try {
        await dl.save({ filename, data });
        toast('Saved ' + filename);
      } catch (e) {
        const code = e && e.code;
        if (code === 'declined') toast('Save cancelled');
        else if (code === 'rate_limited') toast('A save prompt is already open');
        else toast('This view cannot save files');
      }
      return;
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Saved ' + filename);
  }

  function openFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        finishAnimation();
        pushHistory();
        loadDraft(JSON.parse(reader.result));
        syncAllInputs();
        fitView();
        changed();
        toast('Opened ' + file.name);
      } catch (err) {
        dropLastHistory();
        toast('Could not open ' + file.name + ': ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------ autosave

  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(draftJSON())); } catch (e) { /* storage unavailable */ }
    }, 500);
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      loadDraft(JSON.parse(raw));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------ toast

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ------------------------------------------------------------ wiring

  function syncAllInputs() {
    syncSizeInputs();
    syncLookInputs();
    $('algoSelect').value = state.gen.algorithm;
    $('algoNote').textContent = (K.ALGORITHMS[state.gen.algorithm] || {}).note || '';
    $('braidInput').value = state.gen.braid;
    $('braidOut').textContent = state.gen.braid + '%';
    $('animateInput').checked = state.gen.animate;
    $('speedInput').value = state.gen.speed;
    $('speedOut').textContent = state.gen.speed;
    $('speedField').hidden = !state.gen.animate;
    $('bordersEnds').checked = state.gen.borderEnds;
    $('solutionToggle').checked = state.show.solution;
    $('heatToggle').checked = state.show.heat;
    $('deadToggle').checked = state.show.dead;
    renderPens();
    updateSelectionUI();
  }

  function wire() {
    const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

    on('undoBtn', 'click', undo);
    on('redoBtn', 'click', redo);
    on('openBtn', 'click', () => $('openInput').click());
    on('openInput', 'change', (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
    on('saveBtn', 'click', saveDraft);
    on('pngBtn', 'click', exportPNG);
    on('svgBtn', 'click', exportSVG);
    on('zoomIn', 'click', () => zoomCenter(1.25));
    on('zoomOut', 'click', () => zoomCenter(0.8));
    on('zoomFit', 'click', fitView);

    // drop a draft file anywhere
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) openFile(f);
    });

    // sheet
    on('resizeBtn', 'click', () => { const [c, r] = readSize(); resizeMaze(c, r); });
    on('newGridBtn', 'click', () => { const [c, r] = readSize(); newMaze(c, r, 'grid'); });
    on('newOpenBtn', 'click', () => { const [c, r] = readSize(); newMaze(c, r, 'open'); });
    const shapeSel = $('shapeSelect');
    for (const [k, s] of Object.entries(K.SHAPES)) {
      const o = document.createElement('option'); o.value = k; o.textContent = s.name; shapeSel.appendChild(o);
    }
    on('shapeBtn', 'click', () => {
      finishAnimation();
      pushHistory();
      const m = state.maze;
      K.applyShape(m, shapeSel.value, state.selection, state.pen);
      if (m.start && m.isVoid(m.start.c, m.start.r)) m.start = null;
      if (m.end && m.isVoid(m.end.c, m.end.r)) m.end = null;
      for (let i = 0; i < m.voids.length; i++) if (m.voids[i]) m.fill[i] = 0;
      changed();
      toast(K.SHAPES[shapeSel.value].name + ' applied. Generate to fill it with a maze.');
    });

    // generate
    const algoSel = $('algoSelect');
    for (const [k, a] of Object.entries(K.ALGORITHMS)) {
      const o = document.createElement('option'); o.value = k; o.textContent = a.name; algoSel.appendChild(o);
    }
    on('algoSelect', 'change', () => { state.gen.algorithm = algoSel.value; $('algoNote').textContent = K.ALGORITHMS[algoSel.value].note; scheduleSave(); });
    on('braidInput', 'input', (e) => { state.gen.braid = +e.target.value; $('braidOut').textContent = e.target.value + '%'; scheduleSave(); });
    on('animateInput', 'change', (e) => { state.gen.animate = e.target.checked; $('speedField').hidden = !e.target.checked; scheduleSave(); });
    on('speedInput', 'input', (e) => { state.gen.speed = +e.target.value; $('speedOut').textContent = e.target.value; scheduleSave(); });
    on('bordersEnds', 'change', (e) => { state.gen.borderEnds = e.target.checked; scheduleSave(); });
    on('seedInput', 'input', scheduleSave);
    on('genBtn', 'click', () => { if (anim) finishAnimation(); else generate(); });

    // walls
    on('addPenBtn', 'click', addPen);
    on('recolorBtn', 'click', () => bulk((cur) => (cur ? state.pen : 0), 'Redrew {n} walls with ' + '“' + state.pens[state.pen - 1].name + '”'));
    on('fillWallsBtn', 'click', () => bulk((cur, e) => (edgeTouchesWalkable(e) ? cur || state.pen : cur), 'Added {n} walls'));
    on('clearWallsBtn', 'click', () => {
      const sel = state.selection;
      bulk((cur, e) => {
        if (!sel) return 0;
        // Keep the selection's outer edge so the area stays enclosed.
        const outer = e.k === 'h' ? e.r === sel.r0 || e.r === sel.r1 + 1 : e.c === sel.c0 || e.c === sel.c1 + 1;
        return outer ? cur : 0;
      }, 'Removed {n} walls');
    });
    on('borderBtn', 'click', addBorder);
    on('thickInput', 'input', (e) => { state.look.thickness = +e.target.value / 100; $('thickOut').textContent = e.target.value + '%'; renderPens(); requestRender(); scheduleSave(); });
    on('capSelect', 'change', (e) => { state.look.cap = e.target.value; renderPens(); requestRender(); scheduleSave(); });

    // paper
    const paperSel = $('paperSelect');
    for (const [k, p] of Object.entries(PAPERS)) {
      const o = document.createElement('option'); o.value = k; o.textContent = p.name; paperSel.appendChild(o);
    }
    const custom = document.createElement('option');
    custom.value = 'custom'; custom.textContent = 'Custom'; custom.disabled = true;
    paperSel.appendChild(custom);
    on('paperSelect', 'change', (e) => applyPaper(e.target.value));
    const colorInput = (id, key, custom) => on(id, 'input', (e) => {
      state.look[key] = e.target.value;
      if (custom) { state.look.paperKey = 'custom'; $('paperSelect').value = 'custom'; renderPens(); }
      hatchCache = null;
      requestRender();
      scheduleSave();
    });
    colorInput('paperColor', 'paper', true);
    colorInput('gridColor', 'grid', true);
    colorInput('paintColor', 'paint', false);
    colorInput('pathColor', 'path', false);
    colorInput('startColor', 'start', false);
    colorInput('endColor', 'end', false);
    on('cellInput', 'input', (e) => {
      // Keep the sheet centre where it is while the cell size changes.
      const r = stage.getBoundingClientRect();
      const old = cs(), next = +e.target.value;
      const cx = r.width / 2, cy = r.height / 2;
      state.view.x = cx - ((cx - state.view.x) * next) / old;
      state.view.y = cy - ((cy - state.view.y) * next) / old;
      state.look.cellSize = next;
      $('cellOut').textContent = next + 'px';
      requestRender();
      scheduleSave();
    });
    on('gridToggle', 'change', (e) => { state.look.showGrid = e.target.checked; requestRender(); scheduleSave(); });
    on('rulerToggle', 'change', (e) => { state.look.showRulers = e.target.checked; requestRender(); scheduleSave(); });
    on('voidSelect', 'change', (e) => { state.look.voidStyle = e.target.value; requestRender(); scheduleSave(); });
    on('scaleSelect', 'change', (e) => { state.look.exportScale = +e.target.value; scheduleSave(); });

    // check
    const showToggle = (id, key) => on(id, 'change', (e) => { state.show[key] = e.target.checked; analysisCache = null; requestRender(); scheduleSave(); });
    showToggle('solutionToggle', 'solution');
    showToggle('heatToggle', 'heat');
    showToggle('deadToggle', 'dead');

    // Theme changes alter the surround colour.
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', requestRender);
    }
    new MutationObserver(requestRender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    new ResizeObserver(() => { resizeCanvas(); }).observe(stage);
  }

  // A worked example so the first view shows what the tool does: a maze
  // around a walled courtyard drawn with the heavy pen.
  function loadExample() {
    const m = new Maze(32, 20);
    state.maze = m;
    const court = { c0: 12, r0: 7, c1: 19, r1: 12 };
    const inCourt = (c, r) => c >= court.c0 && c <= court.c1 && r >= court.r0 && r <= court.r1;
    for (let r = court.r0; r <= court.r1; r++) for (let c = court.c0; c <= court.c1; c++) m.voids[r * m.cols + c] = 1;
    const g = K.makeContext(m, null, K.makeRng('first-draft:backtracker'), 1);
    K.prepare(g);
    const it = K.ALGORITHMS.backtracker.run(g);
    while (!it.next().done);
    K.connectAll(g);
    m.voids.fill(0);
    const paint = m.fillIndexFor('#f2cf5b');
    for (let r = court.r0; r <= court.r1; r++) {
      for (let c = court.c0; c <= court.c1; c++) {
        for (let d = 0; d < 4; d++) {
          const nc = c + DC[d], nr = r + DR[d];
          m.setWall(c, r, d, inCourt(nc, nr) ? 0 : 2);
        }
        if (c > court.c0 && c < court.c1 && r > court.r0 && r < court.r1) m.fill[r * m.cols + c] = paint;
      }
    }
    // Two gates through the courtyard wall.
    m.setWall(15, court.r0, N, 0);
    m.setWall(16, court.r1, S, 0);
    // Dashed guide marks on either side of each gate.
    m.setWall(14, court.r0, N, 3); m.setWall(16, court.r0, N, 3);
    m.setWall(15, court.r1, S, 3); m.setWall(17, court.r1, S, 3);
    K.placeEnds(g, true);
    state.lastSeed = 'first-draft';
    state.show.solution = true;
  }

  // ------------------------------------------------------------ boot

  buildTools();
  wire();
  if (!loadSaved()) loadExample();
  syncAllInputs();
  setTool('wall');
  updateHistoryButtons();
  resizeCanvas();
  fitView();
  renderStats();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestRender);
})();
