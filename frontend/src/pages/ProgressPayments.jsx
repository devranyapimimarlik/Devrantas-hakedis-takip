import { useState, useMemo, useEffect } from "react";
import { Link, useNavigate, useSearchParams, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { fmtTL, fmtDate, today, STATUS_LABELS } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState, Field, Money } from "@/components/shared/Bits";
import { NInput, NSelect, NTextarea, GoldButton, Chip } from "@/components/shared/Inputs";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft } from "lucide-react";

export function ItemsEditor({ items, onChange, testId = "items" }) {
  const { data: catalog = [] } = useQuery({ queryKey: ["work-catalog"], queryFn: () => api.get("/ai/work-catalog").then((r) => r.data) });
  const upd = (i, k, v) => onChange(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const total = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
  const addFromCatalog = (name) => { const w = catalog.find((c) => c.name === name); if (!w) return; const empty = items.findIndex((it) => !it.description); const row = { description: w.name, unit: w.unit, quantity: "", unit_price: "" }; onChange(empty >= 0 ? items.map((it, i) => (i === empty ? row : it)) : [...items, row]); };
  return (
    <div>
      {catalog.length > 0 && <div className="mb-3 flex items-center gap-2"><NSelect value="" onChange={(e) => addFromCatalog(e.target.value)} className="!h-10" data-testid={`${testId}-catalog-select`}><option value="">+ Devrantaş iş kataloğundan kalem ekle…</option>{catalog.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.unit})</option>)}</NSelect></div>}
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[560px]" data-testid={`${testId}-table`}>
          <thead><tr className="bg-gold-bg text-left text-charcoal"><th className="p-2 rounded-l-lg font-semibold">İşin cinsi</th><th className="p-2 font-semibold w-24">Birim</th><th className="p-2 font-semibold w-32">Birim fiyat</th><th className="p-2 font-semibold w-24">Miktar</th><th className="p-2 font-semibold text-right w-32">Toplam</th><th className="p-2 rounded-r-lg w-8"></th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-gold-border/50">
                <td className="p-1.5"><NInput placeholder="ör. Dış cephe mantolama" value={it.description} onChange={(e) => upd(i, "description", e.target.value)} className="!h-10" data-testid={`${testId}-desc-${i}`} /></td>
                <td className="p-1.5"><NInput value={it.unit} onChange={(e) => upd(i, "unit", e.target.value)} className="!h-10" data-testid={`${testId}-unit-${i}`} /></td>
                <td className="p-1.5"><NInput type="number" step="0.01" value={it.unit_price} onChange={(e) => upd(i, "unit_price", e.target.value)} className="!h-10" data-testid={`${testId}-price-${i}`} /></td>
                <td className="p-1.5"><NInput type="number" step="0.01" value={it.quantity} onChange={(e) => upd(i, "quantity", e.target.value)} className="!h-10" data-testid={`${testId}-qty-${i}`} /></td>
                <td className="p-1.5 text-right money font-medium">{fmtTL(Number(it.quantity || 0) * Number(it.unit_price || 0))}</td>
                <td className="p-1.5 text-center"><button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-red-600 hover:text-red-800 text-lg leading-none" data-testid={`${testId}-remove-${i}`}>×</button></td>
              </tr>
            ))}
            <tr><td colSpan={4} className="p-2 text-right font-semibold">Toplam</td><td className="p-2 text-right money font-semibold">{fmtTL(total)}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <GoldButton type="button" variant="outline" size="sm" onClick={() => onChange([...items, { description: "", unit: "m2", quantity: "", unit_price: "" }])} className="mt-3" data-testid={`${testId}-add-row`}>+ Satır ekle</GoldButton>
    </div>
  );
}

