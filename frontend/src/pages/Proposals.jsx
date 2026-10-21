import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg, openPdf } from "@/lib/api";
import { fmtTL, fmtDate, today, STATUS_LABELS } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState, Field, Money } from "@/components/shared/Bits";
import { NInput, NSelect, NTextarea, GoldButton } from "@/components/shared/Inputs";
import { ItemsEditor } from "@/pages/ProgressPayments";
import { toast } from "sonner";
import { DocHeader, DocFooter } from "@/context/SettingsContext";
import { Sparkles, Loader2, Trash2, Plus } from "lucide-react";

const COMPANY = { name: "Devrantaş Yapı Mimarlık İnşaat Ltd. Şti.", address: "Nurtanesi Sok. No: 3/1, Merkez Mah., Çekmeköy, İstanbul", phone: "0533 482 57 02", email: "Devrantasyapimimarlik@gmail.com" };
const DEFAULT_NOTES = "• Fiyatlarımıza KDV dahil değildir.\n• Ödeme: hakediş usulü, aylık.\n• Malzeme ve işçilik dahildir; aksi belirtilmedikçe iskele hariçtir.";
const EMPTY = { account_id: "", customer_name: "", title: "", project_type: "", location: "", area_m2: "", date: today(), vat_rate: 20, discount: 0, validity_days: 15, intro_text: "Firmamızdan talep etmiş olduğunuz işlere ait fiyat teklifimiz aşağıda bilgilerinize sunulmuştur.", notes: DEFAULT_NOTES, ai_text: "" };

