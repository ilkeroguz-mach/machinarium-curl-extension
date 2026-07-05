# macurl — Proje Bağlamı

## Ne bu?

Chrome eklentisi (Manifest V3, vanilla JS, build/framework/bağımlılık yok).
Gezilen tüm sitelerde (`<all_urls>`) sayfanın yaptığı fetch/XHR isteklerini yakalar,
popup'ta listeler, yanıt gövdesini (JSON) gösterir ve isteği tek tıkla **curl**
komutu olarak panoya kopyalar. Ana kullanım amacı: yakalanan curl'ü Apidog'a
(Import → cURL) yapıştırarak API'leri hızlıca dokümante/test etmek.

## Mimari (veri akışı)

İki kanal + birleştirme:

1. **İstek** — `background.js` (service worker), `chrome.webRequest` ile:
   - `onBeforeRequest` → body (`extractBody`: raw → TextDecoder, formData olduğu gibi)
   - `onBeforeSendHeaders` → header'lar; burada kayıt tamamlanıp `addRecord` çağrılır
   - `onCompleted` / `onErrorOccurred` → HTTP status / hata
2. **Yanıt** — `inject.js` sayfanın **MAIN world**'ünde `window.fetch` ve
   `XMLHttpRequest.prototype.open/send`'i monkey-patch'ler, yanıt metnini okur
   (256KB'da kırpar) → `window.postMessage` → `bridge.js` (**ISOLATED world**)
   → `chrome.runtime.sendMessage({type: "response"})` → background.
   (MAIN world'den chrome.* API'lerine erişilemediği için köprü şart.)
3. **Eşleştirme** — `background.js#attachResponse`: yanıt, `url + method` eşleşen ve
   `response == null` olan kayda bağlanır. Yanıt kayıttan önce gelirse
   `pendingResponses` tamponunda 30 sn (RESP_TTL) bekler; `addRecord` gelince bağlar.
4. **Saklama/UI** — Son 25 kayıt (`MAX_ITEMS`) `chrome.storage.local`'da
   (`macurl_requests` anahtarı). Yazımlar `writeChain` promise zinciriyle sıralanır.
   Popup `storage.onChanged` ile canlı güncellenir, yalnızca **aktif sekmenin
   (tabId)** isteklerini gösterir.

## Dosyalar

- `manifest.json` — izinler (`<all_urls>`), iki content script (bridge ISOLATED,
  inject MAIN, ikisi de `document_start`)
- `background.js` — yakalama, eşleştirme, storage; filtreler burada
- `inject.js` — fetch/XHR yanıt interceptor'ı (MAIN world)
- `bridge.js` — postMessage → runtime.sendMessage köprüsü (10 satır)
- `popup.html/js/css` — liste + arama + detay görünümü; `buildCurl` curl üretimi burada.
  Detay sayfası sekmeli: Yanıt / İstek Body / Header'lar (`activeTab`,
  `renderTabContent`); kopyalama butonu aktif sekmenin içeriğini kopyalar.

## Önemli kararlar / dikkat edilecekler

- **Tüm host'lar kapsanır** (`<all_urls>`): `manifest.json#host_permissions`,
  `manifest.json#content_scripts[*].matches` (iki blok) ve
  `background.js#URL_FILTER`. Host kısıtlaması geri gelecekse bu 3 yer birlikte
  güncellenmeli.
- Filtrelenen istekler: `OPTIONS` method, URL'de `/_next/` veya `/cdn-cgi/`
  (`background.js#shouldSkip`).
- curl üretimi (`popup.js#buildCurl`): `content-length` ve `host` atlanır,
  `:` ile başlayan HTTP/2 pseudo-header'lar atlanır, tek tırnak kaçışı
  `' → '\''`. Header'larda Authorization/Cookie bilinçli olarak tutulur —
  amaç isteğin birebir aynısını üretmek.
- Yanıt eşleştirmesi url+method bazlı ve sezgisel (heuristic); aynı url'e ardışık
  istekte yanlış eşleşme teorik olarak mümkün, kabul edilmiş bir trade-off.
- UI dili **Türkçe**; kod yorumları da Türkçe. Bu tarza uy.
- Build adımı yok: dosyayı değiştir → `chrome://extensions`'da eklentiyi
  yeniden yükle (⟳) → sayfayı yenile (inject.js `document_start`'ta yüklenir).
