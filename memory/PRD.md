# Devrantaş Yapı Mimarlık — Şantiye Finans & ERP

## Orijinal Problem
Şantiye bazlı gelir/gider ve kâr/zarar takibi, müşteri & taşeron cari hesapları, hakediş ve teklif oluşturma (PDF/Excel), yönetici onaylı giderler, dekont/çek fotoğrafı yükleme, otomatik %6 genel gider kesintisi, ileri tarihli çek/kira/kart/kredi için 7-3-0 gün hatırlatıcı, GPT-6 Sol AI asistan. Krem/altın tema, Türkçe, TRY. Kullanıcı dili: **Türkçe**.

### Kullanıcı ek istekleri (21 Eki 2026)
- Referans tasarım (Lovable ekran görüntüleri): pill butonlar, altın gradyan, mobil alt sekme çubuğu (Özet/Şantiye/Müşteri/Taşeron/Gelir-Gider/Hakediş/Raporlar/Diğer), "Diğer" menü sheet'i, belge görünümlü teklif formu, taşeron kartları (Cari ekstre / + Şantiye ata / + Hakediş), firma altbilgisi.
- Logo (altın D) her yerde: header, login, belgeler, PDF, Excel. Dosya: `/app/frontend/public/logo.png`, `/app/backend/fonts/logo.png`.
- İki kasa: **Devrantaş Nakit** ve **Devrantaş Çek**; tahsilat/ödemede kasa seçimi ZORUNLU. Karma ödeme (%50 nakit %50 çek manuel) → 2 işlem.
- Tahsilatta: hangi şantiye, hangi müşteri, kasa. Ödemede: hangi şantiye, taşeron / malzeme / nakliye / tedarikçi / diğer + açıklama.
- Taşeron hakedişi onaylanınca şantiye gideri sayılır; taşerona yapılan ödeme ("Taşeron Hakediş Ödemesi"/"Taşeron Avansı") şantiye giderine çift sayılmaz, sadece cariye ve kasaya işlenir. Avans: hakediş yoksa negatif bakiye (avans alacağı).
- Sözleşme modülü: Excel + PDF, logo & firma bilgisi, birim fiyat cetveli, şartlar, teknik şartname. Hakedişte de Excel + şartlar + teknik şartname.

## Mimari
- Backend: FastAPI (`/app/backend`), MongoDB (motor), uuid id'ler, `{_id:0}` projeksiyon.
  - `core.py`: db, JWT/bcrypt auth, object storage, `site_summary`, `account_balance`, `SUB_CATEGORIES`.
  - `routers/`: auth, accounts (cari + ekstre + şantiye atama), sites, transactions (kasa, onay, çek otomatik), progress (hakediş + excel), checks (çek, ödeme takvimi, reminders), proposals (+excel), contracts (+excel), files (object storage), ai (GPT-6 Sol SSE), pdf (reportlab, DejaVu font, logo), dashboard, reports.
  - `excel.py`: logo/firma başlıklı ortak Excel belge üretici (openpyxl).
- Frontend: React + Tailwind + shadcn, `src/pages/*`, `components/layout/AppLayout.jsx` (sidebar + mobil alt nav + Diğer sheet), `components/shared/{Bits,Inputs,FileUpload}.jsx`, `lib/{api,format}.js`, `context/AuthContext.jsx`. Token localStorage `dvt_token` (Bearer).
- Entegrasyonlar: Emergent LLM key (gpt-6-sol), Emergent Object Storage, custom JWT.

## Önemli API'ler
- Auth: /api/auth/login, register, me, change-password, users (admin), register-sub (admin)
- /api/sites, /api/accounts (+/statement, /assign-site), /api/transactions (+/approve, /reject, /categories, /kasa)
- /api/progress-payments (+/status, /excel), /api/proposals (+/excel), /api/contracts (+/excel)
- /api/checks, /api/payments, /api/reminders, /api/files/upload, /api/files/{id}
- /api/pdf/{progress-payment|proposal|statement|contract}/{id}
- /api/ai/chat (SSE), site-analysis/{id}, proposal-text, cost-estimate, progress-summary/{id}, financial-analysis
- /api/dashboard, /api/reports?start&end&site_id&account_id

