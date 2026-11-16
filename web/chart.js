(() => {
  const HISTORY_MINUTES = 180;
  const MAX_BARS = 240;
  const SMA_PERIOD = 20;
  const OHLC_URL = "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1";
  const TRADES_URL = "https://api.kraken.com/0/public/Trades?pair=XBTUSD";

  const priceEl = document.getElementById("price");
  const statusEl = document.getElementById("status");
  const dotEl = document.getElementById("dot");
  const barEl = document.getElementById("bar");
  const canvas = document.getElementById("chart");
  const ctx = canvas.getContext("2d");

  const bg = "#0b0e11";
  const grid = "#182028";
  const axis = "#8b98a5";
  const up = "#3dd68c";
  const down = "#ff5d73";
  const smaColor = "#f0c14b";

  const bars = new Map();
  const flow = new Map();
  const seenTrades = new Set();
  let flowCursor = "";
  let flowLoading = false;
  let drawQueued = false;
  let emptyNote = "Loading candles…";
  let feedLabel = "Connecting";

  function candleFrom(raw, time) {
    const open = Number(raw.open);
    const high = Number(raw.high);
    const low = Number(raw.low);
    const close = Number(raw.close);
    if (![time, open, high, low, close].every(Number.isFinite)) return null;
    return { time, open, high, low, close };
  }

  function series() {
    return [...bars.values()].sort((a, b) => a.time - b.time);
  }

  function trim() {
    const all = series();
    if (all.length <= MAX_BARS) return;
    for (const candle of all.slice(0, all.length - MAX_BARS)) bars.delete(candle.time);
  }

  function upsert(candle, source) {
    const prev = bars.get(candle.time);
    if (source === "rest" && prev?.source === "ws") {
      const latest = Math.max(...bars.keys());
      if (candle.time >= latest) return;
    }
    bars.set(candle.time, { ...candle, source });
    trim();
  }

  function formatPrice(value) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  function formatDelta(value) {
    const abs = Math.abs(value);
    const digits = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
    const body = abs.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    if (value > 0) return `+${body}`;
    if (value < 0) return `-${body}`;
    return body;
  }

  function formatMinute(time) {
    const date = new Date(time);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
  }

  function flowBars() {
    if (!flow.size) return [];
    const start = Math.min(...flow.keys());
    const end = Math.max(...flow.keys());
    const rows = [];
    for (let time = start; time <= end; time += 60000) {
      rows.push({ time, delta: flow.get(time) || 0, sma: null });
    }
    let sum = 0;
    for (let i = 0; i < rows.length; i++) {
      sum += rows[i].delta;
      if (i >= SMA_PERIOD) sum -= rows[i - SMA_PERIOD].delta;
      if (i >= SMA_PERIOD - 1) rows[i].sma = sum / SMA_PERIOD;
    }
    return rows;
  }

  function setStatus(state, label) {
    feedLabel = label;
    statusEl.dataset.state = state;
    dotEl.className = "dot" + (state === "connecting" ? "" : " " + state);
    renderStatus();
  }

  function renderStatus() {
    const rows = flowBars();
    const last = rows[rows.length - 1];
    if (!last) {
      statusEl.textContent = feedLabel;
      delete statusEl.dataset.delta;
      delete statusEl.dataset.sma;
      return;
    }
    const smaText = last.sma == null ? "—" : formatDelta(last.sma);
    statusEl.textContent = `${feedLabel} · delta ${formatDelta(last.delta)} BTC · SMA ${smaText}`;
    statusEl.dataset.delta = String(last.delta);
    statusEl.dataset.sma = last.sma == null ? "" : String(last.sma);
  }

  function renderQuote(data) {
    const last = data[data.length - 1];
    if (!last) {
      priceEl.textContent = "—";
      priceEl.dataset.price = "";
      priceEl.className = "";
      barEl.textContent = "BTC spot · USD · 1 minute";
      barEl.dataset.time = "";
      return;
    }
    const prev = data.length > 1 ? data[data.length - 2].close : last.open;
    const direction = last.close > prev ? "up" : last.close < prev ? "down" : "";
    priceEl.textContent = formatPrice(last.close);
    priceEl.dataset.price = String(last.close);
    priceEl.className = direction;
    barEl.textContent = `BTC spot · USD · 1 minute · bar ${formatMinute(last.time)}`;
    barEl.dataset.time = String(last.time);
  }

  function scheduleDraw() {
    renderQuote(series());
    renderStatus();
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      draw();
    });
  }

  function niceStep(span, target) {
    const rough = span / Math.max(target, 1);
    const mag = 10 ** Math.floor(Math.log10(rough));
    const error = rough / mag;
    if (error >= 7.5) return 10 * mag;
    if (error >= 3.5) return 5 * mag;
    if (error >= 1.5) return 2 * mag;
    return mag;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 10 || height < 10) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const data = series();
    const pad = { left: 12, right: 84, top: 14, bottom: 28 };
    const plotW = width - pad.left - pad.right;
    const available = height - pad.top - pad.bottom;
    if (plotW < 20 || available < 40) return;

    if (!data.length) {
      ctx.fillStyle = axis;
      ctx.font = "13px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(emptyNote, width / 2, height / 2);
      return;
    }

    const gap = 18;
    const flowH = Math.max(78, Math.round(available * 0.28));
    const priceH = available - flowH - gap;
    const priceTop = pad.top;
    const flowTop = priceTop + priceH + gap;

    const times = data.map((candle) => candle.time);
    if (flow.size) {
      const latestFlow = Math.max(...flow.keys());
      if (latestFlow > times[times.length - 1]) times.push(latestFlow);
    }
    const slot = Math.min(10, plotW / times.length);
    const viewCount = Math.max(1, Math.floor(plotW / slot));
    const view = times.slice(-viewCount);
    const originX = pad.left + plotW - slot * view.length;
    const candles = new Map(data.map((candle) => [candle.time, candle]));

    let hi = -Infinity;
    let lo = Infinity;
    for (const time of view) {
      const candle = candles.get(time);
      if (!candle) continue;
      hi = Math.max(hi, candle.high);
      lo = Math.min(lo, candle.low);
    }
    if (!Number.isFinite(hi)) return;
    const cushion = (hi - lo) * 0.08 || Math.max(hi * 0.0008, 1);
    hi += cushion;
    lo -= cushion;
    const yPrice = (price) => priceTop + ((hi - price) / (hi - lo)) * priceH;

    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const step = niceStep(hi - lo, Math.max(3, Math.floor(priceH / 72)));
    const firstTick = Math.ceil(lo / step) * step;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = axis;
    ctx.textAlign = "left";
    for (let price = firstTick; price <= hi; price += step) {
      const y = Math.round(yPrice(price)) + 0.5;
      if (y < priceTop || y > priceTop + priceH) continue;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillText(formatPrice(price), pad.left + plotW + 8, yPrice(price));
    }

    const lastCandle = data[data.length - 1];
    const prevClose = data.length > 1 ? data[data.length - 2].close : lastCandle.open;
    const lastUp = lastCandle.close >= prevClose;
    const yLast = yPrice(lastCandle.close);
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, priceTop, plotW, priceH);
    ctx.clip();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = lastUp ? up : down;
    ctx.beginPath();
    ctx.moveTo(pad.left, Math.round(yLast) + 0.5);
    ctx.lineTo(pad.left + plotW, Math.round(yLast) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    const bodyW = Math.max(2, slot * 0.68);
    for (let i = 0; i < view.length; i++) {
      const candle = candles.get(view[i]);
      if (!candle) continue;
      const x = originX + i * slot + slot / 2;
      const rising = candle.close >= candle.open;
      ctx.strokeStyle = rising ? up : down;
      ctx.fillStyle = rising ? up : down;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yPrice(candle.high));
      ctx.lineTo(Math.round(x) + 0.5, yPrice(candle.low));
      ctx.stroke();
      const top = yPrice(Math.max(candle.open, candle.close));
      const bottom = yPrice(Math.min(candle.open, candle.close));
      ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, bottom - top));
    }
    ctx.restore();

    const label = formatPrice(lastCandle.close);
    const tagW = Math.ceil(ctx.measureText(label).width) + 14;
    const tagH = 18;
    const tagY = Math.min(priceTop + priceH - tagH, Math.max(priceTop, yLast - tagH / 2));
    ctx.fillStyle = lastUp ? up : down;
    roundRect(pad.left + plotW + 4, tagY, tagW, tagH, 3);
    ctx.fill();
    ctx.fillStyle = "#0b0e11";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pad.left + plotW + 4 + tagW / 2, tagY + tagH / 2);

    drawFlow(view, originX, slot, bodyW, pad.left, plotW, flowTop, flowH);

    const labelEvery = Math.max(1, Math.ceil(72 / slot));
    const marks = [];
    for (let i = 0; i < view.length; i += labelEvery) marks.push(i);
    const lastIndex = view.length - 1;
    if (marks[marks.length - 1] !== lastIndex) {
      if (lastIndex - marks[marks.length - 1] < labelEvery * 0.55) marks[marks.length - 1] = lastIndex;
      else marks.push(lastIndex);
    }
    ctx.fillStyle = axis;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const i of marks) {
      const x = originX + i * slot + slot / 2;
      ctx.fillText(formatMinute(view[i]).replace(" UTC", ""), x, flowTop + flowH + 8);
    }
  }

  function drawFlow(view, originX, slot, bodyW, left, plotW, flowTop, flowH) {
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = axis;
    ctx.fillText("Order flow", left, flowTop - 4);
    ctx.fillStyle = smaColor;
    ctx.fillText("SMA 20", left + 96, flowTop - 4);

    const rows = flowBars();
    const byTime = new Map(rows.map((row) => [row.time, row]));
    const visible = view.map((time) => byTime.get(time)).filter(Boolean);
    if (!visible.length) {
      ctx.fillStyle = axis;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(flowLoading ? "Loading order flow…" : "Waiting for trades…", left + plotW / 2, flowTop + flowH / 2);
      return;
    }

    let peak = 0;
    for (const row of visible) {
      peak = Math.max(peak, Math.abs(row.delta), Math.abs(row.sma ?? 0));
    }
    peak = (peak || 1) * 1.12;
    const y0 = flowTop + flowH / 2;
    const yOf = (value) => y0 - (value / peak) * (flowH / 2);

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = axis;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const tick = niceStep(peak * 2, 3);
    for (const value of [tick, 0, -tick]) {
      if (Math.abs(value) > peak) continue;
      const y = Math.round(yOf(value)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotW, y);
      ctx.stroke();
      ctx.fillText(formatDelta(value), left + plotW + 8, yOf(value));
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, flowTop, plotW, flowH);
    ctx.clip();
    for (let i = 0; i < view.length; i++) {
      const row = byTime.get(view[i]);
      if (!row) continue;
      const x = originX + i * slot + slot / 2;
      const y = yOf(row.delta);
      ctx.fillStyle = row.delta >= 0 ? up : down;
      const top = Math.min(y, y0);
      ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, Math.abs(y - y0)));
    }
    ctx.beginPath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = smaColor;
    let started = false;
    for (let i = 0; i < view.length; i++) {
      const row = byTime.get(view[i]);
      if (!row || row.sma == null) {
        started = false;
        continue;
      }
      const x = originX + i * slot + slot / 2;
      const y = yOf(row.sma);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  async function loadHistory() {
    try {
      const response = await fetch(OHLC_URL, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`history ${response.status}`);
      const payload = await response.json();
      const rows = payload.result && payload.result.XXBTZUSD;
      if (!Array.isArray(rows) || !rows.length) throw new Error("history empty");
      const recent = rows.slice(-HISTORY_MINUTES);
      for (const row of recent) {
        const candle = candleFrom(
          { open: row[1], high: row[2], low: row[3], close: row[4] },
          Number(row[0]) * 1000,
        );
        if (candle) upsert(candle, "rest");
      }
      emptyNote = "";
      setStatus("connected", "Connected");
      scheduleDraw();
    } catch (error) {
      if (!bars.size) emptyNote = "Waiting for the live candle…";
      setStatus("disconnected", "Reconnecting");
      scheduleDraw();
      console.warn(error);
    }
  }

  function addTrades(rows) {
    for (const row of rows) {
      const id = row[6];
      if (id != null) {
        if (seenTrades.has(id)) continue;
        seenTrades.add(id);
      }
      const volume = Number(row[1]);
      const time = Number(row[2]);
      const side = row[3];
      if (!Number.isFinite(volume) || !Number.isFinite(time)) continue;
      const sign = side === "b" ? 1 : side === "s" ? -1 : 0;
      if (!sign) continue;
      const minute = Math.floor(time / 60) * 60000;
      flow.set(minute, (flow.get(minute) || 0) + sign * volume);
    }
    const cutoff = Date.now() - (HISTORY_MINUTES + 5) * 60000;
    for (const minute of flow.keys()) {
      if (minute < cutoff) flow.delete(minute);
    }
  }

  async function loadFlow() {
    if (flowLoading) return;
    flowLoading = true;
    try {
      let since = flowCursor || `${Math.floor(Date.now() / 1000) - HISTORY_MINUTES * 60}000000000`;
      const maxPages = flowCursor ? 4 : 40;
      for (let page = 0; page < maxPages; page++) {
        const response = await fetch(`${TRADES_URL}&since=${since}`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`trades ${response.status}`);
        const payload = await response.json();
        if (payload.error && payload.error.length) throw new Error(payload.error.join(", "));
        const rows = payload.result && payload.result.XXBTZUSD;
        const cursor = payload.result && payload.result.last;
        if (!Array.isArray(rows) || !rows.length) {
          if (cursor) flowCursor = String(cursor);
          break;
        }
        addTrades(rows);
        if (!cursor || String(cursor) === since) break;
        flowCursor = String(cursor);
        since = flowCursor;
        scheduleDraw();
        const lastTime = Number(rows[rows.length - 1][2]);
        if (Number.isFinite(lastTime) && lastTime >= Date.now() / 1000 - 1) break;
      }
      scheduleDraw();
    } catch (error) {
      console.warn(error);
      scheduleDraw();
    } finally {
      flowLoading = false;
    }
  }

  new ResizeObserver(scheduleDraw).observe(canvas.parentElement);
  loadHistory();
  loadFlow();
  setInterval(loadHistory, 2000);
  setInterval(loadFlow, 2000);
})();
