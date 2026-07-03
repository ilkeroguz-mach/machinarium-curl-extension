// macurl — sayfanın MAIN world'ünde çalışır: fetch ve XMLHttpRequest'i sarar,
// yanıt gövdesini yakalar ve window.postMessage ile bridge.js'e iletir.
// (chrome.* API'lerine buradan erişilemez; o yüzden bridge üzerinden geçiyoruz.)
(function () {
  const MAX_BODY = 256 * 1024; // 256KB üstü yanıt gövdesini kırp

  function post(payload) {
    try {
      window.postMessage({ __macurl: true, payload }, "*");
    } catch (e) {}
  }

  function clampText(text) {
    if (typeof text !== "string") return null;
    return text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text;
  }

  function absUrl(url) {
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return String(url);
    }
  }

  // --- fetch ---
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      let url = "";
      let method = "GET";
      try {
        const input = args[0];
        if (input && typeof input === "object" && "url" in input) {
          url = input.url;
          method = input.method || "GET";
        } else {
          url = String(input);
          method = (args[1] && args[1].method) || "GET";
        }
        url = absUrl(url);
      } catch (e) {}

      return origFetch.apply(this, args).then((res) => {
        try {
          const clone = res.clone();
          const ct = clone.headers.get("content-type") || "";
          clone
            .text()
            .then((text) => {
              post({
                url,
                method: String(method || "GET").toUpperCase(),
                status: res.status,
                contentType: ct,
                body: clampText(text),
              });
            })
            .catch(() => {});
        } catch (e) {}
        return res;
      });
    };
  }

  // --- XMLHttpRequest ---
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__macurl = { method: String(method || "GET").toUpperCase(), url: absUrl(url) };
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      const xhr = this;
      const info = xhr.__macurl;
      if (info) {
        xhr.addEventListener("load", function () {
          const ct = (function () {
            try {
              return xhr.getResponseHeader("content-type") || "";
            } catch (e) {
              return "";
            }
          })();

          const emit = (body) =>
            post({
              url: info.url,
              method: info.method,
              status: xhr.status,
              contentType: ct,
              body: clampText(body),
            });

          try {
            const rt = xhr.responseType;
            if (rt === "" || rt === "text") {
              emit(xhr.responseText);
            } else if (rt === "json") {
              let body = null;
              try {
                body = JSON.stringify(xhr.response);
              } catch (e) {}
              emit(body);
            } else if (rt === "arraybuffer" && xhr.response) {
              try {
                emit(new TextDecoder("utf-8").decode(new Uint8Array(xhr.response)));
              } catch (e) {
                emit(null);
              }
            } else if (rt === "blob" && xhr.response) {
              // Blob asenkron okunur; metinse yakala
              xhr.response
                .text()
                .then((t) => emit(t))
                .catch(() => emit(null));
            } else {
              emit(null);
            }
          } catch (e) {
            emit(null);
          }
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
