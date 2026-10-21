import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { fmtTL, fmtDate } from "@/lib/format";
import { PageHeader, StatCard, StatusBadge, EmptyState, Money, OverheadTag, SectionTitle } from "@/components/shared/Bits";
import { GoldButton } from "@/components/shared/Inputs";
import { SiteForm } from "@/pages/Sites";
import { TransactionForm } from "@/pages/Transactions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Plus, Sparkles, Loader2, AlertTriangle } from "lucide-react";

export default function SiteDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [addTx, setAddTx] = useState(false);
  const { data: s } = useQuery({ queryKey: ["site", id], queryFn: () => api.get(`/sites/${id}`).then((r) => r.data) });
  const { data: txs = [] } = useQuery({ queryKey: ["transactions", "site", id], queryFn: () => api.get("/transactions", { params: { site_id: id } }).then((r) => r.data) });
  const { data: haks = [] } = useQuery({ queryKey: ["progress", "site", id], queryFn: () => api.get("/progress-payments", { params: { site_id: id } }).then((r) => r.data) });
  const ai = useMutation({ mutationFn: () => api.post(`/ai/site-analysis/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["site", id] }); toast.success("Analiz hazır"); }, onError: (e) => toast.error(errMsg(e)) });
  if (!s) return <div className="h-64 animate-pulse bg-white/60 rounded-2xl" />;
  const sm = s.summary;
  const warn = sm.deviation > 10;
  return (
    <div data-testid="site-detail-page">
      <Link to="/santiyeler" className="inline-flex items-center gap-1 text-sm text-charcoal-light hover:text-gold mb-4"><ArrowLeft className="w-4 h-4" /> Şantiyeler</Link>
      <PageHeader eyebrow={s.customer_name || "Müşteri atanmadı"} title={s.name} subtitle={`${s.location || "-"} · ${fmtDate(s.start_date)} → ${fmtDate(s.end_date)}`}
        actions={<><StatusBadge status={s.status} className="self-center" /><GoldButton variant="outline" onClick={() => setEdit(true)} data-testid="edit-site-button"><Pencil className="w-4 h-4" /> Düzenle</GoldButton><GoldButton onClick={() => setAddTx(true)} data-testid="site-add-tx-button"><Plus className="w-4 h-4" /> Gelir/Gider</GoldButton></>} />
      {warn && <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 flex items-center gap-3 text-sm text-red-800" data-testid="deviation-warning"><AlertTriangle className="w-5 h-5 shrink-0" /><span><strong>İlerleme-maliyet sapması:</strong> Bütçenin %{sm.budget_used_percent}'i harcandı, fiziksel ilerleme %{sm.progress_percent}. Sapma {sm.deviation} puan.</span></div>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard label="Sözleşme Bedeli" value={fmtTL(sm.contract_amount)} hint={`Net (−%6): ${fmtTL(sm.net_contract)}`} testId="site-stat-contract" />
        <StatCard label="Tahsilat" value={fmtTL(sm.total_income)} hint={`Tahsilat oranı %${sm.collection_rate}`} tone="green" testId="site-stat-income" delay={60} />
        <StatCard label="Onaylı Gider" value={fmtTL(sm.total_expense)} hint={`Onay bekleyen: ${fmtTL(sm.pending_expense)}`} tone="red" testId="site-stat-expense" delay={120} />
        <StatCard label="Tahmini Kâr" value={fmtTL(sm.estimated_profit)} hint={`Kâr marjı %${sm.profit_margin} · Gerçekleşen ${fmtTL(sm.realized_profit)}`} tone={sm.estimated_profit >= 0 ? "green" : "red"} testId="site-stat-profit" delay={180} />
      </div>
      <div className="gold-card p-5 mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-3"><OverheadTag amount={sm.overhead_amount} /><span className="text-xs text-charcoal-muted">Sözleşme bedelinden otomatik düşülür.</span></div>
        <div className="grid sm:grid-cols-2 gap-4 text-xs font-mono">
          <div><div className="flex justify-between mb-1"><span>Fiziksel İlerleme</span><span>%{sm.progress_percent}</span></div><div className="h-2 rounded-full bg-stone-100"><div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, sm.progress_percent)}%` }} /></div></div>
          <div><div className="flex justify-between mb-1"><span>Bütçe Kullanımı</span><span>%{sm.budget_used_percent}</span></div><div className="h-2 rounded-full bg-stone-100"><div className={`h-full rounded-full ${warn ? "bg-red-600" : "bg-charcoal"}`} style={{ width: `${Math.min(100, sm.budget_used_percent)}%` }} /></div></div>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="gold-card p-5 md:p-6">
          <SectionTitle right={<GoldButton size="sm" variant="outline" onClick={() => ai.mutate()} disabled={ai.isPending} data-testid="site-ai-analysis-button">{ai.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} {s.ai_analysis ? "Yenile" : "AI Risk Analizi"}</GoldButton>}>Yapay Zeka Analizi</SectionTitle>
          {s.ai_analysis ? <div className="text-sm leading-relaxed whitespace-pre-wrap text-charcoal" data-testid="site-ai-analysis">{s.ai_analysis}</div> : <p className="text-sm text-charcoal-muted">Risk analizi, bütçe aşım ihtimali ve aksiyon önerileri için analiz başlatın.</p>}
        </div>
        <div className="space-y-6">
          <div className="gold-card p-5 md:p-6">
            <SectionTitle right={<Link to={`/hakedis/yeni?site_id=${id}`} className="text-xs text-gold hover:underline">+ Hakediş</Link>}>Hakedişler</SectionTitle>
            {haks.length === 0 ? <p className="text-sm text-charcoal-muted">Hakediş yok</p> : haks.map((h) => (
              <Link key={h.id} to={`/hakedis/${h.id}`} className="row-line hover:text-gold"><span>No {h.number} · {h.account_name} <StatusBadge status={h.status} className="ml-1" /></span><Money value={h.net_amount} className="font-semibold" /></Link>))}
          </div>
          <div className="gold-card p-5 md:p-6">
            <SectionTitle>Son İşlemler</SectionTitle>
            {txs.length === 0 ? <p className="text-sm text-charcoal-muted">İşlem yok</p> : txs.slice(0, 10).map((t) => (
              <div key={t.id} className="row-line"><span className="min-w-0 truncate">{fmtDate(t.date)} · {t.description || t.category} <StatusBadge status={t.status} className="ml-1" /></span><Money value={t.type === "gider" ? -t.amount : t.amount} signed className="font-semibold shrink-0" /></div>))}
          </div>
        </div>
      </div>
      <Dialog open={edit} onOpenChange={setEdit}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="font-serif text-2xl">Şantiyeyi Düzenle</DialogTitle></DialogHeader><SiteForm initial={s} onDone={() => setEdit(false)} /></DialogContent></Dialog>
      <Dialog open={addTx} onOpenChange={setAddTx}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="font-serif text-2xl">Gelir / Gider Ekle</DialogTitle></DialogHeader><TransactionForm defaults={{ site_id: id }} onDone={() => setAddTx(false)} /></DialogContent></Dialog>
    </div>
  );
}
