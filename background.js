// macurl — fetch/XHR isteklerini yakalar, popup'ın curl üretebilmesi için saklar.

// Yalnızca bu host'lara giden fetch/XHR istekleri yakalanır.
// Yeni bir host eklemek için buraya ekle ve manifest.json -> host_permissions
// kısmına da `*://<host>/*` olarak ekle.
const ALLOWED_HOSTS = ["*.gencallar.com.tr", "*.tepehome.com.tr", "mymagazacilik.machinarium.dev"];
const URL_FILTER = {
  urls: ALLOWED_HOSTS.map((h) => `*://${h}/*`),
  types: ["xmlhttprequest"],
};

const MAX_ITEMS = 25;
const STORAGE_KEY = "macurl_requests";

// Bellekteki kayıtlar. Service worker uyandığında storage'dan tekrar doldurulur.
let captured = [];
// requestId -> header'ları bekleyen yarım kayıt
const pending = new Map();
// Henüz eşleşecek istek kaydı oluşmamış (yarış) yanıtlar; kayıt gelince bağlanır
let pendingResponses = [];
const RESP_TTL = 30000; // 30 sn'den eski bekleyen yanıtları at
// storage yazımlarını sıraya sokmak için
let writeChain = Promise.resolve();

// Service worker uyandığında storage hazır olana kadar bekleyebilmek için.
const ready = init();

async function init() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  captured = data[STORAGE_KEY] || [];
}

// 1) Önce body'yi yakala
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (shouldSkip(details)) return;
    pending.set(details.requestId, { body: extractBody(details.requestBody) });
  },
  URL_FILTER,
  ["requestBody"]
);

// 2) Sonra header'ları yakala ve kaydı tamamla
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (shouldSkip(details)) return;

    const partial = pending.get(details.requestId) || {};
    pending.delete(details.requestId);

    const headers = {};
    for (const h of details.requestHeaders || []) {
      headers[h.name] = h.value ?? "";
    }

    addRecord({
      id: `${details.requestId}:${details.timeStamp}`,
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      headers,
      body: partial.body || null,
      timeStamp: details.timeStamp,
      tabId: details.tabId,
      host: hostOf(details.url),
      status: null,
    });
  },
  URL_FILTER,
  ["requestHeaders", "extraHeaders"]
);

// 3) İstek tamamlandığında HTTP status kodunu kaydet
chrome.webRequest.onCompleted.addListener(
  (details) => {
    updateStatus(details.requestId, details.statusCode);
  },
  URL_FILTER
);

// İstek başarısız olursa (network hatası vb.) işaretle
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    updateStatus(details.requestId, 0, details.error);
  },
  URL_FILTER
);

function updateStatus(requestId, status, error) {
  // Aynı requestId'ye sahip, henüz status'u set edilmemiş en yeni kaydı bul
  const rec = captured.find((r) => r.requestId === requestId && r.status == null);
  if (!rec) return;
  rec.status = status;
  if (error) rec.error = error;
  persist();
}

// Popup ve content script'lerden gelen mesajlar
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "clear") {
    captured = [];
    pending.clear();
    persist().then(() => sendResponse({ ok: true }));
    return true; // async yanıt
  }

  if (msg.type === "response") {
    ready.then(() => attachResponse(msg.data));
    return; // yanıt beklenmiyor
  }
});

// inject.js'ten gelen yanıt gövdesini, eşleşen istek kaydına bağla.
// Kayıt henüz oluşmadıysa (yarış) yanıtı tamponla; addRecord sonradan bağlar.
function attachResponse(data) {
  if (!data || !data.url) return;
  const method = String(data.method || "GET").toUpperCase();
  const rec = captured.find(
    (r) =>
      r.url === data.url &&
      String(r.method || "GET").toUpperCase() === method &&
      r.response == null
  );

  if (rec) {
    setResponse(rec, data);
    persist();
    return;
  }

  // Eşleşen kayıt yok: kısa süre beklet, kayıt gelince bağlanır
  const now = Date.now();
  pendingResponses.push({ url: data.url, method, data, at: now });
  pendingResponses = pendingResponses
    .filter((p) => now - p.at < RESP_TTL)
    .slice(-50);
}

function setResponse(rec, data) {
  rec.response = {
    status: data.status != null ? data.status : null,
    contentType: data.contentType || "",
    body: data.body != null ? data.body : null,
  };
}

// İstenmeyen istekleri ele:
// - OPTIONS (CORS preflight) method'u
// - /_next/ (Next.js asset/data) ve /cdn-cgi/ (Cloudflare) klasörleri
function shouldSkip(details) {
  if ((details.method || "").toUpperCase() === "OPTIONS") return true;
  const url = details.url;
  return url.includes("/_next/") || url.includes("/cdn-cgi/");
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}

function addRecord(record) {
  captured.unshift(record);
  if (captured.length > MAX_ITEMS) captured.length = MAX_ITEMS;

  // Bu kayıttan önce gelmiş (tamponlanmış) bir yanıt varsa bağla
  const recMethod = String(record.method || "GET").toUpperCase();
  const idx = pendingResponses.findIndex(
    (p) => p.url === record.url && p.method === recMethod
  );
  if (idx !== -1) {
    setResponse(record, pendingResponses[idx].data);
    pendingResponses.splice(idx, 1);
  }

  persist();
}

function persist() {
  writeChain = writeChain.then(() =>
    chrome.storage.local.set({ [STORAGE_KEY]: captured })
  );
  return writeChain;
}

function extractBody(requestBody) {
  if (!requestBody) return null;

  if (requestBody.raw && requestBody.raw.length) {
    try {
      const decoder = new TextDecoder("utf-8");
      let out = "";
      for (const chunk of requestBody.raw) {
        if (chunk.bytes) out += decoder.decode(chunk.bytes, { stream: true });
      }
      out += decoder.decode();
      return { type: "raw", value: out };
    } catch (e) {
      return null;
    }
  }

  if (requestBody.formData) {
    return { type: "formData", value: requestBody.formData };
  }

  return null;
}
