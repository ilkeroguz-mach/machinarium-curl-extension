const STORAGE_KEY = "macurl_requests";

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const hostEl = document.getElementById("host");
const toastEl = document.getElementById("toast");
const clearBtn = document.getElementById("clear");
const searchEl = document.getElementById("search");

const listViewEl = document.getElementById("listView");
const detailEl = document.getElementById("detail");
const backBtn = document.getElementById("back");
const copyTabBtn = document.getElementById("copyTab");
const copyCurlBtn = document.getElementById("copyCurl");
const tabsEl = document.getElementById("tabs");
const detailMethodEl = document.getElementById("detailMethod");
const detailStatusEl = document.getElementById("detailStatus");
const detailTypeEl = document.getElementById("detailType");
const detailUrlEl = document.getElementById("detailUrl");
const detailBodyEl = document.getElementById("detailBody");

let toastTimer = null;
// Aktif sekmeye ait istekler (aramadan bağımsız), arama bunun üzerinde çalışır
let currentRequests = [];
// Detayda gösterilen istek ve kopyalama için ham (highlight'sız) metin
let detailReq = null;
let detailTabText = "";
// Aktif sekme: response | request | headers
let activeTab = "response";

document.addEventListener("DOMContentLoaded", render);

searchEl.addEventListener("input", applyFilter);

clearBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear" });
  showList();
  render();
});

backBtn.addEventListener("click", showList);
copyCurlBtn.addEventListener("click", () => {
  if (detailReq) copyCurl(detailReq);
});
copyTabBtn.addEventListener("click", () => {
  if (!detailTabText) {
    showToast("Kopyalanacak içerik yok ✕");
    return;
  }
  copyText(detailTabText);
});

// Sekme değişimi: içerik panelini ve kopyalama butonunu güncelle
tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn || btn.dataset.tab === activeTab) return;
  activeTab = btn.dataset.tab;
  for (const t of tabsEl.querySelectorAll(".tab")) {
    t.classList.toggle("active", t === btn);
  }
  if (detailReq) renderTabContent(detailReq);
});

// Arka plan yeni istek/yanıt yakaladıkça arayüzü güncel tut
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  if (!detailEl.classList.contains("hidden") && detailReq) {
    // Detay açıkken yanıt gövdesi sonradan gelebilir; aynı kaydı tazele
    const next = (changes[STORAGE_KEY].newValue || []).find((r) => r.id === detailReq.id);
    if (next) showDetail(next);
  } else {
    render();
  }
});

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTabId = tab ? tab.id : null;
  hostEl.textContent = (tab ? hostOf(tab.url) : "") || "—";

  const data = await chrome.storage.local.get(STORAGE_KEY);
  let requests = data[STORAGE_KEY] || [];

  // Yalnızca aktif sekmede yapılan istekleri göster
  if (activeTabId != null) {
    requests = requests.filter((r) => r.tabId === activeTabId);
  }

  currentRequests = requests;
  applyFilter();
}

function applyFilter() {
  const term = searchEl.value.trim().toLowerCase();
  const filtered = term
    ? currentRequests.filter((r) => {
        const haystack = `${r.method || ""} ${r.url || ""}`.toLowerCase();
        return haystack.includes(term);
      })
    : currentRequests;

  listEl.innerHTML = "";
  for (const req of filtered) {
    listEl.appendChild(renderRow(req));
  }

  const noResults = filtered.length === 0;
  emptyEl.classList.toggle("hidden", !noResults);
  emptyEl.innerHTML =
    currentRequests.length === 0
      ? 'Bu sekmede henüz istek yakalanmadı.<br /><small>Sayfada gezin, fetch/XHR istekleri burada görünecek.</small>'
      : '"' + escapeHtml(term) + '" ile eşleşen istek yok.';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}

function renderRow(req) {
  const li = document.createElement("li");
  li.className = "row";

  const isError = req.error != null || (req.status >= 400 && req.status <= 599);
  if (isError) li.classList.add("row-error");

  const method = (req.method || "GET").toUpperCase();
  const badge = document.createElement("span");
  badge.className = `method m-${method}`;
  badge.textContent = method;

  const wrap = document.createElement("div");
  wrap.className = "path-wrap";

  const path = document.createElement("div");
  path.className = "path";
  path.textContent = shortPath(req.url);
  path.title = req.url;

  const time = document.createElement("div");
  time.className = "time";
  time.textContent = formatTime(req.timeStamp);

  if (req.status != null || req.error) {
    const status = document.createElement("span");
    status.className = "status" + (isError ? " status-error" : "");
    status.textContent = req.error ? "ERR" : req.status;
    time.appendChild(document.createTextNode(" · "));
    time.appendChild(status);
  }

  wrap.appendChild(path);
  wrap.appendChild(time);

  const hint = document.createElement("span");
  hint.className = "copy-hint";
  // Yanıt gövdesi yakalandıysa belli et
  hint.textContent = req.response && req.response.body != null ? "yanıt ›" : "›";

  li.appendChild(badge);
  li.appendChild(wrap);
  li.appendChild(hint);

  li.addEventListener("click", () => showDetail(req, true));

  return li;
}

function showList() {
  detailReq = null;
  detailTabText = "";
  detailEl.classList.add("hidden");
  listViewEl.classList.remove("hidden");
}

