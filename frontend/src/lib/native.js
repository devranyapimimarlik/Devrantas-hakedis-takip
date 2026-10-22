import { api } from "@/lib/api";

const cap = () => (typeof window !== "undefined" ? window.Capacitor : null);
export const isNativeApp = () => !!cap()?.isNativePlatform?.();
export const nativePlatform = () => (isNativeApp() ? cap().getPlatform() : null);
const plugin = () => cap()?.Plugins?.PushNotifications;

let wired = false;
export async function registerNativePush(navigate) {
  const P = plugin();
  if (!isNativeApp() || !P) return { supported: false };
  if (!wired) {
    wired = true;
    P.addListener("registration", async (t) => {
      try { await api.post("/push/device", { token: t.value, platform: nativePlatform(), device: navigator.userAgent.slice(0, 120) }); localStorage.setItem("native_push_token", t.value); } catch { /* ignore */ }
    });
    P.addListener("registrationError", (e) => console.error("Push registration error", e));
    P.addListener("pushNotificationActionPerformed", (a) => {
      const url = a?.notification?.data?.url || a?.notification?.data?.aps?.url;
      if (url && navigate) navigate(url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url);
    });
  }
  let perm = await P.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await P.requestPermissions();
  if (perm.receive !== "granted") return { supported: true, granted: false };
  await P.register();
  return { supported: true, granted: true };
}

export async function unregisterNativePush() {
  const token = localStorage.getItem("native_push_token");
  if (token) { try { await api.delete("/push/device", { data: { endpoint: token } }); } catch { /* ignore */ } localStorage.removeItem("native_push_token"); }
  const P = plugin();
  if (P?.unregister) await P.unregister().catch(() => {});
}
