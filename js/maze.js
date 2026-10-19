/*
 * Maze Builder — data model, generators and analysis.
 * No DOM access in this file, so it can be reused or tested on its own.
 *
 * Walls live on cell edges:
 *   h[r * cols + c]        horizontal edge on the top side of row r   (r = 0..rows)
 *   v[r * (cols + 1) + c]  vertical edge on the left side of column c (c = 0..cols)
 * A wall value of 0 means open; any other value is a pen id (1-based) that
 * decides how the wall is drawn.
 */
(function (global) {
  'use strict';

  const N = 0, E = 1, S = 2, W = 3;
  const DC = [0, 1, 0, -1];
  const DR = [-1, 0, 1, 0];

  // ---------------------------------------------------------------- RNG

  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  // mulberry32, seeded from a string so seeds can be words.
  function makeRng(seed) {
    let a = hashSeed(String(seed))();
    const rng = () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.int = (n) => Math.floor(rng() * n);
    rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
    rng.shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    };
    return rng;
  }

  function randomSeed() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // ---------------------------------------------------------------- base64

  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function b64ToBytes(str, expected) {
    const bin = atob(str);
    if (bin.length !== expected) throw new Error('Layer has ' + bin.length + ' entries, expected ' + expected);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------------------------------------------------------------- model

  class Maze {
    constructor(cols, rows) {
      this.cols = cols;
      this.rows = rows;
      this.h = new Uint8Array((rows + 1) * cols);
      this.v = new Uint8Array(rows * (cols + 1));
      this.voids = new Uint8Array(rows * cols);
      this.fill = new Uint8Array(rows * cols);
      this.fillColors = [null]; // index 0 = unpainted
      this.start = null; // {c, r}
      this.end = null;
    }

    inBounds(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
    isVoid(c, r) { return !this.inBounds(c, r) || this.voids[r * this.cols + c] === 1; }

    edgeRef(c, r, d) {
      switch (d) {
        case N: return [this.h, r * this.cols + c];
        case S: return [this.h, (r + 1) * this.cols + c];
        case W: return [this.v, r * (this.cols + 1) + c];
        default: return [this.v, r * (this.cols + 1) + c + 1];
      }
    }

    getWall(c, r, d) { const [a, i] = this.edgeRef(c, r, d); return a[i]; }
    setWall(c, r, d, val) { const [a, i] = this.edgeRef(c, r, d); a[i] = val; }

    // True if you can walk from (c, r) through side d.
    passable(c, r, d) {
      const nc = c + DC[d], nr = r + DR[d];
      return !this.isVoid(nc, nr) && !this.isVoid(c, r) && this.getWall(c, r, d) === 0;
    }

    fillIndexFor(color) {
      let i = this.fillColors.indexOf(color);
      if (i > 0) return i;
      if (this.fillColors.length >= 255) {
        // Recycle palette slots that no cell uses any more.
        const used = new Set(this.fill);
        for (let k = 1; k < this.fillColors.length; k++) {
          if (!used.has(k)) { this.fillColors[k] = color; return k; }
        }
        return 1;
      }
      this.fillColors.push(color);
      return this.fillColors.length - 1;
    }

    clone() {
      const m = new Maze(this.cols, this.rows);
      m.h.set(this.h); m.v.set(this.v);
      m.voids.set(this.voids); m.fill.set(this.fill);
      m.fillColors = this.fillColors.slice();
      m.start = this.start && { ...this.start };
      m.end = this.end && { ...this.end };
      return m;
    }

    // New maze of a different size, keeping everything that still fits
    // (anchored at the top-left corner).
    resized(cols, rows) {
      const m = new Maze(cols, rows);
      const cc = Math.min(cols, this.cols), rr = Math.min(rows, this.rows);
      for (let r = 0; r <= rr; r++) {
        for (let c = 0; c < cc; c++) {
          if (r < rows + 1 && r < this.rows + 1) m.h[r * cols + c] = this.h[r * this.cols + c];
        }
      }
      for (let r = 0; r < rr; r++) {
        for (let c = 0; c <= cc; c++) m.v[r * (cols + 1) + c] = this.v[r * (this.cols + 1) + c];
        for (let c = 0; c < cc; c++) {
          m.voids[r * cols + c] = this.voids[r * this.cols + c];
          m.fill[r * cols + c] = this.fill[r * this.cols + c];
        }
      }
      m.fillColors = this.fillColors.slice();
      const keep = (p) => (p && p.c < cols && p.r < rows ? { ...p } : null);
      m.start = keep(this.start);
      m.end = keep(this.end);
      return m;
    }

    toJSON() {
      return {
        cols: this.cols,
        rows: this.rows,
        h: bytesToB64(this.h),
        v: bytesToB64(this.v),
        voids: bytesToB64(this.voids),
        fill: bytesToB64(this.fill),
        fillColors: this.fillColors,
        start: this.start,
        end: this.end,
      };
    }

    static fromJSON(o) {
      const cols = o.cols | 0, rows = o.rows | 0;
      if (cols < 1 || rows < 1 || cols > 1000 || rows > 1000) throw new Error('Maze size ' + cols + '×' + rows + ' is out of range');
      const m = new Maze(cols, rows);
      m.h = b64ToBytes(o.h, (rows + 1) * cols);
      m.v = b64ToBytes(o.v, rows * (cols + 1));
      m.voids = b64ToBytes(o.voids, rows * cols);
      m.fill = b64ToBytes(o.fill, rows * cols);
      m.fillColors = Array.isArray(o.fillColors) ? o.fillColors.slice(0, 255) : [null];
      m.fillColors[0] = null;
      const pt = (p) => (p && m.inBounds(p.c, p.r) ? { c: p.c, r: p.r } : null);
      m.start = pt(o.start);
      m.end = pt(o.end);
      return m;
    }
  }

  // ---------------------------------------------------------------- regions

  // A generation context: the cells being worked on plus helpers.
  function makeContext(maze, region, rng, pen) {
    const reg = region || { c0: 0, r0: 0, c1: maze.cols - 1, r1: maze.rows - 1 };
    const mask = new Uint8Array(maze.cols * maze.rows);
    const cells = [];
    for (let r = reg.r0; r <= reg.r1; r++) {
      for (let c = reg.c0; c <= reg.c1; c++) {
        const i = r * maze.cols + c;
        if (!maze.voids[i]) { mask[i] = 1; cells.push(i); }
      }
    }
    const ctx = { maze, region: reg, mask, cells, rng, pen };
    ctx.active = (c, r) => maze.inBounds(c, r) && mask[r * maze.cols + c] === 1;
    // Neighbours of cell index i inside the region: [[j, dir], ...]
    ctx.nbrs = (i) => {
      const c = i % maze.cols, r = (i / maze.cols) | 0, out = [];
      for (let d = 0; d < 4; d++) {
        const nc = c + DC[d], nr = r + DR[d];
        if (ctx.active(nc, nr)) out.push([nr * maze.cols + nc, d]);
      }
      return out;
    };
    ctx.carve = (i, d) => maze.setWall(i % maze.cols, (i / maze.cols) | 0, d, 0);
    ctx.build = (i, d) => maze.setWall(i % maze.cols, (i / maze.cols) | 0, d, pen);
    ctx.isOpen = (i, d) => maze.getWall(i % maze.cols, (i / maze.cols) | 0, d) === 0;
    return ctx;
  }

  // Wall in every cell of the region; open edges between void cells.
  function prepare(ctx) {
    const { maze, region, pen } = ctx;
    for (let r = region.r0; r <= region.r1; r++) {
      for (let c = region.c0; c <= region.c1; c++) {
        const isV = maze.isVoid(c, r);
        for (let d = 0; d < 4; d++) {
          const nVoid = maze.isVoid(c + DC[d], r + DR[d]);
          if (!isV) maze.setWall(c, r, d, pen);
          else maze.setWall(c, r, d, nVoid ? 0 : pen);
        }
      }
    }
  }

  // Connected groups of active cells (ignoring walls). Voids can split a
  // region into islands; each island is generated separately.
  function islands(ctx) {
    const comp = new Int32Array(ctx.maze.cols * ctx.maze.rows).fill(-1);
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
  // Each generator carves passages and yields the cell it just worked on so
  // the UI can animate it.

  function* backtracker(ctx) {
    const seen = new Uint8Array(ctx.mask.length);
    for (const s of ctx.rng.shuffle(ctx.cells.slice())) {
      if (seen[s]) continue;
      seen[s] = 1;
      const stack = [s];
      while (stack.length) {
        const cur = stack[stack.length - 1];
        const opts = ctx.nbrs(cur).filter(([j]) => !seen[j]);
        if (!opts.length) { stack.pop(); continue; }
        const [j, d] = ctx.rng.pick(opts);
        ctx.carve(cur, d);
        seen[j] = 1;
        stack.push(j);
        yield j;
      }
    }
  }

  function* growingTree(ctx, newestBias) {
    const seen = new Uint8Array(ctx.mask.length);
    for (const s of ctx.rng.shuffle(ctx.cells.slice())) {
      if (seen[s]) continue;
      seen[s] = 1;
      const list = [s];
      while (list.length) {
        const k = ctx.rng() < newestBias ? list.length - 1 : ctx.rng.int(list.length);
        const cur = list[k];
        const opts = ctx.nbrs(cur).filter(([j]) => !seen[j]);
        if (!opts.length) { list.splice(k, 1); continue; }
        const [j, d] = ctx.rng.pick(opts);
        ctx.carve(cur, d);
        seen[j] = 1;
        list.push(j);
        yield j;
      }
    }
  }

  function* prim(ctx) {
    const state = new Uint8Array(ctx.mask.length); // 0 out, 1 frontier, 2 in
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
        const [, d] = ctx.rng.pick(ins);
        ctx.carve(cur, d);
        add(cur);
        yield cur;
      }
    }
  }

  function* kruskal(ctx) {
    const { maze } = ctx;
    const edges = [];
    for (const i of ctx.cells) {
      for (const [j, d] of ctx.nbrs(i)) if (d === E || d === S) edges.push([i, j, d]);
    }
    ctx.rng.shuffle(edges);
    const uf = unionFind(maze.cols * maze.rows);
    for (const [i, j, d] of edges) {
      if (uf.union(i, j)) { ctx.carve(i, d); yield j; }
    }
  }

  function* wilson(ctx) {
    const { comp, roots } = islands(ctx);
    const inTree = new Uint8Array(ctx.mask.length);
    for (const r of roots) inTree[r] = 1; // one seed per island
    const next = new Int32Array(ctx.mask.length);
    const nextDir = new Int8Array(ctx.mask.length);
    for (const s of ctx.rng.shuffle(ctx.cells.slice())) {
      if (inTree[s]) continue;
      // Loop-erased random walk until it hits the tree.
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
    void comp;
  }

  function* aldousBroder(ctx) {
    const { comp, roots } = islands(ctx);
    const seen = new Uint8Array(ctx.mask.length);
    const sizes = new Int32Array(roots.length);
    for (const i of ctx.cells) sizes[comp[i]]++;
    for (let k = 0; k < roots.length; k++) {
      let cur = roots[k], left = sizes[k] - 1;
      seen[cur] = 1;
      let steps = 0;
      while (left > 0) {
        const [j, d] = ctx.rng.pick(ctx.nbrs(cur));
        if (!seen[j]) { ctx.carve(cur, d); seen[j] = 1; left--; yield j; }
        cur = j;
        // Walks can be long on big grids; yield now and then so animation stays live.
        if (++steps % 64 === 0) yield cur;
      }
    }
  }

  function* huntAndKill(ctx) {
    const seen = new Uint8Array(ctx.mask.length);
    const order = ctx.cells; // row-major scan
    let cur = ctx.rng.pick(order);
    if (cur === undefined) return;
    seen[cur] = 1;
    let scanFrom = 0;
    for (;;) {
      const opts = ctx.nbrs(cur).filter(([j]) => !seen[j]);
      if (opts.length) {
        const [j, d] = ctx.rng.pick(opts);
        ctx.carve(cur, d);
        seen[j] = 1;
        cur = j;
        yield cur;
        continue;
      }
      // Hunt: first unvisited cell next to a visited one.
      let found = -1;
      while (scanFrom < order.length && seen[order[scanFrom]]) scanFrom++;
      for (let k = scanFrom; k < order.length; k++) {
        const i = order[k];
        if (seen[i]) continue;
        const vis = ctx.nbrs(i).filter(([j]) => seen[j]);
        if (vis.length) {
          ctx.carve(i, ctx.rng.pick(vis)[1]);
          found = i;
          break;
        }
      }
      if (found < 0) {
        // Remaining cells are on another island: start fresh there.
        if (scanFrom >= order.length) return;
        found = order[scanFrom];
      }
      seen[found] = 1;
      cur = found;
      yield cur;
    }
  }

  function* binaryTree(ctx) {
    for (const i of ctx.cells) {
      const opts = ctx.nbrs(i).filter(([, d]) => d === N || d === E);
      if (opts.length) { ctx.carve(i, ctx.rng.pick(opts)[1]); yield i; }
    }
  }

  function* sidewinder(ctx) {
    const { maze, region } = ctx;
    for (let r = region.r0; r <= region.r1; r++) {
      let run = [];
      for (let c = region.c0; c <= region.c1; c++) {
        if (!ctx.active(c, r)) { run = []; continue; }
        const i = r * maze.cols + c;
        run.push(i);
        const canEast = ctx.active(c + 1, r);
        const canNorth = r > region.r0;
        if (!canEast || (canNorth && ctx.rng() < 0.5)) {
          const ups = run.filter((k) => ctx.active(k % maze.cols, r - 1));
          if (canNorth && ups.length) ctx.carve(ctx.rng.pick(ups), N);
          run = [];
        } else {
          ctx.carve(i, E);
        }
        yield i;
      }
    }
  }

  function* recursiveDivision(ctx) {
    const { maze, region } = ctx;
    // Start open, then add walls.
    for (const i of ctx.cells) for (const [, d] of ctx.nbrs(i)) ctx.carve(i, d);
    yield ctx.cells[0];
    const stack = [[region.c0, region.r0, region.c1 - region.c0 + 1, region.r1 - region.r0 + 1]];
    while (stack.length) {
      const [x, y, w, h] = stack.pop();
      if (w < 2 || h < 2) continue;
      const horizontal = h > w ? true : w > h ? false : ctx.rng() < 0.5;
      if (horizontal) {
        const wy = y + 1 + ctx.rng.int(h - 1);
        const gap = x + ctx.rng.int(w);
        for (let c = x; c < x + w; c++) {
          if (c !== gap && ctx.active(c, wy) && ctx.active(c, wy - 1)) maze.setWall(c, wy, N, ctx.pen);
        }
        yield wy * maze.cols + gap;
        stack.push([x, y, w, wy - y], [x, wy, w, y + h - wy]);
      } else {
        const wx = x + 1 + ctx.rng.int(w - 1);
        const gap = y + ctx.rng.int(h);
        for (let r = y; r < y + h; r++) {
          if (r !== gap && ctx.active(wx, r) && ctx.active(wx - 1, r)) maze.setWall(wx, r, W, ctx.pen);
        }
        yield gap * maze.cols + wx;
        stack.push([x, y, wx - x, h], [wx, y, x + w - wx, h]);
      }
    }
  }

  const ALGORITHMS = {
    backtracker: { name: 'Recursive backtracker', note: 'Long winding corridors, few branches.', run: backtracker },
    prim: { name: "Prim's", note: 'Many short dead ends radiating outward.', run: prim },
    kruskal: { name: "Kruskal's", note: 'Even texture of short passages.', run: kruskal },
    wilson: { name: "Wilson's", note: 'Unbiased: every possible maze is equally likely.', run: wilson },
    aldousBroder: { name: 'Aldous–Broder', note: 'Unbiased, slow to finish on large grids.', run: aldousBroder },
    huntAndKill: { name: 'Hunt and kill', note: 'Like the backtracker, with more rivers.', run: huntAndKill },
    growingTree: { name: 'Growing tree', note: 'Mix of backtracker and Prim textures.', run: (ctx) => growingTree(ctx, 0.75) },
    binaryTree: { name: 'Binary tree', note: 'Strong diagonal bias, open north and east edges.', run: binaryTree },
    sidewinder: { name: 'Sidewinder', note: 'Open top corridor, vertical bias.', run: sidewinder },
    division: { name: 'Recursive division', note: 'Long straight walls, room-like blocks.', run: recursiveDivision },
  };

  // Join any separate pieces with single openings so every island ends up as
  // one connected maze, whatever the algorithm did around voids.
  // `canOpen(i, j)` limits which walls may be cut (default: any).
  function connectAll(ctx, canOpen) {
    const { maze } = ctx;
    const uf = unionFind(maze.cols * maze.rows);
    const walled = [];
    for (const i of ctx.cells) {
      for (const [j, d] of ctx.nbrs(i)) {
        if (d !== E && d !== S) continue;
        if (ctx.isOpen(i, d)) uf.union(i, j);
        else if (!canOpen || canOpen(i, j)) walled.push([i, j, d]);
      }
    }
    for (const [i, j, d] of ctx.rng.shuffle(walled)) if (uf.union(i, j)) ctx.carve(i, d);
  }

  function openCount(ctx, i) {
    let n = 0;
    for (const [, d] of ctx.nbrs(i)) if (ctx.isOpen(i, d)) n++;
    return n;
  }

  // After regenerating part of a maze, the region is sealed off and the maze
  // around it may be cut into pieces. Re-join everything with single
  // openings, cutting only walls that touch the region.
  function stitchRegion(ctx) {
    const whole = makeContext(ctx.maze, null, ctx.rng, ctx.pen);
    connectAll(whole, (i, j) => ctx.mask[i] === 1 || ctx.mask[j] === 1);
  }

  // Remove a share of dead ends, which adds loops.
  function braid(ctx, amount) {
    if (amount <= 0) return;
    for (const i of ctx.rng.shuffle(ctx.cells.slice())) {
      if (openCount(ctx, i) !== 1 || ctx.rng() >= amount) continue;
      const closed = ctx.nbrs(i).filter(([, d]) => !ctx.isOpen(i, d));
      if (!closed.length) continue;
      const deadNbrs = closed.filter(([j]) => openCount(ctx, j) === 1);
      const [, d] = ctx.rng.pick(deadNbrs.length ? deadNbrs : closed);
      ctx.carve(i, d);
    }
  }

  // ---------------------------------------------------------------- analysis

  function bfs(maze, from, limitMask) {
    const n = maze.cols * maze.rows;
    const dist = new Int32Array(n).fill(-1);
    const prev = new Int32Array(n).fill(-1);
    if (!from || maze.isVoid(from.c, from.r)) return { dist, prev };
    const s = from.r * maze.cols + from.c;
    const queue = new Int32Array(n);
    let qh = 0, qt = 0;
    queue[qt++] = s;
    dist[s] = 0;
    while (qh < qt) {
      const i = queue[qh++];
      const c = i % maze.cols, r = (i / maze.cols) | 0;
      for (let d = 0; d < 4; d++) {
        if (!maze.passable(c, r, d)) continue;
        const j = (r + DR[d]) * maze.cols + c + DC[d];
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
    const t = maze.end.r * maze.cols + maze.end.c;
    if (dist[t] < 0) return null;
    const path = [];
    for (let i = t; i >= 0; i = prev[i]) path.push(i);
    return path.reverse();
  }

  function degree(maze, c, r) {
    let n = 0;
    for (let d = 0; d < 4; d++) if (maze.passable(c, r, d)) n++;
    return n;
  }

  function stats(maze) {
    let cells = 0, deadEnds = 0, junctions = 0, walls = 0, open = 0;
    for (let i = 0; i < maze.h.length; i++) if (maze.h[i]) walls++;
    for (let i = 0; i < maze.v.length; i++) if (maze.v[i]) walls++;
    const uf = unionFind(maze.cols * maze.rows);
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        if (maze.isVoid(c, r)) continue;
        cells++;
        const deg = degree(maze, c, r);
        if (deg === 1) deadEnds++;
        if (deg >= 3) junctions++;
        const i = r * maze.cols + c;
        if (maze.passable(c, r, E)) { open++; uf.union(i, i + 1); }
        if (maze.passable(c, r, S)) { open++; uf.union(i, i + maze.cols); }
      }
    }
    let parts = 0;
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        const i = r * maze.cols + c;
        if (!maze.isVoid(c, r) && uf.find(i) === i) parts++;
      }
    }
    // Every open edge beyond a spanning forest closes a loop.
    return { cells, deadEnds, junctions, walls, loops: open - (cells - parts), parts };
  }

  // A cell is on the border if any side leads off the grid or into a void.
  function isBorderCell(maze, c, r) {
    for (let d = 0; d < 4; d++) if (maze.isVoid(c + DC[d], r + DR[d])) return true;
    return false;
  }

  function borderSide(maze, c, r, rng) {
    const sides = [];
    for (let d = 0; d < 4; d++) if (maze.isVoid(c + DC[d], r + DR[d])) sides.push(d);
    return sides.length ? rng.pick(sides) : -1;
  }

  // Place start and end as far apart as possible inside the region. With
  // `onBorder`, both sit on the outside edge and get an opening cut.
  function placeEnds(ctx, onBorder) {
    const { maze, mask, rng } = ctx;
    const candidates = onBorder
      ? ctx.cells.filter((i) => isBorderCell(maze, i % maze.cols, (i / maze.cols) | 0))
      : ctx.cells;
    if (candidates.length < 2) return;
    const toPt = (i) => ({ c: i % maze.cols, r: (i / maze.cols) | 0 });
    const farthest = (from) => {
      const { dist } = bfs(maze, toPt(from), mask);
      let best = from, bd = -1;
      for (const i of candidates) if (dist[i] > bd) { bd = dist[i]; best = i; }
      return best;
    };
    const a = farthest(rng.pick(candidates));
    const b = farthest(a);
    if (a === b) return;
    maze.start = toPt(a);
    maze.end = toPt(b);
    if (onBorder) {
      for (const p of [maze.start, maze.end]) {
        const d = borderSide(maze, p.c, p.r, rng);
        if (d >= 0) maze.setWall(p.c, p.r, d, 0);
      }
    }
  }

  // ---------------------------------------------------------------- shapes

  const SHAPES = {
    rectangle: { name: 'Rectangle', inside: () => true },
    circle: { name: 'Circle', inside: (u, v) => u * u + v * v <= 1 },
    ring: { name: 'Ring', inside: (u, v) => { const d = u * u + v * v; return d <= 1 && d >= 0.16; } },
    diamond: { name: 'Diamond', inside: (u, v) => Math.abs(u) + Math.abs(v) <= 1 },
    hexagon: { name: 'Hexagon', inside: (u, v) => Math.abs(v) <= 1 && Math.abs(u) + 0.5 * Math.abs(v) <= 1 },
    triangle: { name: 'Triangle', inside: (u, v) => Math.abs(u) <= (v + 1) / 2 },
    cross: { name: 'Cross', inside: (u, v) => Math.abs(u) <= 0.34 || Math.abs(v) <= 0.34 },
    heart: {
      name: 'Heart',
      inside: (u, v) => {
        const x = u * 1.2, y = -v * 1.15 + 0.12;
        const a = x * x + y * y - 1;
        return a * a * a - x * x * y * y * y <= 0;
      },
    },
  };

  // Turn cells outside the shape into voids, inside the region.
  function applyShape(maze, shapeKey, region, pen) {
    const shape = SHAPES[shapeKey] || SHAPES.rectangle;
    const reg = region || { c0: 0, r0: 0, c1: maze.cols - 1, r1: maze.rows - 1 };
    const w = reg.c1 - reg.c0 + 1, h = reg.r1 - reg.r0 + 1;
    for (let r = reg.r0; r <= reg.r1; r++) {
      for (let c = reg.c0; c <= reg.c1; c++) {
        const u = ((c - reg.c0 + 0.5) / w) * 2 - 1;
        const v = ((r - reg.r0 + 0.5) / h) * 2 - 1;
        maze.voids[r * maze.cols + c] = shape.inside(u, v) ? 0 : 1;
      }
    }
    for (let r = reg.r0; r <= reg.r1; r++) for (let c = reg.c0; c <= reg.c1; c++) fixVoidEdges(maze, c, r, pen);
  }

  // Keep walls tidy around a cell whose void state changed: no walls between
  // two voids, and a wall wherever a void meets a walkable cell.
  function fixVoidEdges(maze, c, r, pen) {
    const a = maze.isVoid(c, r);
    for (let d = 0; d < 4; d++) {
      const b = maze.isVoid(c + DC[d], r + DR[d]);
      if (a && b) maze.setWall(c, r, d, 0);
      else if (a !== b && !maze.getWall(c, r, d)) maze.setWall(c, r, d, pen);
    }
  }

  global.MazeKit = {
    N, E, S, W, DC, DR,
    Maze, makeRng, randomSeed,
    makeContext, prepare, connectAll, stitchRegion, braid, placeEnds,
    ALGORITHMS, SHAPES, applyShape, fixVoidEdges,
    bfs, solve, stats, degree,
  };
})(typeof window !== 'undefined' ? window : globalThis);
