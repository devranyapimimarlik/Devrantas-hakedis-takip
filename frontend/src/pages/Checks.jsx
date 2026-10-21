import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { fmtTL, fmtDate, today, STATUS_LABELS } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState, Field, Money } from "@/components/shared/Bits";
import { NInput, NSelect, NTextarea, GoldButton, Chip } from "@/components/shared/Inputs";
import { FileUpload, AttachmentButton } from "@/components/shared/FileUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

function CheckForm({ onDone }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ direction: "alinan", account_id: "", site_id: "", bank: "", check_no: "", drawer: "", amount: "", issue_date: today(), due_date: "", image_file_id: null, notes: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts", "all"], queryFn: () => api.get("/accounts").then((r) => r.data) });
  const { data: sites = [] } = useQuery({ queryKey: ["sites"], queryFn: () => api.get("/sites").then((r) => r.data) });
  const m = useMutation({ mutationFn: (b) => api.post("/checks", b), onSuccess: () => { ["checks", "reminders", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Çek kaydedildi, 7/3/0 gün hatırlatıcıları oluşturuldu"); onDone(); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...f, amount: Number(f.amount), account_id: f.account_id || null, site_id: f.site_id || null }); }} className="space-y-4" data-testid="check-form">
      <div className="grid grid-cols-2 gap-2">{["alinan", "verilen"].map((d) => <Chip key={d} active={f.direction === d} onClick={() => setF({ ...f, direction: d })} className="w-full" data-testid={`check-direction-${d}`}>{d === "alinan" ? "Alınan Çek" : "Verilen Çek"}</Chip>)}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Tutar (₺)"><NInput type="number" step="0.01" value={f.amount} onChange={set("amount")} required data-testid="check-amount-input" /></Field>
        <Field label="Vade Tarihi"><NInput type="date" value={f.due_date} onChange={set("due_date")} required data-testid="check-due-input" /></Field>
        <Field label="Banka"><NInput value={f.bank} onChange={set("bank")} data-testid="check-bank-input" /></Field>
        <Field label="Çek No"><NInput value={f.check_no} onChange={set("check_no")} data-testid="check-no-input" /></Field>
        <Field label="Keşideci"><NInput value={f.drawer} onChange={set("drawer")} data-testid="check-drawer-input" /></Field>
        <Field label="Düzenleme Tarihi"><NInput type="date" value={f.issue_date} onChange={set("issue_date")} /></Field>
        <Field label="Cari"><NSelect value={f.account_id} onChange={set("account_id")} data-testid="check-account-select"><option value="">Yok</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({STATUS_LABELS[a.type]})</option>)}</NSelect></Field>
        <Field label="Şantiye"><NSelect value={f.site_id} onChange={set("site_id")} data-testid="check-site-select"><option value="">Yok</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NSelect></Field>
      </div>
      <FileUpload value={f.image_file_id} onChange={(id) => setF({ ...f, image_file_id: id })} label="Çek Fotoğrafı" testId="check-image" />
      <Field label="Not"><NTextarea value={f.notes} onChange={set("notes")} /></Field>
      <GoldButton type="submit" disabled={m.isPending} className="w-full" data-testid="check-submit-button">Çeki Kaydet</GoldButton>
    </form>
  );
}

export default function Checks() {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const [dir, setDir] = useState(sp.get("direction") || "tumu");
  const [open, setOpen] = useState(false);
  const [endorse, setEndorse] = useState(null);
  const { data = [], isLoading } = useQuery({ queryKey: ["checks"], queryFn: () => api.get("/checks").then((r) => r.data) });
  const inv = () => ["checks", "reminders", "dashboard", "accounts", "reports", "transactions", "pending-count", "progress"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const st = useMutation({ mutationFn: ({ id, status }) => api.patch(`/checks/${id}/status`, { status }), onSuccess: () => { inv(); toast.success("Durum güncellendi"); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id) => api.delete(`/checks/${id}`), onSuccess: () => { inv(); toast.success("Silindi"); } });
  const rows = data.filter((c) => dir === "tumu" || c.direction === dir);
  const port = (d) => data.filter((c) => c.direction === d && c.status === "portfoyde").reduce((s, c) => s + c.amount, 0);
  const urgency = (d) => (d < 0 ? "border-red-300 bg-red-50/60" : d === 0 ? "border-red-200" : d <= 3 ? "border-amber-300" : d <= 7 ? "border-gold" : "");
  return (
    <div data-testid="checks-page">
      <PageHeader title="Çekler" subtitle={`Portföy: Alınan ${fmtTL(port("alinan"))} · Verilen ${fmtTL(port("verilen"))}`} actions={<GoldButton onClick={() => setOpen(true)} data-testid="add-check-button"><Plus className="w-4 h-4" /> Çek Ekle</GoldButton>} />
      <div className="flex gap-2 mb-5">{[["tumu", "Tümü"], ["alinan", "Alınan"], ["verilen", "Verilen"]].map(([k, l]) => <Chip key={k} active={dir === k} onClick={() => setDir(k)} data-testid={`check-filter-${k}`}>{l}</Chip>)}</div>
      {isLoading ? <div className="h-40 animate-pulse bg-white/60 rounded-2xl" /> : rows.length === 0 ? <EmptyState title="Çek yok" testId="checks-empty" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="checks-list">
          {rows.map((c) => (
            <div key={c.id} className={`gold-card p-5 ${c.status === "portfoyde" ? urgency(c.days_left) : ""}`} data-testid={`check-card-${c.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="label-gold">{c.direction === "alinan" ? "Alınan Çek" : "Verilen Çek"} · {c.bank || "-"} {c.check_no}</p><p className="text-lg font-semibold mt-1">{c.account_name || c.drawer || "-"}</p><p className="text-xs text-charcoal-light">{c.site_name || "Şantiye yok"} · Vade {fmtDate(c.due_date)}</p></div>
                <div className="text-right"><Money value={c.amount} className="text-xl font-semibold text-gold" /><div className="mt-1"><StatusBadge status={c.status} /></div></div>
              </div>
              {c.status === "portfoyde" && <p className={`text-xs font-mono mt-2 ${c.days_left < 0 ? "text-red-700" : c.days_left <= 3 ? "text-amber-700" : "text-charcoal-light"}`} data-testid={`check-days-${c.id}`}>{c.days_left < 0 ? `${-c.days_left} gün gecikti` : c.days_left === 0 ? "BUGÜN vadesi" : `${c.days_left} gün kaldı`}</p>}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <AttachmentButton fileId={c.image_file_id} testId={`check-image-${c.id}`} />
                <div className="flex-1" />
                {c.status === "portfoyde" && <>
                  <GoldButton size="sm" onClick={() => st.mutate({ id: c.id, status: c.direction === "alinan" ? "tahsil_edildi" : "odendi" })} data-testid={`check-settle-${c.id}`}>{c.direction === "alinan" ? "Tahsil Edildi" : "Ödendi"}</GoldButton>
                  <GoldButton size="sm" variant="outline" onClick={() => st.mutate({ id: c.id, status: "karsiliksiz" })} data-testid={`check-bounce-${c.id}`}>Karşılıksız</GoldButton>
                  {c.direction === "alinan" && <GoldButton size="sm" variant="outline" onClick={() => setEndorse(c)} data-testid={`check-endorse-${c.id}`}>Ciro Et</GoldButton>}
                </>}
                {c.status === "ciro_edildi" && c.endorsed_to_name && <span className="text-xs text-charcoal-light">Ciro: {c.endorsed_to_name}</span>}
                <button onClick={() => window.confirm("Silinsin mi?") && del.mutate(c.id)} className="p-2 rounded-full hover:bg-red-50 text-charcoal-muted hover:text-red-700" data-testid={`check-delete-${c.id}`}><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="font-serif text-2xl">Çek Kaydı</DialogTitle></DialogHeader><CheckForm onDone={() => setOpen(false)} /></DialogContent></Dialog>
      {endorse && <EndorseDialog check={endorse} onClose={() => { setEndorse(null); inv(); }} />}
    </div>
  );
}

function EndorseDialog({ check, onClose }) {
  const [f, setF] = useState({ account_id: "", progress_payment_id: "", date: today(), description: "" });
  const { data: subs = [] } = useQuery({ queryKey: ["accounts", "taseron"], queryFn: () => api.get("/accounts", { params: { type: "taseron" } }).then((r) => r.data) });
  const { data: haks = [] } = useQuery({ queryKey: ["progress", "acc", f.account_id], queryFn: () => api.get("/progress-payments", { params: { account_id: f.account_id } }).then((r) => r.data.filter((h) => h.status === "onaylandi")), enabled: !!f.account_id });
  const m = useMutation({
    mutationFn: () => api.post(`/checks/${check.id}/endorse`, { ...f, progress_payment_id: f.progress_payment_id || null }),
    onSuccess: () => { toast.success("Çek ciro edildi — ödeme kaydı yönetici onayına düştü"); onClose(); }, onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg"><DialogHeader><DialogTitle className="font-serif text-2xl">Çeki Taşerona Ciro Et</DialogTitle></DialogHeader>
        <p className="text-sm text-charcoal-light -mt-2">{check.bank} {check.check_no} · <Money value={check.amount} className="font-semibold text-gold" /> · Vade {fmtDate(check.due_date)}</p>
        <form onSubmit={(e) => { e.preventDefault(); if (!f.account_id) return toast.error("Taşeron seçin"); m.mutate(); }} className="space-y-4" data-testid="endorse-form">
          <Field label="Taşeron"><NSelect value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value, progress_payment_id: "" })} required data-testid="endorse-account-select"><option value="">Seçin</option>{subs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NSelect></Field>
          <Field label="Bağlanacak Hakediş (isteğe bağlı)" hint="Seçilmezse taşeron avansı olarak işlenir"><NSelect value={f.progress_payment_id} onChange={(e) => setF({ ...f, progress_payment_id: e.target.value })} data-testid="endorse-progress-select"><option value="">Avans olarak kaydet</option>{haks.map((h) => <option key={h.id} value={h.id}>No {h.number} · {h.site_name} · {fmtTL(h.net_amount)}</option>)}</NSelect></Field>
          <Field label="Tarih"><NInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="endorse-date-input" /></Field>
          <Field label="Açıklama"><NInput value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <GoldButton type="submit" disabled={m.isPending} className="w-full" data-testid="endorse-submit-button">Ciro Et ve Ödeme Oluştur</GoldButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
