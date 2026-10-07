const TF_SEC = { "1d": 86400, "4h": 14400, "1h": 3600 };
const PAD = { l: 8, r: 72, t: 16, b: 28 };

const state = {
  tf: "4h",
  series: {},
  lines: [],
  circles: [],
  channels: [],
  channelLevels: [],
  circleScale: null,
  view: null,
  drag: null,
  hover: null,
  active: null,
};

const canvas = document.getElementById("chart");
const ctx = canvas.getContext("2d");

function priceOnLine(line, t) {
  const a = line.ref[0];
  const b = line.ref[1];
  const f = (t - a.t) / (b.t - a.t);
  return Math.exp(Math.log(a.p) + f * (Math.log(b.p) - Math.log(a.p)));
}

function candles() {
  return state.series[state.tf];
}

function xOf(t) {
  const w = plot();
  return w.x + ((t - state.view.t0) / (state.view.t1 - state.view.t0)) * w.w;
}

function yOf(p) {
  const w = plot();
  const ly = Math.log(p);
  return w.y + ((state.view.log1 - ly) / (state.view.log1 - state.view.log0)) * w.h;
}

function tAt(x) {
  const w = plot();
  return state.view.t0 + ((x - w.x) / w.w) * (state.view.t1 - state.view.t0);
}

function pAt(y) {
  const w = plot();
  const ly = state.view.log1 - ((y - w.y) / w.h) * (state.view.log1 - state.view.log0);
  return Math.exp(ly);
}

function plot() {
  const dpr = window.devicePixelRatio || 1;
  return {
    x: PAD.l,
    y: PAD.t,
    w: canvas.width / dpr - PAD.l - PAD.r,
    h: canvas.height / dpr - PAD.t - PAD.b,
  };
}

function fmtPrice(p) {
  if (p >= 1000) return Math.round(p).toLocaleString("en-US");
  if (p >= 100) return p.toFixed(0);
  if (p >= 10) return p.toFixed(1);
  return p.toFixed(2);
}

