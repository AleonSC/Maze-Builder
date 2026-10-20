/* Maze Builder 3D — editor UI. Depends on three.js (global THREE),
   js/maze.js (MazeKit) and js/maze3d.js (Maze3DKit). */
(function () {
  'use strict';

  const MK = window.MazeKit;
  const K = window.Maze3DKit;
  const { Maze3D, N, E, S, W, U, D, DC, DR, DZ } = K;
  const STORE_KEY = 'maze-builder-3d:draft:v1';
  const MAX_HISTORY = 60;
  const MAX_SIDE = 120, MAX_LEVELS = 32, MAX_CELLS = 120000;
  const SLAB = 0.08;

  // ------------------------------------------------------------ defaults

  const PAPERS = {
    vellum: { name: 'Vellum', paper: '#eef2f3', grid: '#cfdadf', ink: '#1b2732' },
    blueprint: { name: 'Blueprint', paper: '#1c4f86', grid: '#3a6ca3', ink: '#eef5fc' },
    graphite: { name: 'Graphite on white', paper: '#ffffff', grid: '#e4e4e4', ink: '#2d2d2d' },
    kraft: { name: 'Kraft', paper: '#c7a676', grid: '#b5925f', ink: '#2a1c0e' },
    night: { name: 'Night', paper: '#12171c', grid: '#252e36', ink: '#d6e2ea' },
  };

  const defaultPens = () => [
    { name: 'Stone', color: '#46525e', width: 1, style: 'solid', height: 1, opacity: 1 },
    { name: 'Heavy', color: '#1b2732', width: 2, style: 'solid', height: 1, opacity: 1 },
    { name: 'Glass', color: '#5fb3d4', width: 0.8, style: 'dashed', height: 1, opacity: 0.35 },
    { name: 'Hedge', color: '#3d7a4a', width: 1.6, style: 'solid', height: 0.45, opacity: 1 },
    { name: 'Rail', color: '#c4532a', width: 0.5, style: 'dotted', height: 0.25, opacity: 1 },
  ];

  const defaultLook = () => ({
    paperKey: 'vellum',
    paper: PAPERS.vellum.paper,
    grid: PAPERS.vellum.grid,
    showGrid: true,
    showRulers: true,
    ghost: true,
    cellSize: 28,
    thickness: 0.14,
    cap: 'round',
    voidStyle: 'hatch',
    path: '#e0662f',
    start: '#2f9a68',
    end: '#c93b3b',
    paint: '#f2cf5b',
    stair: '#7a52c7',
    floor: '#d9dfe3',
    floorOpacity: 0.9,
    sky: null, // null follows the page theme
    wallHeight: 0.8,
    levelGap: 0.4,
    cut: 'upto',
    mmPerCell: 10,
  });

  // ------------------------------------------------------------ state

  const state = {
    maze: new Maze3D(12, 12, 4),
    pens: defaultPens(),
    pen: 1,
    look: defaultLook(),
    view: { zoom: 1, x: 0, y: 0 },
    layout: 'split',
    level: 0,
    tool: 'wall',
    selection: null, // {c0, r0, c1, r1} on the plan
    selAll: true,
    show: { solution: false, heat: false, dead: false },
    gen: {
      algorithm: 'backtracker', braid: 0, vertical: 15, stairs: 0, layered: false,
      bottomTop: true, borderEnds: true, animate: true, speed: 20,
    },
    lastSeed: '',
  };

  const history = { undo: [], redo: [] };
  let anim = null;
  let stroke = null;
  let hover = null;
  let spaceDown = false;
  let analysisCache = null;
  let needsRender = false;

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const planPane = canvas.parentElement;
  const canvas3d = $('canvas3d');

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cs = () => state.look.cellSize;
  const levelY = (z) => z * (state.look.wallHeight + state.look.levelGap + SLAB);

  // ------------------------------------------------------------ tools

  const ICONS = {
    wall: '<path d="M3 17V3h14"/><path d="M8 17V8h9"/><circle cx="3" cy="17" r="1.2"/><circle cx="17" cy="3" r="1.2"/>',
    erase: '<path d="M7 16h10"/><path d="M4.5 12.5l7-7a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L10 15.5H7.5z"/><path d="M8 9l4 4"/>',
    line: '<path d="M3 10h14"/><circle cx="3" cy="10" r="1.6"/><circle cx="17" cy="10" r="1.6"/>',
    rect: '<rect x="3.5" y="4.5" width="13" height="11"/><circle cx="3.5" cy="4.5" r="1.2"/><circle cx="16.5" cy="15.5" r="1.2"/>',
    carve: '<path d="M3 6h5v8h9"/><path d="M14 11l3 3-3 3"/>',
    stairs: '<path d="M3 17h4v-4h4V9h4V5h2"/><path d="M14 2.5l3 2.5-3 2.5"/>',
    void: '<rect x="3.5" y="3.5" width="13" height="13"/><path d="M3.5 9.5l6-6M3.5 15.5l12-12M9.5 16.5l7-7"/>',
    paint: '<path d="M4 13c0-3 3-4 3-7a3 3 0 0 1 6 0c0 3 3 4 3 7a6 6 0 0 1-12 0z"/>',
    flood: '<path d="M10 3l6 6-6 6-6-6z"/><path d="M16 13c0 1.5 1 2 1 3a1 1 0 0 1-2 0c0-1 1-1.5 1-3z"/>',
    start: '<circle cx="10" cy="10" r="6"/><path d="M8.5 7.5l4 2.5-4 2.5z"/>',
    end: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"/>',
    select: '<path d="M3.5 6V3.5H6M14 3.5h2.5V6M16.5 14v2.5H14M6 16.5H3.5V14"/><path d="M9 3.5h2M9 16.5h2M3.5 9v2M16.5 9v2"/>',
    hand: '<path d="M7 10V4.5a1.3 1.3 0 0 1 2.6 0V9"/><path d="M9.6 9V3.5a1.3 1.3 0 0 1 2.6 0V9"/><path d="M12.2 9V5a1.3 1.3 0 0 1 2.6 0v6.5c0 3-2 5.5-5 5.5S5 15.5 4 13l-1-2.6a1.3 1.3 0 0 1 2.3-1.1L7 12"/>',
  };

  const TOOLS = [
    { id: 'wall', key: 'W', label: 'Draw walls', hint: 'Drag across grid corners to draw walls on this level. Click an edge to toggle it. Shift or right button erases.' },
    { id: 'erase', key: 'E', label: 'Erase walls', hint: 'Drag across grid corners to remove walls. Click an edge to clear it.' },
    { id: 'line', key: 'L', label: 'Straight wall', hint: 'Drag from corner to corner for a straight wall. Shift erases along the line.' },
    { id: 'rect', key: 'R', label: 'Room outline', hint: 'Drag a rectangle to wall it in. Shift removes the outline.' },
    { id: 'carve', key: 'C', label: 'Carve passage', hint: 'Drag from cell to cell to open a passage. Shift builds walls instead.' },
    { id: 'stairs', key: 'T', label: 'Stairs', hint: 'Click a cell to open or close stairs to the level above. Shift-click does the same for the level below.' },
    'sep',
    { id: 'void', key: 'V', label: 'Void cells', hint: 'Paint cells out of this level. Shift brings them back.' },
    { id: 'paint', key: 'P', label: 'Paint cells', hint: 'Paint cells with the paint colour. Shift clears paint.' },
    { id: 'flood', key: 'B', label: 'Fill area', hint: 'Click to paint every cell you can reach without crossing a wall, on any level. Shift clears.' },
    'sep',
    { id: 'start', key: 'S', label: 'Place start', hint: 'Click a cell to place the start on this level. Shift removes it.' },
    { id: 'end', key: 'X', label: 'Place end', hint: 'Click a cell to place the end on this level. Shift removes it.' },
    { id: 'select', key: 'M', label: 'Select area', hint: 'Drag to select cells. Generate, shapes and wall actions then work only inside it. Esc clears.' },
    { id: 'hand', key: 'H', label: 'Pan', hint: 'Drag to move the plan. Wheel or pinch to zoom.' },
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

  function pushHistory() {
    history.undo.push(state.maze.clone());
    if (history.undo.length > MAX_HISTORY) history.undo.shift();
    history.redo.length = 0;
    updateHistoryButtons();
  }
  function dropLastHistory() { history.undo.pop(); updateHistoryButtons(); }
  function undo() {
    finishAnimation();
    if (!history.undo.length) return;
    history.redo.push(state.maze.clone());
    restore(history.undo.pop());
  }
  function redo() {
    finishAnimation();
    if (!history.redo.length) return;
    history.undo.push(state.maze.clone());
    restore(history.redo.pop());
  }
  function restore(m) {
    const sizeChanged = m.cols !== state.maze.cols || m.rows !== state.maze.rows || m.levels !== state.maze.levels;
    state.maze = m;
    if (sizeChanged) { state.selection = null; state.level = clamp(state.level, 0, m.levels - 1); syncSizeInputs(); fitView(); fitCamera(); }
    changed();
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    $('undoBtn').disabled = !history.undo.length;
    $('redoBtn').disabled = !history.redo.length;
  }

  function changed() {
    analysisCache = null;
    requestRender();
    scheduleRebuild();
    scheduleStats();
    scheduleSave();
    renderPenCounts();
  }

  // ------------------------------------------------------------ plan geometry

  function toGrid(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.view.x) / state.view.zoom / cs(),
      y: (clientY - rect.top - state.view.y) / state.view.zoom / cs(),
    };
  }
  function nearestCorner(p) {
    const m = state.maze;
    return { x: clamp(Math.round(p.x), 0, m.cols), y: clamp(Math.round(p.y), 0, m.rows) };
  }
  function cellAt(p) {
    const c = Math.floor(p.x), r = Math.floor(p.y);
    return c >= 0 && r >= 0 && c < state.maze.cols && r < state.maze.rows ? { c, r } : null;
  }
  function nearestEdge(p) {
    const m = state.maze;
    const dy = Math.abs(p.y - Math.round(p.y)), dx = Math.abs(p.x - Math.round(p.x));
    if (dy <= dx) return { k: 'h', c: clamp(Math.floor(p.x), 0, m.cols - 1), r: clamp(Math.round(p.y), 0, m.rows) };
    return { k: 'v', c: clamp(Math.round(p.x), 0, m.cols), r: clamp(Math.floor(p.y), 0, m.rows - 1) };
  }
  function edgeRef(e, z) {
    const m = state.maze;
    return e.k === 'h' ? [m.h, m.hIndex(e.c, e.r, z)] : [m.v, m.vIndex(e.c, e.r, z)];
  }
  function edgeGet(e) { const [a, i] = edgeRef(e, state.level); return a[i]; }
  function edgeSet(e, val) {
    const [a, i] = edgeRef(e, state.level);
    if (a[i] === val) return false;
    a[i] = val;
    return true;
  }
  function cornerPath(a, b) {
    const out = [];
    let x = a.x, y = a.y;
    while (x !== b.x || y !== b.y) {
      const dx = b.x - x, dy = b.y - y;
      if (Math.abs(dx) >= Math.abs(dy)) { const nx = x + Math.sign(dx); out.push({ k: 'h', c: Math.min(x, nx), r: y }); x = nx; }
      else { const ny = y + Math.sign(dy); out.push({ k: 'v', c: x, r: Math.min(y, ny) }); y = ny; }
    }
    return out;
  }
  function cellPath(a, b) {
    const out = [];
    let c = a.c, r = a.r;
    while (c !== b.c || r !== b.r) {
      const dc = b.c - c, dr = b.r - r;
      const d = Math.abs(dc) >= Math.abs(dr) ? (dc > 0 ? E : W) : (dr > 0 ? S : N);
      out.push({ c, r, d });
      c += DC[d]; r += DR[d];
    }
    return out;
  }
  function rectEdges(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (x0 === x1 || y0 === y1) return cornerPath({ x: x0, y: y0 }, { x: x1, y: y1 });
    const out = [];
    for (let c = x0; c < x1; c++) out.push({ k: 'h', c, r: y0 }, { k: 'h', c, r: y1 });
    for (let r = y0; r < y1; r++) out.push({ k: 'v', c: x0, r }, { k: 'v', c: x1, r });
    return out;
  }
  const lineEnd = (a, b) => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
  const cellRect = (a, b) => ({ c0: Math.min(a.c, b.c), r0: Math.min(a.r, b.r), c1: Math.max(a.c, b.c), r1: Math.max(a.r, b.r) });

  // ------------------------------------------------------------ plan view

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const r = planPane.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    requestRender();
  }

  function fitView() {
    const r = planPane.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const m = state.maze;
    const pad = state.look.showRulers ? 2.2 : 1.2;
    const top = 52; // room for the stage toolbar
    const w = (m.cols + pad * 2) * cs(), h = (m.rows + pad * 2) * cs();
    const zoom = clamp(Math.min(r.width / w, (r.height - top - 28) / h), 0.05, 8);
    state.view.zoom = zoom;
    state.view.x = (r.width - m.cols * cs() * zoom) / 2;
    state.view.y = top + (r.height - top - 28 - m.rows * cs() * zoom) / 2;
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
  function zoomCenter(factor) { const r = planPane.getBoundingClientRect(); zoomAt(factor, r.width / 2, r.height / 2); }
  function updateZoomLabel() { $('zoomLabel').textContent = Math.round(state.view.zoom * 100) + '%'; }

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

  function requestRender() {
    if (needsRender) return;
    needsRender = true;
    requestAnimationFrame(() => { needsRender = false; renderPlan(); });
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function penDash(pen, size) {
    if (pen.style === 'dashed') return [size * 0.42, size * 0.26];
    if (pen.style === 'dotted') return [0.001, size * 0.22];
    return [];
  }

  // Merge neighbouring edges with the same pen into runs, per level.
  function wallRuns(m, z) {
    const runs = [];
    for (let r = 0; r <= m.rows; r++) {
      let pen = 0, from = 0;
      for (let c = 0; c <= m.cols; c++) {
        const p = c < m.cols ? m.h[m.hIndex(c, r, z)] : 0;
        if (p !== pen) { if (pen) runs.push({ pen, x1: from, y1: r, x2: c, y2: r }); pen = p; from = c; }
      }
    }
    for (let c = 0; c <= m.cols; c++) {
      let pen = 0, from = 0;
      for (let r = 0; r <= m.rows; r++) {
        const p = r < m.rows ? m.v[m.vIndex(c, r, z)] : 0;
        if (p !== pen) { if (pen) runs.push({ pen, x1: c, y1: from, x2: c, y2: r }); pen = p; from = r; }
      }
    }
    return runs;
  }

  let hatchCache = null;
  function hatchPattern(g, color) {
    if (hatchCache && hatchCache.color === color && hatchCache.g === g) return hatchCache.pattern;
    const t = document.createElement('canvas');
    t.width = t.height = 12;
    const h = t.getContext('2d');
    h.strokeStyle = color;
    h.lineWidth = 1.2;
    h.beginPath();
    h.moveTo(0, 12); h.lineTo(12, 0); h.moveTo(-6, 6); h.lineTo(6, -6); h.moveTo(6, 18); h.lineTo(18, 6);
    h.stroke();
    hatchCache = { color, g, pattern: g.createPattern(t, 'repeat') };
    return hatchCache.pattern;
  }
  const heatColor = (t) => 'hsla(' + (200 - 180 * t) + ', 75%, 55%, 0.5)';

  function strokeRuns(g, runs, size, hair, alphaPen) {
    const byPen = new Map();
    for (const r of runs) { if (!byPen.has(r.pen)) byPen.set(r.pen, []); byPen.get(r.pen).push(r); }
    for (const [id, list] of byPen) {
      const pen = state.pens[id - 1] || state.pens[0];
      g.strokeStyle = alphaPen || pen.color;
      g.lineWidth = Math.max(state.look.thickness * size * (alphaPen ? 0.6 : pen.width), hair || 0);
      g.lineCap = pen.style === 'dotted' && !alphaPen ? 'round' : state.look.cap;
      g.setLineDash(alphaPen ? [] : penDash(pen, size));
      g.beginPath();
      for (const r of list) { g.moveTo(r.x1 * size, r.y1 * size); g.lineTo(r.x2 * size, r.y2 * size); }
      g.stroke();
    }
    g.setLineDash([]);
  }

  function stairGlyph(g, c, r, size, up) {
    const x = c * size, y = r * size, s = size * 0.26;
    g.beginPath();
    if (up) { const cx = x + size * 0.72, cy = y + size * 0.3; g.moveTo(cx - s / 2, cy + s / 3); g.lineTo(cx + s / 2, cy + s / 3); g.lineTo(cx, cy - s / 2); }
    else { const cx = x + size * 0.28, cy = y + size * 0.7; g.moveTo(cx - s / 2, cy - s / 3); g.lineTo(cx + s / 2, cy - s / 3); g.lineTo(cx, cy + s / 2); }
    g.closePath();
    g.fill();
  }

  // Draw level z of the maze in world units (1 cell = size).
  function drawPlan(g, size, z, opts) {
    const m = state.maze, L = state.look;
    const hair = opts.hair || 0;
    g.fillStyle = L.paper;
    g.fillRect(0, 0, m.cols * size, m.rows * size);

    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const f = m.fill[m.idx(c, r, z)];
      if (f && m.fillColors[f]) { g.fillStyle = m.fillColors[f]; g.fillRect(c * size, r * size, size, size); }
    }
    const a = analysis();
    if (a.dist && a.maxDist > 0) {
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        const d = a.dist[m.idx(c, r, z)];
        if (d >= 0) { g.fillStyle = heatColor(d / a.maxDist); g.fillRect(c * size, r * size, size, size); }
      }
    }
    if (L.showGrid) {
      g.strokeStyle = L.grid;
      g.lineWidth = Math.max(size * 0.03, hair);
      g.beginPath();
      for (let c = 0; c <= m.cols; c++) { g.moveTo(c * size, 0); g.lineTo(c * size, m.rows * size); }
      for (let r = 0; r <= m.rows; r++) { g.moveTo(0, r * size); g.lineTo(m.cols * size, r * size); }
      g.stroke();
    }
    if (L.ghost && z > 0 && opts.ghost !== false) {
      g.globalAlpha = 0.22;
      strokeRuns(g, wallRuns(m, z - 1), size, hair, L.grid === L.paper ? '#888' : shade(L.grid));
      g.globalAlpha = 1;
    }
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      if (!m.voids[m.idx(c, r, z)]) continue;
      if (L.voidStyle === 'hidden' && opts.exporting) continue;
      g.fillStyle = L.voidStyle === 'solid' ? L.grid : L.voidStyle === 'hidden' ? opts.surround : L.paper;
      g.fillRect(c * size - 0.5, r * size - 0.5, size + 1, size + 1);
      if (L.voidStyle === 'hatch') { g.fillStyle = hatchPattern(g, L.grid); g.fillRect(c * size, r * size, size, size); }
    }
    // stairs
    g.fillStyle = L.stair;
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      if (m.passable(c, r, z, U)) stairGlyph(g, c, r, size, true);
      if (m.passable(c, r, z, D)) stairGlyph(g, c, r, size, false);
    }
    if (state.show.dead) {
      g.fillStyle = L.path;
      g.globalAlpha = 0.55;
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        if (m.isVoid(c, r, z) || K.degree(m, c, r, z) !== 1) continue;
        if (isAt(m.start, c, r, z) || isAt(m.end, c, r, z)) continue;
        g.beginPath(); g.arc((c + 0.5) * size, (r + 0.5) * size, size * 0.12, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
    if (a.path && a.path.length > 1) {
      g.strokeStyle = L.path;
      g.fillStyle = L.path;
      g.lineWidth = size * 0.22;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      let drawing = false;
      for (let k = 0; k < a.path.length; k++) {
        const p = m.pos(a.path[k]);
        const x = (p.c + 0.5) * size, y = (p.r + 0.5) * size;
        if (p.z !== z) { drawing = false; continue; }
        if (drawing) g.lineTo(x, y); else g.moveTo(x, y);
        drawing = true;
      }
      g.stroke();
      // Dots where the route changes level.
      for (let k = 1; k < a.path.length; k++) {
        const p = m.pos(a.path[k]), q = m.pos(a.path[k - 1]);
        if (p.z === q.z) continue;
        const at = p.z === z ? p : q.z === z ? q : null;
        if (!at) continue;
        g.beginPath(); g.arc((at.c + 0.5) * size, (at.r + 0.5) * size, size * 0.2, 0, Math.PI * 2); g.fill();
      }
    }
    strokeRuns(g, wallRuns(m, z), size, hair);

    const marker = (p, color, isEnd) => {
      if (!p || p.z !== z) return;
      const x = (p.c + 0.5) * size, y = (p.r + 0.5) * size, rad = size * 0.3;
      g.fillStyle = color;
      g.beginPath();
      if (isEnd) { const s = rad * 1.6; if (g.roundRect) g.roundRect(x - s / 2, y - s / 2, s, s, s * 0.22); else g.rect(x - s / 2, y - s / 2, s, s); }
      else g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = '600 ' + Math.round(size * 0.36) + 'px IBM Plex Sans, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(isEnd ? 'E' : 'S', x, y + size * 0.02);
    };
    marker(m.start, L.start, false);
    marker(m.end, L.end, true);
  }

  function shade(hex) {
    // A darker version of the grid colour for the ghost level.
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.round(v * 0.45).toString(16).padStart(2, '0');
    return '#' + f((n >> 16) & 255) + f((n >> 8) & 255) + f(n & 255);
  }
  const isAt = (p, c, r, z) => p && p.c === c && p.r === r && p.z === z;

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
    for (let c = 0; c <= m.cols; c++) { const len = c % step === 0 ? size * 0.35 : size * 0.15; g.moveTo(c * size, -size * 0.1); g.lineTo(c * size, -size * 0.1 - len); }
    for (let r = 0; r <= m.rows; r++) { const len = r % step === 0 ? size * 0.35 : size * 0.15; g.moveTo(-size * 0.1, r * size); g.lineTo(-size * 0.1 - len, r * size); }
    g.stroke();
    for (let c = step; c <= m.cols; c += step) g.fillText(String(c), (c - 0.5) * size, -off - size * 0.2);
    g.textAlign = 'right';
    for (let r = step; r <= m.rows; r += step) g.fillText(String(r), -off + size * 0.05, (r - 0.5) * size);
    g.textAlign = 'left';
    g.fillText('Level ' + (state.level + 1) + ' of ' + m.levels + ' · ' + m.cols + ' × ' + m.rows, 0, (m.rows + 0.7) * size);
  }

  function renderPlan() {
    if (state.layout === '3d') return;
    const dpr = window.devicePixelRatio || 1;
    const v = state.view, size = cs(), m = state.maze;
    const surround = cssVar('--bg') || '#e4e9ec';
    const accent = cssVar('--accent') || '#0b7593';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = surround;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.x, dpr * v.y);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 18 / v.zoom;
    ctx.shadowOffsetY = 3 / v.zoom;
    ctx.fillStyle = state.look.paper;
    ctx.fillRect(0, 0, m.cols * size, m.rows * size);
    ctx.restore();
    drawPlan(ctx, size, state.level, { hair: 1 / (v.zoom * dpr), surround });
    if (state.look.showRulers) drawRulers(ctx, size, cssVar('--muted') || '#5a6975');

    if (anim && anim.cursor >= 0) {
      const p = m.pos(anim.cursor);
      if (p.z === state.level) {
        ctx.fillStyle = accent; ctx.globalAlpha = 0.6;
        ctx.fillRect(p.c * size, p.r * size, size, size);
        ctx.globalAlpha = 1;
      }
    }
    if (walk.on && walk.level === state.level) {
      // Walker position and heading.
      const x = walk.x * size, y = walk.y * size, s = size * 0.35;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-walk.yaw);
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s * 0.7); ctx.lineTo(0, s * 0.35); ctx.lineTo(-s * 0.7, s * 0.7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    const sel = stroke && stroke.tool === 'select' && stroke.rect ? stroke.rect : state.selection;
    if (sel) {
      const x = sel.c0 * size, y = sel.r0 * size, w = (sel.c1 - sel.c0 + 1) * size, h = (sel.r1 - sel.r0 + 1) * size;
      ctx.fillStyle = accent; ctx.globalAlpha = 0.08; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
      ctx.strokeStyle = accent; ctx.lineWidth = 2 / v.zoom;
      ctx.setLineDash([6 / v.zoom, 4 / v.zoom]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
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
      ctx.moveTo(e.c * size, e.r * size);
      if (e.k === 'h') ctx.lineTo((e.c + 1) * size, e.r * size); else ctx.lineTo(e.c * size, (e.r + 1) * size);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawToolPreview(size, accent) {
    const z = state.view.zoom, t = state.tool;
    if (stroke && (stroke.tool === 'line' || stroke.tool === 'rect') && stroke.preview) {
      const pen = state.pens[state.pen - 1];
      drawEdges(stroke.preview, size, stroke.erase ? accent : pen.color, Math.max(state.look.thickness * size * pen.width, 2 / z), stroke.erase ? [4 / z, 4 / z] : null);
      return;
    }
    if (!hover || stroke || spaceDown || t === 'hand') return;
    ctx.globalAlpha = 0.5;
    if (t === 'wall' || t === 'erase') drawEdges([nearestEdge(hover)], size, accent, Math.max(state.look.thickness * size, 3 / z));
    else if (t === 'line' || t === 'rect') {
      const p = nearestCorner(hover);
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(p.x * size, p.y * size, Math.max(size * 0.12, 3 / z), 0, Math.PI * 2); ctx.fill();
    } else {
      const c = cellAt(hover);
      if (c) { ctx.strokeStyle = accent; ctx.lineWidth = 2 / z; ctx.strokeRect(c.c * size, c.r * size, size, size); }
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ plan input

  const pointers = new Map();
  let pinch = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      cancelStroke();
      const [p1, p2] = [...pointers.values()];
      pinch = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
      return;
    }
    if (pointers.size > 2) return;
    finishAnimation();
    if (e.button === 1 || spaceDown || state.tool === 'hand') {
      stroke = { pan: true, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
      updateCursor();
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    beginStroke(toGrid(e.clientX, e.clientY), e.shiftKey || e.button === 2);
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
      return;
    }
    const p = toGrid(e.clientX, e.clientY);
    hover = p;
    const c = cellAt(p);
    $('coords').textContent = c ? 'col ' + (c.c + 1) + ' · row ' + (c.r + 1) + ' · level ' + (state.level + 1) : '—';
    if (stroke && stroke.pan) {
      state.view.x = stroke.vx + e.clientX - stroke.sx;
      state.view.y = stroke.vy + e.clientY - stroke.sy;
      requestRender();
      return;
    }
    if (stroke) moveStroke(p);
    requestRender();
  });

  canvas.addEventListener('pointerup', (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (stroke) endStroke(stroke.pan ? null : toGrid(e.clientX, e.clientY));
  });
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; cancelStroke(); });
  canvas.addEventListener('pointerleave', () => { hover = null; $('coords').textContent = '—'; requestRender(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(-delta * 0.0018), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  function clampToGrid(p) {
    const m = state.maze;
    return { x: clamp(p.x, 0, m.cols - 0.001), y: clamp(p.y, 0, m.rows - 0.001) };
  }

  function beginStroke(p, invert) {
    const t = state.tool;
    const s = { tool: t, erase: invert, changed: false };
    stroke = s;
    if (t === 'select') {
      const c = cellAt(clampToGrid(p));
      s.anchor = c; s.rect = c ? cellRect(c, c) : null; s.moved = false;
      return;
    }
    pushHistory();
    if (t === 'wall' || t === 'erase') { s.last = nearestCorner(p); s.downEdge = nearestEdge(p); s.drew = false; }
    else if (t === 'line' || t === 'rect') { s.a = nearestCorner(p); s.preview = []; }
    else { s.lastCell = cellAt(p); if (s.lastCell) applyCellTool(s.lastCell, null); }
    requestRender();
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
    } else if (t !== 'stairs' && t !== 'flood') {
      const c = cellAt(p);
      if (!c) return;
      if (!s.lastCell) { s.lastCell = c; applyCellTool(c, null); return; }
      if (c.c === s.lastCell.c && c.r === s.lastCell.r) return;
      for (const st of cellPath(s.lastCell, c)) applyCellTool({ c: st.c + DC[st.d], r: st.r + DR[st.d] }, st);
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
    if ((t === 'wall' || t === 'erase') && !s.drew) {
      const e = s.downEdge;
      const val = t === 'erase' || s.erase ? 0 : edgeGet(e) === state.pen ? 0 : state.pen;
      if (edgeSet(e, val)) s.changed = true;
    } else if ((t === 'line' || t === 'rect') && p) {
      const b = nearestCorner(p);
      const edges = t === 'line' ? cornerPath(s.a, lineEnd(s.a, b)) : rectEdges(s.a, b);
      for (const e of edges) if (edgeSet(e, s.erase ? 0 : state.pen)) s.changed = true;
    }
    if (!s.changed) dropLastHistory(); else changed();
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

  function applyCellTool(cell, step) {
    const s = stroke, m = state.maze, t = s.tool, z = state.level;
    const i = m.idx(cell.c, cell.r, z);
    let did = false;
    if (t === 'carve') {
      if (step && !m.isVoid(cell.c, cell.r, z) && !m.isVoid(step.c, step.r, z)) {
        const val = s.erase ? state.pen : 0;
        if (m.getWall(step.c, step.r, z, step.d) !== val) { m.setWall(step.c, step.r, z, step.d, val); did = true; }
      }
    } else if (t === 'stairs') {
      if (!step) did = toggleStairs(cell, s.erase ? D : U);
    } else if (t === 'void') {
      const val = s.erase ? 0 : 1;
      if (m.voids[i] !== val) {
        m.voids[i] = val;
        if (val) {
          m.fill[i] = 0;
          if (isAt(m.start, cell.c, cell.r, z)) m.start = null;
          if (isAt(m.end, cell.c, cell.r, z)) m.end = null;
        }
        K.fixVoidEdges(m, cell.c, cell.r, z, state.pen);
        did = true;
      }
    } else if (t === 'paint') {
      const val = s.erase ? 0 : m.fillIndexFor(state.look.paint);
      if (!m.voids[i] && m.fill[i] !== val) { m.fill[i] = val; did = true; }
    } else if (t === 'flood') {
      if (!step && !m.isVoid(cell.c, cell.r, z)) {
        const val = s.erase ? 0 : m.fillIndexFor(state.look.paint);
        const { dist } = K.bfs(m, { c: cell.c, r: cell.r, z });
        for (let k = 0; k < dist.length; k++) if (dist[k] >= 0 && m.fill[k] !== val) { m.fill[k] = val; did = true; }
      }
    } else if (t === 'start' || t === 'end') {
      const cur = m[t];
      if (s.erase) { if (!step && cur) { m[t] = null; did = true; } }
      else if (!m.isVoid(cell.c, cell.r, z) && !isAt(cur, cell.c, cell.r, z)) { m[t] = { c: cell.c, r: cell.r, z }; did = true; }
    }
    if (did) { s.changed = true; changed(); }
  }

  function toggleStairs(cell, d) {
    const m = state.maze, z = state.level, nz = z + DZ[d];
    if (nz < 0 || nz >= m.levels) { toast(d === U ? 'There is no level above. Add one under Size.' : 'There is no level below.'); return false; }
    if (m.isVoid(cell.c, cell.r, z) || m.isVoid(cell.c, cell.r, nz)) { toast('Stairs need a walkable cell on both levels.'); return false; }
    const open = m.getWall(cell.c, cell.r, z, d) === 0;
    m.setWall(cell.c, cell.r, z, d, open ? state.pen : 0);
    toast(open ? 'Stairs closed' : d === U ? 'Stairs up to level ' + (nz + 1) : 'Stairs down to level ' + (nz + 1));
    return true;
  }

  // ------------------------------------------------------------ levels

  function setLevel(z) {
    const m = state.maze;
    state.level = clamp(z, 0, m.levels - 1);
    $('levelLabel').textContent = (state.level + 1) + ' / ' + m.levels;
    $('levelDown').disabled = state.level === 0;
    $('levelUp').disabled = state.level === m.levels - 1;
    $('delLevelBtn').disabled = m.levels <= 1;
    requestRender();
    scheduleRebuild();
  }

  function levelOp(fn, msg) {
    finishAnimation();
    pushHistory();
    state.maze = fn(state.maze);
    afterResize();
    if (msg) toast(msg);
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
    if (walk.on) {
      if (e.key === 'Escape') { stopWalk(); return; }
      if (walkKey(e, true)) { e.preventDefault(); return; }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); saveDraft(); return; }
    if (mod || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; updateCursor(); } return; }
    if (e.key === 'Escape') { state.selection = null; updateSelectionUI(); requestRender(); return; }
    if (e.key === 'PageUp' || k === ']') { e.preventDefault(); setLevel(state.level + 1); return; }
    if (e.key === 'PageDown' || k === '[') { e.preventDefault(); setLevel(state.level - 1); return; }
    if (k === 'f') { fitView(); return; }
    if (k === 'g') { generate(); return; }
    if (k === '+' || k === '=') { zoomCenter(1.25); return; }
    if (k === '-' || k === '_') { zoomCenter(0.8); return; }
    if (/^[1-9]$/.test(k) && state.pens[+k - 1]) { setPen(+k); return; }
    if (TOOL_BY_KEY[k]) setTool(TOOL_BY_KEY[k]);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; updateCursor(); }
    if (walk.on) walkKey(e, false);
  });
  window.addEventListener('blur', () => { spaceDown = false; walk.keys.clear(); updateCursor(); });

  // ------------------------------------------------------------ generation

  function region() {
    const m = state.maze, s = state.selection;
    const z0 = s && !state.selAll ? state.level : 0;
    const z1 = s && !state.selAll ? state.level : m.levels - 1;
    if (!s) return { c0: 0, r0: 0, z0, c1: m.cols - 1, r1: m.rows - 1, z1 };
    return { c0: s.c0, r0: s.r0, z0, c1: s.c1, r1: s.r1, z1 };
  }

  function generate() {
    finishAnimation();
    stopWalk();
    pushHistory();
    const typed = $('seedInput').value.trim();
    const seed = typed || MK.randomSeed();
    state.lastSeed = seed;
    const G = state.gen;
    const rng = MK.makeRng(seed + ':' + G.algorithm + ':3d');
    const g = K.makeContext(state.maze, region(), rng, state.pen, { vertical: G.vertical / 100, allowVertical: !G.layered });
    K.prepare(g);
    const iter = (K.ALGORITHMS[G.algorithm] || K.ALGORITHMS.backtracker).run(g);
    const finish = () => {
      K.connectAll(g);
      K.addStairs(g, G.stairs);
      K.braid(g, G.braid / 100);
      if (state.selection) K.stitchRegion(g);
      else K.placeEnds(g, G.borderEnds, G.bottomTop);
      anim = null;
      if (!state.selection && state.maze.start) setLevel(state.maze.start.z);
      changed();
      showSeedNote(seed, !typed);
      $('genBtn').textContent = generateLabel();
    };
    if (!G.animate) { while (!iter.next().done); finish(); return; }
    anim = { iter, finish, cursor: -1 };
    $('genBtn').textContent = 'Finish now';
    const tick = () => {
      if (!anim || anim.iter !== iter) return;
      for (let k = 0; k < G.speed; k++) {
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
    note.textContent = 'Seed ' + seed + ' · ' + K.ALGORITHMS[state.gen.algorithm].name + ' ';
    if (wasRandom) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Keep this seed';
      b.addEventListener('click', () => { $('seedInput').value = seed; note.textContent = 'Seed ' + seed + ' kept. Generate again for the same maze.'; scheduleSave(); });
      note.appendChild(b);
    }
  }

  const generateLabel = () => (state.selection ? 'Generate in selection' : 'Generate maze');

  function updateSelectionUI() {
    if (!anim) $('genBtn').textContent = generateLabel();
    const m = state.maze, sel = state.selection;
    $('sheetLabel').textContent = m.cols + ' × ' + m.rows + ' × ' + m.levels +
      (sel ? ' · selection ' + (sel.c1 - sel.c0 + 1) + ' × ' + (sel.r1 - sel.r0 + 1) : '');
  }

  // ------------------------------------------------------------ bulk edits

  // Edges of the current level inside the selection (or the whole level).
  function forLevelEdges(fn) {
    const m = state.maze, z = state.level;
    const s = state.selection || { c0: 0, r0: 0, c1: m.cols - 1, r1: m.rows - 1 };
    for (let r = s.r0; r <= s.r1 + 1; r++) for (let c = s.c0; c <= s.c1; c++) fn(m.h, m.hIndex(c, r, z), { k: 'h', c, r, z });
    for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1 + 1; c++) fn(m.v, m.vIndex(c, r, z), { k: 'v', c, r, z });
  }
  function edgeSides(e) {
    const m = state.maze;
    return e.k === 'h' ? [m.isVoid(e.c, e.r - 1, e.z), m.isVoid(e.c, e.r, e.z)] : [m.isVoid(e.c - 1, e.r, e.z), m.isVoid(e.c, e.r, e.z)];
  }
  function bulk(fn, msg, allLevels) {
    finishAnimation();
    pushHistory();
    let n = 0;
    const visit = (arr, i, e) => { const v = fn(arr[i], e); if (v !== arr[i]) { arr[i] = v; n++; } };
    if (allLevels) {
      const keep = state.level;
      for (let z = 0; z < state.maze.levels; z++) { state.level = z; forLevelEdges(visit); }
      state.level = keep;
    } else forLevelEdges(visit);
    if (!n) { dropLastHistory(); toast('Nothing to change'); return; }
    changed();
    if (msg) toast(msg.replace('{n}', n.toLocaleString()));
  }

  function newMaze(cols, rows, levels, mode) {
    finishAnimation();
    pushHistory();
    const m = new Maze3D(cols, rows, levels);
    const p = state.pen;
    m.f.fill(p);
    if (mode === 'grid') { m.h.fill(p); m.v.fill(p); }
    else {
      for (let z = 0; z < levels; z++) {
        for (let c = 0; c < cols; c++) { m.h[m.hIndex(c, 0, z)] = p; m.h[m.hIndex(c, rows, z)] = p; }
        for (let r = 0; r < rows; r++) { m.v[m.vIndex(0, r, z)] = p; m.v[m.vIndex(cols, r, z)] = p; }
      }
    }
    state.maze = m;
    state.selection = null;
    afterResize();
  }

  function afterResize() {
    state.level = clamp(state.level, 0, state.maze.levels - 1);
    syncSizeInputs();
    fitView();
    fitCamera();
    changed();
  }

  function readSize() {
    let cols = clamp(parseInt($('colsInput').value, 10) || 2, 2, MAX_SIDE);
    let rows = clamp(parseInt($('rowsInput').value, 10) || 2, 2, MAX_SIDE);
    let levels = clamp(parseInt($('levelsInput').value, 10) || 1, 1, MAX_LEVELS);
    if (cols * rows * levels > MAX_CELLS) {
      levels = Math.max(1, Math.floor(MAX_CELLS / (cols * rows)));
      toast('Capped at ' + MAX_CELLS.toLocaleString() + ' cells: using ' + levels + ' levels.');
    }
    $('colsInput').value = cols; $('rowsInput').value = rows; $('levelsInput').value = levels;
    return [cols, rows, levels];
  }

  function syncSizeInputs() {
    const m = state.maze;
    $('colsInput').value = m.cols; $('rowsInput').value = m.rows; $('levelsInput').value = m.levels;
    setLevel(state.level);
    updateSelectionUI();
  }

  // ------------------------------------------------------------ pens

  function setPen(id) { state.pen = id; renderPens(); scheduleSave(); }

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
    g.globalAlpha = Math.max(0.3, pen.opacity);
    g.strokeStyle = pen.color;
    g.lineWidth = Math.max(1, 14 * state.look.thickness * pen.width);
    g.lineCap = pen.style === 'dotted' ? 'round' : state.look.cap;
    g.setLineDash(penDash(pen, 14));
    g.beginPath(); g.moveTo(8, 9); g.lineTo(46, 9); g.stroke();
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
      const num = document.createElement('span'); num.className = 'num'; num.textContent = id;
      const cv = document.createElement('canvas'); drawPenSample(cv, pen);
      const name = document.createElement('input');
      name.className = 'name'; name.value = pen.name; name.id = 'pen-name-' + id;
      name.setAttribute('aria-label', 'Pen ' + id + ' name');
      name.addEventListener('input', () => { pen.name = name.value; scheduleSave(); });
      const count = document.createElement('span');
      count.className = 'count'; count.textContent = counts[id] ? counts[id].toLocaleString() : '';
      count.title = 'Walls drawn with this pen';
      li.append(num, cv, name, count);
      li.addEventListener('click', (e) => {
        if (e.target.closest('.pen-edit')) return;
        if (state.pen === id && e.target !== name) editingPen = editingPen === id ? 0 : id; else editingPen = id;
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
    box.className = 'pen-edit pen-edit-3d';
    const mk = (tag, props) => Object.assign(document.createElement(tag), props);
    const color = mk('input', { type: 'color', value: pen.color, id: 'pen-color-' + id, title: 'Colour' });
    color.setAttribute('aria-label', 'Colour');
    const width = mk('input', { type: 'number', min: '0.2', max: '6', step: '0.1', value: pen.width, id: 'pen-width-' + id, title: 'Thickness, relative to the base thickness' });
    width.setAttribute('aria-label', 'Thickness multiplier');
    const style = mk('select', { id: 'pen-style-' + id, title: 'Line style on the plan' });
    style.setAttribute('aria-label', 'Plan line style');
    for (const [v, label] of [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]) style.appendChild(mk('option', { value: v, textContent: label }));
    style.value = pen.style;
    const del = mk('button', { type: 'button', className: 'btn ghost danger', textContent: 'Delete', title: 'Delete this pen. Its walls move to pen 1.' });
    del.disabled = state.pens.length <= 1;
    const hLabel = mk('label', { className: 'mini' });
    const height = mk('input', { type: 'range', min: '5', max: '100', value: Math.round(pen.height * 100), id: 'pen-height-' + id });
    hLabel.append(mk('span', { textContent: 'Height ' }), height);
    const oLabel = mk('label', { className: 'mini' });
    const opacity = mk('input', { type: 'range', min: '10', max: '100', value: Math.round(pen.opacity * 100), id: 'pen-opacity-' + id });
    oLabel.append(mk('span', { textContent: 'Solid ' }), opacity);
    const update = () => {
      pen.color = color.value;
      pen.width = clamp(parseFloat(width.value) || 1, 0.2, 6);
      pen.style = style.value;
      pen.height = +height.value / 100;
      pen.opacity = +opacity.value / 100;
      drawPenSample(sample, pen);
      requestRender();
      scheduleRebuild();
      scheduleSave();
    };
    for (const el of [color, width, height, opacity]) el.addEventListener('input', update);
    style.addEventListener('change', update);
    del.addEventListener('click', () => deletePen(id));
    box.append(color, width, style, del, hLabel, oLabel);
    return box;
  }

  function addPen() {
    if (state.pens.length >= 9) return;
    const hues = ['#6b4fa3', '#2a7f9e', '#a3683a', '#8a2f5c'];
    state.pens.push({ name: 'Pen ' + (state.pens.length + 1), color: hues[state.pens.length % hues.length], width: 1, style: 'solid', height: 1, opacity: 1 });
    editingPen = state.pens.length;
    setPen(state.pens.length);
  }

  function deletePen(id) {
    if (state.pens.length <= 1) return;
    finishAnimation();
    const remap = (arr) => { for (let i = 0; i < arr.length; i++) { if (arr[i] === id) arr[i] = 1; else if (arr[i] > id) arr[i]--; } };
    for (const m of [state.maze].concat(history.undo, history.redo)) { remap(m.h); remap(m.v); remap(m.f); }
    state.pens.splice(id - 1, 1);
    editingPen = 0;
    state.pen = clamp(state.pen > id ? state.pen - 1 : state.pen, 1, state.pens.length);
    renderPens();
    changed();
  }

  // ------------------------------------------------------------ paper

  function applyPaper(key) {
    const p = PAPERS[key];
    if (!p) return;
    Object.assign(state.look, { paperKey: key, paper: p.paper, grid: p.grid });
    syncLookInputs();
    renderPens();
    requestRender();
    scheduleSave();
  }

  function syncLookInputs() {
    const L = state.look;
    $('paperSelect').value = PAPERS[L.paperKey] ? L.paperKey : 'custom';
    for (const [id, key] of [['paperColor', 'paper'], ['gridColor', 'grid'], ['paintColor', 'paint'], ['pathColor', 'path'],
      ['startColor', 'start'], ['endColor', 'end'], ['floorColor', 'floor'], ['stairColor', 'stair']]) $(id).value = L[key];
    $('skyColor').value = /^#[0-9a-f]{6}$/i.test(skyColor()) ? skyColor() : '#e4e9ec';
    $('gridToggle').checked = L.showGrid;
    $('rulerToggle').checked = L.showRulers;
    $('ghostToggle').checked = L.ghost;
    $('voidSelect').value = L.voidStyle;
    $('cellInput').value = L.cellSize; $('cellOut').textContent = L.cellSize + 'px';
    $('thickInput').value = Math.round(L.thickness * 100); $('thickOut').textContent = Math.round(L.thickness * 100) + '%';
    $('capSelect').value = L.cap;
    $('cutSelect').value = L.cut;
    $('heightInput').value = Math.round(L.wallHeight * 100); $('heightOut').textContent = L.wallHeight.toFixed(1);
    $('gapInput').value = Math.round(L.levelGap * 100); $('gapOut').textContent = L.levelGap.toFixed(1);
    $('floorOpInput').value = Math.round(L.floorOpacity * 100); $('floorOpOut').textContent = Math.round(L.floorOpacity * 100) + '%';
    $('mmInput').value = L.mmPerCell; $('mmOut').textContent = L.mmPerCell;
  }

  // ------------------------------------------------------------ stats

  let statsTimer = 0;
  function scheduleStats() { clearTimeout(statsTimer); statsTimer = setTimeout(renderStats, anim ? 400 : 60); }
  function renderStats() {
    const m = state.maze, s = K.stats(m), path = K.solve(m);
    let climbs = 0;
    if (path) for (let k = 1; k < path.length; k++) if (m.pos(path[k]).z !== m.pos(path[k - 1]).z) climbs++;
    const rows = [
      ['Open cells', s.cells.toLocaleString()],
      ['Wall segments', s.walls.toLocaleString()],
      ['Stairs', s.stairs.toLocaleString()],
      ['Dead ends', s.deadEnds.toLocaleString()],
      ['Junctions', s.junctions.toLocaleString()],
      ['Loops', s.loops.toLocaleString()],
      ['Separate areas', s.parts.toLocaleString(), s.parts > 1],
      ['Solution length', !m.start || !m.end ? 'place start and end' : path ? path.length + ' cells' : 'no route', !!(m.start && m.end && !path)],
    ];
    if (path) rows.push(['Level changes on route', climbs.toLocaleString()]);
    $('stats').innerHTML = rows.map(([k, v, bad]) => '<dt>' + k + '</dt><dd' + (bad ? ' class="bad"' : '') + '>' + v + '</dd>').join('');
  }

  // ------------------------------------------------------------ 3D geometry

  // Every solid piece of the model as boxes in cell units:
  // {x, y, z, sx, sy, sz} centres and sizes, grouped by what draws them.
  // Shared by the 3D view and STL export.
  function buildBoxes(levelFilter) {
    const m = state.maze, L = state.look;
    const walls = new Map(), floors = [], ladders = [];
    const H = L.wallHeight;
    for (let z = 0; z < m.levels; z++) {
      if (levelFilter && !levelFilter(z)) continue;
      const y0 = levelY(z);
      for (const run of wallRuns(m, z)) {
        const pen = state.pens[run.pen - 1] || state.pens[0];
        const t = Math.max(0.02, L.thickness * pen.width);
        const h = Math.max(0.02, H * pen.height);
        const b = run.y1 === run.y2
          ? { x: (run.x1 + run.x2) / 2, y: y0 + h / 2, z: run.y1, sx: run.x2 - run.x1 + t, sy: h, sz: t }
          : { x: run.x1, y: y0 + h / 2, z: (run.y1 + run.y2) / 2, sx: t, sy: h, sz: run.y2 - run.y1 + t };
        if (!walls.has(run.pen)) walls.set(run.pen, []);
        walls.get(run.pen).push(b);
      }
      // Floor under level z, merged along rows.
      for (let r = 0; r < m.rows; r++) {
        let from = -1;
        for (let c = 0; c <= m.cols; c++) {
          const solid = c < m.cols && !m.isVoid(c, r, z) && m.f[m.fIndex(c, r, z)] !== 0;
          if (solid && from < 0) from = c;
          if (!solid && from >= 0) {
            floors.push({ x: (from + c) / 2, y: y0 - SLAB / 2, z: r + 0.5, sx: c - from, sy: SLAB, sz: 1 });
            from = -1;
          }
        }
      }
      // Ladders up from this level.
      const top = levelY(z + 1);
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        if (!m.passable(c, r, z, U)) continue;
        const h = top - y0, cx = c + 0.5, cz = r + 0.5;
        ladders.push({ x: cx - 0.17, y: y0 + h / 2, z: cz, sx: 0.04, sy: h, sz: 0.04 });
        ladders.push({ x: cx + 0.17, y: y0 + h / 2, z: cz, sx: 0.04, sy: h, sz: 0.04 });
        const rungs = Math.max(2, Math.round(h / 0.18));
        for (let k = 1; k < rungs; k++) ladders.push({ x: cx, y: y0 + (h * k) / rungs, z: cz, sx: 0.34, sy: 0.025, sz: 0.035 });
      }
    }
    return { walls, floors, ladders };
  }

  // ------------------------------------------------------------ 3D view

  let three = null;
  const walk = { on: false, x: 0, y: 0, level: 0, yaw: 0, pitch: 0, eye: 0, keys: new Set(), reached: false, lastT: 0 };
  const cam = { target: null, radius: 20, theta: -0.7, phi: 0.95 };

  function init3D() {
    if (!window.THREE) { $('no3d').hidden = false; $('no3d').textContent = 'The 3D view could not load (three.js did not arrive). The floor plan still works.'; return; }
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
      $('no3d').hidden = false;
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 2000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8a94, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);
    const content = new THREE.Group();
    scene.add(content);
    three = { renderer, scene, camera, sun, content, box: new THREE.BoxGeometry(1, 1, 1), dirty: true, needsDraw: true };
    cam.target = new THREE.Vector3();
    wireOrbit();
    fitCamera();
    rebuild();
    loop3d();
  }

  function resize3D() {
    if (!three) return;
    const r = canvas3d.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    three.renderer.setSize(r.width, r.height, false);
    three.camera.aspect = r.width / r.height;
    three.camera.updateProjectionMatrix();
    three.needsDraw = true;
  }

  let rebuildTimer = 0, lastRebuild = 0;
  function scheduleRebuild() {
    if (!three) return;
    if (rebuildTimer) return;
    // During animation rebuild at most ~8 times a second.
    const wait = anim ? Math.max(0, 120 - (performance.now() - lastRebuild)) : 0;
    rebuildTimer = setTimeout(() => { rebuildTimer = 0; requestAnimationFrame(rebuild); }, wait);
  }

  function disposeGroup(g) {
    for (const child of g.children.slice()) {
      g.remove(child);
      if (child.geometry && child.geometry !== three.box) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  function instanced(list, material, shadows) {
    const mesh = new THREE.InstancedMesh(three.box, material, Math.max(1, list.length));
    const mtx = new THREE.Matrix4();
    list.forEach((b, i) => { mtx.makeScale(b.sx, b.sy, b.sz); mtx.setPosition(b.x, b.y, b.z); mesh.setMatrixAt(i, mtx); });
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    return mesh;
  }

  function visibleLevel(z) {
    const cut = walk.on ? 'all' : state.look.cut;
    if (cut === 'all') return true;
    if (cut === 'only') return z === state.level;
    return z <= state.level;
  }

  function rebuild() {
    if (!three) return;
    lastRebuild = performance.now();
    const m = state.maze, L = state.look;
    const { content } = three;
    disposeGroup(content);
    three.renderer.setClearColor(skyColor());
    const { walls, floors, ladders } = buildBoxes(visibleLevel);
    for (const [penId, list] of walls) {
      const pen = state.pens[penId - 1] || state.pens[0];
      const mat = new THREE.MeshStandardMaterial({ color: pen.color, roughness: 0.85, metalness: 0.02, transparent: pen.opacity < 1, opacity: pen.opacity });
      if (pen.opacity < 1) mat.depthWrite = false;
      content.add(instanced(list, mat, pen.opacity >= 0.6));
    }
    if (floors.length && L.floorOpacity > 0) {
      const mat = new THREE.MeshStandardMaterial({ color: L.floor, roughness: 0.95, transparent: L.floorOpacity < 1, opacity: L.floorOpacity });
      content.add(instanced(floors, mat, false));
    }
    if (ladders.length) {
      content.add(instanced(ladders, new THREE.MeshStandardMaterial({ color: L.stair, roughness: 0.6 }), true));
    }
    // Painted cells as thin tiles just above the floor.
    const tiles = new Map();
    for (let z = 0; z < m.levels; z++) {
      if (!visibleLevel(z)) continue;
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        const f = m.fill[m.idx(c, r, z)];
        if (!f || !m.fillColors[f] || m.voids[m.idx(c, r, z)]) continue;
        if (!tiles.has(f)) tiles.set(f, []);
        tiles.get(f).push({ x: c + 0.5, y: levelY(z) + 0.004, z: r + 0.5, sx: 1, sy: 0.006, sz: 1 });
      }
    }
    for (const [f, list] of tiles) content.add(instanced(list, new THREE.MeshStandardMaterial({ color: m.fillColors[f], roughness: 1 }), false));

    // Ground grid for scale.
    const span = Math.max(m.cols, m.rows) + 6;
    const grid = new THREE.GridHelper(span, span, 0x9aa7b0, 0xc2ccd2);
    grid.position.set(m.cols / 2, -SLAB - 0.005, m.rows / 2);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    content.add(grid);

    // Solution as a tube, split where it leaves the visible levels.
    const a = analysis();
    if (a.path && a.path.length > 1) {
      // Walking: a thin line on the floor instead of a tube at eye level.
      const lift = walk.on ? 0.03 : Math.min(0.18, L.wallHeight * 0.25);
      const radius = walk.on ? 0.035 : 0.09;
      let chunk = [];
      const flush = () => {
        if (chunk.length > 1) {
          const curve = new THREE.CurvePath();
          for (let k = 1; k < chunk.length; k++) curve.add(new THREE.LineCurve3(chunk[k - 1], chunk[k]));
          const geo = new THREE.TubeGeometry(curve, Math.max(4, chunk.length * 2), radius, 8, false);
          content.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: L.path, roughness: 0.5, emissive: L.path, emissiveIntensity: 0.25 })));
        }
        chunk = [];
      };
      for (const i of a.path) {
        const p = m.pos(i);
        if (!visibleLevel(p.z)) { flush(); continue; }
        chunk.push(new THREE.Vector3(p.c + 0.5, levelY(p.z) + lift, p.r + 0.5));
      }
      flush();
    }
    const addMarker = (p, color, isEnd) => {
      if (!p || !visibleLevel(p.z)) return;
      const geo = isEnd ? new THREE.OctahedronGeometry(0.28) : new THREE.SphereGeometry(0.24, 24, 16);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.2 }));
      mesh.position.set(p.c + 0.5, levelY(p.z) + 0.3, p.r + 0.5);
      mesh.castShadow = true;
      content.add(mesh);
    };
    addMarker(m.start, L.start, false);
    addMarker(m.end, L.end, true);
    if (anim && anim.cursor >= 0) {
      const p = m.pos(anim.cursor);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: cssVar('--accent') || '#0b7593' }));
      mesh.position.set(p.c + 0.5, levelY(p.z) + 0.3, p.r + 0.5);
      content.add(mesh);
    }

    // Light and shadow camera sized to the model.
    const height = levelY(m.levels);
    const ext = Math.max(m.cols, m.rows, height) * 0.8 + 2;
    const sc = three.sun.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 0.5; sc.far = ext * 6;
    sc.updateProjectionMatrix();
    three.sun.target.position.set(m.cols / 2, 0, m.rows / 2);
    three.sun.position.set(m.cols / 2 - ext * 0.9, ext * 2.2, m.rows / 2 + ext * 1.4);
    three.needsDraw = true;
  }

  const skyColor = () => state.look.sky || cssVar('--bg') || '#e4e9ec';

  function fitCamera() {
    if (!three) return;
    const m = state.maze;
    const height = levelY(m.levels);
    cam.target.set(m.cols / 2, height * 0.35, m.rows / 2);
    cam.radius = Math.max(m.cols, m.rows, height) * 1.55 + 3;
    cam.theta = -0.7;
    cam.phi = 0.95;
    three.needsDraw = true;
  }

  function placeCamera() {
    const c = three.camera;
    if (walk.on) {
      const m = state.maze;
      const target = levelY(walk.level) + walk.eye;
      // Ease towards the eye height so climbing reads as movement.
      walk.camY = walk.camY === undefined ? target : walk.camY + (target - walk.camY) * 0.18;
      c.position.set(walk.x, walk.camY, walk.y);
      const dx = -Math.sin(walk.yaw) * Math.cos(walk.pitch), dz = -Math.cos(walk.yaw) * Math.cos(walk.pitch), dy = Math.sin(walk.pitch);
      c.lookAt(walk.x + dx, walk.camY + dy, walk.y + dz);
      if (c.fov !== 72) { c.fov = 72; c.updateProjectionMatrix(); }
      void m;
      return;
    }
    if (c.fov !== 45) { c.fov = 45; c.updateProjectionMatrix(); }
    const sp = Math.sin(cam.phi);
    c.position.set(
      cam.target.x + cam.radius * sp * Math.sin(cam.theta),
      cam.target.y + cam.radius * Math.cos(cam.phi),
      cam.target.z + cam.radius * sp * Math.cos(cam.theta),
    );
    c.lookAt(cam.target);
  }

  function loop3d(t) {
    requestAnimationFrame(loop3d);
    if (!three || state.layout === 'plan') return;
    if (walk.on) stepWalk(t || 0);
    if (!three.needsDraw && !walk.on) return;
    three.needsDraw = false;
    placeCamera();
    three.renderer.render(three.scene, three.camera);
  }

  function wireOrbit() {
    const ptrs = new Map();
    let drag = null, pinch3 = null;
    canvas3d.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas3d.addEventListener('pointerdown', (e) => {
      canvas3d.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch3 = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        drag = null;
        return;
      }
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
    });
    canvas3d.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch3 && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (!walk.on) {
          if (pinch3.d > 0) cam.radius = clamp(cam.radius * (pinch3.d / d), 1, 600);
          panBy(mx - pinch3.mx, my - pinch3.my);
        }
        pinch3 = { d, mx, my };
        three.needsDraw = true;
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (walk.on) {
        walk.yaw -= dx * 0.005;
        walk.pitch = clamp(walk.pitch - dy * 0.004, -1.1, 1.1);
      } else if (drag.pan) panBy(dx, dy);
      else {
        cam.theta -= dx * 0.008;
        cam.phi = clamp(cam.phi - dy * 0.008, 0.08, 1.52);
      }
      three.needsDraw = true;
    });
    const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch3 = null; if (!ptrs.size) drag = null; };
    canvas3d.addEventListener('pointerup', up);
    canvas3d.addEventListener('pointercancel', up);
    canvas3d.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (walk.on) return;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      cam.radius = clamp(cam.radius * Math.exp(delta * 0.0012), 1, 600);
      three.needsDraw = true;
    }, { passive: false });
  }

  function panBy(dx, dy) {
    const k = cam.radius * 0.0016;
    const right = new THREE.Vector3(Math.cos(cam.theta), 0, -Math.sin(cam.theta));
    const fwd = new THREE.Vector3(Math.sin(cam.theta), 0, Math.cos(cam.theta));
    cam.target.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k);
  }

  // ------------------------------------------------------------ walking

  function startWalk() {
    if (!three) return;
    const m = state.maze;
    let p = m.start;
    if (!p) {
      for (let i = 0; i < m.size && !p; i++) if (!m.voids[i] && m.pos(i).z === state.level) p = m.pos(i);
    }
    if (!p) { toast('There is no walkable cell to stand on.'); return; }
    if (state.layout === 'plan') setLayout('split');
    walk.on = true;
    walk.x = p.c + 0.5; walk.y = p.r + 0.5; walk.level = p.z;
    walk.eye = Math.min(0.45, state.look.wallHeight * 0.55);
    walk.camY = undefined;
    walk.pitch = 0;
    walk.reached = false;
    // Face the first open side.
    const yawFor = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
    walk.yaw = 0;
    for (let d = 0; d < 4; d++) if (m.passable(p.c, p.r, p.z, d)) { walk.yaw = yawFor[d]; break; }
    $('walkBtn').setAttribute('aria-pressed', 'true');
    $('walkBtn').textContent = 'Stop walking';
    $('walkHelp').hidden = false;
    setLevel(walk.level);
    rebuild();
    updateWalkHint();
    if (document.activeElement) document.activeElement.blur();
  }

  function stopWalk() {
    if (!walk.on) return;
    walk.on = false;
    walk.keys.clear();
    $('walkBtn').setAttribute('aria-pressed', 'false');
    $('walkBtn').textContent = 'Walk';
    $('walkHelp').hidden = true;
    rebuild();
    requestRender();
  }

  const WALK_KEYS = {
    w: 'fwd', arrowup: 'fwd', s: 'back', arrowdown: 'back', a: 'left', d: 'right',
    arrowleft: 'turnL', arrowright: 'turnR',
  };
  function walkKey(e, down) {
    const k = e.key.toLowerCase();
    if (WALK_KEYS[k]) { if (down) walk.keys.add(WALK_KEYS[k]); else walk.keys.delete(WALK_KEYS[k]); return true; }
    if (down && (k === 'e' || k === ' ')) { climb(U); return true; }
    if (down && (k === 'q' || k === 'c')) { climb(D); return true; }
    return false;
  }

  function climb(d) {
    const m = state.maze, c = Math.floor(walk.x), r = Math.floor(walk.y);
    if (!m.passable(c, r, walk.level, d)) { toast(d === U ? 'No stairs up here' : 'No stairs down here'); return; }
    walk.level += DZ[d];
    setLevel(walk.level);
    updateWalkHint();
  }

  function stepWalk(t) {
    const dt = Math.min(0.05, walk.lastT ? (t - walk.lastT) / 1000 : 0.016);
    walk.lastT = t;
    const k = walk.keys;
    if (k.has('turnL')) walk.yaw += 2.2 * dt;
    if (k.has('turnR')) walk.yaw -= 2.2 * dt;
    let f = 0, s = 0;
    if (k.has('fwd')) f += 1;
    if (k.has('back')) f -= 1;
    if (k.has('left')) s -= 1;
    if (k.has('right')) s += 1;
    if (!f && !s) return;
    const speed = 2.4 * dt;
    const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw);
    const rx = Math.cos(walk.yaw), rz = -Math.sin(walk.yaw);
    move((fx * f + rx * s) * speed, (fz * f + rz * s) * speed);
  }

  // Slide along walls: resolve x and then y against the walls of the cell
  // the walker is in.
  function move(dx, dy) {
    const m = state.maze, z = walk.level, rad = 0.2;
    const blocked = (c, r, d) => !m.passable(c, r, z, d);
    let c = Math.floor(walk.x), r = Math.floor(walk.y);
    let nx = walk.x + dx;
    if (dx > 0 && nx > c + 1 - rad && blocked(c, r, E)) nx = c + 1 - rad;
    if (dx < 0 && nx < c + rad && blocked(c, r, W)) nx = c + rad;
    walk.x = nx;
    c = Math.floor(walk.x);
    let ny = walk.y + dy;
    if (dy > 0 && ny > r + 1 - rad && blocked(c, r, S)) ny = r + 1 - rad;
    if (dy < 0 && ny < r + rad && blocked(c, r, N)) ny = r + rad;
    walk.y = ny;
    const cell = { c: Math.floor(walk.x), r: Math.floor(walk.y) };
    if (cell.c !== walk.cellC || cell.r !== walk.cellR) {
      walk.cellC = cell.c; walk.cellR = cell.r;
      updateWalkHint();
    }
    requestRender();
  }

  function updateWalkHint() {
    const m = state.maze, c = Math.floor(walk.x), r = Math.floor(walk.y), z = walk.level;
    const up = m.passable(c, r, z, U), down = m.passable(c, r, z, D);
    const here = up && down ? 'Stairs here: E up, Q down' : up ? 'Stairs here: press E to climb' : down ? 'Stairs here: press Q to go down' : '';
    const el = $('walkHelp').querySelector('.here');
    el.textContent = here || 'Level ' + (z + 1) + ' of ' + m.levels;
    if (!walk.reached && isAt(m.end, c, r, z)) {
      walk.reached = true;
      toast('You reached the end.');
    }
  }

  function buildWalkPad() {
    const help = $('walkHelp');
    const here = document.createElement('span');
    here.className = 'here';
    help.appendChild(here);
    // Touch controls for phones and tablets.
    const pad = document.createElement('div');
    pad.className = 'walkpad';
    const keys = [['turnL', '⟲', 'Turn left'], ['fwd', '▲', 'Forward'], ['turnR', '⟳', 'Turn right'], ['climbD', 'Q ▼', 'Go down'], ['back', '▼', 'Back'], ['climbU', 'E ▲', 'Climb']];
    for (const [k, label, title] of keys) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn icon';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      if (k === 'climbU' || k === 'climbD') b.addEventListener('click', () => climb(k === 'climbU' ? U : D));
      else {
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); walk.keys.add(k); });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => walk.keys.delete(k));
      }
      pad.appendChild(b);
    }
    help.appendChild(pad);
  }

  // ------------------------------------------------------------ layout

  function setLayout(mode) {
    state.layout = mode;
    $('views').dataset.mode = mode;
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === mode)));
    requestAnimationFrame(() => { resizeCanvas(); resize3D(); fitView(); if (three) three.needsDraw = true; });
    scheduleSave();
  }

  // ------------------------------------------------------------ export

  function exportPNG() {
    if (!three) { toast('The 3D view is not available, so there is nothing to export.'); return; }
    finishAnimation();
    const r = three.renderer, dpr = window.devicePixelRatio || 1;
    r.setPixelRatio(dpr * 2);
    resize3D();
    placeCamera();
    r.render(three.scene, three.camera);
    canvas3d.toBlob((blob) => {
      if (blob) saveFile(fileBase() + '-3d.png', blob); else toast('The browser could not create the image.');
    }, 'image/png');
    r.setPixelRatio(dpr);
    resize3D();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  // All levels' plans on one sheet, laid out in a grid.
  function exportSVG() {
    finishAnimation();
    const m = state.maze, L = state.look, size = cs();
    const f = (n) => +n.toFixed(2);
    const colsN = Math.ceil(Math.sqrt(m.levels));
    const rowsN = Math.ceil(m.levels / colsN);
    const gap = size * 2, label = size * 1.2;
    const pw = m.cols * size, ph = m.rows * size;
    const W = colsN * pw + (colsN + 1) * gap, H = rowsN * (ph + label) + (rowsN + 1) * gap;
    const out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + f(W) + '" height="' + f(H) + '" viewBox="0 0 ' + f(W) + ' ' + f(H) + '">');
    out.push('<title>' + esc(m.cols + ' × ' + m.rows + ' × ' + m.levels + ' maze plans') + '</title>');
    out.push('<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="' + L.grid + '" stroke-width="1.5"/></pattern></defs>');
    out.push('<rect width="100%" height="100%" fill="#ffffff"/>');
    const a = analysis();
    for (let z = 0; z < m.levels; z++) {
      const gx = gap + (z % colsN) * (pw + gap), gy = gap + Math.floor(z / colsN) * (ph + label + gap);
      out.push('<g id="level-' + (z + 1) + '" transform="translate(' + f(gx) + ' ' + f(gy) + ')">');
      out.push('<text x="0" y="' + f(label * 0.6) + '" font-family="IBM Plex Mono, monospace" font-size="' + f(size * 0.55) + '" fill="#16202a">Level ' + (z + 1) + '</text>');
      out.push('<g transform="translate(0 ' + f(label) + ')">');
      out.push('<rect width="' + pw + '" height="' + ph + '" fill="' + L.paper + '"/>');
      const cellsWhere = (test, fill) => {
        const parts = [];
        for (let r = 0; r < m.rows; r++) {
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
      out.push(cellsWhere((c, r) => { const i = m.idx(c, r, z); return m.fill[i] && !m.voids[i] ? m.fill[i] : null; }, (k) => m.fillColors[k]));
      if (a.dist && a.maxDist > 0) out.push(cellsWhere((c, r) => { const d = a.dist[m.idx(c, r, z)]; return d >= 0 ? d : null; }, (d) => heatColor(d / a.maxDist)));
      if (L.showGrid) {
        const d = [];
        for (let c = 0; c <= m.cols; c++) d.push('M' + c * size + ' 0V' + ph);
        for (let r = 0; r <= m.rows; r++) d.push('M0 ' + r * size + 'H' + pw);
        out.push('<path d="' + d.join('') + '" stroke="' + L.grid + '" stroke-width="' + f(size * 0.03) + '" fill="none"/>');
      }
      if (L.voidStyle !== 'hidden') {
        const fill = L.voidStyle === 'solid' ? L.grid : 'url(#hatch)';
        out.push(cellsWhere((c, r) => (m.voids[m.idx(c, r, z)] ? 1 : null), () => fill));
      }
      const tri = [];
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        const s = size * 0.26;
        if (m.passable(c, r, z, U)) { const cx = (c + 0.72) * size, cy = (r + 0.3) * size; tri.push('M' + f(cx - s / 2) + ' ' + f(cy + s / 3) + 'H' + f(cx + s / 2) + 'L' + f(cx) + ' ' + f(cy - s / 2) + 'Z'); }
        if (m.passable(c, r, z, D)) { const cx = (c + 0.28) * size, cy = (r + 0.7) * size; tri.push('M' + f(cx - s / 2) + ' ' + f(cy - s / 3) + 'H' + f(cx + s / 2) + 'L' + f(cx) + ' ' + f(cy + s / 2) + 'Z'); }
      }
      if (tri.length) out.push('<path class="stairs" d="' + tri.join('') + '" fill="' + L.stair + '"/>');
      if (a.path) {
        const segs = [];
        let cur = [];
        for (const i of a.path) {
          const p = m.pos(i);
          if (p.z !== z) { if (cur.length > 1) segs.push(cur); cur = []; continue; }
          cur.push(f((p.c + 0.5) * size) + ',' + f((p.r + 0.5) * size));
        }
        if (cur.length > 1) segs.push(cur);
        for (const sgm of segs) out.push('<polyline points="' + sgm.join(' ') + '" fill="none" stroke="' + L.path + '" stroke-width="' + f(size * 0.22) + '" stroke-linecap="round" stroke-linejoin="round"/>');
      }
      const runs = wallRuns(m, z);
      state.pens.forEach((pen, k) => {
        const list = runs.filter((r) => r.pen === k + 1);
        if (!list.length) return;
        const d = list.map((r) => 'M' + r.x1 * size + ' ' + r.y1 * size + (r.x1 === r.x2 ? 'V' + r.y2 * size : 'H' + r.x2 * size)).join('');
        const dash = penDash(pen, size);
        out.push('<path data-pen="' + esc(pen.name) + '" d="' + d + '" fill="none" stroke="' + pen.color + '" stroke-width="' + f(L.thickness * size * pen.width) +
          '" stroke-linecap="' + (pen.style === 'dotted' ? 'round' : L.cap) + '"' + (dash.length ? ' stroke-dasharray="' + dash.map(f).join(' ') + '"' : '') + '/>');
      });
      const mark = (p, color, isEnd) => {
        if (!p || p.z !== z) return '';
        const x = (p.c + 0.5) * size, y = (p.r + 0.5) * size, rad = size * 0.3;
        return (isEnd
          ? '<rect x="' + f(x - rad * 0.8) + '" y="' + f(y - rad * 0.8) + '" width="' + f(rad * 1.6) + '" height="' + f(rad * 1.6) + '" rx="' + f(rad * 0.35) + '" fill="' + color + '"/>'
          : '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(rad) + '" fill="' + color + '"/>') +
          '<text x="' + f(x) + '" y="' + f(y) + '" fill="#fff" font-family="IBM Plex Sans, Arial, sans-serif" font-weight="600" font-size="' + f(size * 0.36) + '" text-anchor="middle" dominant-baseline="central">' + (isEnd ? 'E' : 'S') + '</text>';
      };
      out.push(mark(m.start, L.start, false) + mark(m.end, L.end, true));
      out.push('</g></g>');
    }
    out.push('</svg>');
    saveFile(fileBase() + '-plans.svg', out.join('\n'));
  }

  // Binary STL of walls and floors, Z up, in millimetres.
  function buildSTL() {
    const { walls, floors } = buildBoxes(null);
    const boxes = floors.slice();
    for (const list of walls.values()) for (const b of list) boxes.push(b);
    const mm = state.look.mmPerCell;
    const TRIS = [[1, 3, 7], [1, 7, 5], [0, 4, 6], [0, 6, 2], [2, 6, 7], [2, 7, 3], [0, 1, 5], [0, 5, 4], [4, 5, 7], [4, 7, 6], [0, 2, 3], [0, 3, 1]];
    const buf = new ArrayBuffer(84 + boxes.length * 12 * 50);
    const dv = new DataView(buf);
    const header = 'Maze Builder 3D ' + state.maze.cols + 'x' + state.maze.rows + 'x' + state.maze.levels;
    for (let i = 0; i < Math.min(80, header.length); i++) dv.setUint8(i, header.charCodeAt(i));
    dv.setUint32(80, boxes.length * 12, true);
    let o = 84;
    const v = new Float32Array(24);
    for (const b of boxes) {
      for (let i = 0; i < 8; i++) {
        const x = b.x + (i & 1 ? 0.5 : -0.5) * b.sx;
        const y = b.y + (i & 2 ? 0.5 : -0.5) * b.sy;
        const z = b.z + (i & 4 ? 0.5 : -0.5) * b.sz;
        // Rotate scene axes (Y up) to printer axes (Z up): (x, y, z) -> (x, -z, y).
        v[i * 3] = x * mm; v[i * 3 + 1] = -z * mm; v[i * 3 + 2] = y * mm;
      }
      for (const [a, bb, c] of TRIS) {
        const ax = v[a * 3], ay = v[a * 3 + 1], az = v[a * 3 + 2];
        const ux = v[bb * 3] - ax, uy = v[bb * 3 + 1] - ay, uz = v[bb * 3 + 2] - az;
        const wx = v[c * 3] - ax, wy = v[c * 3 + 1] - ay, wz = v[c * 3 + 2] - az;
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
        o += 12;
        for (const idx of [a, bb, c]) {
          dv.setFloat32(o, v[idx * 3], true); dv.setFloat32(o + 4, v[idx * 3 + 1], true); dv.setFloat32(o + 8, v[idx * 3 + 2], true);
          o += 12;
        }
        dv.setUint16(o, 0, true);
        o += 2;
      }
    }
    return new Uint8Array(buf);
  }

  // Minimal store-only ZIP, used where .stl files cannot be saved directly.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zipOne(name, data) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
    central.setUint32(16, crc, true); central.setUint32(20, data.length, true); central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    const end = new DataView(new ArrayBuffer(22));
    const cdOffset = 30 + nameBytes.length + data.length;
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
    end.setUint32(12, 46 + nameBytes.length, true); end.setUint32(16, cdOffset, true);
    return new Blob([local, nameBytes, data, central, nameBytes, end], { type: 'application/zip' });
  }

  async function exportSTL() {
    finishAnimation();
    const stl = buildSTL();
    const name = fileBase() + '.stl';
    // The Claude viewer only saves certain file types, STL not among them.
    if (await getDownloads()) saveFile(name + '.zip', zipOne(name, stl));
    else saveFile(name, new Blob([stl], { type: 'model/stl' }));
  }

  const fileBase = () => {
    const m = state.maze;
    return 'maze-' + m.cols + 'x' + m.rows + 'x' + m.levels + (state.lastSeed ? '-' + state.lastSeed : '');
  };

  // ------------------------------------------------------------ files

  function draftJSON() {
    return {
      app: 'maze-builder-3d', version: 1,
      maze: state.maze.toJSON(), pens: state.pens, pen: state.pen, look: state.look,
      gen: state.gen, show: state.show, layout: state.layout, level: state.level, selAll: state.selAll,
      seed: $('seedInput').value,
    };
  }

  function loadDraft(o) {
    if (!o || o.app !== 'maze-builder-3d' || !o.maze) {
      throw new Error(o && o.app === 'maze-builder' ? 'that is a 2D draft; open it in the 2D builder' : 'this file is not a Maze Builder 3D draft');
    }
    const maze = Maze3D.fromJSON(o.maze);
    const pens = Array.isArray(o.pens) && o.pens.length
      ? o.pens.slice(0, 9).map((p) => ({
        name: String(p.name || 'Pen'),
        color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#46525e',
        width: clamp(+p.width || 1, 0.2, 6),
        style: ['solid', 'dashed', 'dotted'].includes(p.style) ? p.style : 'solid',
        height: clamp(+p.height || 1, 0.05, 1),
        opacity: clamp(+p.opacity || 1, 0.1, 1),
      }))
      : defaultPens();
    const fix = (arr) => { for (let i = 0; i < arr.length; i++) if (arr[i] > pens.length) arr[i] = 1; };
    fix(maze.h); fix(maze.v); fix(maze.f);
    state.maze = maze;
    state.pens = pens;
    state.pen = clamp(o.pen | 0 || 1, 1, pens.length);
    state.look = Object.assign(defaultLook(), o.look || {});
    state.look.cellSize = clamp(+state.look.cellSize || 28, 8, 64);
    state.look.thickness = clamp(+state.look.thickness || 0.14, 0.02, 0.6);
    state.look.wallHeight = clamp(+state.look.wallHeight || 0.8, 0.2, 3);
    state.look.levelGap = clamp(+state.look.levelGap, 0, 4) || 0;
    state.gen = Object.assign(state.gen, o.gen || {});
    state.show = Object.assign({ solution: false, heat: false, dead: false }, o.show || {});
    state.layout = ['plan', 'split', '3d'].includes(o.layout) ? o.layout : 'split';
    state.level = clamp(o.level | 0, 0, maze.levels - 1);
    state.selAll = o.selAll !== false;
    $('seedInput').value = o.seed || '';
    state.selection = null;
  }

  const saveDraft = () => saveFile(fileBase() + '.json', JSON.stringify(draftJSON()));

  let downloadsCap;
  async function getDownloads() {
    if (downloadsCap !== undefined) return downloadsCap;
    downloadsCap = null;
    try { if (window.claude && typeof window.claude.use === 'function') downloadsCap = await window.claude.use('downloads'); } catch (e) { downloadsCap = null; }
    return downloadsCap;
  }

  async function saveFile(filename, data) {
    const dl = await getDownloads();
    if (dl) {
      try { await dl.save({ filename, data }); toast('Saved ' + filename); }
      catch (e) {
        const code = e && e.code;
        toast(code === 'declined' ? 'Save cancelled' : code === 'rate_limited' ? 'A save prompt is already open' : 'This view cannot save files');
      }
      return;
    }
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Saved ' + filename);
  }

  function openFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        finishAnimation();
        stopWalk();
        pushHistory();
        loadDraft(JSON.parse(reader.result));
        syncAllInputs();
        setLayout(state.layout);
        fitView();
        fitCamera();
        changed();
        toast('Opened ' + file.name);
      } catch (err) {
        dropLastHistory();
        toast('Could not open ' + file.name + ': ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(draftJSON())); } catch (e) { /* storage unavailable */ } }, 600);
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      loadDraft(JSON.parse(raw));
      return true;
    } catch (e) { return false; }
  }

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
    const G = state.gen;
    $('algoSelect').value = G.algorithm;
    $('algoNote').textContent = (K.ALGORITHMS[G.algorithm] || {}).note || '';
    $('braidInput').value = G.braid; $('braidOut').textContent = G.braid + '%';
    $('vertInput').value = G.vertical; $('vertOut').textContent = G.vertical + '%';
    $('stairsInput').value = G.stairs; $('stairsOut').textContent = G.stairs;
    $('layeredInput').checked = G.layered;
    $('bottomTopInput').checked = G.bottomTop;
    $('bordersEnds').checked = G.borderEnds;
    $('animateInput').checked = G.animate;
    $('speedInput').value = G.speed; $('speedOut').textContent = G.speed;
    $('speedField').hidden = !G.animate;
    $('selAllInput').checked = state.selAll;
    $('solutionToggle').checked = state.show.solution;
    $('heatToggle').checked = state.show.heat;
    $('deadToggle').checked = state.show.dead;
    renderPens();
    updateSelectionUI();
  }

  function wire() {
    const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
    const save = () => scheduleSave();

    on('undoBtn', 'click', undo);
    on('redoBtn', 'click', redo);
    on('openBtn', 'click', () => $('openInput').click());
    on('openInput', 'change', (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
    on('saveBtn', 'click', saveDraft);
    on('pngBtn', 'click', exportPNG);
    on('svgBtn', 'click', exportSVG);
    on('stlBtn', 'click', exportSTL);
    on('zoomIn', 'click', () => zoomCenter(1.25));
    on('zoomOut', 'click', () => zoomCenter(0.8));
    on('zoomFit', 'click', fitView);
    on('levelUp', 'click', () => setLevel(state.level + 1));
    on('levelDown', 'click', () => setLevel(state.level - 1));
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.view)));
    on('walkBtn', 'click', () => (walk.on ? stopWalk() : startWalk()));
    on('resetCamBtn', 'click', () => { stopWalk(); fitCamera(); });

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) openFile(f); });

    // size and levels
    on('resizeBtn', 'click', () => {
      const [c, r, l] = readSize();
      const m = state.maze;
      if (c === m.cols && r === m.rows && l === m.levels) { toast('Already ' + c + ' × ' + r + ' × ' + l); return; }
      levelOp((mz) => mz.resized(c, r, l, state.pen));
    });
    on('newGridBtn', 'click', () => { const [c, r, l] = readSize(); newMaze(c, r, l, 'grid'); });
    on('newOpenBtn', 'click', () => { const [c, r, l] = readSize(); newMaze(c, r, l, 'open'); });
    const roomFor = () => {
      const m = state.maze;
      if (m.levels >= MAX_LEVELS || m.cols * m.rows * (m.levels + 1) > MAX_CELLS) { toast('That would be more levels than the builder supports.'); return false; }
      return true;
    };
    on('addLevelBtn', 'click', () => {
      if (!roomFor()) return;
      const z = state.level + 1;
      levelOp((m) => m.withLevelInserted(z, -1, state.pen), 'Added level ' + (z + 1));
      setLevel(z);
    });
    on('dupLevelBtn', 'click', () => {
      if (!roomFor()) return;
      const z = state.level + 1, src = state.level;
      levelOp((m) => m.withLevelInserted(z, src, state.pen), 'Copied level ' + (src + 1) + ' to level ' + (z + 1));
      setLevel(z);
    });
    on('delLevelBtn', 'click', () => {
      if (state.maze.levels <= 1) return;
      const z = state.level;
      levelOp((m) => m.withLevelRemoved(z), 'Deleted level ' + (z + 1) + '. Undo brings it back.');
      setLevel(Math.min(z, state.maze.levels - 1));
    });
    const shapeSel = $('shapeSelect');
    for (const [k, s] of Object.entries(K.SHAPES)) shapeSel.appendChild(Object.assign(document.createElement('option'), { value: k, textContent: s.name }));
    on('shapeBtn', 'click', () => {
      finishAnimation();
      pushHistory();
      const m = state.maze;
      K.applyShape(m, shapeSel.value, state.selection ? region() : null, state.pen);
      if (m.start && m.isVoid(m.start.c, m.start.r, m.start.z)) m.start = null;
      if (m.end && m.isVoid(m.end.c, m.end.r, m.end.z)) m.end = null;
      changed();
      toast(K.SHAPES[shapeSel.value].name + ' applied. Generate to fill it with a maze.');
    });

    // generate
    const algoSel = $('algoSelect');
    for (const [k, a] of Object.entries(K.ALGORITHMS)) algoSel.appendChild(Object.assign(document.createElement('option'), { value: k, textContent: a.name }));
    on('algoSelect', 'change', () => { state.gen.algorithm = algoSel.value; $('algoNote').textContent = K.ALGORITHMS[algoSel.value].note; save(); });
    const range = (id, out, key, suffix) => on(id, 'input', (e) => { state.gen[key] = +e.target.value; $(out).textContent = e.target.value + (suffix || ''); save(); });
    range('braidInput', 'braidOut', 'braid', '%');
    range('vertInput', 'vertOut', 'vertical', '%');
    range('stairsInput', 'stairsOut', 'stairs');
    range('speedInput', 'speedOut', 'speed');
    const check = (id, key) => on(id, 'change', (e) => { state.gen[key] = e.target.checked; save(); });
    check('layeredInput', 'layered');
    check('bottomTopInput', 'bottomTop');
    check('bordersEnds', 'borderEnds');
    on('animateInput', 'change', (e) => { state.gen.animate = e.target.checked; $('speedField').hidden = !e.target.checked; save(); });
    on('selAllInput', 'change', (e) => { state.selAll = e.target.checked; save(); });
    on('seedInput', 'input', save);
    on('genBtn', 'click', () => { if (anim) finishAnimation(); else generate(); });

    // walls
    on('addPenBtn', 'click', addPen);
    on('recolorBtn', 'click', () => bulk((cur) => (cur ? state.pen : 0), 'Redrew {n} walls with “' + state.pens[state.pen - 1].name + '”'));
    on('fillWallsBtn', 'click', () => bulk((cur, e) => { const [a, b] = edgeSides(e); return a && b ? cur : cur || state.pen; }, 'Added {n} walls'));
    on('clearWallsBtn', 'click', () => {
      const sel = state.selection;
      bulk((cur, e) => {
        if (!sel) { const [a, b] = edgeSides(e); return a !== b ? cur : 0; } // keep the outer border
        const outer = e.k === 'h' ? e.r === sel.r0 || e.r === sel.r1 + 1 : e.c === sel.c0 || e.c === sel.c1 + 1;
        return outer ? cur : 0;
      }, 'Removed {n} walls');
    });
    on('borderBtn', 'click', () => bulk((cur, e) => { const [a, b] = edgeSides(e); return a !== b && !cur ? state.pen : cur; }, 'Added {n} border walls', true));
    on('thickInput', 'input', (e) => { state.look.thickness = +e.target.value / 100; $('thickOut').textContent = e.target.value + '%'; renderPens(); requestRender(); scheduleRebuild(); save(); });
    on('capSelect', 'change', (e) => { state.look.cap = e.target.value; renderPens(); requestRender(); save(); });

    // 3D look
    on('cutSelect', 'change', (e) => { state.look.cut = e.target.value; scheduleRebuild(); save(); });
    const look3 = (id, out, key, fmt) => on(id, 'input', (e) => {
      state.look[key] = +e.target.value / (key === 'mmPerCell' ? 1 : 100);
      $(out).textContent = fmt(state.look[key]);
      scheduleRebuild();
      save();
    });
    look3('heightInput', 'heightOut', 'wallHeight', (v) => v.toFixed(1));
    look3('gapInput', 'gapOut', 'levelGap', (v) => v.toFixed(1));
    look3('floorOpInput', 'floorOpOut', 'floorOpacity', (v) => Math.round(v * 100) + '%');
    look3('mmInput', 'mmOut', 'mmPerCell', (v) => String(v));

    // plan paper
    const paperSel = $('paperSelect');
    for (const [k, p] of Object.entries(PAPERS)) paperSel.appendChild(Object.assign(document.createElement('option'), { value: k, textContent: p.name }));
    paperSel.appendChild(Object.assign(document.createElement('option'), { value: 'custom', textContent: 'Custom', disabled: true }));
    on('paperSelect', 'change', (e) => applyPaper(e.target.value));
    const colorInput = (id, key, opts) => on(id, 'input', (e) => {
      state.look[key] = e.target.value;
      if (opts.custom) { state.look.paperKey = 'custom'; $('paperSelect').value = 'custom'; renderPens(); }
      hatchCache = null;
      requestRender();
      if (opts.three) scheduleRebuild();
      save();
    });
    colorInput('paperColor', 'paper', { custom: true });
    colorInput('gridColor', 'grid', { custom: true });
    colorInput('paintColor', 'paint', {});
    for (const [id, key] of [['pathColor', 'path'], ['startColor', 'start'], ['endColor', 'end'], ['stairColor', 'stair'], ['floorColor', 'floor'], ['skyColor', 'sky']]) colorInput(id, key, { three: true });
    on('cellInput', 'input', (e) => {
      const r = planPane.getBoundingClientRect();
      const old = cs(), next = +e.target.value, cx = r.width / 2, cy = r.height / 2;
      state.view.x = cx - ((cx - state.view.x) * next) / old;
      state.view.y = cy - ((cy - state.view.y) * next) / old;
      state.look.cellSize = next;
      $('cellOut').textContent = next + 'px';
      requestRender();
      save();
    });
    const lookToggle = (id, key) => on(id, 'change', (e) => { state.look[key] = e.target.checked; requestRender(); save(); });
    lookToggle('gridToggle', 'showGrid');
    lookToggle('rulerToggle', 'showRulers');
    lookToggle('ghostToggle', 'ghost');
    on('voidSelect', 'change', (e) => { state.look.voidStyle = e.target.value; requestRender(); save(); });

    // check
    const showToggle = (id, key) => on(id, 'change', (e) => { state.show[key] = e.target.checked; analysisCache = null; requestRender(); scheduleRebuild(); save(); });
    showToggle('solutionToggle', 'solution');
    showToggle('heatToggle', 'heat');
    showToggle('deadToggle', 'dead');

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', themeChanged);
    }
    new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    new ResizeObserver(() => { resizeCanvas(); resize3D(); }).observe($('views'));
  }

  function themeChanged() {
    requestRender();
    if (!state.look.sky) { scheduleRebuild(); $('skyColor').value = skyColor(); }
  }

  // A worked example: a four-level tower with the route from the bottom
  // level to the top, and a glass-walled atrium on level 2.
  function loadExample() {
    const m = new Maze3D(12, 12, 4);
    m.f.fill(1);
    state.maze = m;
    const g = K.makeContext(m, null, MK.makeRng('tower:backtracker:3d'), 1, { vertical: 0.15 });
    K.prepare(g);
    const it = K.ALGORITHMS.backtracker.run(g);
    while (!it.next().done);
    K.connectAll(g);
    K.placeEnds(g, true, true);
    // Atrium: open a 4x4 room on level 2 with glass walls round it.
    const z = 1;
    for (let r = 4; r <= 7; r++) for (let c = 4; c <= 7; c++) {
      for (let d = 0; d < 4; d++) {
        const inside = (c + DC[d] >= 4 && c + DC[d] <= 7 && r + DR[d] >= 4 && r + DR[d] <= 7);
        if (inside) m.setWall(c, r, z, d, 0);
        else if (m.getWall(c, r, z, d)) m.setWall(c, r, z, d, 3);
      }
    }
    const paint = m.fillIndexFor('#f2cf5b');
    for (let r = 5; r <= 6; r++) for (let c = 5; c <= 6; c++) m.fill[m.idx(c, r, z)] = paint;
    state.lastSeed = 'tower';
    state.show.solution = true;
    state.level = 1;
  }

  // ------------------------------------------------------------ boot

  buildTools();
  buildWalkPad();
  wire();
  if (!loadSaved()) loadExample();
  syncAllInputs();
  setTool('wall');
  updateHistoryButtons();
  $('views').dataset.mode = state.layout;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.layout)));
  resizeCanvas();
  init3D();
  resize3D();
  fitView();
  renderStats();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestRender);
})();
