import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageCircle, Copy, Check, ClipboardPaste, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { fmtTL, fmtDate } from "@/lib/format";
import { NTextarea, GoldButton } from "@/components/shared/Inputs";

export function WhatsAppImport({ initialText = "", onParsed }) {
  const [text, setText] = useState(initialText);
  const [copied, setCopied] = useState(false);
  const { data: tpl } = useQuery({ queryKey: ["wa-template"], queryFn: () => api.get("/whatsapp/template").then((r) => r.data), staleTime: 300_000 });
  const parse = useMutation({ mutationFn: (t) => api.post("/whatsapp/parse", { text: t }).then((r) => r.data), onError: (e) => toast.error(errMsg(e)) });
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); setCopied(true); toast.success("Şablon kopyalandı — WhatsApp grubuna yapıştırın"); setTimeout(() => setCopied(false), 1500); } catch { window.prompt("Şablon:", t); } };
  const paste = async () => { try { setText(await navigator.clipboard.readText()); } catch { toast.error("Panoya erişilemedi; mesajı elle yapıştırın"); } };
  const r = parse.data;
  return (
    <div className="space-y-4" data-testid="whatsapp-import">
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
        <p className="text-sm font-semibold text-emerald-900 flex items-center gap-2"><MessageCircle className="w-4 h-4" /> WhatsApp şablonu (gruba bu formatta yazın)</p>
        <pre className="text-xs font-mono whitespace-pre-wrap mt-2 bg-white rounded-xl p-3 border border-emerald-100" data-testid="whatsapp-template">{tpl?.template || "Kasa : Devrantaş Nakit\nÖdeme : Avans\nTarih : 26.10.2026\nTutar : 50.000 TL\nŞantiye : Ünalan\nTaşeron : Ferdi Kızıltaş"}</pre>
        <div className="flex flex-wrap gap-2 mt-2">
          <GoldButton size="sm" variant="outline" type="button" onClick={() => copy(tpl?.template || "")} data-testid="whatsapp-copy-template">{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Taşeron şablonu</GoldButton>
          <GoldButton size="sm" variant="outline" type="button" onClick={() => copy(tpl?.template_customer || "")} data-testid="whatsapp-copy-template-customer"><Copy className="w-3.5 h-3.5" /> Müşteri şablonu</GoldButton>
        </div>
        <p className="text-[11px] text-emerald-800 mt-2">Satır başlıkları: Kasa · Ödeme (Avans/Tahsilat/Malzeme/İşçilik…) · Tarih · Tutar · Şantiye · Taşeron veya Müşteri · Açıklama. Dekont fotoğrafını ayrıca ekleyebilirsiniz.</p>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1"><p className="text-sm font-semibold">WhatsApp mesajını buraya yapıştırın</p><button type="button" onClick={paste} className="text-xs text-gold inline-flex items-center gap-1" data-testid="whatsapp-paste-button"><ClipboardPaste className="w-3.5 h-3.5" /> Panodan yapıştır</button></div>
        <NTextarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Kasa : Devrantaş Nakit&#10;Ödeme : Avans&#10;Tarih : 26.10.2026&#10;Tutar : 50.000 TL&#10;Şantiye : Ünalan&#10;Taşeron : Ferdi Kızıltaş" data-testid="whatsapp-text-input" />
        <GoldButton type="button" className="w-full mt-2" disabled={!text.trim() || parse.isPending} onClick={() => parse.mutate(text)} data-testid="whatsapp-parse-button">{parse.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />} Mesajı Oku</GoldButton>
      </div>
      {r && (
        <div className="gold-card p-4 space-y-2" data-testid="whatsapp-result">
          <p className="text-sm font-semibold">Okunan bilgiler — kontrol edin</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-charcoal-light">Tür</span><span data-testid="wa-type">{r.type === "gelir" ? "Tahsilat (Gelir)" : "Ödeme (Gider)"} · {r.category}</span>
            <span className="text-charcoal-light">Tutar</span><span className="money font-semibold" data-testid="wa-amount">{r.amount != null ? fmtTL(r.amount) : "—"}</span>
            <span className="text-charcoal-light">Tarih</span><span>{fmtDate(r.date)}</span>
            <span className="text-charcoal-light">Kasa</span><span>{r.kasa || "—"}</span>
            <span className="text-charcoal-light">Şantiye</span><span>{r.site_name || "—"}</span>
            <span className="text-charcoal-light">Cari</span><span>{r.account_name || "—"}</span>
          </div>
          {r.warnings?.length > 0 && <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 list-disc pl-5" data-testid="wa-warnings">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <GoldButton type="button" className="w-full" disabled={r.amount == null} onClick={() => onParsed?.(r)} data-testid="whatsapp-use-button"><Check className="w-4 h-4" /> Forma Aktar ve Kontrol Et</GoldButton>
        </div>
      )}
    </div>
  );
}
