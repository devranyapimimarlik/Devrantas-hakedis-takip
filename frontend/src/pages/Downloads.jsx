import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Monitor, Smartphone, Apple, Download, ExternalLink, Github, KeyRound, ListChecks, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader, Field } from "@/components/shared/Bits";
import { NInput, GoldButton } from "@/components/shared/Inputs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { LIVE_URL } from "@/components/shared/MigrationGuide";

const SECRETS = [
  ["APPLE_TEAM_ID", "developer.apple.com → Membership → Team ID (10 karakter)"],
  ["APP_STORE_CONNECT_KEY_ID", "App Store Connect API anahtarının Key ID'si"],
  ["APP_STORE_CONNECT_ISSUER_ID", "Anahtarlar sayfasının üstündeki Issuer ID"],
  ["APP_STORE_CONNECT_PRIVATE_KEY_BASE64", "İndirdiğiniz AuthKey_XXXX.p8 dosyasının base64 hali (aşağıda nasıl üretileceği yazıyor)"],
  ["ANDROID_KEYSTORE_BASE64 (opsiyonel)", "İlk derlemede üretilen 'android-keystore' artifact'inin base64'ü; şifre ANDROID_KEYSTORE_PASSWORD=devrantas2026"],
  ["GOOGLE_SERVICES_JSON (opsiyonel)", "Firebase → Proje ayarları → google-services.json içeriği (Android bildirimleri için)"],
];

const Step = ({ n, title, children }) => (
  <li className="flex gap-3 min-w-0">
    <span className="w-6 h-6 rounded-full bg-gold text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
    <div className="text-sm min-w-0 flex-1 [&_code]:break-all [&_code]:bg-stone-100 [&_code]:px-1 [&_code]:rounded"><p className="font-semibold">{title}</p><div className="text-xs text-charcoal-light space-y-1 mt-0.5 break-words">{children}</div></div>
  </li>
);

