import { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { usePwaInstall } from "@/components/shared/PwaInstall";
import { isNativeApp, registerNativePush, unregisterNativePush } from "@/lib/native";

function b64ToUint8(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePush() {
  const native = isNativeApp();
  const supported = native || ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  const [permission, setPermission] = useState(native ? "default" : supported ? Notification.permission : "unsupported");
  const [subscribed, setSubscribed] = useState(native ? !!localStorage.getItem("native_push_token") : false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supported || native) return;
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setSubscribed(!!s)).catch(() => {});
  }, [supported, native]);
  const enable = async () => {
    setBusy(true);
    try {
      if (native) {
        const r = await registerNativePush();
        if (!r.granted) { setPermission("denied"); toast.error("Bildirim izni verilmedi"); return false; }
        setPermission("granted"); setSubscribed(true); toast.success("Bildirimler açıldı"); return true;
      }
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") { toast.error("Bildirim izni verilmedi"); return false; }
      const reg = await navigator.serviceWorker.ready;
      const { data } = await api.get("/push/vapid-public-key");
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(data.public_key) }));
      await api.post("/push/subscribe", { subscription: sub.toJSON(), device: navigator.userAgent.slice(0, 120) });
      setSubscribed(true);
      toast.success("Bildirimler açıldı");
      return true;
    } catch (e) { toast.error(errMsg(e)); return false; } finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      if (native) { await unregisterNativePush(); setSubscribed(false); toast.success("Bildirimler kapatıldı"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api.post("/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setSubscribed(false);
      toast.success("Bildirimler kapatıldı");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const test = async () => { try { const { data } = await api.post("/push/test"); toast.success(`Test bildirimi gönderildi (${data.sent} cihaz)`); } catch (e) { toast.error(errMsg(e)); } };
  return { supported, permission, subscribed, busy, enable, disable, test };
}

export function PushToggle() {
  const { supported, permission, subscribed, busy, enable, disable, test } = usePush();
  const { isIOS, standalone } = usePwaInstall();
  const iosBlocked = isIOS && !standalone && !isNativeApp();
  return (
    <div className="gold-card p-5 space-y-3" data-testid="push-card">
      <div className="flex items-center gap-2">{subscribed ? <BellRing className="w-5 h-5 text-gold" /> : <Bell className="w-5 h-5 text-gold" />}<p className="font-semibold">Anlık Bildirimler</p></div>
      <p className="text-xs text-charcoal-light">Vadesi 3 gün kalan çek ve ödemeler, onay bekleyen giderler ve sabah 09:00 günlük özet bu cihaza bildirim olarak düşer.</p>
      {!supported && <p className="text-xs text-amber-700" data-testid="push-unsupported">Bu tarayıcı anlık bildirimi desteklemiyor.</p>}
      {iosBlocked && <p className="text-xs text-amber-700" data-testid="push-ios-hint">iPhone'da bildirim için önce uygulamayı ana ekrana kurup oradan açın (iOS 16.4+).</p>}
      {permission === "denied" && <p className="text-xs text-red-700" data-testid="push-denied">Bildirim izni engellenmiş. Tarayıcı/cihaz ayarlarından bu site için bildirime izin verin.</p>}
      <div className="flex flex-wrap gap-2">
        {!subscribed
          ? <Button onClick={enable} disabled={busy || !supported || iosBlocked || permission === "denied"} className="bg-gold hover:bg-gold-dark text-white" data-testid="push-enable-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4 mr-2" />}Bildirimleri Aç</Button>
          : <>
            <Button onClick={test} variant="outline" className="border-gold-border" data-testid="push-test-button"><BellRing className="w-4 h-4 mr-2" />Test Bildirimi</Button>
            <Button onClick={disable} disabled={busy} variant="ghost" className="text-red-700" data-testid="push-disable-button"><BellOff className="w-4 h-4 mr-2" />Kapat</Button>
          </>}
      </div>
    </div>
  );
}