## Tamamlananlar (21 Eki 2026)
- Tüm MVP modülleri + referans tasarım uyarlaması + kasa/karma ödeme/avans mantığı + sözleşme modülü + Excel/PDF çıktıları.
- Test: testing_agent iteration_1 → backend 36/36 (PDF filename latin-1 hatası düzeltildi), frontend smoke OK.
- Tur 2: Hakediş ödeme kısayolu (POST /progress-payments/{id}/pay, nakit/çek bölüşüm, otomatik "odendi"), rapor Excel/PDF export (GET /reports/export?tab&format), günlük özet + WhatsApp (routers/alerts.py; cron `.emergent/crons.yml` 09:00 Europe/Istanbul → POST /api/cron/daily-reminders, Bearer WEBHOOK_CRON_SECRET; Twilio opsiyonel: TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM/SMS_FROM, MANAGER_PHONE=+905334825702; zarar riski, müşteri riski >%33, şüpheli kayıt özeti), şantiye fotoğraf günlüğü (/sites/{id}/photos → hakediş PDF'ine eklenir), AI iş kataloğu (ai.py WORK_CATALOG, GET /ai/work-catalog; teklif/maliyet AI sadece katalogdan seçer). Test iteration_2 → 34/34 backend.
- Code review düzeltmeleri: public /auth/register kaldırıldı (kullanıcılar sadece yönetici tarafından /auth/register-sub ile eklenir), seed_admin artık mevcut şifreyi ezmiyor, ?auth= query token fallback kaldırıldı, müşteri hakedişi tam tahsilatta otomatik "odendi", cron idempotency unique index + claim kaydı. Backend pytest 70/70.
- Tur 3 (22 Eki 2026): Firma görünümü (routers/settings.py GET/PUT /settings, /settings/logo, /settings/manifest.json; SettingsContext canlı tema CSS değişkenleri; PDF/Excel firma bilgisi dinamik), çek ciro (POST /checks/{id}/endorse → hakedişe bağlı taşeron ödemesi), müşteri portalı (POST /accounts/{id}/portal-token, GET /portal/{token} salt-okunur), TEST_ veri temizliği endpoint'i. Test iteration_3 → backend 18/18, frontend %100.
- PWA / iOS+Android kurulum: public/sw.js (network-first, offline fallback), index.js'te SW kaydı, index.html apple/mobile meta + apple-touch-icon 180, /settings/logo?size=180|192|512 kare opak ikon üretimi, manifest id/scope/shortcuts; /telefona-kur sayfası (iOS Safari adımları + Android beforeinstallprompt "Ana Ekrana Kur" butonu), mobilde kapatılabilir kurulum banner'ı (InstallBanner). Ekran görüntüsü ile doğrulandı (SW registered, manifest linked).
- Çevrimdışı kayıt: lib/offline.js (IndexedDB kuyruk: transaction/photo + Blob dosya), components/shared/OfflineQueue.jsx (OfflineBar + liste + "Şimdi gönder"), FileUpload `localFile/onLocalFile`, TransactionForm ve SitePhotos çevrimdışı/ağ hatasında kuyruğa yazar; online olunca otomatik flush. QueryClient networkMode "always" (aksi halde react-query mutation'ı pause ediyor). Playwright set_offline ile E2E doğrulandı.
- Anlık bildirim (Web Push): routers/push.py (VAPID anahtarı db.settings id="vapid" içinde otomatik üretilir; GET /push/vapid-public-key, POST /push/subscribe|unsubscribe|test, GET /push/status), sw.js push/notificationclick; tetikleyiciler: yeni gider → yöneticilere "Onay bekleyen gider", onay/ret → kaydı girene, günlük cron → yöneticilere özet. components/shared/PushToggle.jsx (/telefona-kur sayfasında). Backend akışı sahte abonelikle doğrulandı (şifreleme+VAPID OK, 410 → abonelik temizlendi); gerçek cihaz teslimatı kullanıcı telefonunda test edilmeli (iOS: yalnızca ana ekrana kurulu halde).
- Sesli gider girişi (22 Eki): routers/voice.py POST /voice/expense (audio multipart → OpenAI whisper-1 STT (Emergent key, language=tr) → GPT ile JSON çıkarım {type, category, amount, site_id, account_id, kasa, description}; LLM hata verirse regex/anahtar kelime fallback; `text` form alanıyla da test edilebilir). components/shared/VoiceExpense.jsx (MediaRecorder, max 20 sn, mikrofon butonu) TransactionForm'un üstünde; sonuç formu otomatik doldurur. TTS ile üretilen gerçek mp3 → "500 ₺ Malzeme Çekmeköy Çimento alımı" doğrulandı. Mobil dialog taşması düzeltildi (Inputs base min-w-0, Field min-w-0, DialogContent w-[calc(100vw-1rem)]).

## Backlog
- P1: Twilio anahtarları (TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM/SMS_FROM) — kullanıcı 22 Eki'de secrets kartını atladı; tekrar istenince secrets_request ile al. Gerçek WhatsApp/SMS gönderimi henüz doğrulanmadı.
- P2: Push bildirimleri (Web Push) ile telefona anlık uyarı; çoklu para birimi.
- P2: Recharts ilk mount boyut uyarısı (kozmetik); dashboard/daily-summary N+1 aggregation performansı (büyük veri).