function PlatformCard({ icon: Icon, title, desc, href, cta, steps, testId, disabledNote }) {
  return (
    <div className="gold-card p-5 flex flex-col" data-testid={testId}>
      <div className="flex items-center gap-3 mb-2"><Icon className="w-7 h-7 text-gold" /><p className="font-serif text-xl font-bold">{title}</p></div>
      <p className="text-sm text-charcoal-light mb-4">{desc}</p>
      {href
        ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 bg-gold hover:bg-gold-dark text-white rounded-full px-5 py-2.5 text-sm font-medium transition-colors" data-testid={`${testId}-download`}><Download className="w-4 h-4" />{cta}</a>
        : <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2" data-testid={`${testId}-pending`}>{disabledNote}</p>}
      <ol className="mt-4 space-y-2">{steps.map((s, i) => <li key={i} className="text-xs text-charcoal-light flex gap-2"><span className="font-mono text-gold">{i + 1}.</span>{s}</li>)}</ol>
    </div>
  );
}

function DistributionForm({ settings, refresh }) {
  const [f, setF] = useState({ github_repo: "", testflight_url: "" });
  useEffect(() => { if (settings) setF({ github_repo: settings.github_repo || "", testflight_url: settings.testflight_url || "" }); }, [settings]);
  const save = useMutation({ mutationFn: () => api.put("/settings/distribution", f), onSuccess: async () => { await refresh(); toast.success("İndirme bağlantıları güncellendi"); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="soft-card p-5 grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end" data-testid="distribution-form">
      <Field label="GitHub deposu (kullanici/depo)" hint="Save to GitHub sonrası depo adı; indirme linkleri buradan üretilir"><NInput value={f.github_repo} onChange={(e) => setF({ ...f, github_repo: e.target.value })} placeholder="devrantas/hakedis-takip" data-testid="distribution-repo-input" /></Field>
      <Field label="TestFlight davet bağlantısı" hint="App Store Connect → TestFlight → Public Link"><NInput value={f.testflight_url} onChange={(e) => setF({ ...f, testflight_url: e.target.value })} placeholder="https://testflight.apple.com/join/..." data-testid="distribution-testflight-input" /></Field>
      <GoldButton type="submit" disabled={save.isPending} data-testid="distribution-save-button">Kaydet</GoldButton>
    </form>
  );
}

export default function Downloads() {
  const { settings, refresh } = useSettings();
  const { isManager } = useAuth();
  const repo = settings?.github_repo;
  const rel = repo ? `https://github.com/${repo}/releases/latest/download` : null;
  const actions = repo ? `https://github.com/${repo}/actions` : "https://github.com";
  return (
    <div data-testid="downloads-page">
      <PageHeader title="Uygulamayı İndir" subtitle="Windows bilgisayar, Android telefon ve iPhone (TestFlight) için kurulum paketleri. Hepsi aynı canlı sisteme bağlanır; kayıtlar ortaktır." />
      {isManager && <div className="mb-6"><DistributionForm settings={settings} refresh={refresh} /></div>}
      <div className="grid md:grid-cols-3 gap-4">
        <PlatformCard icon={Monitor} title="Windows" desc="Başlat menüsüne kurulan masaüstü uygulaması (.exe). Bildirim ve yazdırma destekli." href={rel && `${rel}/Devrantas-Setup.exe`} cta="Devrantas-Setup.exe indir" testId="download-windows"
          disabledNote="İndirme bağlantısı için önce kodu GitHub'a kaydedip yukarıya depo adını yazın; ilk derleme ~10 dk sürer."
          steps={["İndirilen dosyaya çift tıklayın.", "SmartScreen uyarısı çıkarsa 'Ek bilgi' → 'Yine de çalıştır' (uygulama imzasız olduğu için bir kez görünür).", "Kurulum klasörünü onaylayın; masaüstünde Devrantaş simgesi oluşur.", "Açılınca kullanıcı adı/şifrenizle girin."]} />
        <PlatformCard icon={Smartphone} title="Android" desc="Mağazasız doğrudan kurulum (APK). Güncellemede aynı dosyayı tekrar indirip kurun." href={rel && `${rel}/Devrantas.apk`} cta="Devrantas.apk indir" testId="download-android"
          disabledNote="APK bağlantısı GitHub deposu kaydedildikten ve ilk derleme bittikten sonra aktif olur."
          steps={["Telefonda bu sayfayı açıp APK'yı indirin.", "Bildirimden dosyaya dokunun; 'Bu kaynaktan izin ver' deyin (Ayarlar → Bilinmeyen uygulamaları yükle).", "'Yükle' → 'Aç'. Simge ana ekrana gelir.", "Bildirimlere izin verin."]} />
        <PlatformCard icon={Apple} title="iPhone / iPad" desc="Apple'ın test dağıtım uygulaması TestFlight ile kurulur; App Store incelemesi beklenmez." href={settings?.testflight_url || null} cta="TestFlight'ta aç" testId="download-ios"
          disabledNote="TestFlight bağlantısı için aşağıdaki Apple adımlarını tamamlayın; ilk yükleme sonrası App Store Connect'te 'Public Link' oluşturup yukarıya yapıştırın."
          steps={["App Store'dan ücretsiz TestFlight uygulamasını indirin.", "Davet bağlantısına dokunun → 'Kabul et' → 'Yükle'.", "Devrantaş simgesi ana ekranda; bildirim iznini onaylayın.", "Yeni sürümler TestFlight'tan otomatik bildirilir (90 gün geçerli, her yeni derlemede yenilenir)."]} />
      </div>

      <div className="gold-card p-5 sm:p-6 mt-6" data-testid="release-setup-guide">
        <div className="flex items-center gap-2 mb-1"><ListChecks className="w-5 h-5 text-gold" /><p className="font-serif text-xl font-bold">Kurulum rehberi (bir kez yapılır)</p></div>
        <p className="text-sm text-charcoal-light mb-4">Derlemeler GitHub Actions üzerinde otomatik çalışır: her kayıtta Windows .exe ve Android APK üretilir, iPhone sürümü TestFlight'a yüklenir.</p>
        <Accordion type="multiple" defaultValue={["github"]} className="space-y-2">
          <AccordionItem value="github" className="border border-gold-border rounded-xl px-4 bg-white">
            <AccordionTrigger className="text-sm font-semibold hover:no-underline" data-testid="guide-github"><span className="flex items-center gap-2"><Github className="w-4 h-4 text-gold" />1 · Kodu GitHub'a kaydet ve derlemeyi başlat</span></AccordionTrigger>
            <AccordionContent><ol className="space-y-3 pt-1">
              <Step n="1" title="Sohbet kutusundaki 'Save to GitHub' düğmesine basın"><p>Depo adını (ör. <code>devrantas/hakedis-takip</code>) not edin ve yukarıdaki alana yazıp kaydedin.</p></Step>
              <Step n="2" title="GitHub → depo → Actions sekmesi"><p>'I understand my workflows, go ahead and enable them' deyin. 'Uygulama Derlemeleri' iş akışı → 'Run workflow'.</p></Step>
              <Step n="3" title="~10 dk sonra Releases → 'latest'"><p>Devrantas-Setup.exe ve Devrantas.apk burada; bu sayfadaki indir düğmeleri otomatik bu dosyalara gider.</p><p className="flex items-center gap-1"><ExternalLink className="w-3 h-3" /><a className="underline" href={actions} target="_blank" rel="noreferrer">Actions sayfasını aç</a></p></Step>
              <Step n="4" title="Android anahtarını kalıcı yapın (önerilir)"><p>İlk derlemenin 'android-keystore' artifact'ini indirin; <code>base64 -w0 release.keystore</code> çıktısını <code>ANDROID_KEYSTORE_BASE64</code>, şifre olarak <code>devrantas2026</code>'yı <code>ANDROID_KEYSTORE_PASSWORD</code> secret'ına ekleyin. Böylece güncellemeler eski kurulumun üstüne kurulur.</p></Step>
            </ol></AccordionContent>
          </AccordionItem>
          <AccordionItem value="apple" className="border border-gold-border rounded-xl px-4 bg-white">
            <AccordionTrigger className="text-sm font-semibold hover:no-underline" data-testid="guide-apple"><span className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-gold" />2 · Apple: App Store Connect API anahtarı (TestFlight için)</span></AccordionTrigger>
            <AccordionContent><ol className="space-y-3 pt-1">
              <Step n="1" title="appstoreconnect.apple.com → Kullanıcılar ve Erişim → Entegrasyonlar → App Store Connect API"><p>Üstteki <b>Issuer ID</b>'yi kopyalayın (uzun UUID). Bu <code>APP_STORE_CONNECT_ISSUER_ID</code> olur.</p></Step>
              <Step n="2" title="'+' ile anahtar oluştur"><p>Ad: <code>GitHub TestFlight</code> · Erişim: <b>Admin</b> (sertifikaları otomatik oluşturması için Admin gerekir) · 'Oluştur'.</p><p><b>Key ID</b> sütunundaki değer → <code>APP_STORE_CONNECT_KEY_ID</code>.</p></Step>
              <Step n="3" title="'API Anahtarını İndir' (tek seferlik!)"><p><code>AuthKey_XXXXXXXX.p8</code> iner. Mac/Linux: <code>base64 -i AuthKey_XXXX.p8 | pbcopy</code> · Windows PowerShell: <code>[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8")) | Set-Clipboard</code>. Çıktı → <code>APP_STORE_CONNECT_PRIVATE_KEY_BASE64</code>.</p></Step>
              <Step n="4" title="developer.apple.com → Account → Membership details"><p><b>Team ID</b> (10 karakter, ör. <code>A1B2C3D4E5</code>) → <code>APPLE_TEAM_ID</code>.</p></Step>
              <Step n="5" title="App Store Connect → Uygulamalarım → '+' Yeni Uygulama"><p>Platform iOS · Ad <b>Devrantaş</b> · Birincil dil Türkçe · Bundle ID <b>com.devrantas.yapi</b> (listede yoksa developer.apple.com → Identifiers'da 'Push Notifications' işaretli olarak ekleyin) · SKU <code>devrantas-yapi</code>.</p></Step>
              <Step n="6" title="Secret'ları GitHub'a girin"><p>GitHub → depo → Settings → Secrets and variables → Actions → 'New repository secret'. Aşağıdaki adlarla tek tek ekleyin.</p>
                <ul className="mt-1 space-y-1">{SECRETS.map(([k, v]) => <li key={k}><code className="bg-stone-100 px-1 rounded">{k}</code> — {v}</li>)}</ul></Step>
              <Step n="7" title="Actions → 'Run workflow' → TestFlight"><p>Derleme bitince App Store Connect → TestFlight sekmesinde 'İşleniyor' (5-15 dk). İlk kez 'Dışa aktarma uyumluluk bilgisi' sorarsa 'Hayır' deyin.</p><p>Dahili test için 'App Store Connect Users' grubuna kendinizi ekleyin; dış test için 'Harici Test' grubu oluşturup <b>Public Link</b>'i etkinleştirin ve yukarıdaki alana yapıştırın.</p></Step>
            </ol></AccordionContent>
          </AccordionItem>
          <AccordionItem value="notes" className="border border-gold-border rounded-xl px-4 bg-white">
            <AccordionTrigger className="text-sm font-semibold hover:no-underline" data-testid="guide-notes"><span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-gold" />3 · Bilinmesi gerekenler</span></AccordionTrigger>
            <AccordionContent><ul className="text-xs text-charcoal-light space-y-2 pt-1 list-disc pl-4">
              <li>Üç uygulama da <code>{LIVE_URL}</code> adresine bağlanır; sunucu güncellemeleri otomatik yansır, yeniden kurulum gerekmez. Yalnızca kabuk (simge/menü) değişirse yeni derleme gerekir.</li>
              <li>Windows .exe kod imzasızdır; SmartScreen ilk açılışta uyarır. İmza için EV sertifikası (~300 $/yıl) gerekir — istenirse eklenir.</li>
              <li>TestFlight derlemeleri 90 gün geçerlidir; her yeni derleme süreyi yeniler. Kalıcı dağıtım için App Store incelemesine gönderilebilir (mobile/APP_STORE_LISTING.md hazır).</li>
              <li>Apple bildirimleri TestFlight'ta <b>production</b> APNs ortamını kullanır; Telefona Kur sayfasındaki APNs ayarında sandbox kapalı olmalı.</li>
              <li>GitHub Actions ücretsiz kotası: özel depolarda aylık 2000 dk (macOS dakikaları 10 kat sayılır; bir iOS derlemesi ≈ 15 dk × 10 = 150 dk). Aylık ~10 iOS derlemesi ücretsize sığar.</li>
            </ul></AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