function fmtDate(t, withTime) {
  const d = new Date(t * 1000);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const base = `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}`;
  if (!withTime) return base;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${base} ${hh}:00`;
}

function lowerBound(cs, t) {
  let lo = 0;
  let hi = cs.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (cs[m].t < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function visibleCandles() {
  const cs = candles();
  if (!cs || !state.view) return [];
  const i0 = Math.max(0, lowerBound(cs, state.view.t0) - 1);
  let i1 = lowerBound(cs, state.view.t1);
  if (i1 < cs.length) i1 += 1;
  return cs.slice(i0, i1);
}

function fitPrice() {
  const cs = visibleCandles();
  if (!cs.length) return;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of cs) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  if (!(lo > 0) || !(hi > lo)) return;
  const a = Math.log(lo);
  const b = Math.log(hi);
  const pad = Math.max(0.04, (b - a) * 0.12);
  state.view.log0 = a - pad;
  state.view.log1 = b + pad;
}

function fitAll() {
  const cs = candles();
  const sec = TF_SEC[state.tf];
  state.view = {
    t0: cs[0].t - sec,
    t1: cs[cs.length - 1].t + sec * 12,
    log0: 0,
    log1: 1,
  };
  fitPrice();
}

function drawnChannels() {
  return state.channels;
}

function frameChannels() {
  // The 8:00 window is the working lattice: a few years, tight enough
  // that the flat ceiling cuts across the rising channels on the pane.
  const t0 = Date.UTC(2024, 5, 1) / 1000;
  const t1 = Date.UTC(2026, 9, 20) / 1000;
  state.view = {
    t0,
    t1,
    log0: Math.log(46000),
    log1: Math.log(150000),
  };
}

function setTime(t0, t1) {
  const cs = candles();
  const sec = TF_SEC[state.tf];
  const data0 = cs[0].t;
  const data1 = cs[cs.length - 1].t;
  if (!state.view) state.view = { t0, t1, log0: 0, log1: 1 };
  if (t1 < data0 + sec) {
    fitAll();
    return;
  }
  if (t0 < data0) t0 = data0 - sec;
  if (t1 > data1 + sec * 40) t1 = data1 + sec * 12;
  if (t1 - t0 < sec * 8) t1 = t0 + sec * 40;
  state.view.t0 = t0;
  state.view.t1 = t1;
  fitPrice();
}

function applyView(name) {
  const cs = candles();
  const last = cs[cs.length - 1].t;
  for (const b of document.querySelectorAll("#views button")) {
    b.classList.toggle("active", b.dataset.view === name);
  }
  if (name === "fit") {
    fitAll();
    return;
  }
  if (name === "channels") {
    frameChannels();
    return;
  }
  if (name === "macro") {
    setTime(Date.UTC(2014, 3, 1) / 1000, last + 86400 * 20);
    return;
  }
  if (name === "y2022") {
    setTime(Date.UTC(2022, 0, 1) / 1000, last + 86400 * 15);
    return;
  }
  if (name === "y2026") {
    setTime(Date.UTC(2026, 0, 1) / 1000, last + 86400 * 10);
    return;
  }
  if (name === "sep") {
    setTime(Date.UTC(2026, 7, 15) / 1000, Date.UTC(2026, 9, 8) / 1000);
    return;
  }
  if (name === "summer") {
    setTime(Date.UTC(2026, 6, 1) / 1000, Date.UTC(2026, 8, 1) / 1000);
    return;
  }
  if (name === "cycle") {
    setTime(Date.UTC(2017, 6, 1) / 1000, Date.UTC(2019, 3, 1) / 1000);
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function spanOf(line) {
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const touch of line.touches) {
    if (touch.t < t0) t0 = touch.t;
    if (touch.t > t1) t1 = touch.t;
  }
  const cs = state.series["1d"] || candles();
  const last = cs[cs.length - 1].t;
  return [t0, Math.max(t1, last) + 86400 * 90];
}

function draw() {
  if (!state.view) return;
  const w = plot();
  const width = canvas.width / (window.devicePixelRatio || 1);
  const height = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0c1016";
  ctx.fillRect(0, 0, width, height);

  drawGrid();
  ctx.save();
  ctx.beginPath();
  ctx.rect(w.x, w.y, w.w, w.h);
  ctx.clip();
  drawChannelFills();
  drawCandles();
  drawChannelEdges();
  ctx.restore();
  drawAxes();
  drawCrosshair();
  drawLastTag();
}

function niceLogGrid() {
  const lo = Math.exp(state.view.log0);
  const hi = Math.exp(state.view.log1);
  const ticks = [];
  const mag = Math.pow(10, Math.floor(Math.log10(lo)));
  for (let m = mag / 10; m <= hi * 10; m *= 10) {
    for (const k of [1, 2, 5]) {
      const p = k * m;
      if (p >= lo && p <= hi) ticks.push(p);
    }
  }
  return ticks;
}

function timeTicks() {
  const span = state.view.t1 - state.view.t0;
  const ticks = [];
  const start = new Date(state.view.t0 * 1000);
  if (span > 86400 * 800) {
    for (let y = start.getUTCFullYear(); y <= new Date(state.view.t1 * 1000).getUTCFullYear() + 1; y++) {
      const t = Date.UTC(y, 0, 1) / 1000;
      if (t >= state.view.t0 && t <= state.view.t1) ticks.push({ t, label: String(y) });
    }
  } else if (span > 86400 * 120) {
    const d0 = new Date(state.view.t0 * 1000);
    for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth(); ; ) {
      const t = Date.UTC(y, m, 1) / 1000;
      if (t > state.view.t1) break;
      if (t >= state.view.t0) {
        const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m];
        ticks.push({ t, label: `${mon} ${y}` });
      }
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
  } else {
    const step = span > 86400 * 20 ? 86400 * 7 : span > 86400 * 5 ? 86400 : TF_SEC[state.tf] * 6;
    let t = Math.ceil(state.view.t0 / step) * step;
    while (t <= state.view.t1) {
      ticks.push({ t, label: span > 86400 * 5 ? fmtDate(t, false) : fmtDate(t, true) });
      t += step;
    }
  }
  return ticks;
}

function drawGrid() {
  const w = plot();
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const p of niceLogGrid()) {
    const y = yOf(p);
    ctx.strokeStyle = "#1c2633";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w.x, y);
    ctx.lineTo(w.x + w.w, y);
    ctx.stroke();
    ctx.fillStyle = "#8b9aab";
    ctx.fillText(fmtPrice(p), w.x + w.w + PAD.r - 6, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const tick of timeTicks()) {
    const x = xOf(tick.t);
    ctx.strokeStyle = "#1c2633";
    ctx.beginPath();
    ctx.moveTo(x, w.y);
    ctx.lineTo(x, w.y + w.h);
    ctx.stroke();
    ctx.fillStyle = "#8b9aab";
    ctx.fillText(tick.label, x, w.y + w.h + 8);
  }
}

function drawCandles() {
  const cs = visibleCandles();
  if (!cs.length) return;
  const sec = TF_SEC[state.tf];
  const w = plot();
  const barPx = (sec / (state.view.t1 - state.view.t0)) * w.w;
  if (barPx >= 1.7) {
    const bodyW = Math.max(1, barPx * 0.68);
    for (const c of cs) {
      const x = xOf(c.t);
      const up = c.c >= c.o;
      ctx.strokeStyle = up ? "#2fbf8a" : "#ef5d6c";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.h));
      ctx.lineTo(x, yOf(c.l));
      ctx.stroke();
      const y1 = yOf(Math.max(c.o, c.c));
      const y2 = yOf(Math.min(c.o, c.c));
      const bh = Math.max(1, y2 - y1);
      ctx.fillRect(x - bodyW / 2, y1, bodyW, bh);
    }
    return;
  }
  const buckets = new Map();
  for (const c of cs) {
    const x = Math.round(xOf(c.t));
    const b = buckets.get(x);
    if (!b) buckets.set(x, { x, o: c.o, h: c.h, l: c.l, c: c.c });
    else {
      b.h = Math.max(b.h, c.h);
      b.l = Math.min(b.l, c.l);
      b.c = c.c;
    }
  }
  for (const b of buckets.values()) {
    ctx.strokeStyle = b.c >= b.o ? "#2fbf8a" : "#ef5d6c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.x, yOf(b.h));
    ctx.lineTo(b.x, yOf(b.l));
    ctx.stroke();
  }
}

function drawLines() {
  for (const line of state.lines) {
    const [tA, tB] = spanOf(line);
    const t0 = Math.max(tA, state.view.t0);
    const t1 = Math.min(tB, state.view.t1);
    if (t1 <= t0) continue;
    ctx.strokeStyle = line.color;
    ctx.lineWidth = state.active === line.id ? 2.6 : 1.7;
    ctx.beginPath();
    ctx.moveTo(xOf(t0), yOf(priceOnLine(line, t0)));
    ctx.lineTo(xOf(t1), yOf(priceOnLine(line, t1)));
    ctx.stroke();
  }
}

function drawLineLabels() {
  const w = plot();
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const placed = [];
  for (const line of state.lines) {
    const [tA, tB] = spanOf(line);
    const tLabel = Math.min(state.view.t1, tB);
    if (tLabel < Math.max(state.view.t0, tA)) continue;
    let y = yOf(priceOnLine(line, tLabel));
    if (y < w.y + 12 || y > w.y + w.h - 12) continue;
    for (const py of placed) {
      if (Math.abs(py - y) < 14) y = py - 14;
    }
    placed.push(y);
    ctx.fillStyle = line.color;
    ctx.fillText(line.name, w.x + w.w - 8, y);
  }
}

function levelColor(ratio) {
  const row = state.channelLevels.find((item) => item.ratio === ratio);
  return row ? row.color : "#e7eef6";
}

function channelPrice(ch, level, t) {
  const line = state.lines.find((item) => item.id === ch.lineId);
  return Math.exp(Math.log(priceOnLine(line, t)) + ch.origin + level * ch.width);
}

function channelLevelsOf(ch) {
  return ch.show || state.channelLevels.map((item) => item.ratio);
}

function drawChannelFills() {
  const t0 = state.view.t0;
  const t1 = state.view.t1;
  for (const ch of drawnChannels()) {
    const levels = channelLevelsOf(ch).slice().sort((a, b) => a - b);
    for (let i = 0; i < levels.length - 1; i++) {
      const a = levels[i];
      const b = levels[i + 1];
      ctx.beginPath();
      ctx.moveTo(xOf(t0), yOf(channelPrice(ch, a, t0)));
      ctx.lineTo(xOf(t1), yOf(channelPrice(ch, a, t1)));
      ctx.lineTo(xOf(t1), yOf(channelPrice(ch, b, t1)));
      ctx.lineTo(xOf(t0), yOf(channelPrice(ch, b, t0)));
      ctx.closePath();
      ctx.fillStyle = levelColor(a);
      // The flat family is the other angle. Keep it strong enough to read
      // across the two rising stacks.
      ctx.globalAlpha = ch.lineId === "blue" ? 0.26 : 0.12;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawChannelEdges() {
  const t0 = state.view.t0;
  const t1 = state.view.t1;
  for (const ch of drawnChannels()) {
    const levels = channelLevelsOf(ch).slice().sort((a, b) => a - b);
    for (const level of levels) {
      ctx.beginPath();
      ctx.strokeStyle = levelColor(level);
      ctx.globalAlpha = 0.92;
      ctx.lineWidth = level === 0 || level === 1 ? 1.7 : 1.15;
      ctx.moveTo(xOf(t0), yOf(channelPrice(ch, level, t0)));
      ctx.lineTo(xOf(t1), yOf(channelPrice(ch, level, t1)));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawChannelLabels() {
  if (!state.view) return;
  const w = plot();
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const placed = [];
  const tLabel = state.view.t1;
  for (const ch of state.channels) {
    const levels = channelLevelsOf(ch);
    for (const level of levels) {
      let y = yOf(channelPrice(ch, level, tLabel));
      if (y < w.y + 10 || y > w.y + w.h - 10) continue;
      for (const py of placed) {
        if (Math.abs(py - y) < 13) y = py - 13;
      }
      placed.push(y);
      const row = state.channelLevels.find((item) => item.ratio === level);
      ctx.fillStyle = levelColor(level);
      ctx.fillText(row ? row.name : String(level), w.x + 8, y);
    }
  }
}

function barOpen(t) {
  const sec = TF_SEC[state.tf];
  return Math.floor(t / sec) * sec;
}

function shownCircles() {
  return state.circles.filter((circle) => circle.id === "channel-grid");
}

function drawDots() {
  if (!state.circleScale) return;
  for (const circle of shownCircles()) {
    const g = circleGeom(circle);
    for (const touch of circle.touches) {
      const bt = barOpen(touch.t);
      if (bt < state.view.t0 - TF_SEC[state.tf] || bt > state.view.t1) continue;
      const x = xOf(bt);
      const y = yOf(touch.p);
      ctx.beginPath();
      ctx.fillStyle = circle.color;
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function circleGeom(circle) {
  const line = state.lines.find((item) => item.id === circle.lineId);
  const [tA, tB] = circle.anchors;
  const off = circle.logOffset || 0;
  const pA = priceOnLine(line, tA) * Math.exp(off);
  const pB = priceOnLine(line, tB) * Math.exp(off);
  const tc = (tA + tB) / 2;
  const lc = (Math.log(pA) + Math.log(pB)) / 2;
  const { sx, sy } = state.circleScale;
  const r1 = Math.hypot((tA - tc) / sx, (Math.log(pA) - lc) / sy);
  return { line, tA, tB, tc, lc, r1, sx, sy, off };
}

function ringPricesAt(g, level, t) {
  const dt = (t - g.tc) / g.sx;
  const rem = level * g.r1 * (level * g.r1) - dt * dt;
  if (rem < 0) return null;
  const dlp = Math.sqrt(rem) * g.sy;
  return [Math.exp(g.lc + dlp), Math.exp(g.lc - dlp)];
}

function nearestRingPrice(g, level, t, p) {
  const pair = ringPricesAt(g, level, t);
  if (!pair) return null;
  return Math.abs(Math.log(p) - Math.log(pair[0])) < Math.abs(Math.log(p) - Math.log(pair[1]))
    ? pair[0]
    : pair[1];
}

function drawRing(g, level, faint) {
  const steps = 220;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const rad = level * g.r1;
    const t = g.tc + Math.cos(theta) * rad * g.sx;
    const p = Math.exp(g.lc + Math.sin(theta) * rad * g.sy);
    const x = xOf(t);
    const y = yOf(p);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.globalAlpha = faint ? 0.28 : 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawCircles() {
  if (!state.circleScale) return;
  for (const circle of shownCircles()) {
    const g = circleGeom(circle);
    ctx.strokeStyle = circle.color;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    for (const level of circle.show) drawRing(g, level, false);
    for (const level of circle.faint) drawRing(g, level, true);
    ctx.setLineDash([]);
    for (const t of circle.anchors) {
      const x = xOf(t);
      const y = yOf(priceOnLine(g.line, t) * Math.exp(g.off));
      ctx.strokeStyle = circle.color;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
    }
  }
}

function drawCircleLabels() {
  if (!state.circleScale || !state.view) return;
  const w = plot();
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tLabel = state.view.t0 + (state.view.t1 - state.view.t0) * 0.72;
  for (const circle of shownCircles()) {
    const g = circleGeom(circle);
    for (const level of circle.show) {
      const pair = ringPricesAt(g, level, tLabel);
      if (!pair) continue;
      const p = pair[0] > pair[1] ? pair[0] : pair[1];
      const y = yOf(p);
      const x = xOf(tLabel);
      if (y < w.y + 10 || y > w.y + w.h - 10) continue;
      ctx.fillStyle = circle.color;
      ctx.fillText(String(level), x + 4, y);
    }
  }
}

function drawAxes() {
  const w = plot();
  ctx.strokeStyle = "#2a3646";
  ctx.lineWidth = 1;
  ctx.strokeRect(w.x, w.y, w.w, w.h);
}

function drawCrosshair() {
  if (!state.hover) return;
  const w = plot();
  const { x, y } = state.hover;
  if (x < w.x || x > w.x + w.w || y < w.y || y > w.y + w.h) return;
  ctx.strokeStyle = "#5c6d80";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, w.y);
  ctx.lineTo(x, w.y + w.h);
  ctx.moveTo(w.x, y);
  ctx.lineTo(w.x + w.w, y);
  ctx.stroke();
  ctx.setLineDash([]);
  const price = pAt(y);
  const when = tAt(x);
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#d7e0ea";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${fmtDate(when, state.tf !== "1d")}   ${fmtPrice(price)}`, w.x + 8, w.y + 16);
}