// resetTab: listeden yeni bir kayıt açılırken true; storage tazelemesinde
// false kalır ki kullanıcının baktığı sekme değişmesin.
function showDetail(req, resetTab) {
  detailReq = req;
  listViewEl.classList.add("hidden");
  detailEl.classList.remove("hidden");

  if (resetTab && activeTab !== "response") {
    activeTab = "response";
    for (const t of tabsEl.querySelectorAll(".tab")) {
      t.classList.toggle("active", t.dataset.tab === "response");
    }
  }

  const method = (req.method || "GET").toUpperCase();
  detailMethodEl.className = `method m-${method}`;
  detailMethodEl.textContent = method;

  const res = req.response;
  const status = res && res.status != null ? res.status : req.status;
  const isError = req.error != null || (status >= 400 && status <= 599);
  detailStatusEl.className = "status" + (isError ? " status-error" : "");
  detailStatusEl.textContent = req.error ? "ERR" : status != null ? status : "—";

  detailTypeEl.textContent = (res && res.contentType ? res.contentType : "").split(";")[0];
  detailUrlEl.textContent = req.url;

  renderTabContent(req);
}

// Aktif sekmenin içeriğini panele bas, kopyalanacak ham metni hazırla
function renderTabContent(req) {
  if (activeTab === "request") {
    copyTabBtn.textContent = "Copy Body";
    renderRequestBody(req);
  } else if (activeTab === "headers") {
    copyTabBtn.textContent = "Copy Headers";
    renderHeaders(req);
  } else {
    copyTabBtn.textContent = "Copy JSON";
    renderResponseBody(req);
  }
}

function renderEmpty(message) {
  detailTabText = "";
  detailBodyEl.classList.add("empty-body");
  detailBodyEl.textContent = message;
}

// Metni panele bas: JSON ise güzelleştirip renklendir, değilse ham göster
function renderText(text) {
  detailBodyEl.classList.remove("empty-body");
  try {
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    detailTabText = pretty;
    detailBodyEl.innerHTML = syntaxHighlight(pretty);
  } catch (e) {
    detailTabText = text;
    detailBodyEl.textContent = text;
  }
}

function renderResponseBody(req) {
  const res = req.response;
  const body = res && res.body != null ? res.body : null;
  if (body == null) {
    renderEmpty(
      "Bu istek için yanıt gövdesi yakalanmadı.\n(fetch/XHR dışı, ikili içerik veya henüz tamamlanmamış olabilir.)"
    );
    return;
  }
  renderText(body);
}

function renderRequestBody(req) {
  const body = req.body;
  if (!body || body.value == null) {
    renderEmpty("Bu istek gövde (body) içermiyor.\n(GET istekleri genelde gövdesizdir.)");
    return;
  }
  if (body.type === "formData") {
    // formData: {alan: [değerler]} — tek değerli alanları sadeleştirip göster
    const flat = {};
    for (const [k, vals] of Object.entries(body.value)) {
      flat[k] = Array.isArray(vals) && vals.length === 1 ? vals[0] : vals;
    }
    renderText(JSON.stringify(flat));
    return;
  }
  renderText(body.value);
}

function renderHeaders(req) {
  const entries = Object.entries(req.headers || {});
  if (entries.length === 0) {
    renderEmpty("Bu istek için header yakalanmadı.");
    return;
  }
  detailBodyEl.classList.remove("empty-body");
  detailTabText = entries.map(([name, value]) => `${name}: ${value}`).join("\n");
  detailBodyEl.innerHTML = entries
    .map(
      ([name, value]) =>
        `<span class="j-key">${escapeHtml(name)}:</span> ${escapeHtml(value)}`
    )
    .join("\n");
}

function syntaxHighlight(json) {
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "j-num";
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "j-key" : "j-str";
      } else if (/true|false/.test(match)) {
        cls = "j-bool";
      } else if (/null/.test(match)) {
        cls = "j-null";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function copyCurl(req) {
  copyText(buildCurl(req));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Kopyalandı ✓");
  } catch (e) {
    showToast("Kopyalanamadı ✕");
  }
}

function buildCurl(req) {
  // curl'ün kendi yöneteceği header'ları atla
  const skip = new Set(["content-length", "host"]);
  const parts = [`curl '${req.url}'`];

  if (req.method && req.method.toUpperCase() !== "GET") {
    parts.push(`-X ${req.method.toUpperCase()}`);
  }

  for (const [name, value] of Object.entries(req.headers || {})) {
    const lower = name.toLowerCase();
    if (lower.startsWith(":")) continue; // HTTP/2 pseudo-header'ları
    if (skip.has(lower)) continue;
    parts.push(`-H '${name}: ${escapeSingle(value)}'`);
  }

  if (req.body) {
    if (req.body.type === "raw" && req.body.value) {
      parts.push(`--data-raw '${escapeSingle(req.body.value)}'`);
    } else if (req.body.type === "formData" && req.body.value) {
      for (const [k, vals] of Object.entries(req.body.value)) {
        for (const v of vals) {
          parts.push(`--data-urlencode '${escapeSingle(k)}=${escapeSingle(v)}'`);
        }
      }
    }
  }

  return parts.join(" \\\n  ");
}

// Tek tırnak içinde güvenli kaçış: ' -> '\''
function escapeSingle(str) {
  return String(str).replace(/'/g, `'\\''`);
}

function shortPath(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch (e) {
    return url;
  }
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 1500);
}
