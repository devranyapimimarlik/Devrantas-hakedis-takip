import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg, openPdf, downloadFile } from "@/lib/api";
import { fmtTL, fmtDate, today, STATUS_LABELS } from "@/lib/format";
import { PageHeader, EmptyState, Field, Money } from "@/components/shared/Bits";
import { NInput, NSelect, NTextarea, GoldButton, Chip } from "@/components/shared/Inputs";
import { ItemsEditor } from "@/pages/ProgressPayments";
import { toast } from "sonner";
import { Loader2, Trash2, Plus, FileDown } from "lucide-react";

const COMPANY = { name: "Devrantaş Yapı Mimarlık İnşaat Ltd. Şti.", address: "Nurtanesi Sok. No: 3/1, Merkez Mah., Çekmeköy, İstanbul", phone: "0533 482 57 02", email: "Devrantasyapimimarlik@gmail.com" };
const EMPTY = { title: "", account_id: "", party_name: "", party_type: "musteri", site_id: "", date: today(), start_date: "", end_date: "", duration_days: "", vat_rate: 20, advance_amount: 0, retention_rate: 0, terms: "", technical_spec: "", payment_terms: "Aylık hakediş usulü; hakediş onayını takiben 7 iş günü içinde ödeme.", notes: "" };
const CSTATUS = { taslak: "Taslak", imzalandi: "İmzalandı", tamamlandi: "Tamamlandı", feshedildi: "Feshedildi" };

