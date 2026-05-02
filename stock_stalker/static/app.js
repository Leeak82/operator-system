const $ = (id) => document.getElementById(id);
const state = {
  timer: null,
  history: {},
  seenEvents: new Set(),
};

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json();
}

function rowHtml(text, meta, onDelete) {
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `<div><div>${text}</div><div class="small">${meta}</div></div>`;
  const btn = document.createElement("button");
  btn.textContent = "Delete";
  btn.className = "danger";
  btn.onclick = onDelete;
  div.appendChild(btn);
  return div;
}

async function refreshWatchlist() {
  const box = $("watchlist");
  box.innerHTML = "Loading...";
  const data = await api("/api/watchlist");
  box.innerHTML = "";
  for (const w of data.watchlist || []) {
    box.appendChild(rowHtml(
      w.symbol,
      w.note || "No note",
      async () => { await api(`/api/watchlist/${w.id}`, { method: "DELETE" }); refreshWatchlist(); }
    ));
  }
  if (!box.children.length) box.innerHTML = "No symbols yet.";
}

async function refreshAlerts() {
  const box = $("alerts");
  box.innerHTML = "Loading...";
  const data = await api("/api/alerts");
  box.innerHTML = "";
  for (const a of data.alerts || []) {
    box.appendChild(rowHtml(
      `${a.symbol} - ${a.type} @ ${a.threshold}`,
      `Window: ${a.window_minutes} min`,
      async () => { await api(`/api/alerts/${a.id}`, { method: "DELETE" }); refreshAlerts(); }
    ));
  }
  if (!box.children.length) box.innerHTML = "No alert rules yet.";
}

function notify(title, body) {
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function addEvent(msg) {
  const box = $("events");
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `<div>${msg}</div>`;
  box.prepend(div);
}

function checkRule(rule, current, past) {
  if (rule.type === "below_price") return current < rule.threshold;
  if (rule.type === "above_price") return current > rule.threshold;
  if (!past) return false;
  const movePct = ((current - past) / past) * 100;
  if (rule.type === "percent_drop") return movePct <= -Math.abs(rule.threshold);
  if (rule.type === "percent_rise") return movePct >= Math.abs(rule.threshold);
  return false;
}

async function monitorTick() {
  const watchData = await api("/api/watchlist");
  const alertData = await api("/api/alerts");

  const symbols = [...new Set((watchData.watchlist || []).map((w) => w.symbol))];
  const alerts = alertData.alerts || [];

  for (const symbol of symbols) {
    const q = await api(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
    if (!q.ok) continue;
    const price = q.quote.close;

    state.history[symbol] = state.history[symbol] || [];
    state.history[symbol].push({ t: Date.now(), p: price });
    state.history[symbol] = state.history[symbol].slice(-1000);

    const symbolAlerts = alerts.filter((a) => a.symbol === symbol && a.enabled);
    for (const rule of symbolAlerts) {
      const cutoff = Date.now() - rule.window_minutes * 60 * 1000;
      const past = state.history[symbol].find((x) => x.t >= cutoff);
      const pastPrice = past ? past.p : null;
      const hit = checkRule(rule, price, pastPrice);
      const eventKey = `${rule.id}-${Math.floor(Date.now() / 60000)}`;
      if (hit && !state.seenEvents.has(eventKey)) {
        state.seenEvents.add(eventKey);
        const msg = `${symbol} hit ${rule.type} threshold (${rule.threshold}). Current: ${price}`;
        addEvent(msg);
        notify("Stock Stalker Alert", msg);
      }
    }
  }

  $("status").textContent = `Monitoring ${symbols.length} symbols. Last check: ${new Date().toLocaleTimeString()}`;
}

function startMonitoring() {
  if (state.timer) clearInterval(state.timer);
  monitorTick();
  const sec = Math.max(15, Number($("interval").value || 120));
  state.timer = setInterval(monitorTick, sec * 1000);
  $("status").textContent = `Monitoring every ${sec}s.`;
}

function stopMonitoring() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  $("status").textContent = "Stopped.";
}

function bindForms() {
  $("watchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbol: $("symbol").value, note: $("note").value })
    });
    $("symbol").value = "";
    $("note").value = "";
    refreshWatchlist();
  });

  $("alertForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await api("/api/alerts", {
      method: "POST",
      body: JSON.stringify({
        symbol: $("alertSymbol").value,
        type: $("alertType").value,
        threshold: $("threshold").value,
        window_minutes: $("window").value,
      }),
    });
    $("alertSymbol").value = "";
    $("threshold").value = "";
    refreshAlerts();
  });

  $("startBtn").onclick = startMonitoring;
  $("stopBtn").onclick = stopMonitoring;
  $("notifyBtn").onclick = async () => {
    await Notification.requestPermission();
    $("status").textContent = `Notification permission: ${Notification.permission}`;
  };
}

bindForms();
refreshWatchlist();
refreshAlerts();
