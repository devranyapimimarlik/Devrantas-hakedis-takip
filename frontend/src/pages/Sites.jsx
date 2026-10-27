import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { fmtTL, fmtDate, today } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState, Field, OverheadTag } from "@/components/shared/Bits";
import { NInput, NSelect, NTextarea, GoldButton } from "@/components/shared/Inputs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, MapPin, ArrowRight } from "lucide-react";

const EMPTY = { name: "", customer_id: "", location: "", contract_amount: "", start_date: today(), end_date: "", status: "devam", progress_percent: 0, description: "" };

export function SiteForm({ initial = EMPTY, onDone }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ ...EMPTY, ...initial, customer_id: initial.customer_id || "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: customers = [] } = useQuery({ queryKey: ["accounts", "musteri"], queryFn: () => api.get("/accounts", { params: { type: "musteri" } }).then((r) => r.data) });
  const m = useMutation({
    mutationFn: (body) => (initial.id ? api.put(`/sites/${initial.id}`, body) : api.post("/sites", body)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sites"] }); qc.invalidateQueries({ queryKey: ["site", initial.id] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Şantiye kaydedildi"); onDone?.(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const overhead = Number(f.contract_amount || 0) * 0.06;
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...f, customer_id: f.customer_id || null, contract_amount: Number(f.contract_amount || 0), progress_percent: Number(f.progress_percent || 0), end_date: f.end_date || null }); }} className="space-y-4" data-testid="site-form">
      <Field label="Şantiye / Proje Adı"><NInput value={f.name} onChange={set("name")} required data-testid="site-name-input" /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Müşteri (Cari)">
          <NSelect value={f.customer_id} onChange={set("customer_id")} data-testid="site-customer-select">
            <option value="">Seçiniz</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NSelect>
        </Field>
        <Field label="Konum"><NInput value={f.location} onChange={set("location")} data-testid="site-location-input" /></Field>
        <Field label="Sözleşme Bedeli (₺)" hint={f.contract_amount ? `%6 Genel Gider: ${fmtTL(overhead)} · Net: ${fmtTL(f.contract_amount - overhead)}` : "Otomatik %6 genel gider kesintisi uygulanır"}>
          <NInput type="number" min="0" step="0.01" value={f.contract_amount} onChange={set("contract_amount")} required data-testid="site-contract-input" />
        </Field>
        <Field label="Durum">
          <NSelect value={f.status} onChange={set("status")} data-testid="site-status-select">
            <option value="planlama">Planlama</option><option value="devam">Devam Ediyor</option><option value="tamamlandi">Tamamlandı</option><option value="durduruldu">Durduruldu</option>
          </NSelect>
        </Field>
        <Field label="Başlangıç"><NInput type="date" value={f.start_date || ""} onChange={set("start_date")} data-testid="site-start-input" /></Field>
        <Field label="Bitiş (Planlanan)"><NInput type="date" value={f.end_date || ""} onChange={set("end_date")} data-testid="site-end-input" /></Field>
        <Field label="Fiziksel İlerleme (%)"><NInput type="number" min="0" max="100" value={f.progress_percent} onChange={set("progress_percent")} data-testid="site-progress-input" /></Field>
      </div>
      <Field label="Açıklama"><NTextarea value={f.description} onChange={set("description")} data-testid="site-desc-input" /></Field>
      <GoldButton type="submit" disabled={m.isPending} className="w-full" data-testid="site-submit-button">{initial.id ? "Güncelle" : "Şantiye Oluştur"}</GoldButton>
    </form>
  );
}

const STATUS_FILTERS = [
  ["devam", "Devam eden", "bg-amber-100 text-amber-800 border-amber-300", "bg-amber-500 text-white border-amber-500"],
  ["tamamlandi", "Tamamlanan", "bg-emerald-50 text-emerald-800 border-emerald-300", "bg-emerald-600 text-white border-emerald-600"],
  ["planlama", "Planlanan", "bg-sky-50 text-sky-800 border-sky-300", "bg-sky-600 text-white border-sky-600"],
  ["durduruldu", "Durdurulan", "bg-stone-100 text-stone-700 border-stone-300", "bg-stone-600 text-white border-stone-600"],
  ["tumu", "Tümü", "bg-white text-charcoal border-stone-200", "bg-charcoal text-white border-charcoal"],
];