function drawLastTag() {
  const cs = candles();
  if (!cs) return;
  const last = cs[cs.length - 1];
  const y = yOf(last.c);
  const w = plot();
  if (y < w.y || y > w.y + w.h) return;
  ctx.fillStyle = "#d7e0ea";
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(fmtPrice(last.c), w.x + w.w + 6, y);
}

function touchError(line, touch) {
  const linePx = priceOnLine(line, touch.t);
  return (touch.p / linePx - 1) * 100;
}

function placeLine(px, linePx) {
  const gap = (px / linePx - 1) * 100;
  const where = gap >= 0 ? "below the close" : "above the close";
  return `${fmtPrice(linePx)}, ${Math.abs(gap).toFixed(1)}% ${where}`;
}

function bandAt(ch, px, t) {
  const levels = channelLevelsOf(ch).slice().sort((a, b) => a - b);
  const rows = levels.map((level) => ({
    level,
    price: channelPrice(ch, level, t),
    name: (state.channelLevels.find((item) => item.ratio === level) || {}).name || String(level),
  }));
  for (let i = 0; i < rows.length - 1; i++) {
    if (px >= rows[i].price && px < rows[i + 1].price) {
      return { name: rows[i].name, lo: rows[i].price, hi: rows[i + 1].price };
    }
  }
  return null;
}

