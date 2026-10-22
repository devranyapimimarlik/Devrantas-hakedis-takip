import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listQueue, flushQueue, removeItem, onQueueChange, isOffline } from "@/lib/offline";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { WifiOff, CloudUpload, Trash2, Loader2 } from "lucide-react";

export function useOfflineQueue() {
  const qc = useQueryClient();
  const [items, setItems] = useState([]);
  const [offline, setOffline] = useState(isOffline());
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => listQueue().then(setItems).catch(() => {}), []);
  const flush = useCallback(async (silent = false) => {
    setBusy(true);
    try {
      const r = await flushQueue();
      if (r.sent) { ["transactions", "dashboard", "sites", "site", "site-photos", "pending-count", "accounts", "kasa", "reports"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(`${r.sent} çevrimdışı kayıt gönderildi`); }
      else if (!silent && r.remaining) toast.error("Kayıtlar gönderilemedi, tekrar denenecek");
      return r;
    } finally { setBusy(false); }
  }, [qc]);
  useEffect(() => {
    reload();
    const off = onQueueChange(reload);
    const on = () => { setOffline(false); flush(true); };
    const offl = () => setOffline(true);
    const msg = (e) => { if (e.data?.type === "flush-queue") flush(true); };
    window.addEventListener("online", on); window.addEventListener("offline", offl);
    navigator.serviceWorker?.addEventListener("message", msg);
    const t = setTimeout(() => flush(true), 1500);
    return () => { off(); clearTimeout(t); window.removeEventListener("online", on); window.removeEventListener("offline", offl); navigator.serviceWorker?.removeEventListener("message", msg); };
  }, [reload, flush]);
  return { items, offline, busy, flush, remove: removeItem };
}

const LABEL = { transaction: "Gider/Tahsilat", photo: "Şantiye fotoğrafı" };

export function OfflineBar() {
  const { items, offline, busy, flush, remove } = useOfflineQueue();
  const [open, setOpen] = useState(false);
  if (!offline && items.length === 0) return null;
  return (
    <>
      <div className={`rounded-2xl border p-3 mb-5 flex items-center gap-3 ${offline ? "border-amber-300 bg-amber-50" : "border-gold-border bg-gold-bg"}`} data-testid="offline-bar">
        {offline ? <WifiOff className="w-5 h-5 text-amber-700 shrink-0" /> : <CloudUpload className="w-5 h-5 text-gold shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight" data-testid="offline-status">{offline ? "İnternet yok — çevrimdışı moddasınız" : "Bağlantı geldi"}</p>
          <p className="text-xs text-charcoal-light" data-testid="offline-queue-count">{items.length > 0 ? `${items.length} kayıt bekliyor; bağlantı gelince otomatik gönderilir` : "Gider ve fotoğraf girişleri cihazda saklanır"}</p>
        </div>
        {items.length > 0 && <button onClick={() => setOpen(true)} className="text-xs underline text-charcoal-light" data-testid="offline-queue-open">Liste</button>}
        {items.length > 0 && !offline && <Button size="sm" disabled={busy} onClick={() => flush(false)} className="bg-gold hover:bg-gold-dark text-white" data-testid="offline-flush-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Şimdi gönder"}</Button>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="font-serif text-2xl">Bekleyen Kayıtlar</DialogTitle></DialogHeader>
          <ul className="space-y-2" data-testid="offline-queue-list">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 border border-gold-border rounded-xl px-3 py-2 text-sm" data-testid={`offline-item-${it.id}`}>
                <div className="flex-1 min-w-0"><p className="font-medium">{LABEL[it.kind]} {it.payload?.amount ? `· ${Number(it.payload.amount).toLocaleString("tr-TR")} ₺` : ""}</p><p className="text-xs text-charcoal-light truncate">{it.payload?.description || it.payload?.note || it.payload?.category || ""} · {new Date(it.createdAt).toLocaleString("tr-TR")}{it.file ? " · fotoğraflı" : ""}</p>{it.lastError && <p className="text-xs text-red-700 truncate">{it.lastError}</p>}</div>
                <button onClick={() => remove(it.id)} className="text-red-700 p-1" data-testid={`offline-item-remove-${it.id}`}><Trash2 className="w-4 h-4" /></button>
              </li>))}
            {items.length === 0 && <p className="text-sm text-charcoal-light">Bekleyen kayıt yok</p>}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