export default function Proposals() {
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [items, setItems] = useState([{ description: "", unit: "m2", quantity: "", unit_price: "" }]);
  const [editId, setEditId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: customers = [] } = useQuery({ queryKey: ["accounts", "musteri"], queryFn: () => api.get("/accounts", { params: { type: "musteri" } }).then((r) => r.data) });
  const { data: list = [] } = useQuery({ queryKey: ["proposals"], queryFn: () => api.get("/proposals").then((r) => r.data) });
  const nextNo = useMemo(() => String(list.length + 1), [list]);
  useEffect(() => { if (f.account_id) { const c = customers.find((x) => x.id === f.account_id); if (c) setF((p) => ({ ...p, customer_name: c.name })); } }, [f.account_id, customers]);

  const calc = useMemo(() => {
    const sub = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
    const base = sub - Number(f.discount || 0);
    const vat = base * Number(f.vat_rate || 0) / 100;
    return { sub, base, vat, total: base + vat };
  }, [items, f.discount, f.vat_rate]);

  const body = () => ({ ...f, account_id: f.account_id || null, area_m2: Number(f.area_m2 || 0), vat_rate: Number(f.vat_rate), discount: Number(f.discount || 0), validity_days: Number(f.validity_days || 15),
    items: items.filter((it) => it.description).map((it) => ({ ...it, quantity: Number(it.quantity || 0), unit_price: Number(it.unit_price || 0) })) });
  const save = useMutation({
    mutationFn: () => (editId ? api.put(`/proposals/${editId}`, body()) : api.post("/proposals", body())),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["proposals"] }); setEditId(r.data.id); setSavedId(r.data.id); toast.success("Teklif kaydedildi"); return r.data.id; },
    onError: (e) => toast.error(errMsg(e)),
  });
  const ensureSaved = async () => { if (!f.title) { toast.error("Proje / iş adı girin"); throw new Error("x"); } const r = await save.mutateAsync(); return r.data.id; };
  const aiText = useMutation({
    mutationFn: () => api.post("/ai/proposal-text", { ...f, area_m2: Number(f.area_m2 || 0), items: items.filter((it) => it.description) }),
    onSuccess: (r) => { setF((p) => ({ ...p, ai_text: r.data.text })); toast.success("Teklif metni oluşturuldu"); }, onError: (e) => toast.error(errMsg(e)),
  });
  const aiCost = useMutation({
    mutationFn: () => api.post("/ai/cost-estimate", { ...f, area_m2: Number(f.area_m2 || 0), details: f.ai_text }),
    onSuccess: (r) => { setItems(r.data.items.map((i) => ({ description: i.description, unit: i.unit || "m2", quantity: i.quantity, unit_price: i.unit_price }))); toast.success("Maliyet tahmini kalemlere eklendi"); }, onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({ mutationFn: (id) => api.delete(`/proposals/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["proposals"] }); toast.success("Silindi"); } });
  const setStatus = useMutation({ mutationFn: ({ id, status }) => api.patch(`/proposals/${id}/status`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }) });

  const pdf = async () => { try { const id = await ensureSaved(); await openPdf(`/pdf/proposal/${id}`, `teklif-${nextNo}.pdf`); } catch (e) { if (e.message !== "x") toast.error(errMsg(e)); } };
  const sharePdf = async () => {
    try {
      const id = await ensureSaved();
      const res = await api.get(`/pdf/proposal/${id}`, { responseType: "blob" });
      const file = new File([res.data], `teklif-${nextNo}.pdf`, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `Teklif ${nextNo}`, text: "Devrantaş Yapı Mimarlık fiyat teklifi" });
      else { await openPdf(`/pdf/proposal/${id}`, file.name); toast.info("Paylaşım desteklenmiyor, PDF indirildi"); }
    } catch (e) { if (e.message !== "x" && e.name !== "AbortError") toast.error(errMsg(e)); }
  };
  const excel = async () => { try { const id = await ensureSaved(); const res = await api.get(`/proposals/${id}/excel`, { responseType: "blob" }); const url = URL.createObjectURL(res.data); const a = document.createElement("a"); a.href = url; a.download = `teklif-${nextNo}.xlsx`; a.click(); URL.revokeObjectURL(url); } catch (e) { if (e.message !== "x") toast.error(errMsg(e)); } };
  const whatsapp = () => {
    const lines = items.filter((i) => i.description).map((i) => `• ${i.description}: ${i.quantity} ${i.unit} × ${fmtTL(i.unit_price)}`).join("\n");
    const txt = `*DEVRANTAŞ YAPI MİMARLIK - FİYAT TEKLİFİ*\nSayın ${f.customer_name || ""}\nProje: ${f.title}\n\n${lines}\n\nAra toplam: ${fmtTL(calc.sub)}\nKDV %${f.vat_rate}: ${fmtTL(calc.vat)}\n*Genel toplam: ${fmtTL(calc.total)}*\n\n${f.notes}\nGeçerlilik: ${f.validity_days} gün\n${COMPANY.phone}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank");
  };
  const load = (p) => { setEditId(p.id); setF({ ...EMPTY, ...p, account_id: p.account_id || "", area_m2: p.area_m2 || "" }); setItems(p.items.length ? p.items : [{ description: "", unit: "m2", quantity: "", unit_price: "" }]); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const reset = () => { setEditId(null); setSavedId(null); setF(EMPTY); setItems([{ description: "", unit: "m2", quantity: "", unit_price: "" }]); };

  return (
    <div data-testid="proposals-page">
      <PageHeader title="Teklif Hazırla" subtitle="Belge görünümünde doldurun; PDF, Excel veya WhatsApp ile paylaşın." actions={editId && <GoldButton variant="outline" onClick={reset} data-testid="new-proposal-button"><Plus className="w-4 h-4" /> Yeni teklif</GoldButton>} />
      <div className="gold-card p-5 md:p-8" data-testid="proposal-document">
        <DocHeader title="FİYAT TEKLİFİ" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Sayın (müşteri)"><NSelect value={f.account_id} onChange={set("account_id")} data-testid="proposal-customer-select"><option value="">Seçin</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NSelect></Field>
          <Field label="Proje / iş"><NInput placeholder="ör. Çayırdağı Sok. mantolama" value={f.title} onChange={set("title")} data-testid="proposal-title-input" /></Field>
          {!f.account_id && <Field label="Müşteri adı (listede yoksa)"><NInput value={f.customer_name} onChange={set("customer_name")} data-testid="proposal-customer-name-input" /></Field>}
          <Field label="Teklif no"><NInput value={editId ? (list.find((p) => p.id === editId)?.number || nextNo) : nextNo} readOnly data-testid="proposal-number" /></Field>
          <Field label="Tarih"><NInput type="date" value={f.date} onChange={set("date")} data-testid="proposal-date-input" /></Field>
          <Field label="Proje türü"><NInput placeholder="Villa, mantolama, tadilat..." value={f.project_type} onChange={set("project_type")} data-testid="proposal-type-input" /></Field>
          <Field label="Alan (m²)"><NInput type="number" value={f.area_m2} onChange={set("area_m2")} data-testid="proposal-area-input" /></Field>
          <Field label="Konum"><NInput value={f.location} onChange={set("location")} data-testid="proposal-location-input" /></Field>
        </div>
        <NTextarea value={f.intro_text} onChange={set("intro_text")} className="mt-4 !min-h-[60px]" data-testid="proposal-intro-input" />
        <div className="flex flex-wrap gap-2 mt-4">
          <GoldButton variant="outline" size="sm" onClick={() => aiCost.mutate()} disabled={aiCost.isPending || !f.title} data-testid="ai-cost-button">{aiCost.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} AI Maliyet Tahmini (kalemleri doldur)</GoldButton>
          <GoldButton variant="outline" size="sm" onClick={() => aiText.mutate()} disabled={aiText.isPending || !f.title} data-testid="ai-text-button">{aiText.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} AI Teklif Metni</GoldButton>
        </div>
        <p className="font-semibold text-lg mt-6 mb-3 tracking-wide">TEKLİF KALEMLERİ</p>
        <ItemsEditor items={items} onChange={setItems} testId="proposal-items" />
        <div className="ml-auto max-w-sm mt-5 space-y-2 text-base" data-testid="proposal-totals">
          <div className="flex justify-between"><span>Ara toplam</span><Money value={calc.sub} /></div>
          <div className="flex justify-between items-center"><span className="flex items-center gap-2">KDV % <NInput type="number" value={f.vat_rate} onChange={set("vat_rate")} className="!w-20 !h-9" data-testid="proposal-vat-input" /></span><Money value={calc.vat} /></div>
          <div className="flex justify-between items-center"><span className="flex items-center gap-2">İskonto ₺ <NInput type="number" value={f.discount} onChange={set("discount")} className="!w-28 !h-9" data-testid="proposal-discount-input" /></span><span className="money">−{fmtTL(f.discount)}</span></div>
          <div className="flex justify-between border-t-2 border-gold pt-2 text-xl font-semibold text-gold"><span>Genel toplam</span><Money value={calc.total} /></div>
        </div>
        {f.ai_text && <div className="mt-6"><p className="font-semibold tracking-wide mb-2">TEKLİF METNİ (AI)</p><NTextarea value={f.ai_text} onChange={set("ai_text")} className="!min-h-[200px]" data-testid="proposal-ai-text" /></div>}
        <p className="font-semibold tracking-wide mt-6 mb-2">ŞARTLAR VE NOTLAR</p>
        <NTextarea value={f.notes} onChange={set("notes")} className="!min-h-[110px] rounded-2xl" data-testid="proposal-notes-input" />
        <p className="mt-4 text-sm flex items-center gap-2">Teklif geçerlilik süresi: <NInput type="number" value={f.validity_days} onChange={set("validity_days")} className="!w-20 !h-9" data-testid="proposal-validity-input" /> gündür.</p>
        <div className="grid grid-cols-2 gap-8 mt-10 text-sm text-charcoal-light"><div className="border-t border-charcoal-muted pt-2 text-center">Müşteri onayı</div><div className="border-t border-charcoal-muted pt-2 text-center">DEVRANTAŞ YAPI MİMARLIK<br />Kaşe / İmza</div></div>
        <DocFooter />
      </div>
      <div className="grid grid-cols-3 gap-3 mt-5">
        <GoldButton variant="outline" onClick={pdf} data-testid="proposal-pdf-button">Yazdır / PDF</GoldButton>
        <GoldButton variant="outline" onClick={whatsapp} data-testid="proposal-whatsapp-button">WhatsApp</GoldButton>
        <GoldButton onClick={() => ensureSaved().catch(() => {})} disabled={save.isPending} data-testid="proposal-save-button">{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Kaydet"}</GoldButton>
        <GoldButton variant="outline" onClick={sharePdf} data-testid="proposal-share-pdf-button">PDF paylaş</GoldButton>
        <GoldButton variant="outline" onClick={excel} className="col-span-2" data-testid="proposal-excel-button">Excel paylaş</GoldButton>
      </div>
      <p className="text-center text-xs text-charcoal-muted mt-2">Paylaş menüsünden WhatsApp'ı seçin.</p>

      <div className="flex items-center justify-between mt-12 mb-4"><h2 className="font-serif text-3xl font-bold">Kayıtlı teklifler</h2><button onClick={reset} className="text-gold text-sm font-medium" data-testid="saved-new-proposal">+ Yeni teklif</button></div>
      {list.length === 0 ? <EmptyState title="Kayıtlı teklif yok" testId="proposals-empty" /> : (
        <div className="space-y-3" data-testid="proposals-list">
          {list.map((p) => (
            <div key={p.id} className={`gold-card p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${savedId === p.id ? "ring-2 ring-gold/40" : ""}`} data-testid={`proposal-row-${p.id}`}>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => load(p)}><p className="font-semibold truncate">#{p.number} · {p.title}</p><p className="text-xs text-charcoal-light">{p.customer_name || "-"} · {fmtDate(p.date)} · {p.items.length} kalem</p></div>
              <div className="flex items-center gap-2 flex-wrap">
                <Money value={p.total} className="font-semibold text-gold" />
                <NSelect value={p.status} onChange={(e) => setStatus.mutate({ id: p.id, status: e.target.value })} className="!w-36 !h-9" data-testid={`proposal-status-${p.id}`}>{["taslak", "gonderildi", "kabul", "red"].map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</NSelect>
                <GoldButton size="sm" variant="outline" onClick={() => openPdf(`/pdf/proposal/${p.id}`, `teklif-${p.number}.pdf`)} data-testid={`proposal-row-pdf-${p.id}`}>PDF</GoldButton>
                <button onClick={() => window.confirm("Silinsin mi?") && del.mutate(p.id)} className="p-2 rounded-full hover:bg-red-50 text-red-700" data-testid={`proposal-delete-${p.id}`}><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
