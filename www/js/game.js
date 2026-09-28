/* OnePath game — rendering, input, audio, streaks, sharing. Requires puzzle.js (OnePathPuzzle). */
(function () {
  'use strict';
  const PZ = window.OnePathPuzzle;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('board'), ctx = canvas.getContext('2d');
  const hintBar = $('hint-bar'), timerEl = $('timer'), streakEl = $('streak-num');
  const progressFill = $('progress-fill'), puzzleLabel = $('puzzle-label');
  const startScreen = $('start-screen'), winScreen = $('win-screen');

  // ---------- Audio (tiny synth, no assets) ----------
  const AudioSys = {
    ctx: null,
    ensure() {
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { /* no audio */ }
    },
    tone(freq, dur, type, vol, delay) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + (delay || 0);
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.09));
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + (dur || 0.09) + 0.05);
    },
    move(step) { this.tone(280 + Math.min(step, 40) * 14, 0.07, 'sine', 0.08); },
    back() { this.tone(220, 0.06, 'sine', 0.06); },
    number(n) { this.tone(520 + n * 90, 0.1, 'triangle', 0.14); this.tone(780 + n * 90, 0.12, 'triangle', 0.1, 0.07); },
    error() { this.tone(140, 0.12, 'square', 0.06); },
    win() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.13, i * 0.09)); },
    click() { this.tone(440, 0.05, 'sine', 0.07); },
  };

  // ---------- Storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  function localDateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function prettyDate(ds) {
    const [y, m, dd] = ds.split('-').map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function yesterdayStr() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return localDateStr(d);
  }

  // ---------- State ----------
  const S = {
    mode: 'daily',            // 'daily' | 'practice'
    dateStr: localDateStr(),
    puzzle: null,
    path: [],                 // array of keys
    visited: new Set(),
    nextNumber: 1,
    freeCells: 0,
    playing: false,
    won: false,
    startTime: 0,
    elapsed: 0,
    timerId: null,
    dragging: false,
    confetti: [],
    winFlash: 0,
    headPulse: 0,
    size: 6,
    cell: 0, ox: 0, oy: 0,    // layout
  };

  function dailySeed(ds) { return 'onepath-' + ds; }

  function newPuzzle(mode, seedOverride, debug) {
    S.mode = mode;
    S.dateStr = localDateStr();
    const seed = mode === 'daily' ? dailySeed(S.dateStr) : (seedOverride || ('practice-' + Date.now() + '-' + Math.floor(Math.random() * 1e9)));
    S.puzzle = PZ.generatePuzzle(seed, { size: 6, walls: 6, numbers: 5, debug: !!debug });
    S.path = []; S.visited = new Set(); S.nextNumber = 1;
    S.freeCells = S.puzzle.size * S.puzzle.size - S.puzzle.walls.size;
    S.playing = false; S.won = false; S.elapsed = 0; S.dragging = false;
    S.confetti = []; S.winFlash = 0;
    stopTimer(); timerEl.textContent = '0:00';
    puzzleLabel.textContent = mode === 'daily' ? 'Daily · ' + prettyDate(S.dateStr) : 'Practice';
    $('btn-new').classList.toggle('hidden', mode !== 'practice');
    $('btn-mode').textContent = mode === 'daily' ? 'Practice' : 'Daily';
    updateProgress(); hideHint();
    refreshStreakUI();
  }

  // ---------- Layout ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = S.puzzle ? S.puzzle.size : 6;
    S.cell = r.width / n;
    S.ox = 0; S.oy = (r.height - r.width) / 2;
  }
  window.addEventListener('resize', resize);

  function cellCenter(k) {
    const n = S.puzzle.size;
    const r = Math.floor(k / n), c = k % n;
    return [S.ox + c * S.cell + S.cell / 2, S.oy + r * S.cell + S.cell / 2];
  }
  function pointToCell(x, y) {
    const rect = canvas.getBoundingClientRect();
    const px = x - rect.left, py = y - rect.top;
    const n = S.puzzle.size;
    const c = Math.floor((px - S.ox) / S.cell), r = Math.floor((py - S.oy) / S.cell);
    if (r < 0 || r >= n || c < 0 || c >= n) return -1;
    return r * n + c;
  }

  // ---------- Rules ----------
  function isAdjacent(a, b) {
    const n = S.puzzle.size;
    const [r1, c1] = PZ.unkey(a, n), [r2, c2] = PZ.unkey(b, n);
    return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
  }
  function validMovesFrom(k) {
    const out = [];
    for (const nb of PZ.neighbors(k, S.puzzle.size, S.puzzle.walls)) {
      if (S.visited.has(nb)) continue;
      const num = S.puzzle.numbers.get(nb);
      if (num !== undefined && num !== S.nextNumber) continue;
      out.push(nb);
    }
    return out;
  }

  function startPath(k) {
    // must begin on tile "1"
    if (S.puzzle.numbers.get(k) !== 1) { deny('Start on tile ①'); return false; }
    S.path = [k]; S.visited = new Set([k]); S.nextNumber = 2;
    S.playing = true; S.startTime = Date.now(); startTimer();
    AudioSys.ensure(); AudioSys.number(1);
    updateProgress(); hideHint();
    return true;
  }

  function tryAdvance(k) {
    const head = S.path[S.path.length - 1];
    if (k === head) return;
    // backtrack: stepped onto previous cell
    if (S.path.length >= 2 && k === S.path[S.path.length - 2]) {
      const removed = S.path.pop();
      S.visited.delete(removed);
      const num = S.puzzle.numbers.get(removed);
      if (num !== undefined) S.nextNumber = num;
      AudioSys.back();
      updateProgress(); hideHint();
      return;
    }
    if (!isAdjacent(head, k)) return;
    if (S.puzzle.walls.has(k) || S.visited.has(k)) { deny(); return; }
    const num = S.puzzle.numbers.get(k);
    if (num !== undefined && num !== S.nextNumber) { deny('Numbers in order!'); return; }
    S.path.push(k); S.visited.add(k);
    if (num !== undefined) { S.nextNumber = num + 1; AudioSys.number(num); }
    else AudioSys.move(S.path.length);
    updateProgress(); hideHint();
    if (S.path.length === S.freeCells) onWin();
    else if (validMovesFrom(k).length === 0) showHint('Dead end — drag back or Reset ↩');
  }

  function deny(msg) {
    AudioSys.error();
    if (msg) showHint(msg);
    canvas.style.transform = 'translateX(0)';
    canvas.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
      { duration: 160 }
    );
  }

  function truncateTo(k) {
    const i = S.path.indexOf(k);
    if (i < 0) return false;
    while (S.path.length > i + 1) {
      const removed = S.path.pop();
      S.visited.delete(removed);
      const num = S.puzzle.numbers.get(removed);
      if (num !== undefined) S.nextNumber = num;
    }
    AudioSys.back();
    updateProgress(); hideHint();
    return true;
  }

  function resetPath() {
    S.path = []; S.visited = new Set(); S.nextNumber = 1;
    S.playing = false; S.won = false;
    stopTimer(); S.elapsed = 0; timerEl.textContent = '0:00';
    S.confetti = []; S.winFlash = 0;
    updateProgress(); hideHint();
    AudioSys.click();
  }

  // ---------- Win ----------
  function onWin() {
    S.won = true; S.playing = false;
    stopTimer();
    S.winFlash = 1;
    AudioSys.win();
    spawnConfetti();
    if (S.mode === 'daily') recordDailyWin();
    setTimeout(showWinScreen, 1100);
  }

  function recordDailyWin() {
    const st = store.get('onepath.streak', { last: null, count: 0 });
    if (st.last === S.dateStr) return; // already counted today
    st.count = (st.last === yesterdayStr()) ? st.count + 1 : 1;
    st.last = S.dateStr;
    store.set('onepath.streak', st);
    store.set('onepath.done.' + S.dateStr, true);
    refreshStreakUI();
  }

  function refreshStreakUI() {
    const st = store.get('onepath.streak', { last: null, count: 0 });
    streakEl.textContent = st.count || 0;
    const s2 = $('start-streak-num'); if (s2) s2.textContent = st.count || 0;
  }

  const NUM_EMOJI = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
  function emojiGrid() {
    const n = S.puzzle.size, rows = [];
    for (let r = 0; r < n; r++) {
      let row = '';
      for (let c = 0; c < n; c++) {
        const k = r * n + c;
        if (S.puzzle.walls.has(k)) row += '⬛';
        else if (S.puzzle.numbers.has(k)) row += NUM_EMOJI[S.puzzle.numbers.get(k)] || '🔢';
        else row += '⬜';
      }
      rows.push(row);
    }
    return rows.join('\n');
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function showWinScreen() {
    const st = store.get('onepath.streak', { last: null, count: 0 });
    const label = S.mode === 'daily' ? 'Daily · ' + prettyDate(S.dateStr) : 'Practice';
    $('win-stats').innerHTML =
      '<b>' + label + '</b><br/>Time: <b>' + fmtTime(S.elapsed) + '</b>' +
      (S.mode === 'daily' ? '<br/>🔥 Streak: <b>' + (st.count || 0) + '</b> day(s)' : '');
    $('win-emoji').textContent = emojiGrid();
    $('share-note').textContent = '';
    $('btn-again').textContent = S.mode === 'daily' ? 'Practice More' : 'New Puzzle';
    winScreen.classList.remove('hidden');
  }

  function shareResult() {
    const st = store.get('onepath.streak', { last: null, count: 0 });
    const text =
      '🟪 OnePath ' + (S.mode === 'daily' ? 'Daily · ' + prettyDate(S.dateStr) : 'Practice') + '\n' +
      emojiGrid() + '\n' +
      'Solved in ' + fmtTime(S.elapsed) + ' ⏱️' +
      (S.mode === 'daily' ? ' · 🔥 Streak ' + (st.count || 0) : '');
    const done = () => { $('share-note').textContent = '✓ Copied — paste it anywhere!'; };
    if (navigator.share) {
      navigator.share({ title: 'OnePath', text }).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => { $('share-note').textContent = text; });
    } else { $('share-note').textContent = text; }
  }

  // ---------- Timer / progress / hint ----------
  function startTimer() {
    stopTimer();
    S.timerId = setInterval(() => {
      S.elapsed = Date.now() - S.startTime;
      timerEl.textContent = fmtTime(S.elapsed);
    }, 250);
  }
  function stopTimer() { if (S.timerId) { clearInterval(S.timerId); S.timerId = null; } }
  function updateProgress() {
    const pct = S.freeCells ? (S.path.length / S.freeCells) * 100 : 0;
    progressFill.style.width = pct.toFixed(1) + '%';
  }
  let hintTimer = null;
  function showHint(msg) {
    hintBar.textContent = msg; hintBar.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 2200);
  }
  function hideHint() { hintBar.classList.remove('show'); }

  // ---------- Confetti ----------
  function spawnConfetti() {
    const colors = ['#7c5cff', '#38e1ff', '#ffd166', '#ff6b9d', '#7ee2a8'];
    for (let i = 0; i < 90; i++) {
      S.confetti.push({
        x: Math.random() * canvas.clientWidth,
        y: -10 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 2.4,
        vy: 2 + Math.random() * 3.2,
        s: 4 + Math.random() * 6,
        c: colors[i % colors.length],
        r: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  // ---------- Rendering ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);
    if (!S.puzzle) { requestAnimationFrame(draw); return; }
    const n = S.puzzle.size, gap = Math.max(2, S.cell * 0.06), cs = S.cell;
    S.headPulse = (S.headPulse + 0.05) % (Math.PI * 2);

    // cells
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const k = r * n + c;
        const x = S.ox + c * cs + gap / 2, y = S.oy + r * cs + gap / 2, w = cs - gap;
        if (S.puzzle.walls.has(k)) {
          roundRect(x, y, w, w, w * 0.22);
          ctx.fillStyle = '#05070f'; ctx.fill();
          ctx.strokeStyle = '#1c2342'; ctx.lineWidth = 1.5; ctx.stroke();
        } else {
          const visited = S.visited.has(k);
          roundRect(x, y, w, w, w * 0.22);
          ctx.fillStyle = visited ? '#1b2247' : '#141a33';
          ctx.fill();
        }
        // numbers
        const num = S.puzzle.numbers.get(k);
        if (num !== undefined) {
          const [cx, cy] = cellCenter(k);
          const done = num < S.nextNumber;
          ctx.beginPath(); ctx.arc(cx, cy, cs * 0.30, 0, Math.PI * 2);
          ctx.fillStyle = done ? '#2f9e6e' : '#2a3560'; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = done ? '#7ee2a8' : '#7c5cff'; ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = '700 ' + Math.round(cs * 0.34) + 'px -apple-system, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(num), cx, cy + 1);
        }
      }
    }

    // valid-move dots
    if (S.playing && !S.won && S.path.length) {
      const head = S.path[S.path.length - 1];
      ctx.fillStyle = 'rgba(125,225,255,0.35)';
      for (const m of validMovesFrom(head)) {
        const [cx, cy] = cellCenter(m);
        ctx.beginPath(); ctx.arc(cx, cy, cs * 0.07, 0, Math.PI * 2); ctx.fill();
      }
    }

    // path
    if (S.path.length) {
      const pts = S.path.map(cellCenter);
      const grad = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1]);
      grad.addColorStop(0, '#7c5cff'); grad.addColorStop(1, '#38e1ff');
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(124,92,255,0.55)'; ctx.shadowBlur = 12 + (S.winFlash > 0 ? 18 * S.winFlash : 0);
      ctx.strokeStyle = grad; ctx.lineWidth = Math.max(8, cs * 0.30);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (pts.length === 1) { ctx.lineTo(pts[0][0] + 0.1, pts[0][1] + 0.1); }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // head glow
      const [hx, hy] = pts[pts.length - 1];
      if (!S.won) {
        const pr = cs * 0.16 + Math.sin(S.headPulse) * 2.5;
        ctx.beginPath(); ctx.arc(hx, hy, pr, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.beginPath(); ctx.arc(hx, hy, pr + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(56,225,255,0.5)'; ctx.lineWidth = 2; ctx.stroke();
      }
    }

    // confetti
    if (S.confetti.length) {
      for (const p of S.confetti) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      }
      S.confetti = S.confetti.filter((p) => p.y < H + 20);
    }
    if (S.winFlash > 0) S.winFlash = Math.max(0, S.winFlash - 0.02);

    requestAnimationFrame(draw);
  }

  // ---------- Input ----------
  function onDown(e) {
    e.preventDefault();
    AudioSys.ensure();
    if (S.won || !S.puzzle) return;
    const t = e.touches ? e.touches[0] : e;
    const k = pointToCell(t.clientX, t.clientY);
    if (k < 0 || S.puzzle.walls.has(k)) return;
    if (!S.path.length) { startPath(k); S.dragging = S.path.length > 0; return; }
    if (S.visited.has(k)) { truncateTo(k); S.dragging = true; return; }
    // tapped a fresh cell adjacent to head -> advance
    if (isAdjacent(S.path[S.path.length - 1], k)) { tryAdvance(k); S.dragging = true; }
    else { S.dragging = true; } // start drag anyway; moves handle the rest
  }
  function onMove(e) {
    if (!S.dragging || S.won || !S.path.length) return;
    e.preventDefault();
    const t = e.touches ? e.touches[0] : e;
    const k = pointToCell(t.clientX, t.clientY);
    if (k >= 0 && !S.puzzle.walls.has(k)) tryAdvance(k);
  }
  function onUp() { S.dragging = false; }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  // ---------- Buttons ----------
  $('btn-daily').addEventListener('click', () => {
    AudioSys.ensure(); AudioSys.click();
    newPuzzle('daily');
    startScreen.classList.add('hidden');
  });
  $('btn-practice').addEventListener('click', () => {
    AudioSys.ensure(); AudioSys.click();
    newPuzzle('practice');
    startScreen.classList.add('hidden');
  });
  $('btn-reset').addEventListener('click', resetPath);
  $('btn-new').addEventListener('click', () => { AudioSys.click(); newPuzzle('practice'); });
  $('btn-mode').addEventListener('click', () => {
    AudioSys.click();
    newPuzzle(S.mode === 'daily' ? 'practice' : 'daily');
  });
  $('btn-share').addEventListener('click', shareResult);
  $('btn-again').addEventListener('click', () => {
    AudioSys.click();
    winScreen.classList.add('hidden');
    newPuzzle(S.mode === 'daily' ? 'practice' : 'practice');
  });

  // ---------- Boot ----------
  newPuzzle('daily');
  resize();
  setTimeout(resize, 100);
  refreshStreakUI();
  requestAnimationFrame(draw);

  // Debug/testing hook (used by automated smoke tests; harmless in production).
  window.__onepath = { S, PZ, newPuzzle, startPath, tryAdvance, truncateTo, resetPath, showWinScreen };
})();
