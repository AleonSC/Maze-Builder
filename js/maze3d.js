/*
 * Maze Builder 3D — multi-level maze model, generators and analysis.
 * Depends on js/maze.js for the seeded RNG and base64 helpers. No DOM access.
 *
 * Cells are (c, r, z): column, row, level (z = 0 is the ground level).
 * Each level has its own wall edges, laid out like the 2D model:
 *   h[z*(rows+1)*cols + r*cols + c]       top side of cell row r
 *   v[z*rows*(cols+1) + r*(cols+1) + c]   left side of cell column c
 * Floors are slabs between levels:
 *   f[z*rows*cols + r*cols + c]           floor under level z (z = levels is the roof)
 * 0 means open (a floor opening is a stairwell); any other value is a pen id.
 */
(function (global) {
  'use strict';

  const MK = global.MazeKit;
  const N = 0, E = 1, S = 2, W = 3, U = 4, D = 5;
  const DC = [0, 1, 0, -1, 0, 0];
  const DR = [-1, 0, 1, 0, 0, 0];
  const DZ = [0, 0, 0, 0, 1, -1];

  class Maze3D {
    constructor(cols, rows, levels) {
      this.cols = cols;
      this.rows = rows;
      this.levels = levels;
      this.h = new Uint8Array(levels * (rows + 1) * cols);
      this.v = new Uint8Array(levels * rows * (cols + 1));
      this.f = new Uint8Array((levels + 1) * rows * cols);
      this.voids = new Uint8Array(levels * rows * cols);
      this.fill = new Uint8Array(levels * rows * cols);
      this.fillColors = [null];
      this.start = null; // {c, r, z}
      this.end = null;
    }

    get size() { return this.cols * this.rows * this.levels; }
    idx(c, r, z) { return z * this.rows * this.cols + r * this.cols + c; }
    pos(i) {
      const rc = this.rows * this.cols, z = Math.floor(i / rc), rem = i - z * rc;
      return { c: rem % this.cols, r: Math.floor(rem / this.cols), z };
    }
    hIndex(c, r, z) { return z * (this.rows + 1) * this.cols + r * this.cols + c; }
    vIndex(c, r, z) { return z * this.rows * (this.cols + 1) + r * (this.cols + 1) + c; }
    fIndex(c, r, z) { return z * this.rows * this.cols + r * this.cols + c; }

    inBounds(c, r, z) {
      return c >= 0 && r >= 0 && z >= 0 && c < this.cols && r < this.rows && z < this.levels;
    }
    isVoid(c, r, z) { return !this.inBounds(c, r, z) || this.voids[this.idx(c, r, z)] === 1; }

    edgeRef(c, r, z, d) {
      switch (d) {
        case N: return [this.h, this.hIndex(c, r, z)];
        case S: return [this.h, this.hIndex(c, r + 1, z)];
        case W: return [this.v, this.vIndex(c, r, z)];
        case E: return [this.v, this.vIndex(c + 1, r, z)];
        case U: return [this.f, this.fIndex(c, r, z + 1)];
        default: return [this.f, this.fIndex(c, r, z)];
      }
    }
    getWall(c, r, z, d) { const [a, i] = this.edgeRef(c, r, z, d); return a[i]; }
    setWall(c, r, z, d, val) { const [a, i] = this.edgeRef(c, r, z, d); a[i] = val; }

    passable(c, r, z, d) {
      return !this.isVoid(c, r, z) && !this.isVoid(c + DC[d], r + DR[d], z + DZ[d]) && this.getWall(c, r, z, d) === 0;
    }

    fillIndexFor(color) {
      const i = this.fillColors.indexOf(color);
      if (i > 0) return i;
      if (this.fillColors.length >= 255) {
        const used = new Set(this.fill);
        for (let k = 1; k < this.fillColors.length; k++) if (!used.has(k)) { this.fillColors[k] = color; return k; }
        return 1;
      }
      this.fillColors.push(color);
      return this.fillColors.length - 1;
    }

    clone() {
      const m = new Maze3D(this.cols, this.rows, this.levels);
      m.h.set(this.h); m.v.set(this.v); m.f.set(this.f);
      m.voids.set(this.voids); m.fill.set(this.fill);
      m.fillColors = this.fillColors.slice();
      m.start = this.start && { ...this.start };
      m.end = this.end && { ...this.end };
      return m;
    }

    // Copy one level (its walls, the floor under it, voids and paint) from
    // `src` level zs into this maze's level zd. Overlapping area only.
    copyLevelFrom(src, zs, zd) {
      const cc = Math.min(this.cols, src.cols), rr = Math.min(this.rows, src.rows);
      for (let r = 0; r <= rr; r++) {
        for (let c = 0; c < cc; c++) this.h[this.hIndex(c, r, zd)] = src.h[src.hIndex(c, r, zs)];
      }
      for (let r = 0; r < rr; r++) {
        for (let c = 0; c <= cc; c++) this.v[this.vIndex(c, r, zd)] = src.v[src.vIndex(c, r, zs)];
        for (let c = 0; c < cc; c++) {
          this.f[this.fIndex(c, r, zd)] = src.f[src.fIndex(c, r, zs)];
          this.voids[this.idx(c, r, zd)] = src.voids[src.idx(c, r, zs)];
          this.fill[this.idx(c, r, zd)] = src.fill[src.idx(c, r, zs)];
        }
      }
    }

    copyRoofFrom(src) {
      const cc = Math.min(this.cols, src.cols), rr = Math.min(this.rows, src.rows);
      for (let r = 0; r < rr; r++) for (let c = 0; c < cc; c++) {
        this.f[this.fIndex(c, r, this.levels)] = src.f[src.fIndex(c, r, src.levels)];
      }
    }

    // Different size, keeping what fits. Added area gets solid floors and the
    // outer edge of every level is walled with `pen`.
    resized(cols, rows, levels, pen) {
      const m = new Maze3D(cols, rows, levels);
      const zz = Math.min(levels, this.levels);
      for (let z = 0; z < zz; z++) m.copyLevelFrom(this, z, z);
      for (let z = 0; z <= levels; z++) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (z >= zz || c >= this.cols || r >= this.rows) m.f[m.fIndex(c, r, z)] = pen;
      }
      for (let z = 0; z < levels; z++) {
        for (let c = 0; c < cols; c++) {
          if (!m.h[m.hIndex(c, 0, z)]) m.h[m.hIndex(c, 0, z)] = pen;
          if (!m.h[m.hIndex(c, rows, z)]) m.h[m.hIndex(c, rows, z)] = pen;
        }
        for (let r = 0; r < rows; r++) {
          if (!m.v[m.vIndex(0, r, z)]) m.v[m.vIndex(0, r, z)] = pen;
          if (!m.v[m.vIndex(cols, r, z)]) m.v[m.vIndex(cols, r, z)] = pen;
        }
      }
      m.fillColors = this.fillColors.slice();
      const keep = (p) => (p && p.c < cols && p.r < rows && p.z < levels ? { ...p } : null);
      m.start = keep(this.start);
      m.end = keep(this.end);
      return m;
    }

    // New maze with a level inserted at index z. `source` is a level index
    // of this maze to copy, or -1 for an empty level.
    withLevelInserted(z, source, pen) {
      const m = new Maze3D(this.cols, this.rows, this.levels + 1);
      for (let k = 0; k < this.levels; k++) m.copyLevelFrom(this, k, k < z ? k : k + 1);
      m.copyRoofFrom(this);
      if (source >= 0) {
        m.copyLevelFrom(this, source, z);
      } else {
        // Empty level: outer border only.
        for (let c = 0; c < m.cols; c++) { m.h[m.hIndex(c, 0, z)] = pen; m.h[m.hIndex(c, m.rows, z)] = pen; }
        for (let r = 0; r < m.rows; r++) { m.v[m.vIndex(0, r, z)] = pen; m.v[m.vIndex(m.cols, r, z)] = pen; }
      }
      // The new level keeps the floor openings that led into the old level z,
      // and the level that moved up gets a solid floor.
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        m.f[m.fIndex(c, r, z)] = z < this.levels ? this.f[this.fIndex(c, r, z)] : this.f[this.fIndex(c, r, this.levels)];
        if (z + 1 <= this.levels) m.f[m.fIndex(c, r, z + 1)] = pen;
      }
      m.fillColors = this.fillColors.slice();
      const shift = (p) => (p ? { ...p, z: p.z >= z ? p.z + 1 : p.z } : null);
      m.start = shift(this.start);
      m.end = shift(this.end);
      return m;
    }

    withLevelRemoved(z) {
      const m = new Maze3D(this.cols, this.rows, this.levels - 1);
      for (let k = 0, j = 0; k < this.levels; k++) {
        if (k === z) continue;
        m.copyLevelFrom(this, k, j);
        if (k === z + 1) {
          // The level that drops down sits on the removed level's floor.
          for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) m.f[m.fIndex(c, r, j)] = this.f[this.fIndex(c, r, z)];
        }
        j++;
      }
      m.copyRoofFrom(this);
      m.fillColors = this.fillColors.slice();
      const shift = (p) => (!p || p.z === z ? null : { ...p, z: p.z > z ? p.z - 1 : p.z });
      m.start = shift(this.start);
      m.end = shift(this.end);
      return m;
    }

    toJSON() {
      const b = MK.bytesToB64;
      return {
        cols: this.cols, rows: this.rows, levels: this.levels,
        h: b(this.h), v: b(this.v), f: b(this.f), voids: b(this.voids), fill: b(this.fill),
        fillColors: this.fillColors, start: this.start, end: this.end,
      };
    }

    static fromJSON(o) {
      const cols = o.cols | 0, rows = o.rows | 0, levels = o.levels | 0;
      if (cols < 1 || rows < 1 || levels < 1 || cols > 300 || rows > 300 || levels > 64) {
        throw new Error('Maze size ' + cols + '×' + rows + '×' + levels + ' is out of range');
      }
      const m = new Maze3D(cols, rows, levels);
      const d = MK.b64ToBytes;
      m.h = d(o.h, m.h.length); m.v = d(o.v, m.v.length); m.f = d(o.f, m.f.length);
      m.voids = d(o.voids, m.voids.length); m.fill = d(o.fill, m.fill.length);
      m.fillColors = Array.isArray(o.fillColors) ? o.fillColors.slice(0, 255) : [null];
      m.fillColors[0] = null;
      const pt = (p) => (p && m.inBounds(p.c, p.r, p.z) ? { c: p.c, r: p.r, z: p.z } : null);
      m.start = pt(o.start);
      m.end = pt(o.end);
      return m;
    }
  }

  // ---------------------------------------------------------------- context

  // region: {c0, r0, z0, c1, r1, z1} inclusive, or null for everything.
  // opts.vertical: weight of up/down moves when picking neighbours (0..1).
  // opts.allowVertical: false keeps generation within each level.
  function makeContext(maze, region, rng, pen, opts) {
    const o = opts || {};
    const reg = region || { c0: 0, r0: 0, z0: 0, c1: maze.cols - 1, r1: maze.rows - 1, z1: maze.levels - 1 };
    const mask = new Uint8Array(maze.size);
    const cells = [];
    for (let z = reg.z0; z <= reg.z1; z++) for (let r = reg.r0; r <= reg.r1; r++) for (let c = reg.c0; c <= reg.c1; c++) {
      const i = maze.idx(c, r, z);
      if (!maze.voids[i]) { mask[i] = 1; cells.push(i); }
    }
    const ctx = {
      maze, region: reg, mask, cells, rng, pen,
      vertical: o.vertical === undefined ? 1 : o.vertical,
      allowVertical: o.allowVertical !== false,
    };
    ctx.active = (c, r, z) => maze.inBounds(c, r, z) && mask[maze.idx(c, r, z)] === 1;
    ctx.nbrs = (i, all) => {
      const { c, r, z } = maze.pos(i), out = [];
      const dMax = all || ctx.allowVertical ? 6 : 4;
      for (let d = 0; d < dMax; d++) {
        const nc = c + DC[d], nr = r + DR[d], nz = z + DZ[d];
        if (ctx.active(nc, nr, nz)) out.push([maze.idx(nc, nr, nz), d]);
      }
      return out;
    };
    // Weighted choice that favours flat moves when `vertical` is low.
    ctx.pick = (opts2) => {
      if (opts2.length === 1 || ctx.vertical === 1) return rng.pick(opts2);
      let total = 0;
      for (const [, d] of opts2) total += d >= 4 ? ctx.vertical : 1;
      if (total <= 0) return rng.pick(opts2);
      let x = rng() * total;
      for (const o2 of opts2) { x -= o2[1] >= 4 ? ctx.vertical : 1; if (x <= 0) return o2; }
      return opts2[opts2.length - 1];
    };
    ctx.carve = (i, d) => { const p = maze.pos(i); maze.setWall(p.c, p.r, p.z, d, 0); };
    ctx.isOpen = (i, d) => { const p = maze.pos(i); return maze.getWall(p.c, p.r, p.z, d) === 0; };
    return ctx;
  }

  function prepare(ctx) {
    const { maze, region, pen } = ctx;
    for (let z = region.z0; z <= region.z1; z++) for (let r = region.r0; r <= region.r1; r++) for (let c = region.c0; c <= region.c1; c++) {
      const isV = maze.isVoid(c, r, z);
      for (let d = 0; d < 6; d++) {
        const nVoid = maze.isVoid(c + DC[d], r + DR[d], z + DZ[d]);
        if (!isV) maze.setWall(c, r, z, d, pen);
        else maze.setWall(c, r, z, d, nVoid ? 0 : pen);
      }
    }
  }

  function islands(ctx) {
    const comp = new Int32Array(ctx.maze.size).fill(-1);
    const roots = [];
    for (const s of ctx.cells) {
      if (comp[s] >= 0) continue;
      const id = roots.length;
      roots.push(s);
      comp[s] = id;
      const stack = [s];
      while (stack.length) {
        const i = stack.pop();
        for (const [j] of ctx.nbrs(i)) if (comp[j] < 0) { comp[j] = id; stack.push(j); }
      }
    }
    return { comp, roots };
  }

  function unionFind(n) {
    const p = new Int32Array(n);
    for (let i = 0; i < n; i++) p[i] = i;
    const find = (x) => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; };
    return { find, union: (a, b) => { a = find(a); b = find(b); if (a === b) return false; p[a] = b; return true; } };
  }

  // ---------------------------------------------------------------- generators

  function* backtracker(ctx) {
    const seen = new Uint8Array(ctx.maze.size);
    for (const s of ctx.rng.shuffle(ctx.cells.slice())) {
      if (seen[s]) continue;
      seen[s] = 1;
      const stack = [s];
      while (stack.length) {
        const cur = stack[stack.length - 1];
        const opts = ctx.nbrs(cur).filter(([j]) => !seen[j]);
        if (!opts.length) { stack.pop(); continue; }
        const [j, d] = ctx.pick(opts);
        ctx.carve(cur, d);
        seen[j] = 1;
        stack.push(j);
        yield j;
      }
    }
  }

  function* growingTree(ctx) {
    const seen = new Uint8Array(ctx.maze.size);
    for (const s of ctx.rng.shuffle(ctx.cells.slice())) {
      if (seen[s]) continue;
      seen[s] = 1;
      const list = [s];
      while (list.length) {
        const k = ctx.rng() < 0.75 ? list.length - 1 : ctx.rng.int(list.length);
        const cur = list[k];
        const opts = ctx.nbrs(cur).filter(([j]) => !seen[j]);
        if (!opts.length) { list.splice(k, 1); continue; }
        const [j, d] = ctx.pick(opts);
        ctx.carve(cur, d);
        seen[j] = 1;
        list.push(j);
        yield j;
      }
    }
  }

  function* prim(ctx) {
    const state = new Uint8Array(ctx.maze.size);
    for (const s of ctx.rng.shuffle(ctx.cells.slice())) {
      if (state[s]) continue;
      const frontier = [];
      const add = (i) => {
        state[i] = 2;
        for (const [j] of ctx.nbrs(i)) if (state[j] === 0) { state[j] = 1; frontier.push(j); }
      };
      add(s);
      while (frontier.length) {
        const k = ctx.rng.int(frontier.length);
        const cur = frontier[k];
        frontier[k] = frontier[frontier.length - 1];
        frontier.pop();
        const ins = ctx.nbrs(cur).filter(([j]) => state[j] === 2);
        ctx.carve(cur, ctx.pick(ins)[1]);
        add(cur);
        yield cur;
      }
    }
  }

  function* kruskal(ctx) {
    const edges = [];
    for (const i of ctx.cells) {
      for (const [j, d] of ctx.nbrs(i)) {
        if (d !== E && d !== S && d !== U) continue;
        // Weighted shuffle key: low vertical weight pushes stairs later.
        const w = d === U ? Math.max(ctx.vertical, 1e-3) : 1;
        edges.push([Math.pow(ctx.rng(), 1 / w), i, j, d]);
      }
    }
    edges.sort((a, b) => b[0] - a[0]);
    const uf = unionFind(ctx.maze.size);
    for (const [, i, j, d] of edges) if (uf.union(i, j)) { ctx.carve(i, d); yield j; }
  }

  function* wilson(ctx) {
    const { roots } = islands(ctx);
    const inTree = new Uint8Array(ctx.maze.size);
    for (const r of roots) inTree[r] = 1;
    const next = new Int32Array(ctx.maze.size);
    const nextDir = new Int8Array(ctx.maze.size);
    for (const s of ctx.rng.shuffle(ctx.cells.slice())) {
      if (inTree[s]) continue;
      let cur = s;
      while (!inTree[cur]) {
        const [j, d] = ctx.rng.pick(ctx.nbrs(cur));
        next[cur] = j; nextDir[cur] = d;
        cur = j;
      }
      cur = s;
      while (!inTree[cur]) {
        ctx.carve(cur, nextDir[cur]);
        inTree[cur] = 1;
        cur = next[cur];
        yield cur;
      }
    }
  }

  function* huntAndKill(ctx) {
    const seen = new Uint8Array(ctx.maze.size);
    const order = ctx.cells;
    let cur = ctx.rng.pick(order);
    if (cur === undefined) return;
    seen[cur] = 1;
    let scanFrom = 0;
    for (;;) {
      const opts = ctx.nbrs(cur).filter(([j]) => !seen[j]);
      if (opts.length) {
        const [j, d] = ctx.pick(opts);
        ctx.carve(cur, d);
        seen[j] = 1;
        cur = j;
        yield cur;
        continue;
      }
      let found = -1;
      while (scanFrom < order.length && seen[order[scanFrom]]) scanFrom++;
      for (let k = scanFrom; k < order.length; k++) {
        const i = order[k];
        if (seen[i]) continue;
        const vis = ctx.nbrs(i).filter(([j]) => seen[j]);
        if (vis.length) { ctx.carve(i, ctx.pick(vis)[1]); found = i; break; }
      }
      if (found < 0) {
        if (scanFrom >= order.length) return;
        found = order[scanFrom];
      }
      seen[found] = 1;
      cur = found;
      yield cur;
    }
  }

  function* aldousBroder(ctx) {
    const { comp, roots } = islands(ctx);
    const seen = new Uint8Array(ctx.maze.size);
    const sizes = new Int32Array(roots.length);
    for (const i of ctx.cells) sizes[comp[i]]++;
    for (let k = 0; k < roots.length; k++) {
      let cur = roots[k], left = sizes[k] - 1, steps = 0;
      seen[cur] = 1;
      while (left > 0) {
        const [j, d] = ctx.rng.pick(ctx.nbrs(cur));
        if (!seen[j]) { ctx.carve(cur, d); seen[j] = 1; left--; yield j; }
        cur = j;
        if (++steps % 64 === 0) yield cur;
      }
    }
  }

  const ALGORITHMS = {
    backtracker: { name: 'Recursive backtracker', note: 'Long winding corridors that wander between levels.', run: backtracker, biased: true },
    growingTree: { name: 'Growing tree', note: 'Mix of long corridors and short branches.', run: growingTree, biased: true },
    huntAndKill: { name: 'Hunt and kill', note: 'Long corridors with fewer dead ends.', run: huntAndKill, biased: true },
    prim: { name: "Prim's", note: 'Lots of short dead ends spreading out.', run: prim, biased: true },
    kruskal: { name: "Kruskal's", note: 'An even mix of short passages.', run: kruskal, biased: true },
    wilson: { name: "Wilson's", note: 'Unbiased; ignores the stair setting.', run: wilson, biased: false },
    aldousBroder: { name: 'Aldous–Broder', note: 'Unbiased and slow on big mazes; ignores the stair setting.', run: aldousBroder, biased: false },
  };

  // Join separate pieces with single openings. `canOpen(i, j, d)` limits
  // which walls may be cut. Vertical joins are allowed here even when the
  // generator stayed within levels: this is how layered mazes get stairs.
  function connectAll(ctx, canOpen) {
    const uf = unionFind(ctx.maze.size);
    const flat = [], up = [];
    for (const i of ctx.cells) {
      for (const [j, d] of ctx.nbrs(i, true)) {
        if (d !== E && d !== S && d !== U) continue;
        if (ctx.isOpen(i, d)) uf.union(i, j);
        else if (!canOpen || canOpen(i, j, d)) (d === U ? up : flat).push([i, j, d]);
      }
    }
    // Prefer joining within a level, then add stairs where still needed.
    for (const [i, j, d] of ctx.rng.shuffle(flat).concat(ctx.rng.shuffle(up))) if (uf.union(i, j)) ctx.carve(i, d);
  }

  // Extra stairwells per pair of levels, which add loops between levels.
  function addStairs(ctx, perLevel) {
    if (perLevel <= 0) return;
    const { maze } = ctx;
    const byLevel = new Map();
    for (const i of ctx.cells) {
      for (const [, d] of ctx.nbrs(i, true)) {
        if (d !== U || ctx.isOpen(i, d)) continue;
        const z = maze.pos(i).z;
        if (!byLevel.has(z)) byLevel.set(z, []);
        byLevel.get(z).push(i);
      }
    }
    for (const list of byLevel.values()) {
      ctx.rng.shuffle(list);
      for (let k = 0; k < Math.min(perLevel, list.length); k++) ctx.carve(list[k], U);
    }
  }

  function stitchRegion(ctx) {
    const whole = makeContext(ctx.maze, null, ctx.rng, ctx.pen);
    connectAll(whole, (i, j) => ctx.mask[i] === 1 || ctx.mask[j] === 1);
  }

  function openCount(ctx, i) {
    let n = 0;
    for (const [, d] of ctx.nbrs(i, true)) if (ctx.isOpen(i, d)) n++;
    return n;
  }

  function braid(ctx, amount) {
    if (amount <= 0) return;
    for (const i of ctx.rng.shuffle(ctx.cells.slice())) {
      if (openCount(ctx, i) !== 1 || ctx.rng() >= amount) continue;
      // Remove dead ends sideways, not by punching holes in floors.
      const closed = ctx.nbrs(i, false).filter(([, d]) => d < 4 && !ctx.isOpen(i, d));
      if (!closed.length) continue;
      const deadNbrs = closed.filter(([j]) => openCount(ctx, j) === 1);
      ctx.carve(i, ctx.rng.pick(deadNbrs.length ? deadNbrs : closed)[1]);
    }
  }

  // ---------------------------------------------------------------- analysis

  function bfs(maze, from, limitMask) {
    const n = maze.size;
    const dist = new Int32Array(n).fill(-1);
    const prev = new Int32Array(n).fill(-1);
    if (!from || maze.isVoid(from.c, from.r, from.z)) return { dist, prev };
    const s = maze.idx(from.c, from.r, from.z);
    const queue = new Int32Array(n);
    let qh = 0, qt = 0;
    queue[qt++] = s;
    dist[s] = 0;
    while (qh < qt) {
      const i = queue[qh++];
      const { c, r, z } = maze.pos(i);
      for (let d = 0; d < 6; d++) {
        if (!maze.passable(c, r, z, d)) continue;
        const j = maze.idx(c + DC[d], r + DR[d], z + DZ[d]);
        if (dist[j] >= 0 || (limitMask && !limitMask[j])) continue;
        dist[j] = dist[i] + 1;
        prev[j] = i;
        queue[qt++] = j;
      }
    }
    return { dist, prev };
  }

  function solve(maze) {
    if (!maze.start || !maze.end) return null;
    const { prev, dist } = bfs(maze, maze.start);
    const t = maze.idx(maze.end.c, maze.end.r, maze.end.z);
    if (dist[t] < 0) return null;
    const path = [];
    for (let i = t; i >= 0; i = prev[i]) path.push(i);
    return path.reverse();
  }

  function degree(maze, c, r, z) {
    let n = 0;
    for (let d = 0; d < 6; d++) if (maze.passable(c, r, z, d)) n++;
    return n;
  }

  function stats(maze) {
    let cells = 0, deadEnds = 0, junctions = 0, walls = 0, stairs = 0, open = 0;
    for (let i = 0; i < maze.h.length; i++) if (maze.h[i]) walls++;
    for (let i = 0; i < maze.v.length; i++) if (maze.v[i]) walls++;
    const uf = unionFind(maze.size);
    for (let z = 0; z < maze.levels; z++) for (let r = 0; r < maze.rows; r++) for (let c = 0; c < maze.cols; c++) {
      if (maze.isVoid(c, r, z)) continue;
      cells++;
      const deg = degree(maze, c, r, z);
      if (deg === 1) deadEnds++;
      if (deg >= 3) junctions++;
      const i = maze.idx(c, r, z);
      if (maze.passable(c, r, z, E)) { open++; uf.union(i, i + 1); }
      if (maze.passable(c, r, z, S)) { open++; uf.union(i, i + maze.cols); }
      if (maze.passable(c, r, z, U)) { open++; stairs++; uf.union(i, i + maze.rows * maze.cols); }
    }
    let parts = 0;
    for (let i = 0; i < maze.size; i++) if (!maze.voids[i] && uf.find(i) === i) parts++;
    return { cells, deadEnds, junctions, walls, stairs, loops: open - (cells - parts), parts };
  }

  function isBorderCell(maze, c, r, z) {
    for (let d = 0; d < 4; d++) if (maze.isVoid(c + DC[d], r + DR[d], z)) return true;
    return false;
  }

  // Start and end as far apart as possible. `onBorder` keeps both on an
  // outside edge and cuts an opening; `bottomToTop` puts the start on the
  // lowest level of the region and the end on the highest.
  function placeEnds(ctx, onBorder, bottomToTop) {
    const { maze, mask, rng, region } = ctx;
    const ok = (i) => { const p = maze.pos(i); return !onBorder || isBorderCell(maze, p.c, p.r, p.z); };
    const all = ctx.cells.filter(ok);
    if (all.length < 2) return;
    const multi = bottomToTop && region.z1 > region.z0;
    const lo = multi ? all.filter((i) => maze.pos(i).z === region.z0) : all;
    const hi = multi ? all.filter((i) => maze.pos(i).z === region.z1) : all;
    if (!lo.length || !hi.length) return;
    const farthest = (from, cands) => {
      const { dist } = bfs(maze, maze.pos(from), mask);
      let best = cands[0], bd = -1;
      for (const i of cands) if (dist[i] > bd) { bd = dist[i]; best = i; }
      return best;
    };
    const a = farthest(rng.pick(hi), lo);
    const b = farthest(a, hi);
    if (a === b) return;
    maze.start = maze.pos(a);
    maze.end = maze.pos(b);
    if (onBorder) {
      for (const p of [maze.start, maze.end]) {
        const sides = [];
        for (let d = 0; d < 4; d++) if (maze.isVoid(p.c + DC[d], p.r + DR[d], p.z)) sides.push(d);
        if (sides.length) maze.setWall(p.c, p.r, p.z, rng.pick(sides), 0);
      }
    }
  }

  // ---------------------------------------------------------------- shapes
  // inside(u, v, w): u, v across the level in -1..1, w from -1 (bottom level)
  // to 1 (top level).

  const flat = MK.SHAPES;
  const SHAPES = {};
  for (const [k, s] of Object.entries(flat)) SHAPES[k] = { name: s.name, inside: (u, v) => s.inside(u, v) };
  Object.assign(SHAPES, {
    pyramid: { name: 'Pyramid', inside: (u, v, w) => Math.max(Math.abs(u), Math.abs(v)) <= 1 - ((w + 1) / 2) * 0.8 },
    cone: { name: 'Cone', inside: (u, v, w) => { const k = 1 - ((w + 1) / 2) * 0.8; return u * u + v * v <= k * k; } },
    sphere: { name: 'Sphere', inside: (u, v, w) => u * u + v * v + w * w * 0.8 <= 1 },
    hourglass: { name: 'Hourglass', inside: (u, v, w) => { const k = 0.35 + 0.65 * Math.abs(w); return Math.max(Math.abs(u), Math.abs(v)) <= k; } },
    ziggurat: { name: 'Stepped tower', inside: (u, v, w) => Math.max(Math.abs(u), Math.abs(v)) <= 1 - Math.floor(((w + 1) / 2) * 3.999) * 0.22 },
  });

  function applyShape(maze, key, region, pen) {
    const shape = SHAPES[key] || SHAPES.rectangle;
    const reg = region || { c0: 0, r0: 0, z0: 0, c1: maze.cols - 1, r1: maze.rows - 1, z1: maze.levels - 1 };
    const w = reg.c1 - reg.c0 + 1, h = reg.r1 - reg.r0 + 1, nz = reg.z1 - reg.z0 + 1;
    for (let z = reg.z0; z <= reg.z1; z++) for (let r = reg.r0; r <= reg.r1; r++) for (let c = reg.c0; c <= reg.c1; c++) {
      const u = ((c - reg.c0 + 0.5) / w) * 2 - 1;
      const v = ((r - reg.r0 + 0.5) / h) * 2 - 1;
      const ww = nz > 1 ? ((z - reg.z0) / (nz - 1)) * 2 - 1 : 0;
      const i = maze.idx(c, r, z);
      maze.voids[i] = shape.inside(u, v, ww) ? 0 : 1;
      if (maze.voids[i]) maze.fill[i] = 0;
    }
    for (let z = reg.z0; z <= reg.z1; z++) for (let r = reg.r0; r <= reg.r1; r++) for (let c = reg.c0; c <= reg.c1; c++) fixVoidEdges(maze, c, r, z, pen);
  }

  function fixVoidEdges(maze, c, r, z, pen) {
    const a = maze.isVoid(c, r, z);
    for (let d = 0; d < 6; d++) {
      const b = maze.isVoid(c + DC[d], r + DR[d], z + DZ[d]);
      if (a && b) maze.setWall(c, r, z, d, 0);
      else if (a !== b && !maze.getWall(c, r, z, d)) maze.setWall(c, r, z, d, pen);
    }
  }

  global.Maze3DKit = {
    N, E, S, W, U, D, DC, DR, DZ,
    Maze3D, makeContext, prepare, connectAll, addStairs, stitchRegion, braid, placeEnds,
    ALGORITHMS, SHAPES, applyShape, fixVoidEdges,
    bfs, solve, stats, degree,
  };
})(typeof window !== 'undefined' ? window : globalThis);
