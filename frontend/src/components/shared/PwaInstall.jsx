import { useEffect, useState } from "react";
import { Share, PlusSquare, Smartphone, Download, CheckCircle2, MoreVertical } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { isNativeApp } from "@/lib/native";
import { Button } from "@/components/ui/button";

let deferredPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; window.dispatchEvent(new Event("pwa-installable")); });
}

export function usePwaInstall() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const [standalone, setStandalone] = useState(isNativeApp() || window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true);
  const [canPrompt, setCanPrompt] = useState(!!deferredPrompt);
  useEffect(() => {
    const on = () => setCanPrompt(true);
    const done = () => { setStandalone(true); setCanPrompt(false); };
    window.addEventListener("pwa-installable", on);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("pwa-installable", on); window.removeEventListener("appinstalled", done); };
  }, []);
  const install = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    setCanPrompt(false);
    return outcome === "accepted";
  };
  return { isIOS, isAndroid, standalone, canPrompt, install };
}

function Step({ n, icon: Icon, children }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-7 h-7 rounded-full bg-gold text-white text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
      <div className="flex items-center gap-2 text-sm text-charcoal pt-1">{Icon && <Icon className="w-4 h-4 text-gold shrink-0" />}<span>{children}</span></div>
    </li>
  );
}

export function InstallGuide({ compact = false }) {
  const { settings } = useSettings();
  const { isIOS, isAndroid, standalone, canPrompt, install } = usePwaInstall();
  const brand = settings?.short_name || "Devrantaş";
  const showIOS = isIOS || !isAndroid;
  const showAndroid = isAndroid || !isIOS;

  if (standalone) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-testid="pwa-installed">
        <CheckCircle2 className="w-6 h-6 text-emerald-600" /><p className="text-sm text-emerald-800">{isNativeApp() ? "Mağaza uygulamasını kullanıyorsunuz." : "Uygulama ana ekranınıza kurulu. Tam ekran modunda çalışıyorsunuz."}</p>
      </div>
    );
  }
  return (
    <div className={compact ? "space-y-4" : "grid md:grid-cols-2 gap-5"}>
      {showAndroid && (
        <div className="rounded-2xl border border-gold-border bg-white p-5 space-y-4" data-testid="install-android">
          <div className="flex items-center gap-2"><Smartphone className="w-5 h-5 text-gold" /><p className="font-semibold">Android (Chrome)</p></div>
          {canPrompt ? (
            <Button onClick={install} className="w-full bg-gold hover:bg-gold-dark text-white" data-testid="pwa-install-button"><Download className="w-4 h-4 mr-2" />Ana Ekrana Kur</Button>
          ) : (
            <ol className="space-y-3">
              <Step n={1} icon={MoreVertical}>Chrome'da sağ üstteki üç nokta menüsüne dokunun</Step>
              <Step n={2} icon={PlusSquare}>"Ana ekrana ekle" ya da "Uygulamayı yükle" seçin</Step>
              <Step n={3}>"Yükle" deyin — {brand} simgesi ana ekranda belirir</Step>
            </ol>
          )}
        </div>
      )}
      {showIOS && (
        <div className="rounded-2xl border border-gold-border bg-white p-5 space-y-4" data-testid="install-ios">
          <div className="flex items-center gap-2"><Smartphone className="w-5 h-5 text-gold" /><p className="font-semibold">iPhone / iPad (Safari)</p></div>
          <ol className="space-y-3">
            <Step n={1} icon={Share}>Safari'de alttaki Paylaş düğmesine dokunun</Step>
            <Step n={2} icon={PlusSquare}>Listeden "Ana Ekrana Ekle" seçin</Step>
            <Step n={3}>Sağ üstten "Ekle" deyin — {brand} logosu ana ekranda belirir</Step>
          </ol>
          <p className="text-xs text-charcoal-light">Not: iPhone'da kurulum yalnızca Safari tarayıcısından yapılabilir.</p>
        </div>
      )}
    </div>
  );
}

export function InstallBanner() {
  const { settings, logoUrl } = useSettings();
  const { standalone, isIOS, isAndroid, canPrompt, install } = usePwaInstall();
  const [hidden, setHidden] = useState(() => localStorage.getItem("pwa-banner-dismissed") === "1");
  const [open, setOpen] = useState(false);
  if (standalone || hidden || !(isIOS || isAndroid)) return null;
  const dismiss = () => { localStorage.setItem("pwa-banner-dismissed", "1"); setHidden(true); };
  return (
    <div className="lg:hidden rounded-2xl border border-gold-border bg-gold-bg p-3 mb-5" data-testid="pwa-banner">
      <div className="flex items-center gap-3">
        <img src={logoUrl} alt="" className="w-10 h-10 rounded-xl object-contain bg-white" />
        <div className="flex-1 min-w-0"><p className="text-sm font-semibold leading-tight">{settings?.short_name || "Devrantaş"} uygulamasını telefona kurun</p><p className="text-xs text-charcoal-light">Ana ekrandan tek dokunuşla açılır</p></div>
        <Button size="sm" className="bg-gold hover:bg-gold-dark text-white" onClick={() => (canPrompt ? install() : setOpen((v) => !v))} data-testid="pwa-banner-install">Kur</Button>
        <button onClick={dismiss} className="text-xs text-charcoal-light px-1" data-testid="pwa-banner-dismiss">Kapat</button>
      </div>
      {open && <div className="mt-3"><InstallGuide compact /></div>}
    </div>
  );
}
