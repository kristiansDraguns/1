(() => {
  const SYMBOL = "PF_XBTUSD";
  const WS_URL = "wss://uws.kraken.com/v2/public";
  const HISTORY_MINUTES = 180;
  const MAX_BARS = 240;

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

  const bars = new Map();
  let socket = null;
  let reconnectDelay = 1000;
  let pingTimer = 0;
  let watchTimer = 0;
  let lastMessageAt = 0;
  let drawQueued = false;
  let emptyNote = "Loading candles…";

  function parseTime(value) {
    if (typeof value === "number") return value;
    const text = String(value).replace(/\.(\d{3})\d+/, ".$1");
    const time = Date.parse(text);
    return Number.isFinite(time) ? time : NaN;
  }

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

  function formatMinute(time) {
    const date = new Date(time);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
  }

  function setStatus(state, label) {
    statusEl.textContent = label;
    statusEl.dataset.state = state;
    dotEl.className = "dot" + (state === "connecting" ? "" : " " + state);
  }

  function renderQuote(data) {
    const last = data[data.length - 1];
    if (!last) {
      priceEl.textContent = "—";
      priceEl.dataset.price = "";
      priceEl.className = "";
      barEl.textContent = "BTC perpetual · USD · 1 minute";
      barEl.dataset.time = "";
      return;
    }
    const prev = data.length > 1 ? data[data.length - 2].close : last.open;
    const direction = last.close > prev ? "up" : last.close < prev ? "down" : "";
    priceEl.textContent = formatPrice(last.close);
    priceEl.dataset.price = String(last.close);
    priceEl.className = direction;
    barEl.textContent = `BTC perpetual · USD · 1 minute · bar ${formatMinute(last.time)}`;
    barEl.dataset.time = String(last.time);
  }

  function scheduleDraw() {
    renderQuote(series());
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
    const plotH = height - pad.top - pad.bottom;
    if (plotW < 20 || plotH < 20) return;

    if (!data.length) {
      ctx.fillStyle = axis;
      ctx.font = "13px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(emptyNote, width / 2, height / 2);
      return;
    }

    const slot = Math.min(10, plotW / data.length);
    const viewCount = Math.max(1, Math.floor(plotW / slot));
    const view = data.slice(-viewCount);
    const originX = pad.left + plotW - slot * view.length;

    let hi = -Infinity;
    let lo = Infinity;
    for (const candle of view) {
      hi = Math.max(hi, candle.high);
      lo = Math.min(lo, candle.low);
    }
    const cushion = (hi - lo) * 0.08 || Math.max(hi * 0.0008, 1);
    hi += cushion;
    lo -= cushion;
    const yOf = (price) => pad.top + ((hi - price) / (hi - lo)) * plotH;

    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const step = niceStep(hi - lo, Math.max(3, Math.floor(plotH / 72)));
    const firstTick = Math.ceil(lo / step) * step;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = axis;
    ctx.textAlign = "left";
    for (let price = firstTick; price <= hi; price += step) {
      const y = Math.round(yOf(price)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillText(formatPrice(price), pad.left + plotW + 8, yOf(price));
    }

    const labelEvery = Math.max(1, Math.ceil(72 / slot));
    const marks = [];
    for (let i = 0; i < view.length; i += labelEvery) marks.push(i);
    const lastIndex = view.length - 1;
    if (marks[marks.length - 1] !== lastIndex) {
      if (lastIndex - marks[marks.length - 1] < labelEvery * 0.55) marks[marks.length - 1] = lastIndex;
      else marks.push(lastIndex);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const i of marks) {
      const x = originX + i * slot + slot / 2;
      ctx.fillText(formatMinute(view[i].time).replace(" UTC", ""), x, pad.top + plotH + 8);
    }

    const last = view[view.length - 1];
    const prev = view.length > 1 ? view[view.length - 2].close : last.open;
    const lastUp = last.close >= prev;
    const yLast = yOf(last.close);
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
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
      const candle = view[i];
      const x = originX + i * slot + slot / 2;
      const rising = candle.close >= candle.open;
      ctx.strokeStyle = rising ? up : down;
      ctx.fillStyle = rising ? up : down;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yOf(candle.high));
      ctx.lineTo(Math.round(x) + 0.5, yOf(candle.low));
      ctx.stroke();
      const top = yOf(Math.max(candle.open, candle.close));
      const bottom = yOf(Math.min(candle.open, candle.close));
      const bodyH = Math.max(1, bottom - top);
      ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH);
    }
    ctx.restore();

    const label = formatPrice(last.close);
    const tagW = Math.ceil(ctx.measureText(label).width) + 14;
    const tagH = 18;
    const tagY = Math.min(pad.top + plotH - tagH, Math.max(pad.top, yLast - tagH / 2));
    ctx.fillStyle = lastUp ? up : down;
    roundRect(pad.left + plotW + 4, tagY, tagW, tagH, 3);
    ctx.fill();
    ctx.fillStyle = "#0b0e11";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pad.left + plotW + 4 + tagW / 2, tagY + tagH / 2);
  }

  async function loadHistory() {
    const now = Math.floor(Date.now() / 1000);
    const from = now - HISTORY_MINUTES * 60;
    const query = `from=${from}&to=${now}&count=${HISTORY_MINUTES + 5}`;
    const path = `/trade/${SYMBOL}/1m?${query}`;
    // Kraken echoes Access-Control-Allow-Origin only for futures.kraken.com.
    // The same charts path on this origin is the fallback while serving locally.
    const urls = [
      `https://futures.kraken.com/api/charts/v1${path}`,
      `/api/charts/v1${path}`,
    ];
    let lastError = null;
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`history ${response.status}`);
        const payload = await response.json();
        const candles = payload.candles || [];
        for (const raw of candles) {
          const candle = candleFrom(raw, Number(raw.time));
          if (candle) upsert(candle, "rest");
        }
        if (candles.length) {
          emptyNote = "";
          scheduleDraw();
          return;
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (!bars.size) emptyNote = "Waiting for the live candle…";
    scheduleDraw();
    if (lastError) console.warn(lastError);
  }

  function applyWsCandle(raw) {
    if (raw.symbol && raw.symbol !== SYMBOL) return;
    if (raw.interval && Number(raw.interval) !== 1) return;
    const candle = candleFrom(raw, parseTime(raw.interval_begin || raw.timestamp));
    if (!candle) return;
    upsert(candle, "ws");
    emptyNote = "";
    scheduleDraw();
  }

  function clearTimers() {
    clearInterval(pingTimer);
    clearInterval(watchTimer);
    pingTimer = 0;
    watchTimer = 0;
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
    setStatus("connecting", socket ? "Reconnecting" : "Connecting");
    const ws = new WebSocket(WS_URL);
    socket = ws;
    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      reconnectDelay = 1000;
      lastMessageAt = Date.now();
      ws.send(JSON.stringify({
        method: "subscribe",
        params: {
          channel: "ohlc",
          asset_class: "derivatives",
          symbol: [SYMBOL],
          interval: 1,
          tick_type: "trade",
          snapshot: true,
        },
      }));
      clearTimers();
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: "ping" }));
      }, 20000);
      watchTimer = setInterval(() => {
        if (Date.now() - lastMessageAt > 15000 && ws.readyState === WebSocket.OPEN) ws.close();
      }, 5000);
    });
    ws.addEventListener("message", (event) => {
      if (socket !== ws) return;
      lastMessageAt = Date.now();
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.method === "ping") {
        ws.send(JSON.stringify({ method: "pong", req_id: message.req_id }));
        return;
      }
      if (message.method === "subscribe" && message.success && message.result?.channel === "ohlc") {
        setStatus("connected", "Connected");
      }
      if (message.channel === "ohlc" && Array.isArray(message.data)) {
        setStatus("connected", "Connected");
        for (const raw of message.data) applyWsCandle(raw);
      }
    });
    ws.addEventListener("close", () => {
      if (socket !== ws) return;
      clearTimers();
      setStatus("disconnected", "Reconnecting");
      const wait = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      setTimeout(connect, wait);
    });
    ws.addEventListener("error", () => {
      if (socket === ws) ws.close();
    });
  }

  new ResizeObserver(scheduleDraw).observe(canvas.parentElement);
  loadHistory();
  connect();
  setInterval(loadHistory, 60000);
})();
