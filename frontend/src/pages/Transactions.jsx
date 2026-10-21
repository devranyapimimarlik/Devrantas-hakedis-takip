import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { fmtTL, fmtDate, today, STATUS_LABELS } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState, Field, Money } from "@/components/shared/Bits";
import { NInput, NSelect, NTextarea, GoldButton, Chip } from "@/components/shared/Inputs";
import { FileUpload, AttachmentButton } from "@/components/shared/FileUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Check, X, Trash2, ShieldAlert } from "lucide-react";

export function TransactionForm({ defaults = {}, onDone }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ type: "gider", category: "Malzeme", amount: "", date: today(), description: "", kasa: "", site_id: "", account_id: "", attachment_file_id: null, check_due_date: "", check_bank: "", check_no: "", ...defaults });
  const [split, setSplit] = useState({ nakit: "", cek: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => api.get("/transactions/categories").then((r) => r.data) });
  const { data: sites = [] } = useQuery({ queryKey: ["sites"], queryFn: () => api.get("/sites").then((r) => r.data) });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts", "all"], queryFn: () => api.get("/accounts").then((r) => r.data) });
  const isSub = f.category.startsWith("Taşeron");
  const isIncome = f.type === "gelir";
  const accType = isIncome ? "musteri" : isSub ? "taseron" : null;
  const m = useMutation({
    mutationFn: async (list) => { for (const b of list) await api.post("/transactions", b); return list; },
    onSuccess: (list) => { ["transactions", "dashboard", "sites", "pending-count", "accounts", "site", "kasa", "reports", "reminders"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(list[0].type === "gider" ? "Ödeme kaydedildi — yönetici onayı bekliyor" : "Tahsilat kaydedildi"); onDone?.(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = (e) => {
    e.preventDefault();
    if (!f.kasa) return toast.error("Kasa seçimi zorunludur (Nakit / Çek)");
    if (isSub && !f.account_id) return toast.error("Taşeron seçin");
    if (isIncome && !f.account_id) return toast.error("Müşteri seçin");
    const base = { ...f, site_id: f.site_id || null, account_id: f.account_id || null, check_due_date: f.check_due_date || null };
    if (f.kasa === "karma") {
      const n = Number(split.nakit || 0), c = Number(split.cek || 0);
      if (n <= 0 || c <= 0) return toast.error("Nakit ve çek tutarlarını girin");
      m.mutate([{ ...base, kasa: "nakit", amount: n, check_due_date: null }, { ...base, kasa: "cek", amount: c }]);
    } else m.mutate([{ ...base, amount: Number(f.amount) }]);
  };
  const hasCek = f.kasa === "cek" || f.kasa === "karma";
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="transaction-form">
      <div className="grid grid-cols-2 gap-2">
        {["gider", "gelir"].map((t) => <Chip key={t} active={f.type === t} onClick={() => setF({ ...f, type: t, category: t === "gider" ? "Malzeme" : "Hakediş Tahsilatı", account_id: "" })} className="w-full" data-testid={`tx-type-${t}`}>{t === "gider" ? "Ödeme (Gider)" : "Tahsilat (Gelir)"}</Chip>)}
      </div>
      {!isIncome && <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 flex items-center gap-2"><ShieldAlert className="w-4 h-4 shrink-0" /> Ödemeler yönetici onayı olmadan şantiye bakiyesine yansımaz.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Hangi Şantiye"><NSelect value={f.site_id} onChange={set("site_id")} data-testid="tx-site-select"><option value="">Genel (şantiye dışı)</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NSelect></Field>
        {!isIncome && <Field label="Ödeme Türü"><NSelect value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, account_id: "" })} data-testid="tx-category-select">{(cats?.gider || []).map((c) => <option key={c}>{c}</option>)}</NSelect></Field>}
        {isIncome && <Field label="Tahsilat Türü"><NSelect value={f.category} onChange={set("category")} data-testid="tx-category-select">{(cats?.gelir || []).map((c) => <option key={c}>{c}</option>)}</NSelect></Field>}
        <Field label={isIncome ? "Hangi Müşteri" : isSub ? "Hangi Taşeron" : "Cari / Tedarikçi (isteğe bağlı)"}>
          <NSelect value={f.account_id} onChange={set("account_id")} data-testid="tx-account-select"><option value="">{accType ? "Seçin" : "Yok"}</option>{accounts.filter((a) => !accType || a.type === accType).map((a) => <option key={a.id} value={a.id}>{a.name}{!accType ? ` (${STATUS_LABELS[a.type]})` : ""}</option>)}</NSelect>
        </Field>
        <Field label="Kasa (zorunlu)">
          <NSelect value={f.kasa} onChange={set("kasa")} required data-testid="tx-kasa-select">
            <option value="">Kasa seçin</option><option value="nakit">Devrantaş Nakit</option><option value="cek">Devrantaş Çek</option>
            {!isIncome && <option value="karma">Karma (Nakit + Çek)</option>}
          </NSelect>
        </Field>
        {f.kasa === "karma" ? (<>
          <Field label="Nakit Tutar (₺)"><NInput type="number" step="0.01" min="0" value={split.nakit} onChange={(e) => setSplit({ ...split, nakit: e.target.value })} data-testid="tx-split-nakit-input" /></Field>
          <Field label="Çek Tutar (₺)" hint={`Toplam: ${fmtTL(Number(split.nakit || 0) + Number(split.cek || 0))}`}><NInput type="number" step="0.01" min="0" value={split.cek} onChange={(e) => setSplit({ ...split, cek: e.target.value })} data-testid="tx-split-cek-input" /></Field>
        </>) : <Field label="Tutar (₺)"><NInput type="number" step="0.01" min="0" value={f.amount} onChange={set("amount")} required data-testid="tx-amount-input" /></Field>}
        <Field label="Tarih"><NInput type="date" value={f.date} onChange={set("date")} required data-testid="tx-date-input" /></Field>
      </div>
      {hasCek && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gold-bg/60 border border-gold-border rounded-2xl p-3">
          <Field label="Çek Vade Tarihi" hint="Girilirse çek kaydı ve 7/3/0 gün hatırlatıcı oluşur"><NInput type="date" value={f.check_due_date} onChange={set("check_due_date")} data-testid="tx-check-due-input" /></Field>
          <Field label="Banka"><NInput value={f.check_bank} onChange={set("check_bank")} data-testid="tx-check-bank-input" /></Field>
          <Field label="Çek No"><NInput value={f.check_no} onChange={set("check_no")} data-testid="tx-check-no-input" /></Field>
        </div>
      )}
      <Field label="Açıklama"><NTextarea value={f.description} onChange={set("description")} placeholder={isSub ? "ör. Hakediş No 2 ödemesi" : "Açıklama"} data-testid="tx-desc-input" /></Field>
      <FileUpload value={f.attachment_file_id} onChange={(id) => setF({ ...f, attachment_file_id: id })} label={isIncome ? "Tahsilat Dekontu / Çek Fotoğrafı" : "Dekont / Fiş Fotoğrafı"} testId="tx-attachment" />
      <GoldButton type="submit" disabled={m.isPending} className="w-full" data-testid="tx-submit-button">{isIncome ? "Tahsilatı Kaydet" : "Ödemeyi Kaydet"}</GoldButton>
    </form>
  );
}

