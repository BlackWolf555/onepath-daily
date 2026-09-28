/* OnePath puzzle generator — DOM-free (testable in Node).
 * A puzzle: grid size N, a set of wall cells, and numbered checkpoints placed
 * along a hidden Hamiltonian path that covers every non-wall cell.
 * The player must draw ONE continuous path that visits every free cell exactly
 * once while stepping on the numbers in ascending order.
 */
(function (global) {
  'use strict';

  // ---- Seeded PRNG ----
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRand(seedStr) {
    const seedFn = xmur3(String(seedStr));
    return mulberry32(seedFn());
  }

  const key = (r, c, n) => r * n + c;
  const unkey = (k, n) => [Math.floor(k / n), k % n];

  function neighbors(k, n, walls) {
    const [r, c] = unkey(k, n);
    const out = [];
    if (r > 0) out.push(key(r - 1, c, n));
    if (r < n - 1) out.push(key(r + 1, c, n));
    if (c > 0) out.push(key(r, c - 1, n));
    if (c < n - 1) out.push(key(r, c + 1, n));
    return out.filter((x) => !walls.has(x));
  }

  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Flood fill count from start over free cells.
  function reachableCount(start, n, walls) {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const k = stack.pop();
      for (const nb of neighbors(k, n, walls)) {
        if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
    }
    return seen.size;
  }

  // Randomized DFS Hamiltonian path over free cells. Returns array of keys or null.
  function hamiltonianPath(n, walls, rand, budget) {
    const free = [];
    for (let k = 0; k < n * n; k++) if (!walls.has(k)) free.push(k);
    const total = free.length;
    if (total === 0) return null;
    const start = free[Math.floor(rand() * free.length)];
    const path = [start];
    const visited = new Set([start]);
    let steps = 0;
    // iterative DFS with per-frame shuffled neighbor order
    const frames = [{ k: start, nbs: shuffle(neighbors(start, n, walls), rand), i: 0 }];
    while (frames.length) {
      if (++steps > budget) return null;
      if (path.length === total) return path.slice();
      const f = frames[frames.length - 1];
      let advanced = false;
      while (f.i < f.nbs.length) {
        const nb = f.nbs[f.i++];
        if (!visited.has(nb)) {
          visited.add(nb); path.push(nb);
          frames.push({ k: nb, nbs: shuffle(neighbors(nb, n, walls), rand), i: 0 });
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        frames.pop();
        const k = path.pop();
        visited.delete(k);
      }
    }
    return null;
  }

  // Deterministic snake fallback (works on any even grid, no walls).
  function snakePath(n) {
    const p = [];
    for (let r = 0; r < n; r++) {
      if (r % 2 === 0) { for (let c = 0; c < n; c++) p.push(key(r, c, n)); }
      else { for (let c = n - 1; c >= 0; c--) p.push(key(r, c, n)); }
    }
    return p;
  }

  function generatePuzzle(seedStr, opts) {
    const o = Object.assign({ size: 6, walls: 6, numbers: 5 }, opts || {});
    const n = o.size;
    const rand = makeRand(seedStr);
    let walls = new Set();
    let path = null;

    // 1) Try: random walls (connectivity-checked) + Hamiltonian path.
    for (let attempt = 0; attempt < 40 && !path; attempt++) {
      walls = new Set();
      let guard = 0;
      while (walls.size < o.walls && guard++ < 200) {
        walls.add(Math.floor(rand() * n * n));
      }
      // connectivity: every free cell reachable from first free cell
      const firstFree = (() => { for (let k = 0; k < n * n; k++) if (!walls.has(k)) return k; return -1; })();
      if (firstFree < 0) continue;
      if (reachableCount(firstFree, n, walls) !== n * n - walls.size) continue;
      path = hamiltonianPath(n, walls, rand, 120000);
    }

    // 2) Fallback: no walls, snake path (always solvable).
    if (!path) {
      walls = new Set();
      path = snakePath(n);
    }

    // 3) Place numbers along the path: first cell = 1, last = max, spread the rest.
    const L = path.length;
    const count = Math.max(2, Math.min(o.numbers, L));
    const idx = [0];
    for (let i = 1; i < count - 1; i++) {
      const lo = Math.floor((i * L) / count);
      const hi = Math.floor(((i + 1) * L) / count) - 1;
      idx.push(lo + Math.floor(rand() * Math.max(1, hi - lo + 1)));
    }
    idx.push(L - 1);
    idx.sort((a, b) => a - b);
    // ensure strictly increasing & unique
    const uniq = [...new Set(idx)];
    const numbers = new Map(); // key -> number
    uniq.forEach((pi, i) => numbers.set(path[pi], i + 1));

    return { size: n, walls, numbers, pathLength: L, seed: String(seedStr),
             solution: o.debug ? path : undefined };
  }

  // Validate a candidate solution path (array of keys).
  function validateSolution(puzzle, pathArr) {
    const n = puzzle.size;
    const free = n * n - puzzle.walls.size;
    if (pathArr.length !== free) return { ok: false, reason: 'incomplete' };
    const seen = new Set();
    let expectNum = 1;
    const maxNum = puzzle.numbers.size;
    for (let i = 0; i < pathArr.length; i++) {
      const k = pathArr[i];
      if (puzzle.walls.has(k)) return { ok: false, reason: 'wall' };
      if (seen.has(k)) return { ok: false, reason: 'revisit' };
      seen.add(k);
      if (i > 0) {
        const [r1, c1] = unkey(pathArr[i - 1], n);
        const [r2, c2] = unkey(k, n);
        if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return { ok: false, reason: 'jump' };
      }
      const num = puzzle.numbers.get(k);
      if (num !== undefined) {
        if (num !== expectNum) return { ok: false, reason: 'order' };
        expectNum++;
      }
    }
    if (expectNum !== maxNum + 1) return { ok: false, reason: 'missing-number' };
    return { ok: true };
  }

  const api = { generatePuzzle, validateSolution, makeRand, key, unkey, neighbors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.OnePathPuzzle = api;
})(typeof window !== 'undefined' ? window : globalThis);