export default function Sites() {
  const [open, setOpen] = useState(false);
  const [sp, setSp] = useSearchParams();
  const filter = sp.get("durum") || "devam";
  const { data = [], isLoading } = useQuery({ queryKey: ["sites"], queryFn: () => api.get("/sites").then((r) => r.data) });
  const counts = data.reduce((m, s) => ({ ...m, [s.status || "devam"]: (m[s.status || "devam"] || 0) + 1 }), {});
  const rows = filter === "tumu" ? data : data.filter((s) => (s.status || "devam") === filter);
  const label = STATUS_FILTERS.find((x) => x[0] === filter)?.[1];
  return (
    <div data-testid="sites-page">
      <PageHeader eyebrow="Projeler" title="Şantiyeler" subtitle="Her şantiye için sözleşme bedeli, %6 genel gider kesintisi, gelir-gider ve kâr marjı."
        actions={<GoldButton onClick={() => setOpen(true)} data-testid="add-site-button"><Plus className="w-4 h-4" /> Yeni Şantiye</GoldButton>} />
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-4 px-4 md:mx-0 md:px-0" data-testid="site-status-filters">
        {STATUS_FILTERS.map(([k, l, idle, active]) => (
          <button key={k} onClick={() => setSp({ durum: k })} className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${filter === k ? active : idle}`} data-testid={`site-filter-${k}`}>
            {l}<span className={`text-[11px] font-mono rounded-full px-1.5 ${filter === k ? "bg-white/25" : "bg-black/5"}`}>{k === "tumu" ? data.length : counts[k] || 0}</span>
          </button>
        ))}
      </div>
      {isLoading ? <div className="h-40 animate-pulse bg-white/60 rounded-xl" /> : rows.length === 0 ? (
        <EmptyState title={data.length === 0 ? "Henüz şantiye yok" : `${label} şantiye yok`} desc={data.length === 0 ? "İlk projenizi ekleyerek başlayın." : "Üstteki durum seçeneklerinden başka bir grubu açın."} action={<GoldButton variant="outline" onClick={() => setOpen(true)}>Şantiye Ekle</GoldButton>} testId="sites-empty" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5" data-testid="sites-grid">
          {rows.map((s, i) => {
            const sm = s.summary;
            return (
              <Link key={s.id} to={`/santiyeler/${s.id}`} className="gold-card p-5 md:p-6 fade-up block hover:-translate-y-0.5 transition-transform" style={{ animationDelay: `${i * 50}ms` }} data-testid={`site-card-${s.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="font-serif text-xl font-semibold truncate">{s.name}</h3>
                    <p className="text-xs text-charcoal-muted flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{s.location || "-"} · {s.customer_name || "Müşteri yok"}</p></div>
                  <StatusBadge status={s.status} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="label-gold">Sözleşme</p><p className="money font-semibold mt-1">{fmtTL(sm.contract_amount)}</p></div>
                  <div><p className="label-gold">Tahmini Kâr</p><p className={`money font-semibold mt-1 ${sm.estimated_profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{fmtTL(sm.estimated_profit)}</p></div>
                  <div><p className="label-gold">Tahsilat</p><p className="money mt-1 text-emerald-700">{fmtTL(sm.total_income)}</p></div>
                  <div><p className="label-gold">Onaylı Gider</p><p className="money mt-1 text-red-700">{fmtTL(sm.total_expense)}</p></div>
                </div>
                <div className="mt-4"><OverheadTag amount={sm.overhead_amount} /></div>
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] font-mono text-charcoal-muted mb-1"><span>İlerleme %{sm.progress_percent}</span><span>Bütçe %{sm.budget_used_percent}</span></div>
                  <div className="h-1.5 rounded-full bg-stone-100 relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-gold rounded-full" style={{ width: `${Math.min(100, sm.progress_percent)}%` }} />
                    <div className="absolute inset-y-0 left-0 bg-charcoal/40 rounded-full" style={{ width: `${Math.min(100, sm.budget_used_percent)}%` }} />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-charcoal-muted"><span>{fmtDate(s.start_date)} → {fmtDate(s.end_date)}</span><span className="inline-flex items-center gap-1 text-gold">Detay <ArrowRight className="w-3 h-3" /></span></div>
              </Link>
            );
          })}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="font-serif text-2xl">Yeni Şantiye</DialogTitle></DialogHeader><SiteForm onDone={() => setOpen(false)} /></DialogContent>
      </Dialog>
    </div>
  );
}
