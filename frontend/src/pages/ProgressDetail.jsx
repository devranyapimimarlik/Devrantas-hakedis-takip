import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, openPdf, downloadFile } from "@/lib/api";
import { fmtTL, fmtDate, STATUS_LABELS } from "@/lib/format";
import { PageHeader, StatusBadge, Money } from "@/components/shared/Bits";
import { GoldButton } from "@/components/shared/Inputs";
import { toast } from "sonner";
import { ArrowLeft, FileDown, Sparkles, Loader2, Trash2 } from "lucide-react";

export default function ProgressDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, isManager } = useAuth();
  const { data: h } = useQuery({ queryKey: ["progress", id], queryFn: () => api.get(`/progress-payments/${id}`).then((r) => r.data) });
  const inv = () => ["progress", "accounts", "statement", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const status = useMutation({ mutationFn: (s) => api.patch(`/progress-payments/${id}/status`, { status: s }), onSuccess: () => { inv(); toast.success("Durum güncellendi"); }, onError: (e) => toast.error(errMsg(e)) });
  const ai = useMutation({ mutationFn: () => api.post(`/ai/progress-summary/${id}`), onSuccess: () => { inv(); toast.success("Özet hazır"); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: () => api.delete(`/progress-payments/${id}`), onSuccess: () => { inv(); nav("/hakedis"); }, onError: (e) => toast.error(errMsg(e)) });
  if (!h) return <div className="h-64 animate-pulse bg-white/60 rounded-2xl" />;
  const canStatus = isManager || user.role === "muhasebe";
  return (
    <div data-testid="progress-detail-page">
      <Link to="/hakedis" className="inline-flex items-center gap-1 text-sm text-charcoal-light hover:text-gold mb-4"><ArrowLeft className="w-4 h-4" /> Hakedişler</Link>
      <PageHeader eyebrow={`${STATUS_LABELS[h.type]} Hakedişi · No ${h.number}`} title={h.account_name} subtitle={`${h.site_name} · ${fmtDate(h.date)}${h.period ? ` · ${h.period}` : ""}`}
        actions={<>
          <GoldButton variant="outline" onClick={() => openPdf(`/pdf/progress-payment/${id}`, `hakedis-${h.number}.pdf`).catch((e) => toast.error(errMsg(e)))} data-testid="progress-pdf-button"><FileDown className="w-4 h-4" /> PDF</GoldButton>
          <GoldButton variant="outline" onClick={() => downloadFile(`/progress-payments/${id}/excel`, `hakedis-${h.number}.xlsx`).catch((e) => toast.error(errMsg(e)))} data-testid="progress-excel-button"><FileDown className="w-4 h-4" /> Excel</GoldButton>
          <GoldButton variant="outline" onClick={() => ai.mutate()} disabled={ai.isPending} data-testid="progress-ai-button">{ai.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI Özet</GoldButton>
          {canStatus && h.status === "taslak" && <GoldButton onClick={() => status.mutate("onaylandi")} data-testid="progress-approve-button">Onayla</GoldButton>}
          {canStatus && h.status === "onaylandi" && <GoldButton onClick={() => status.mutate("odendi")} data-testid="progress-paid-button">Ödendi İşaretle</GoldButton>}
          {isManager && <button onClick={() => window.confirm("Hakediş silinsin mi?") && del.mutate()} className="p-2 rounded-full hover:bg-red-50 text-red-700" data-testid="progress-delete-button"><Trash2 className="w-5 h-5" /></button>}
        </>} />
      <div className="gold-card p-5 md:p-8">
        <div className="flex items-center justify-between mb-5"><div className="flex items-center gap-3"><img src="/logo.png" alt="" className="w-12 h-12 rounded-full" /><div><p className="font-serif text-xl font-bold">DEVRANTAŞ</p><p className="text-[11px] text-charcoal-light tracking-wider">YAPI MİMARLIK İNŞAAT LTD. ŞTİ.</p></div></div><div className="text-right"><p className="font-serif text-2xl text-gold font-bold">HAKEDİŞ</p><StatusBadge status={h.status} testId="progress-status" /></div></div>
        <div className="border-t-2 border-gold mb-5" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]" data-testid="progress-items-table">
            <thead><tr className="bg-[#F1E8D6] text-left"><th className="p-2 rounded-l-lg">#</th><th className="p-2">İşin cinsi</th><th className="p-2">Birim</th><th className="p-2 text-right">Miktar</th><th className="p-2 text-right">Birim fiyat</th><th className="p-2 text-right rounded-r-lg">Toplam</th></tr></thead>
            <tbody>{h.items.map((it, i) => <tr key={i} className="border-b border-gold-border/40"><td className="p-2 text-charcoal-muted">{i + 1}</td><td className="p-2">{it.description}</td><td className="p-2">{it.unit}</td><td className="p-2 text-right money">{it.quantity}</td><td className="p-2 text-right money">{fmtTL(it.unit_price)}</td><td className="p-2 text-right money font-medium">{fmtTL(it.total)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="ml-auto max-w-sm mt-6 space-y-2 text-sm" data-testid="progress-detail-totals">
          <div className="flex justify-between"><span>Ara toplam</span><Money value={h.subtotal} /></div>
          {h.overhead_amount > 0 && <div className="flex justify-between text-gold-dark"><span>Genel gider kesintisi (%6)</span><span className="money">−{fmtTL(h.overhead_amount)}</span></div>}
          {h.retention_amount > 0 && <div className="flex justify-between"><span>Teminat (%{h.retention_rate})</span><span className="money">−{fmtTL(h.retention_amount)}</span></div>}
          {h.previous_deduction > 0 && <div className="flex justify-between"><span>Önceki kesinti / avans</span><span className="money">−{fmtTL(h.previous_deduction)}</span></div>}
          <div className="flex justify-between"><span>KDV matrahı</span><Money value={h.base_amount} /></div>
          <div className="flex justify-between"><span>KDV %{h.vat_rate}</span><Money value={h.vat_amount} /></div>
          <div className="flex justify-between border-t-2 border-gold pt-2 text-xl font-semibold text-gold"><span>Net ödenecek</span><Money value={h.net_amount} /></div>
        </div>
        {h.notes && <div className="mt-6"><p className="font-semibold tracking-wide mb-1">NOTLAR</p><p className="text-sm whitespace-pre-wrap bg-[#FDFBF7] border border-gold-border rounded-2xl p-4">{h.notes}</p></div>}
        {h.terms && <div className="mt-6"><p className="font-semibold tracking-wide mb-1">ŞARTLAR</p><p className="text-sm whitespace-pre-wrap bg-[#FDFBF7] border border-gold-border rounded-2xl p-4">{h.terms}</p></div>}
        {h.technical_spec && <div className="mt-6"><p className="font-semibold tracking-wide mb-1">TEKNİK ŞARTNAME</p><p className="text-sm whitespace-pre-wrap bg-[#FDFBF7] border border-gold-border rounded-2xl p-4">{h.technical_spec}</p></div>}
        {h.ai_summary && <div className="mt-6" data-testid="progress-ai-summary"><p className="font-semibold tracking-wide mb-1 flex items-center gap-2"><Sparkles className="w-4 h-4 text-gold" /> YAPAY ZEKA ÖZETİ</p><p className="text-sm whitespace-pre-wrap bg-gold-bg border border-gold-border rounded-2xl p-4 leading-relaxed">{h.ai_summary}</p></div>}
        <div className="grid grid-cols-3 gap-6 mt-12 text-center text-sm text-charcoal-light">{["Hazırlayan", "Kontrol Eden", "Onaylayan"].map((l) => <div key={l} className="border-t border-charcoal-muted pt-2">{l}</div>)}</div>
      </div>
    </div>
  );
}