function renderSide() {
  const cs = candles();
  const last = cs[cs.length - 1];
  const daily = state.series["1d"].find((bar) => {
    const d = new Date(bar.t * 1000);
    return d.getUTCFullYear() === 2026 && d.getUTCMonth() === 9 && d.getUTCDate() === 6;
  });
  const spot = daily || last;
  const px = spot.c;
  document.getElementById("asof").textContent =
    `${state.tf.toUpperCase()} · 6 Oct 2026 close ${fmtPrice(px)}`;

  const yellowCh = state.channels.find((ch) => ch.id === "yellow-up");
  const purpleCh = state.channels.find((ch) => ch.id === "purple-up");
  const flatCh = state.channels.find((ch) => ch.id === "blue-flat");
  const flatBack = state.channels.find((ch) => ch.id === "blue-below");
  let read = `The 6 Oct 2026 close is ${fmtPrice(px)}.`;
  if (yellowCh && purpleCh && flatCh && flatBack) {
    const yBand = bandAt(yellowCh, px, spot.t);
    const pBand = bandAt(purpleCh, px, spot.t);
    const backBand = bandAt(flatBack, px, spot.t);
    const flatBase = channelPrice(flatCh, 0, spot.t);
    read +=
      ` Inside the lattice it sits in the ${yBand.name} band of the flatter rising channel` +
      ` (${fmtPrice(yBand.lo)} to ${fmtPrice(yBand.hi)})` +
      ` and the ${pBand.name} band of the steeper rising channel` +
      ` (${fmtPrice(pBand.lo)} to ${fmtPrice(pBand.hi)}).` +
      ` It is just under the flat channel base at ${fmtPrice(flatBase)},` +
      ` in the ${backBand.name} band of that channel's back channel` +
      ` (${fmtPrice(backBand.lo)} to ${fmtPrice(backBand.hi)}).`;
  }
  document.getElementById("read").textContent = read;

  const box = document.getElementById("lines");
  box.innerHTML = "";
  let worst = 0;
  for (const row of state.channelLevels) {
    const card = document.createElement("article");
    card.className = "card";
    const h2 = document.createElement("h2");
    h2.innerHTML = `<span class="swatch" style="background:${row.color}"></span>${row.name} ${row.ratio}`;
    const why = document.createElement("p");
    why.className = "why";
    if (row.ratio === 0) why.textContent = "Gray band, from the base up to 0.382. The base is the hidden trend line.";
    else if (row.ratio === 0.382) why.textContent = "Red band, from 0.382 to 0.5.";
    else if (row.ratio === 0.5) why.textContent = "Green band, from 0.5 to the cyan 0.618.";
    else if (row.ratio === 0.618) why.textContent = "Cyan band, from 0.618 to 0.786. The next channel on that slope starts here.";
    else if (row.ratio === 0.786) why.textContent = "Purple band, from 0.786 to the blue rail.";
    else why.textContent = "Blue rail. Top of the purple band.";
    card.append(h2, why);
    box.appendChild(card);
  }
  const circlesBox = document.getElementById("circles");
  if (circlesBox) {
    circlesBox.innerHTML = "";
    let circleWorst = 0;
    for (const circle of shownCircles()) {
      const g = state.circleScale ? circleGeom(circle) : null;
      const card = document.createElement("article");
      card.className = "card";
      const h2 = document.createElement("h2");
      h2.innerHTML = `<span class="swatch swatch-ring" style="border-color:${circle.color}"></span>${circle.name}`;
      const why = document.createElement("p");
      why.className = "why";
      why.textContent = circle.why;
      const ul = document.createElement("ul");
      for (const touch of circle.touches) {
        const ring = g ? nearestRingPrice(g, touch.level, touch.t, touch.p) : touch.p;
        const err = ring ? (touch.p / ring - 1) * 100 : 0;
        circleWorst = Math.max(circleWorst, Math.abs(err));
        const li = document.createElement("li");
        li.innerHTML = `${touch.label} · ${touch.level} ${touch.role} <span class="err">${err >= 0 ? "+" : ""}${err.toFixed(2)}%</span>`;
        ul.appendChild(li);
      }
      card.append(h2, why, ul);
      circlesBox.appendChild(card);
    }
    worst = Math.max(worst, circleWorst);
  }
  const channelsBox = document.getElementById("channels");
  if (channelsBox) {
    channelsBox.innerHTML = "";
    for (const ch of state.channels) {
      const card = document.createElement("article");
      card.className = "card";
      const h2 = document.createElement("h2");
      h2.textContent = ch.name;
      const why = document.createElement("p");
      why.className = "why";
      why.textContent = ch.why;
      const ul = document.createElement("ul");
      for (const touch of ch.touches) {
        const lv = channelPrice(ch, touch.level, touch.t);
        const err = (touch.p / lv - 1) * 100;
        worst = Math.max(worst, Math.abs(err));
        const li = document.createElement("li");
        li.innerHTML = `${touch.label} · ${touch.level} ${touch.role} <span class="err">${err >= 0 ? "+" : ""}${err.toFixed(2)}%</span>`;
        ul.appendChild(li);
      }
      card.append(h2, why, ul);
      channelsBox.appendChild(card);
    }
  }
  const audit = document.getElementById("audit");
  audit.textContent = `Claimed touches stay on the fixed slope and the fixed rings. Largest gap is ${worst.toFixed(2)}%. Pan and timeframe switches do not move them.`;
  audit.style.color = worst > 0.8 ? "#ef5d6c" : "#8b9aab";
}

