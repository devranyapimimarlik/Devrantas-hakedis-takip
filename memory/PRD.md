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

## Backlog
- P1: Çek "ciro" ile taşerona ödeme bağlama; hakediş ödemesi butonundan otomatik "Taşeron Hakediş Ödemesi" formu açma.
- P1: Raporlar için PDF/Excel export (şu an tarayıcı yazdır).
- P2: Görünüm ayarları (logo/renk), bildirim e-postası/SMS, çoklu para birimi.
- P2: Recharts ilk mount boyut uyarısı (kozmetik).