export function NewProgress() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const { id: editId } = useParams();
  const { data: existing } = useQuery({ queryKey: ["progress", editId], queryFn: () => api.get(`/progress-payments/${editId}`).then((r) => r.data), enabled: !!editId });
  useEffect(() => {
    if (!existing) return;
    setF((p) => ({ ...p, site_id: existing.site_id, account_id: existing.account_id, type: existing.type, date: existing.date, period: existing.period || "", vat_rate: existing.vat_rate, apply_overhead: existing.apply_overhead, previous_deduction: existing.previous_deduction || 0, retention_rate: existing.retention_rate || 0, notes: existing.notes || "", terms: existing.terms || "", technical_spec: existing.technical_spec || "" }));
    setItems(existing.items?.length ? existing.items : [{ description: "", unit: "m2", quantity: "", unit_price: "" }]);
  }, [existing]);
  const [f, setF] = useState({ site_id: sp.get("site_id") || "", account_id: sp.get("account_id") || "", type: sp.get("type") || "taseron", date: today(), period: "", vat_rate: 20, apply_overhead: true, previous_deduction: 0, retention_rate: 0, notes: "", terms: "", technical_spec: "" });
  const [items, setItems] = useState([{ description: "", unit: "m2", quantity: "", unit_price: "" }]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: sites = [] } = useQuery({ queryKey: ["sites"], queryFn: () => api.get("/sites").then((r) => r.data) });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts", "all"], queryFn: () => api.get("/accounts").then((r) => r.data) });
  const calc = useMemo(() => {
    const sub = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
    const oh = f.apply_overhead ? sub * 0.06 : 0;
    const ret = sub * Number(f.retention_rate || 0) / 100;
    const base = sub - oh - ret - Number(f.previous_deduction || 0);
    const vat = base * Number(f.vat_rate || 0) / 100;
    return { sub, oh, ret, base, vat, net: base + vat };
  }, [items, f]);
  const m = useMutation({
    mutationFn: (b) => (editId ? api.put(`/progress-payments/${editId}`, b) : api.post("/progress-payments", b)),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["progress"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["sites"] }); toast.success(editId ? "Hakediş düzeltildi" : "Hakediş oluşturuldu"); nav(`/hakedis/${r.data.id}`); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = (e) => {
    e.preventDefault();
    if (!f.site_id || !f.account_id) return toast.error("Şantiye ve cari seçin");
    const clean = items.filter((it) => it.description).map((it) => ({ ...it, quantity: Number(it.quantity || 0), unit_price: Number(it.unit_price || 0) }));
    if (!clean.length) return toast.error("En az bir kalem girin");
    m.mutate({ ...f, items: clean, vat_rate: Number(f.vat_rate), previous_deduction: Number(f.previous_deduction || 0), retention_rate: Number(f.retention_rate || 0) });
  };
  return (
    <div data-testid="new-progress-page">
      <Link to="/hakedis" className="inline-flex items-center gap-1 text-sm text-charcoal-light hover:text-gold mb-4"><ArrowLeft className="w-4 h-4" /> Hakedişler</Link>
      <PageHeader title={editId ? `Hakediş Düzelt #${existing?.number ?? ""}` : "Yeni Hakediş"} subtitle="Metraj × birim fiyat, otomatik %6 genel gider kesintisi ve KDV ile net ödenecek tutar hesaplanır." />
      <form onSubmit={submit} className="gold-card p-5 md:p-8 space-y-6" data-testid="progress-form">
        <div className="flex gap-2">{["taseron", "musteri"].map((t) => <Chip key={t} active={f.type === t} onClick={() => setF({ ...f, type: t, account_id: "" })} data-testid={`progress-type-${t}`}>{STATUS_LABELS[t]} Hakedişi</Chip>)}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Şantiye"><NSelect value={f.site_id} onChange={set("site_id")} required data-testid="progress-site-select"><option value="">Seçin</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NSelect></Field>
          <Field label={f.type === "musteri" ? "Müşteri" : "Taşeron"}><NSelect value={f.account_id} onChange={set("account_id")} required data-testid="progress-account-select"><option value="">Seçin</option>{accounts.filter((a) => a.type === f.type).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NSelect></Field>
          <Field label="Tarih"><NInput type="date" value={f.date} onChange={set("date")} data-testid="progress-date-input" /></Field>
          <Field label="Dönem"><NInput placeholder="ör. Haziran 2026" value={f.period} onChange={set("period")} data-testid="progress-period-input" /></Field>
        </div>
        <div><p className="font-semibold text-lg mb-3 tracking-wide">HAKEDİŞ KALEMLERİ</p><ItemsEditor items={items} onChange={setItems} testId="progress-items" /></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="KDV %"><NInput type="number" value={f.vat_rate} onChange={set("vat_rate")} data-testid="progress-vat-input" /></Field>
          <Field label="Teminat %"><NInput type="number" value={f.retention_rate} onChange={set("retention_rate")} data-testid="progress-retention-input" /></Field>
          <Field label="Önceki Kesinti / Avans (₺)"><NInput type="number" value={f.previous_deduction} onChange={set("previous_deduction")} data-testid="progress-deduction-input" /></Field>
          <label className="flex items-center gap-2 text-sm pt-6"><input type="checkbox" checked={f.apply_overhead} onChange={(e) => setF({ ...f, apply_overhead: e.target.checked })} className="w-5 h-5 accent-[#B8860B]" data-testid="progress-overhead-checkbox" /> %6 Genel Gider Kes</label>
        </div>
        <div className="ml-auto max-w-sm space-y-2 text-sm" data-testid="progress-totals">
          <div className="flex justify-between"><span>Ara toplam</span><Money value={calc.sub} /></div>
          {f.apply_overhead && <div className="flex justify-between text-gold-dark"><span>Genel gider (%6)</span><span className="money">−{fmtTL(calc.oh)}</span></div>}
          {calc.ret > 0 && <div className="flex justify-between"><span>Teminat</span><span className="money">−{fmtTL(calc.ret)}</span></div>}
          {Number(f.previous_deduction) > 0 && <div className="flex justify-between"><span>Önceki kesinti</span><span className="money">−{fmtTL(f.previous_deduction)}</span></div>}
          <div className="flex justify-between"><span>KDV %{f.vat_rate}</span><Money value={calc.vat} /></div>
          <div className="flex justify-between border-t-2 border-gold pt-2 text-xl font-semibold text-gold"><span>Net ödenecek</span><Money value={calc.net} /></div>
        </div>
        <Field label="Notlar"><NTextarea value={f.notes} onChange={set("notes")} data-testid="progress-notes-input" /></Field>
        <Field label="Şartlar"><NTextarea value={f.terms} onChange={set("terms")} placeholder="Ödeme ve hakediş şartları..." data-testid="progress-terms-input" /></Field>
        <Field label="Teknik Şartname"><NTextarea value={f.technical_spec} onChange={set("technical_spec")} placeholder="Malzeme standartları, uygulama detayları..." data-testid="progress-spec-input" /></Field>
        <GoldButton type="submit" size="lg" disabled={m.isPending} className="w-full sm:w-auto sm:ml-auto sm:flex" data-testid="progress-submit-button">Hakedişi Kaydet</GoldButton>
      </form>
    </div>
  );
}

export default function ProgressPayments() {
  const [filter, setFilter] = useState("tumu");
  const { data = [], isLoading } = useQuery({ queryKey: ["progress"], queryFn: () => api.get("/progress-payments").then((r) => r.data) });
  const rows = data.filter((h) => filter === "tumu" || h.type === filter);
  return (
    <div data-testid="progress-page">
      <PageHeader title="Hakedişler" subtitle="Müşteri ve taşeron hakedişleri, %6 genel gider kesintili net tutarlar, PDF çıktı."
        actions={<Link to="/hakedis/yeni"><GoldButton data-testid="add-progress-button"><Plus className="w-4 h-4" /> Yeni Hakediş</GoldButton></Link>} />
      <div className="flex gap-2 mb-5">{[["tumu", "Tümü"], ["taseron", "Taşeron"], ["musteri", "Müşteri"]].map(([k, l]) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)} data-testid={`progress-filter-${k}`}>{l}</Chip>)}</div>
      {isLoading ? <div className="h-40 animate-pulse bg-white/60 rounded-2xl" /> : rows.length === 0 ? <EmptyState title="Hakediş yok" testId="progress-empty" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="progress-list">
          {rows.map((h) => (
            <Link key={h.id} to={`/hakedis/${h.id}`} className="gold-card p-5 block hover:-translate-y-0.5 transition-transform" data-testid={`progress-card-${h.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="label-gold">{STATUS_LABELS[h.type]} Hakedişi · No {h.number}</p><h3 className="text-lg font-semibold mt-1">{h.account_name}</h3><p className="text-xs text-charcoal-light">{h.site_name} · {fmtDate(h.date)}{h.period ? ` · ${h.period}` : ""}</p></div>
                <StatusBadge status={h.status} />
              </div>
              <div className="flex items-end justify-between mt-4"><span className="text-xs text-charcoal-muted">Ara toplam {fmtTL(h.subtotal)} · GG −{fmtTL(h.overhead_amount)}</span><Money value={h.net_amount} className="text-xl font-semibold text-gold" /></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