function wire() {
  document.getElementById("tf").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const tf = btn.dataset.tf;
    if (!state.series[tf]) return;
    state.tf = tf;
    for (const b of document.querySelectorAll("#tf button")) b.classList.toggle("active", b === btn);
    renderSide();
    draw();
  });

  document.getElementById("views").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    applyView(btn.dataset.view);
    draw();
  });

  canvas.addEventListener("mousedown", (ev) => {
    const rect = canvas.getBoundingClientRect();
    state.drag = {
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
      t0: state.view.t0,
      t1: state.view.t1,
      log0: state.view.log0,
      log1: state.view.log1,
    };
    canvas.classList.add("dragging");
  });

  window.addEventListener("mouseup", () => {
    state.drag = null;
    canvas.classList.remove("dragging");
  });

  window.addEventListener("mousemove", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    if (state.drag) {
      const w = plot();
      const dt = ((x - state.drag.x) / w.w) * (state.drag.t1 - state.drag.t0);
      const dlog = ((y - state.drag.y) / w.h) * (state.drag.log1 - state.drag.log0);
      state.view.t0 = state.drag.t0 - dt;
      state.view.t1 = state.drag.t1 - dt;
      state.view.log0 = state.drag.log0 - dlog;
      state.view.log1 = state.drag.log1 - dlog;
    }
    state.hover = { x, y };
    draw();
  });

  canvas.addEventListener("mouseleave", () => {
    state.hover = null;
    draw();
  });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const factor = ev.deltaY > 0 ? 1.12 : 0.89;
    const t = tAt(x);
    const logp = Math.log(pAt(y));
    const nextT0 = t - (t - state.view.t0) * factor;
    const nextT1 = t + (state.view.t1 - t) * factor;
    const minSpan = TF_SEC[state.tf] * 12;
    if (nextT1 - nextT0 < minSpan) return;
    state.view.t0 = nextT0;
    state.view.t1 = nextT1;
    state.view.log0 = logp - (logp - state.view.log0) * factor;
    state.view.log1 = logp + (state.view.log1 - logp) * factor;
    draw();
  }, { passive: false });

  window.addEventListener("resize", resize);

  window.addEventListener("keydown", (ev) => {
    if (!state.view) return;
    const span = state.view.t1 - state.view.t0;
    if (ev.key === "ArrowLeft") {
      state.view.t0 -= span * 0.2;
      state.view.t1 -= span * 0.2;
      draw();
    } else if (ev.key === "ArrowRight") {
      state.view.t0 += span * 0.2;
      state.view.t1 += span * 0.2;
      draw();
    }
  });
}

