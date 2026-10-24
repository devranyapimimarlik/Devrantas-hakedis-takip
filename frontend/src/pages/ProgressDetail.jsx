import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, openPdf, downloadFile } from "@/lib/api";
import { fmtTL, fmtDate, today, STATUS_LABELS } from "@/lib/format";
import { PageHeader, StatusBadge, Money, Field } from "@/components/shared/Bits";
import { GoldButton, Chip, NInput } from "@/components/shared/Inputs";
import { FileUpload } from "@/components/shared/FileUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { DocHeader } from "@/context/SettingsContext";
import { ArrowLeft, FileDown, Sparkles, Loader2, Trash2, Wallet } from "lucide-react";

export default function ProgressDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, isManager, can } = useAuth();
  const [payOpen, setPayOpen] = useState(false);
  const { data: h } = useQuery({ queryKey: ["progress", id], queryFn: () => api.get(`/progress-payments/${id}`).then((r) => r.data) });
  const { data: pays } = useQuery({ queryKey: ["progress-pays", id], queryFn: () => api.get(`/progress-payments/${id}/payments`).then((r) => r.data) });
  const inv = () => ["progress", "progress-pays", "accounts", "statement", "dashboard", "transactions", "pending-count", "checks", "reminders"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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
          {h.status !== "taslak" && <GoldButton onClick={() => setPayOpen(true)} data-testid="progress-pay-button"><Wallet className="w-4 h-4" /> {h.type === "taseron" ? "Ödeme Yap" : "Tahsilat Al"}</GoldButton>}
          {can("edit_progress") && h.status !== "odendi" && <GoldButton variant="outline" onClick={() => nav(`/hakedis/${h.id}/duzenle`)} data-testid="progress-edit-button"><Pencil className="w-4 h-4" /> Düzenle</GoldButton>}
          {isManager && <button onClick={() => window.confirm("Hakediş silinsin mi?") && del.mutate()} className="p-2 rounded-full hover:bg-red-50 text-red-700" data-testid="progress-delete-button"><Trash2 className="w-5 h-5" /></button>}
        </>} />
      <div className="gold-card p-5 md:p-8">
        <DocHeader title="HAKEDİŞ" /><div className="flex justify-end -mt-3 mb-3"><StatusBadge status={h.status} testId="progress-status" /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]" data-testid="progress-items-table">
            <thead><tr className="bg-gold-bg text-left"><th className="p-2 rounded-l-lg">#</th><th className="p-2">İşin cinsi</th><th className="p-2">Birim</th><th className="p-2 text-right">Miktar</th><th className="p-2 text-right">Birim fiyat</th><th className="p-2 text-right rounded-r-lg">Toplam</th></tr></thead>
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
      {pays && (
        <div className="gold-card p-5 md:p-6 mt-6" data-testid="progress-payments-card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-xl font-semibold">{h.type === "taseron" ? "Ödemeler" : "Tahsilatlar"}</h2>
            <div className="flex gap-4 text-sm"><span>Ödenen <Money value={pays.paid} className="font-semibold text-emerald-700" /></span>{pays.pending > 0 && <span>Onay bekleyen <Money value={pays.pending} className="font-semibold text-amber-700" /></span>}<span>Kalan <Money value={pays.remaining} className="font-semibold text-gold" data-testid="progress-remaining" /></span></div>
          </div>
          <div className="h-2 rounded-full bg-stone-100 mb-4"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, (pays.paid / (h.net_amount || 1)) * 100)}%` }} /></div>
          {pays.rows.length === 0 ? <p className="text-sm text-charcoal-muted">Henüz ödeme yok</p> : pays.rows.map((t) => (
            <div key={t.id} className="row-line" data-testid={`progress-pay-row-${t.id}`}><span>{fmtDate(t.date)} · {t.kasa === "cek" ? "Devrantaş Çek" : "Devrantaş Nakit"} · {t.description} <StatusBadge status={t.status} className="ml-1" /></span><Money value={t.amount} className="font-semibold" /></div>))}
        </div>
      )}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="font-serif text-2xl">{h.type === "taseron" ? "Taşerona Ödeme" : "Müşteriden Tahsilat"} — Hakediş No {h.number}</DialogTitle></DialogHeader>
          <PayForm h={h} remaining={pays?.remaining ?? h.net_amount} onDone={() => { setPayOpen(false); inv(); }} /></DialogContent>
      </Dialog>
    </div>
  );
}

function PayForm({ h, remaining, onDone }) {
  const half = Math.round(remaining / 2 * 100) / 100;
  const [f, setF] = useState({ date: today(), nakit_amount: remaining, cek_amount: 0, check_due_date: "", check_bank: "", check_no: "", description: "", attachment_file_id: null });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const total = Number(f.nakit_amount || 0) + Number(f.cek_amount || 0);
  const m = useMutation({
    mutationFn: () => api.post(`/progress-payments/${h.id}/pay`, { ...f, nakit_amount: Number(f.nakit_amount || 0), cek_amount: Number(f.cek_amount || 0), check_due_date: f.check_due_date || null }),
    onSuccess: (r) => { toast.success(h.type === "taseron" ? `${r.data.created.length} ödeme kaydı oluşturuldu — yönetici onayı bekliyor` : "Tahsilat kaydedildi"); onDone(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const preset = (nk, ck) => setF({ ...f, nakit_amount: nk, cek_amount: ck });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-4" data-testid="pay-form">
      <div className="flex flex-wrap gap-2">
        <Chip active={Number(f.cek_amount) === 0 && Number(f.nakit_amount) === remaining} onClick={() => preset(remaining, 0)} data-testid="pay-preset-nakit">Tamamı Nakit</Chip>
        <Chip active={Number(f.nakit_amount) === half && Number(f.cek_amount) === remaining - half} onClick={() => preset(half, Math.round((remaining - half) * 100) / 100)} data-testid="pay-preset-half">%50 Nakit / %50 Çek</Chip>
        <Chip active={Number(f.nakit_amount) === 0 && Number(f.cek_amount) === remaining} onClick={() => preset(0, remaining)} data-testid="pay-preset-cek">Tamamı Çek</Chip>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Devrantaş Nakit (₺)"><NInput type="number" step="0.01" min="0" value={f.nakit_amount} onChange={set("nakit_amount")} data-testid="pay-nakit-input" /></Field>
        <Field label="Devrantaş Çek (₺)"><NInput type="number" step="0.01" min="0" value={f.cek_amount} onChange={set("cek_amount")} data-testid="pay-cek-input" /></Field>
        <Field label="Tarih"><NInput type="date" value={f.date} onChange={set("date")} required data-testid="pay-date-input" /></Field>
        <div className="pt-6 text-sm">Toplam: <Money value={total} className="font-semibold" /> <span className="text-xs text-charcoal-muted">/ kalan {fmtTL(remaining)}</span></div>
      </div>
      {Number(f.cek_amount) > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gold-bg/60 border border-gold-border rounded-2xl p-3">
          <Field label="Çek Vade Tarihi"><NInput type="date" value={f.check_due_date} onChange={set("check_due_date")} required data-testid="pay-check-due-input" /></Field>
          <Field label="Banka"><NInput value={f.check_bank} onChange={set("check_bank")} data-testid="pay-check-bank-input" /></Field>
          <Field label="Çek No"><NInput value={f.check_no} onChange={set("check_no")} data-testid="pay-check-no-input" /></Field>
        </div>
      )}
      <Field label="Açıklama"><NInput value={f.description} onChange={set("description")} placeholder={`Hakediş No ${h.number} ${h.type === "taseron" ? "ödemesi" : "tahsilatı"}`} data-testid="pay-desc-input" /></Field>
      <FileUpload value={f.attachment_file_id} onChange={(id) => setF({ ...f, attachment_file_id: id })} label="Dekont / Çek Fotoğrafı" testId="pay-attachment" />
      <GoldButton type="submit" disabled={m.isPending || total <= 0} className="w-full" data-testid="pay-submit-button">{h.type === "taseron" ? "Ödemeyi Kaydet" : "Tahsilatı Kaydet"}</GoldButton>
    </form>
  );
}