export default function Contracts() {
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [items, setItems] = useState([{ description: "", unit: "m2", quantity: "", unit_price: "" }]);
  const [editId, setEditId] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts", "all"], queryFn: () => api.get("/accounts").then((r) => r.data) });
  const { data: sites = [] } = useQuery({ queryKey: ["sites"], queryFn: () => api.get("/sites").then((r) => r.data) });
  const { data: defaults } = useQuery({ queryKey: ["contract-defaults"], queryFn: () => api.get("/contracts/defaults").then((r) => r.data) });
  const { data: list = [] } = useQuery({ queryKey: ["contracts"], queryFn: () => api.get("/contracts").then((r) => r.data) });
  const terms = f.terms || defaults?.terms || "";
  const calc = useMemo(() => { const sub = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0); const vat = sub * Number(f.vat_rate || 0) / 100; return { sub, vat, total: sub + vat }; }, [items, f.vat_rate]);
  const body = () => ({ ...f, terms, account_id: f.account_id || null, site_id: f.site_id || null, start_date: f.start_date || null, end_date: f.end_date || null, duration_days: f.duration_days ? Number(f.duration_days) : null, vat_rate: Number(f.vat_rate), advance_amount: Number(f.advance_amount || 0), retention_rate: Number(f.retention_rate || 0),
    items: items.filter((it) => it.description).map((it) => ({ ...it, quantity: Number(it.quantity || 0), unit_price: Number(it.unit_price || 0) })) });
  const save = useMutation({ mutationFn: () => (editId ? api.put(`/contracts/${editId}`, body()) : api.post("/contracts", body())), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["contracts"] }); setEditId(r.data.id); toast.success("Sözleşme kaydedildi"); }, onError: (e) => toast.error(errMsg(e)) });
  const ensure = async () => { if (!f.title) { toast.error("İşin adını girin"); throw new Error("x"); } const r = await save.mutateAsync(); return r.data; };
  const excel = async () => { try { const c = await ensure(); await downloadFile(`/contracts/${c.id}/excel`, `sozlesme-${c.number}.xlsx`); } catch (e) { if (e.message !== "x") toast.error(errMsg(e)); } };
  const pdf = async () => { try { const c = await ensure(); await openPdf(`/pdf/contract/${c.id}`, `sozlesme-${c.number}.pdf`); } catch (e) { if (e.message !== "x") toast.error(errMsg(e)); } };
  const del = useMutation({ mutationFn: (id) => api.delete(`/contracts/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["contracts"] }); toast.success("Silindi"); }, onError: (e) => toast.error(errMsg(e)) });
  const setStatus = useMutation({ mutationFn: ({ id, status }) => api.patch(`/contracts/${id}/status`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ["contracts"] }) });
  const load = (c) => { setEditId(c.id); setF({ ...EMPTY, ...c, account_id: c.account_id || "", site_id: c.site_id || "", duration_days: c.duration_days || "", start_date: c.start_date || "", end_date: c.end_date || "" }); setItems(c.items.length ? c.items : [{ description: "", unit: "m2", quantity: "", unit_price: "" }]); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const reset = () => { setEditId(null); setF(EMPTY); setItems([{ description: "", unit: "m2", quantity: "", unit_price: "" }]); };

  return (
    <div data-testid="contracts-page">
      <PageHeader title="Sözleşme" subtitle="Birim fiyat cetveli, ödeme şartları ve teknik şartname ile Excel/PDF sözleşme hazırlayın." actions={editId && <GoldButton variant="outline" onClick={reset} data-testid="new-contract-button"><Plus className="w-4 h-4" /> Yeni sözleşme</GoldButton>} />
      <div className="gold-card p-5 md:p-8" data-testid="contract-document">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3"><img src="/logo.png" alt="Devrantaş" className="w-14 h-14 rounded-full" /><div><p className="font-serif text-2xl font-bold tracking-wide">DEVRANTAŞ</p><p className="text-[11px] text-charcoal-light tracking-wider">YAPI MİMARLIK İNŞAAT LTD. ŞTİ.</p></div></div>
          <p className="font-serif text-2xl md:text-3xl text-gold font-bold">SÖZLEŞME</p>
        </div>
        <div className="border-t-2 border-gold my-5" />
        <div className="flex gap-2 mb-4">{["musteri", "taseron"].map((t) => <Chip key={t} active={f.party_type === t} onClick={() => setF({ ...f, party_type: t, account_id: "" })} data-testid={`contract-party-${t}`}>{t === "musteri" ? "Müşteri Sözleşmesi" : "Taşeron Sözleşmesi"}</Chip>)}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={f.party_type === "musteri" ? "İşveren (Müşteri)" : "Yüklenici (Taşeron)"}><NSelect value={f.account_id} onChange={set("account_id")} data-testid="contract-account-select"><option value="">Seçin</option>{accounts.filter((a) => a.type === f.party_type).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NSelect></Field>
          <Field label="İşin Adı"><NInput value={f.title} onChange={set("title")} placeholder="ör. Villa kaba inşaat işleri" data-testid="contract-title-input" /></Field>
          {!f.account_id && <Field label="Taraf adı (listede yoksa)"><NInput value={f.party_name} onChange={set("party_name")} data-testid="contract-party-name-input" /></Field>}
          <Field label="Şantiye / Proje"><NSelect value={f.site_id} onChange={set("site_id")} data-testid="contract-site-select"><option value="">Seçin</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NSelect></Field>
          <Field label="Sözleşme Tarihi"><NInput type="date" value={f.date} onChange={set("date")} data-testid="contract-date-input" /></Field>
          <Field label="Süre (gün)"><NInput type="number" value={f.duration_days} onChange={set("duration_days")} data-testid="contract-duration-input" /></Field>
          <Field label="Başlangıç"><NInput type="date" value={f.start_date} onChange={set("start_date")} data-testid="contract-start-input" /></Field>
          <Field label="Bitiş"><NInput type="date" value={f.end_date} onChange={set("end_date")} data-testid="contract-end-input" /></Field>
        </div>
        <p className="font-semibold text-lg mt-6 mb-3 tracking-wide">BİRİM FİYAT CETVELİ</p>
        <ItemsEditor items={items} onChange={setItems} testId="contract-items" />
        <div className="ml-auto max-w-sm mt-5 space-y-2 text-base" data-testid="contract-totals">
          <div className="flex justify-between"><span>Ara toplam</span><Money value={calc.sub} /></div>
          <div className="flex justify-between items-center"><span className="flex items-center gap-2">KDV % <NInput type="number" value={f.vat_rate} onChange={set("vat_rate")} className="!w-20 !h-9" data-testid="contract-vat-input" /></span><Money value={calc.vat} /></div>
          <div className="flex justify-between items-center"><span className="flex items-center gap-2">Avans ₺ <NInput type="number" value={f.advance_amount} onChange={set("advance_amount")} className="!w-32 !h-9" data-testid="contract-advance-input" /></span><span className="text-xs text-charcoal-muted">%6 genel gider hakedişlerde kesilir</span></div>
          <div className="flex justify-between border-t-2 border-gold pt-2 text-xl font-semibold text-gold"><span>Sözleşme bedeli</span><Money value={calc.total} /></div>
        </div>
        <p className="font-semibold tracking-wide mt-6 mb-2">ÖDEME ŞARTLARI</p><NTextarea value={f.payment_terms} onChange={set("payment_terms")} className="!min-h-[70px]" data-testid="contract-payment-terms-input" />
        <p className="font-semibold tracking-wide mt-6 mb-2">SÖZLEŞME ŞARTLARI</p><NTextarea value={terms} onChange={set("terms")} className="!min-h-[170px]" data-testid="contract-terms-input" />
        <p className="font-semibold tracking-wide mt-6 mb-2">TEKNİK ŞARTNAME</p><NTextarea value={f.technical_spec} onChange={set("technical_spec")} placeholder="Malzeme standartları (C30 beton, S420 demir...), uygulama detayları, kabul kriterleri..." className="!min-h-[140px]" data-testid="contract-spec-input" />
        <p className="font-semibold tracking-wide mt-6 mb-2">NOTLAR</p><NTextarea value={f.notes} onChange={set("notes")} className="!min-h-[60px]" data-testid="contract-notes-input" />
        <div className="grid grid-cols-2 gap-8 mt-10 text-sm text-charcoal-light"><div className="border-t border-charcoal-muted pt-2 text-center">{f.party_type === "musteri" ? "İŞVEREN" : "YÜKLENİCİ (TAŞERON)"}<br />Kaşe / İmza</div><div className="border-t border-charcoal-muted pt-2 text-center">{f.party_type === "musteri" ? "YÜKLENİCİ" : "İŞVEREN"}<br />DEVRANTAŞ YAPI MİMARLIK<br />Kaşe / İmza</div></div>
        <div className="border-t border-gold-border mt-8 pt-5 text-center text-xs text-charcoal-light space-y-1"><p className="font-semibold text-charcoal text-sm">{COMPANY.name}</p><p>{COMPANY.address}</p><p>Tel: {COMPANY.phone} · E-posta: {COMPANY.email}</p></div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-5">
        <GoldButton variant="outline" onClick={pdf} data-testid="contract-pdf-button"><FileDown className="w-4 h-4" /> PDF</GoldButton>
        <GoldButton variant="outline" onClick={excel} data-testid="contract-excel-button"><FileDown className="w-4 h-4" /> Excel</GoldButton>
        <GoldButton onClick={() => ensure().catch(() => {})} disabled={save.isPending} data-testid="contract-save-button">{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Kaydet"}</GoldButton>
      </div>
      <div className="flex items-center justify-between mt-12 mb-4"><h2 className="font-serif text-3xl font-bold">Kayıtlı sözleşmeler</h2><button onClick={reset} className="text-gold text-sm font-medium" data-testid="saved-new-contract">+ Yeni sözleşme</button></div>
      {list.length === 0 ? <EmptyState title="Kayıtlı sözleşme yok" testId="contracts-empty" /> : (
        <div className="space-y-3" data-testid="contracts-list">
          {list.map((c) => (
            <div key={c.id} className="gold-card p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-testid={`contract-row-${c.id}`}>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => load(c)}><p className="font-semibold truncate">{c.number} · {c.title}</p><p className="text-xs text-charcoal-light">{c.party_name || "-"} · {STATUS_LABELS[c.party_type]} · {c.site_name || "-"} · {fmtDate(c.date)}</p></div>
              <div className="flex items-center gap-2 flex-wrap">
                <Money value={c.total} className="font-semibold text-gold" />
                <NSelect value={c.status} onChange={(e) => setStatus.mutate({ id: c.id, status: e.target.value })} className="!w-36 !h-9" data-testid={`contract-status-${c.id}`}>{Object.entries(CSTATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NSelect>
                <GoldButton size="sm" variant="outline" onClick={() => downloadFile(`/contracts/${c.id}/excel`, `sozlesme-${c.number}.xlsx`)} data-testid={`contract-row-excel-${c.id}`}>Excel</GoldButton>
                <GoldButton size="sm" variant="outline" onClick={() => openPdf(`/pdf/contract/${c.id}`, `sozlesme-${c.number}.pdf`)} data-testid={`contract-row-pdf-${c.id}`}>PDF</GoldButton>
                <button onClick={() => window.confirm("Silinsin mi?") && del.mutate(c.id)} className="p-2 rounded-full hover:bg-red-50 text-red-700" data-testid={`contract-delete-${c.id}`}><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