function parseSeries(doc) {
  const out = [];
  for (let i = 0; i < doc.t.length; i++) {
    out.push({ t: doc.t[i], o: doc.o[i], h: doc.h[i], l: doc.l[i], c: doc.c[i] });
  }
  return out;
}

async function main() {
  wire();
  const [d1, h4, h1, linesDoc, circlesDoc, channelsDoc] = await Promise.all([
    fetch("data/btc-1d.json").then((r) => r.json()),
    fetch("data/btc-4h.json").then((r) => r.json()),
    fetch("data/btc-1h.json").then((r) => r.json()),
    fetch("data/lines.json").then((r) => r.json()),
    fetch("data/circles.json").then((r) => r.json()),
    fetch("data/channels.json").then((r) => r.json()),
  ]);
  state.series["1d"] = parseSeries(d1);
  state.series["4h"] = parseSeries(h4);
  state.series["1h"] = parseSeries(h1);
  state.lines = linesDoc.lines;
  state.circles = circlesDoc.circles;
  state.circleScale = circlesDoc.scale;
  state.channels = channelsDoc.channels;
  state.channelLevels = channelsDoc.levels;
  const params = new URLSearchParams(location.search);
  const tf = params.get("tf");
  if (tf && state.series[tf]) {
    state.tf = tf;
    for (const b of document.querySelectorAll("#tf button")) {
      b.classList.toggle("active", b.dataset.tf === tf);
    }
  }
  applyView(params.get("view") || "channels");
  document.getElementById("loading").classList.add("hidden");
  renderSide();
  resize();
}

main().catch((err) => {
  document.getElementById("loading").textContent = "Could not load BTC data. " + err.message;
});
