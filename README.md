# macurl

Gezdiğin her sitede sayfanın yaptığı tüm **fetch/XHR** isteklerini yakalayan,
popup'ta listeleyen, isteğin dönen **yanıtını (JSON)** gösteren ve tek tıkla
**curl** ya da **JSON** olarak panoya kopyalayan bir Chrome eklentisi (Manifest V3).
Kopyaladığın curl'ü doğrudan Apidog'a (**Import → cURL**) yapıştırabilirsin.

## Kurulum

1. Chrome'da `chrome://extensions` adresine git.
2. Sağ üstten **Developer mode**'u aç.
3. **Load unpacked** → bu `macurl` klasörünü seç.

## Kullanım

1. Herhangi bir sitede gezin.
2. macurl ikonuna tıkla → o sekmede yakalanan istekler listelenir (en yeni en üstte).
   Başlıkta o anki domain yazar. Yanıtı yakalanan istekler "yanıt ›" ile işaretlenir.
3. Üstteki arama kutusuyla path/method/url'e göre filtrele.
4. Listeden bir isteğe tıkla → detay sayfası açılır. **Yanıt | İstek Body |
   Header'lar** sekmeleriyle dönen JSON'u, gönderilen body'yi ve istek
   header'larını görürsün (JSON içerik renklendirilmiş gösterilir).
5. Soldaki kopyalama butonu aktif sekmenin içeriğini (**Copy JSON / Copy Body /
   Copy Headers**), **Copy curl** isteğin curl'ünü panoya kopyalar. **← Geri**
   ile listeye dönersin.

## Nasıl çalışır

Eklenti iki ayrı kanaldan veri toplar ve bunları arka planda birleştirir:

```
┌─ Sayfa (MAIN world) ─────────┐
│ inject.js                    │  fetch/XHR'ı sarar, YANIT gövdesini yakalar
│   └─ window.postMessage ──►  │
│ bridge.js (ISOLATED world)   │  mesajı alır, service worker'a iletir
└──────────────┬───────────────┘
               │ chrome.runtime.sendMessage
┌─ Service worker ─────────────┐
│ background.js                │  webRequest ile İSTEK'i (url, method,
│                              │  header'lar, body, status) yakalar,
│                              │  inject'ten gelen yanıtı isteğe eşler,
│                              │  chrome.storage.local'a yazar
└──────────────┬───────────────┘
               │ storage.onChanged
┌─ Popup ──────────────────────┐
│ popup.html/js/css            │  aktif sekmenin isteklerini listeler,
│                              │  detay gösterir, curl/JSON kopyalar
└──────────────────────────────┘
```

- **İstek tarafı** (`background.js`): `chrome.webRequest` dinleyicileriyle
  `onBeforeRequest`'te body, `onBeforeSendHeaders`'ta header'lar,
  `onCompleted`/`onErrorOccurred`'da status yakalanır. Header'lar arasında
  Authorization ve Cookie de vardır; üretilen curl isteğin birebir aynısıdır.
- **Yanıt tarafı** (`inject.js`): `chrome.webRequest` yanıt gövdesine erişemediği
  için sayfanın MAIN world'üne enjekte edilen bu script `window.fetch` ve
  `XMLHttpRequest`'i sarar, yanıt metnini okur. MAIN world'den `chrome.*`
  API'lerine erişilemediği için mesaj `bridge.js` (ISOLATED world) üzerinden
  service worker'a taşınır.
- **Eşleştirme**: Yanıt, `url + method`'u eşleşen ve henüz yanıtı olmayan en yeni
  istek kaydına bağlanır. Yanıt istekten önce gelirse (yarış durumu) 30 sn'lik
  bir tamponda bekletilir, kayıt oluşunca bağlanır.
- **Saklama**: Son **25** istek `chrome.storage.local`'da tutulur (service worker
  uyusa bile kaybolmaz); yeni istek geldikçe en eskiler düşer. Popup,
  `storage.onChanged` ile canlı güncellenir.

## Dosyalar

| Dosya | Görev |
|---|---|
| `manifest.json` | MV3 manifest; izinler, content script tanımları |
| `background.js` | Service worker; istek yakalama, yanıt eşleştirme, storage |
| `inject.js` | MAIN world interceptor; fetch/XHR yanıt gövdesini yakalar |
| `bridge.js` | ISOLATED world köprüsü; postMessage → runtime.sendMessage |
| `popup.html` / `popup.js` / `popup.css` | Popup arayüzü; liste, arama, detay, curl/JSON kopyalama |

## Davranış ve sınırlar

- **Tüm sitelerde** çalışır (`<all_urls>`); popup **yalnızca aktif sekmenin**
  isteklerini gösterir.
- Sadece **fetch/XHR** istekleri yakalanır (statik asset gürültüsü yoktur).
- `OPTIONS` (CORS preflight), `/_next/` (Next.js asset/data) ve `/cdn-cgi/`
  (Cloudflare) istekleri gizlenir.
- Yanıt gövdesi yalnızca metin/JSON olarak yakalanır; **256KB** üstü kırpılır.
  İkili (binary) içerik veya interceptor'dan kaçan istekler için yanıt gösterilmez.
- `content-length` ve `host` header'ları curl tarafından otomatik yönetildiği için
  çıktıya eklenmez; HTTP/2 pseudo-header'ları (`:authority` vb.) atlanır.
