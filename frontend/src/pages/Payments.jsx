import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { fmtTL, fmtDate, today, STATUS_LABELS } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState, Field, Money } from "@/components/shared/Bits";
import { NInput, NSelect, NTextarea, GoldButton } from "@/components/shared/Inputs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Check, AlertTriangle, Clock, CalendarClock, BellOff } from "lucide-react";

export function ReminderBanners({ compact = false }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["reminders"], queryFn: () => api.get("/reminders").then((r) => r.data) });
  const dismiss = useMutation({ mutationFn: (id) => api.patch(`/reminders/${id}/dismiss`), onSuccess: () => qc.invalidateQueries({ queryKey: ["reminders"] }) });
  if (!data || data.total === 0) return compact ? null : <EmptyState title="Yaklaşan ödeme yok" desc="7 gün, 3 gün ve vade günü uyarıları burada görünür." testId="reminders-empty" />;
  const groups = [
    ["overdue", "Vadesi Geçti", "bg-red-50 border-red-300 text-red-900", AlertTriangle],
    ["today", "BUGÜN Vadesi Dolan", "bg-red-50 border-red-200 text-red-800", AlertTriangle],
    ["three_days", "3 Gün İçinde", "bg-amber-50 border-amber-300 text-amber-900", Clock],
    ["seven_days", "7 Gün İçinde", "bg-gold-bg border-gold-border text-gold-dark", CalendarClock],
  ];
  return (
    <div className="space-y-3 mb-8" data-testid="reminder-banners">
      {groups.map(([k, label, cls, Icon]) => data[k]?.length > 0 && (
        <div key={k} className={`rounded-2xl border px-4 py-3 ${cls}`} data-testid={`reminder-group-${k}`}>
          <p className="text-xs font-mono uppercase tracking-widest font-bold flex items-center gap-2 mb-2"><Icon className="w-4 h-4" />{label} ({data[k].length})</p>
          <ul className="space-y-1.5">{data[k].slice(0, compact ? 4 : 50).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 text-sm" data-testid={`reminder-${r.id}`}>
              <span className="min-w-0 truncate"><span className="font-semibold">{STATUS_LABELS[r.source_type] || r.source_type}:</span> {r.title} · {fmtDate(r.due_date)}</span>
              <span className="flex items-center gap-2 shrink-0"><Money value={r.amount} className="font-semibold" /><button onClick={() => dismiss.mutate(r.id)} title="Kapat" className="p-1 rounded-full hover:bg-white/60" data-testid={`dismiss-reminder-${r.id}`}><BellOff className="w-3.5 h-3.5" /></button></span>
            </li>))}</ul>
        </div>
      ))}
    </div>
  );
}

function PaymentForm({ onDone }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ type: "kira", title: "", amount: "", due_date: today(), site_id: "", notes: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: sites = [] } = useQuery({ queryKey: ["sites"], queryFn: () => api.get("/sites").then((r) => r.data) });
  const m = useMutation({ mutationFn: (b) => api.post("/payments", b), onSuccess: () => { ["payments", "reminders"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success("Ödeme planlandı, hatırlatıcılar oluşturuldu"); onDone(); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...f, amount: Number(f.amount), site_id: f.site_id || null }); }} className="space-y-4" data-testid="payment-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Tür"><NSelect value={f.type} onChange={set("type")} data-testid="payment-type-select"><option value="kira">Kira</option><option value="kredi_karti">Kredi Kartı</option><option value="kredi">Banka Kredisi</option><option value="diger">Diğer (SSK, vergi...)</option></NSelect></Field>
        <Field label="Başlık"><NInput value={f.title} onChange={set("title")} required placeholder="ör. Ofis kirası - Haziran" data-testid="payment-title-input" /></Field>
        <Field label="Tutar (₺)"><NInput type="number" step="0.01" value={f.amount} onChange={set("amount")} required data-testid="payment-amount-input" /></Field>
        <Field label="Vade Tarihi"><NInput type="date" value={f.due_date} onChange={set("due_date")} required data-testid="payment-due-input" /></Field>
        <Field label="Şantiye (isteğe bağlı)" className="sm:col-span-2"><NSelect value={f.site_id} onChange={set("site_id")}><option value="">Genel</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NSelect></Field>
      </div>
      <Field label="Not"><NTextarea value={f.notes} onChange={set("notes")} /></Field>
      <GoldButton type="submit" disabled={m.isPending} className="w-full" data-testid="payment-submit-button">Planla</GoldButton>
    </form>
  );
}

