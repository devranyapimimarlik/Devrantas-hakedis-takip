# Devrantaş — Windows / Android / iOS dağıtımı

Tüm derlemeler `.github/workflows/build-apps.yml` ile GitHub Actions üzerinde çalışır. Adım adım rehber uygulama içinde **Menü → Uygulamayı indir** sayfasındadır.

## Çıktılar
| Platform | Dosya | Nereden |
|---|---|---|
| Windows | `Devrantas-Setup.exe` (NSIS, x64) | GitHub Releases → `latest` |
| Android | `Devrantas.apk` (release, imzalı) | GitHub Releases → `latest` |
| iOS | TestFlight | App Store Connect → TestFlight (xcodebuild `destination: upload`) |

## Gerekli GitHub Secrets
| Secret | Açıklama |
|---|---|
| `APPLE_TEAM_ID` | developer.apple.com → Membership → Team ID |
| `APP_STORE_CONNECT_KEY_ID` | ASC API anahtarı Key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | ASC API Issuer ID |
| `APP_STORE_CONNECT_PRIVATE_KEY_BASE64` | `base64 -i AuthKey_XXXX.p8` çıktısı (anahtar **Admin** rolünde olmalı — cloud signing için) |
| `ANDROID_KEYSTORE_BASE64` (ops.) | Kalıcı APK imza anahtarı; yoksa ilk derleme üretir ve `android-keystore` artifact'i olarak verir |
| `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` (ops.) | Varsayılan: `devrantas2026` / `devrantas` |
| `GOOGLE_SERVICES_JSON` (ops.) | Firebase `google-services.json` içeriği (Android push) |

Apple secret'ları eksikse iOS işi uyarı verip atlanır; Windows ve Android yine derlenir.

## Yerel derleme
- Windows: `cd desktop && npm install && npm run dist:win` (Windows makinede)
- Android: `cd mobile && yarn && npx cap sync android && cd android && ./gradlew assembleRelease`
- iOS: `cd mobile && yarn && npx cap sync ios && cd ios/App && pod install && open App.xcworkspace` → Product → Archive → Distribute → TestFlight

## Uygulama içi bağlantılar
Yönetici, **Uygulamayı indir** sayfasında GitHub depo adını (`kullanici/depo`) ve TestFlight Public Link'i girer; indir düğmeleri `https://github.com/<repo>/releases/latest/download/...` adreslerine yönlenir.
