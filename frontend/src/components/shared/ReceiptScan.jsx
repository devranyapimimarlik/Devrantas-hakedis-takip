import { useRef, useState } from "react";
import { ScanLine, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { fmtTL, fmtDate } from "@/lib/format";

export function ReceiptScan({ onResult }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/receipt/parse", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setLast(data);
      onResult?.(data, file);
      toast.success(data.amount != null ? `Dekont okundu: ${fmtTL(data.amount)} · ${fmtDate(data.date)}` : "Dekont okundu, tutarı kontrol edin");
      (data.warnings || []).forEach((w) => toast.warning(w));
    } catch (err) { toast.error(errMsg(err)); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl border border-dashed border-gold-border bg-gold-bg/30 p-3 flex items-center gap-3" data-testid="receipt-scan">
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} data-testid="receipt-scan-input" />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="inline-flex items-center gap-2 rounded-full bg-charcoal text-white px-4 py-2 text-sm font-medium disabled:opacity-60" data-testid="receipt-scan-button">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />} {busy ? "Dekont okunuyor…" : "Dekontu Fotoğrafla / Oku"}
      </button>
      <p className="text-xs text-charcoal-light flex-1 min-w-0">
        {last ? <span data-testid="receipt-scan-result">{last.bank ? `${last.bank} · ` : ""}{last.payer ? `Gönderen: ${last.payer} · ` : ""}{last.payee ? `Alıcı: ${last.payee}` : ""}{last.account_name ? ` → ${last.account_name}` : ""}</span>
          : "WhatsApp'tan gelen dekont görselini seçin; tutar, tarih ve cari otomatik dolar, dekont eke de eklenir."}
      </p>
    </div>
  );
}
