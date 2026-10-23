# Devrantaş — App Store & Google Play Uygulaması

Bu klasör, web uygulamasını **native iOS ve Android uygulaması** olarak paketleyen Capacitor projesidir.
Uygulama açılınca `capacitor.config.json` içindeki `server.url` adresini tam ekran olarak yükler; giriş, sesli gider,
çevrimdışı kayıt ve kamera özellikleri aynen çalışır. Bildirimler native (APNs / Firebase) üzerinden gelir.

> Mac + Xcode (iOS için) ve Android Studio (Android için) gerekir. Apple Developer ve Google Play Console hesabınız olmalı.

---

## 0. Hazırlık (tek sefer)

```bash
cd mobile
npm install            # veya yarn
npx cap sync           # eklentileri iOS/Android projelerine işler
```

**Adres:** `capacitor.config.json` → `server.url` = `https://hakedis-takip-3.emergent.host` (yayınlanmış kalıcı adres). Değiştirirseniz `npx cap sync` çalıştırın.

**Logo değişikliği:** `assets/icon-only.png`, `assets/icon-foreground.png`, `assets/splash.png` dosyalarını güncelleyip `npm run assets` çalıştırın.

---

## 1. iOS — App Store

### 1.1 Xcode'da aç
```bash
npx cap open ios
```
- Sol panelde **App** projesini seçin → **Signing & Capabilities**.
- **Team**: Apple Developer hesabınızı seçin. Bundle Identifier: `com.devrantas.yapi` (App Store Connect'te aynı ID ile uygulama oluşturun).
- **+ Capability** → **Push Notifications** ekleyin (App.entitlements zaten hazır).
- **+ Capability** → **Background Modes** → *Remote notifications* işaretli olsun.

### 1.2 Bildirim anahtarı (APNs)
1. https://developer.apple.com/account/resources/authkeys → **+** → *Apple Push Notifications service (APNs)* işaretle → indir (`AuthKey_XXXXXXXXXX.p8`). **Bu dosya yalnızca bir kez indirilir, saklayın.**
2. Key ID (10 karakter) ve Team ID (Membership sayfasında) değerlerini not edin.
3. Emergent sohbetinde "Apple push anahtarlarını ekle" deyin; güvenli kart üzerinden şu değerler istenecek:
   - `APNS_KEY_ID`, `APNS_TEAM_ID` (Team ID ≠ Key ID; Membership details sayfasında)
   - `APNS_BUNDLE_ID` → `com.devrantas.yapi`
   - `APNS_USE_SANDBOX` → TestFlight/Xcode denemelerinde `true`, App Store yayınında `false`
   - .p8 dosyasını metin olarak kopyalamak yerine uygulama içinden yükleyin: **Diğer → Telefona kur → "iPhone Bildirim Anahtarı" → .p8 dosyasını yükle** (yönetici).

### 1.3 Test ve yayın
- iPhone'u bağlayın → Xcode'da cihazı seçin → **▶ Run**. Uygulama açılır, bildirim izni sorar.
- Uygulama içinde **Diğer → Telefona kur → Test Bildirimi** ile deneyin.
- Yayın: **Product → Archive** → **Distribute App** → App Store Connect. App Store Connect'te ekran görüntüleri, açıklama ve gizlilik bilgilerini doldurup incelemeye gönderin.
- **Not (Apple 4.2 kuralı):** Apple yalnızca web sitesini saran uygulamaları reddedebilir. Bu uygulamada native bildirim, kamera/mikrofon ve çevrimdışı kayıt bulunduğunu inceleme notunda belirtin; gerekirse "şirket içi kullanım" olduğunu yazın.

---

## 2. Android — Google Play

### 2.1 Firebase (bildirim için)
1. https://console.firebase.google.com → proje oluşturun (ör. *devrantas*).
2. **Android uygulaması ekle** → paket adı `com.devrantas.yapi` → `google-services.json` indirin → `mobile/android/app/google-services.json` konumuna koyun.
3. **Proje Ayarları → Servis hesapları → Yeni özel anahtar oluştur** → JSON indirin.
4. Emergent sohbetinde "Firebase anahtarını ekle" deyin; güvenli kartta `FIREBASE_SERVICE_ACCOUNT_JSON` olarak bu JSON'un **tamamını** yapıştırın.

### 2.2 Android Studio'da aç
```bash
npx cap sync android
npx cap open android
```
- Gradle senkronu bitince telefonu bağlayıp **▶ Run**.
- Yayın: **Build → Generate Signed Bundle / APK → Android App Bundle** → yeni keystore oluşturun (**keystore dosyasını ve şifreyi mutlaka yedekleyin**) → `.aab` dosyasını Google Play Console'a yükleyin.

---

## 3. Güncelleme nasıl olur?
Web tarafındaki her değişiklik **mağazaya yeniden gönderim gerektirmez** — uygulama her açılışta güncel web sürümünü yükler.
Yalnızca logo, adres (`server.url`) veya native eklenti değişince yeni sürüm yüklemeniz gerekir.

## 4. Sık sorunlar
- *Beyaz ekran / açılmıyor:* `server.url` erişilebilir mi? Önizleme adresi değiştiyse güncelleyip `npx cap sync` yapın.
- *iOS'ta bildirim gelmiyor:* Xcode'da Push Notifications capability eklendi mi, `APNS_USE_SANDBOX` değeri derleme tipine (Debug/TestFlight=true, App Store=false) uygun mu?
- *Android'de bildirim gelmiyor:* `google-services.json` doğru klasörde mi, `FIREBASE_SERVICE_ACCOUNT_JSON` eklendi mi?
- *Mikrofon/kamera çalışmıyor:* İlk kullanımda izin isteği çıkar; reddedildiyse telefon Ayarlar → Devrantaş'tan açın.