export default function Transactions() {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || (sp.get("status") === "onay_bekliyor" ? "bekleyen" : "tumu");
  const [open, setOpen] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey: ["transactions"], queryFn: () => api.get("/transactions").then((r) => r.data) });
  const inv = () => ["transactions", "dashboard", "sites", "pending-count", "accounts", "site"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const approve = useMutation({ mutationFn: (id) => api.post(`/transactions/${id}/approve`), onSuccess: () => { inv(); toast.success("Gider onaylandı"); }, onError: (e) => toast.error(errMsg(e)) });
  const reject = useMutation({ mutationFn: ({ id, reason }) => api.post(`/transactions/${id}/reject`, { reason }), onSuccess: () => { inv(); toast.success("Gider reddedildi"); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id) => api.delete(`/transactions/${id}`), onSuccess: () => { inv(); toast.success("Silindi"); }, onError: (e) => toast.error(errMsg(e)) });

  const TABS = [["tumu", "Tümü"], ["bekleyen", "Onay Bekleyen"], ["gelir", "Gelirler"], ["gider", "Giderler"], ["onay", "Onay / Denetim Geçmişi"]];
  const rows = data.filter((t) => tab === "tumu" || (tab === "bekleyen" && t.status === "onay_bekliyor") || (tab === "gelir" && t.type === "gelir") || (tab === "gider" && t.type === "gider") || (tab === "onay" && t.type === "gider" && t.status !== "onay_bekliyor"));
  const pending = data.filter((t) => t.status === "onay_bekliyor");

  return (
    <div data-testid="transactions-page">
      <PageHeader title="Gelir / Gider" subtitle="Tüm giderler yönetici onayından geçer; onaylanmayan gider şantiye kâr/zararına yansımaz."
        actions={<GoldButton onClick={() => setOpen(true)} data-testid="add-transaction-button"><Plus className="w-4 h-4" /> Yeni İşlem</GoldButton>} />
      {pending.length > 0 && isManager && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-center justify-between gap-3" data-testid="pending-banner">
          <p className="text-sm text-amber-900"><strong>{pending.length}</strong> gider onayınızı bekliyor · {fmtTL(pending.reduce((s, t) => s + t.amount, 0))}</p>
          <Chip active={tab === "bekleyen"} onClick={() => setSp({ tab: "bekleyen" })}>Onay Paneli</Chip>
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-4 px-4 md:mx-0 md:px-0">{TABS.map(([k, l]) => <Chip key={k} active={tab === k} onClick={() => setSp({ tab: k })} data-testid={`tx-tab-${k}`}>{l}{k === "bekleyen" && pending.length > 0 ? ` (${pending.length})` : ""}</Chip>)}</div>
      {isLoading ? <div className="h-40 animate-pulse bg-white/60 rounded-2xl" /> : rows.length === 0 ? <EmptyState title="İşlem yok" testId="transactions-empty" /> : (
        <div className="space-y-3" data-testid="transactions-list">
          {rows.map((t) => (
            <div key={t.id} className="gold-card p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-testid={`tx-row-${t.id}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${t.type === "gelir" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{t.type === "gelir" ? "↙" : "↗"}</div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{t.description || t.category}</p>
                <p className="text-xs text-charcoal-light">{fmtDate(t.date)} · {t.category} · {t.site_name || "Genel"}{t.account_name ? ` · ${t.account_name}` : ""} · Kasa: {t.kasa === "cek" ? "Devrantaş Çek" : "Devrantaş Nakit"}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap"><StatusBadge status={t.status} testId={`tx-status-${t.id}`} /><AttachmentButton fileId={t.attachment_file_id} testId={`tx-attachment-${t.id}`} />
                  {t.approved_by_name && t.type === "gider" && <span className="text-[11px] text-charcoal-muted">{t.status === "reddedildi" ? "Reddeden" : "Onaylayan"}: {t.approved_by_name}{t.reject_reason ? ` — ${t.reject_reason}` : ""}</span>}
                  <span className="text-[11px] text-charcoal-muted">Ekleyen: {t.created_by_name}</span></div>
              </div>
              <div className="flex items-center gap-2 justify-between sm:justify-end">
                <Money value={t.type === "gider" ? -t.amount : t.amount} signed className="text-lg font-semibold" />
                {t.status === "onay_bekliyor" && isManager && (
                  <div className="flex gap-1">
                    <button onClick={() => approve.mutate(t.id)} className="h-9 px-3 rounded-full bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1 hover:bg-emerald-700" data-testid={`approve-expense-${t.id}`}><Check className="w-3.5 h-3.5" /> Onayla</button>
                    <button onClick={() => { const r = window.prompt("Red nedeni (isteğe bağlı):") ?? null; if (r !== null) reject.mutate({ id: t.id, reason: r }); }} className="h-9 px-3 rounded-full bg-white border border-red-200 text-red-700 text-xs font-semibold inline-flex items-center gap-1 hover:bg-red-50" data-testid={`reject-expense-${t.id}`}><X className="w-3.5 h-3.5" /> Reddet</button>
                  </div>
                )}
                {(t.status !== "onaylandi" || isManager) && <button onClick={() => window.confirm("Silinsin mi?") && del.mutate(t.id)} className="p-2 rounded-full hover:bg-red-50 text-charcoal-muted hover:text-red-700" data-testid={`delete-tx-${t.id}`}><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="font-serif text-2xl">Yeni Gelir / Gider</DialogTitle></DialogHeader><TransactionForm onDone={() => setOpen(false)} /></DialogContent>
      </Dialog>
    </div>
  );
}