export default function Payments() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({ queryKey: ["payments"], queryFn: () => api.get("/payments").then((r) => r.data) });
  const inv = () => ["payments", "reminders"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const pay = useMutation({ mutationFn: (id) => api.patch(`/payments/${id}/paid`), onSuccess: () => { inv(); toast.success("Ödendi olarak işaretlendi"); } });
  const del = useMutation({ mutationFn: (id) => api.delete(`/payments/${id}`), onSuccess: () => { inv(); toast.success("Silindi"); } });
  const pending = data.filter((p) => p.status === "bekliyor");
  const paid = data.filter((p) => p.status === "odendi");
  return (
    <div data-testid="payments-page">
      <PageHeader title="Ödeme Takvimi" subtitle={`Kira, kredi kartı, kredi ve çek vadeleri · Bekleyen ${fmtTL(pending.reduce((s, p) => s + p.amount, 0))}`} actions={<GoldButton onClick={() => setOpen(true)} data-testid="add-payment-button"><Plus className="w-4 h-4" /> Sabit Gider Planla</GoldButton>} />
      <ReminderBanners />
      <h2 className="text-xl font-semibold mb-3">Planlanan Ödemeler</h2>
      {pending.length === 0 ? <EmptyState title="Planlanan ödeme yok" testId="payments-empty" /> : (
        <div className="space-y-3 mb-8" data-testid="payments-list">
          {pending.map((p) => (
            <div key={p.id} className={`gold-card p-4 flex items-center gap-3 ${p.days_left <= 0 ? "border-red-300" : p.days_left <= 3 ? "border-amber-300" : p.days_left <= 7 ? "border-gold" : ""}`} data-testid={`payment-row-${p.id}`}>
              <div className="flex-1 min-w-0"><p className="font-semibold truncate">{p.title}</p><p className="text-xs text-charcoal-light">{STATUS_LABELS[p.type]} · Vade {fmtDate(p.due_date)} · <span className={p.days_left <= 3 ? "text-red-700 font-semibold" : ""}>{p.days_left < 0 ? `${-p.days_left} gün gecikti` : p.days_left === 0 ? "BUGÜN" : `${p.days_left} gün kaldı`}</span></p></div>
              <Money value={p.amount} className="font-semibold text-lg" />
              <button onClick={() => pay.mutate(p.id)} className="h-9 px-3 rounded-full bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1" data-testid={`pay-payment-${p.id}`}><Check className="w-3.5 h-3.5" /> Ödendi</button>
              <button onClick={() => del.mutate(p.id)} className="p-2 rounded-full hover:bg-red-50 text-charcoal-muted hover:text-red-700" data-testid={`delete-payment-${p.id}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
      {paid.length > 0 && <><h2 className="text-xl font-semibold mb-3">Ödenenler</h2><div className="space-y-2">{paid.map((p) => <div key={p.id} className="soft-card p-3 flex items-center gap-3 text-sm opacity-70"><span className="flex-1 truncate">{p.title} · {fmtDate(p.due_date)}</span><StatusBadge status="odendi" /><Money value={p.amount} /></div>)}</div></>}
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle className="font-serif text-2xl">Sabit Gider / Ödeme Planla</DialogTitle></DialogHeader><PaymentForm onDone={() => setOpen(false)} /></DialogContent></Dialog>
    </div>
  );
}
