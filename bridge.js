// macurl — ISOLATED world köprüsü: MAIN world'deki inject.js'ten gelen
// postMessage'leri alıp arka plan service worker'a iletir.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__macurl !== true || !data.payload) return;
  try {
    chrome.runtime.sendMessage({ type: "response", data: data.payload });
  } catch (e) {}
});
