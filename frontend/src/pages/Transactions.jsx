import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { enqueue, isOffline, isNetworkError } from "@/lib/offline";
import { VoiceExpense } from "@/components/shared/VoiceExpense";
import { fmtTL, fmtDate, today, STATUS_LABELS } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState, Field, Money } from "@/components/shared/Bits";
import { NInput, NSelect, NTextarea, GoldButton, Chip } from "@/components/shared/Inputs";
import { FileUpload, AttachmentButton } from "@/components/shared/FileUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Check, X, Trash2, ShieldAlert, MessageCircle, Search } from "lucide-react";
import { useKasalar } from "@/lib/kasa";
import { WhatsAppImport } from "@/components/shared/WhatsAppImport";

export function TransactionForm({ defaults = {}, onDone, editTx = null }) {
  const qc = useQueryClient();
  const isEdit = !!editTx;
  const [f, setF] = useState({ type: "gider", category: "Malzeme", amount: "", date: today(), description: "", kasa: "", site_id: "", account_id: "", attachment_file_id: null, check_due_date: "", check_bank: "", check_no: "", ...defaults , ...(editTx ? { ...editTx, amount: String(editTx.amount), site_id: editTx.site_id || "", account_id: editTx.account_id || "", check_due_date: editTx.check_due_date || "", description: editTx.description || "" } : {}) });
  const [split, setSplit] = useState({ nakit: "", cek: "" });
  const [localFile, setLocalFile] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: cats } = useQuery({ queryKey: ["categories"], queryFn: () => api.get("/transactions/categories").then((r) => r.data) });
  const { data: sites = [] } = useQuery({ queryKey: ["sites"], queryFn: () => api.get("/sites").then((r) => r.data) });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts", "all"], queryFn: () => api.get("/accounts").then((r) => r.data) });
  const isSub = f.category.startsWith("Taşeron");
  const isIncome = f.type === "gelir";
  const accType = isIncome ? "musteri" : isSub ? "taseron" : null;
  const accOptions = accounts.filter((a) => (!accType || a.type === accType) && (a.is_active !== false || a.id === f.account_id));
  const SITE_GROUPS = [["devam", "Devam eden"], ["planlama", "Planlanan"], ["durduruldu", "Durdurulan"], ["tamamlandi", "Tamamlanan"]];
  const pickAccount = (e) => {
    const id = e.target.value, acc = accounts.find((a) => a.id === id);
    if (!isIncome && acc?.type === "taseron" && !isSub) { setF({ ...f, account_id: id, category: "Taşeron Avansı" }); toast.info("Taşerona ödeme avans olarak kaydedilir; şantiye giderine yansımaz, hakedişten düşülür"); }
    else setF({ ...f, account_id: id });
  };
  const withKeys = (list) => list.map((b) => ({ ...b, client_key: b.client_key || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }));
  const saveOffline = async (list) => {
    for (const b of list) await enqueue({ kind: "transaction", payload: b, file: localFile || null, fileName: localFile?.name });
    toast.info(`Çevrimdışı kaydedildi (${list.length}) — bağlantı gelince otomatik gönderilecek`);
    onDone?.();
  };
  const edit = useMutation({
    mutationFn: (body) => api.put(`/transactions/${editTx.id}`, body).then((r) => r.data),
    onSuccess: (d) => { ["transactions", "dashboard", "sites", "pending-count", "accounts", "site", "kasa", "reports", "reminders", "checks"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(d.status === "onay_bekliyor" && editTx.status === "onaylandi" ? "Düzeltildi — yeniden yönetici onayı bekliyor" : "İşlem düzeltildi"); onDone?.(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const m = useMutation({
    mutationFn: async (raw) => {
      const list = withKeys(raw);
      if (isOffline() || localFile) { await saveOffline(list); return null; }
      const pending = [...list];
      try { while (pending.length) { await api.post("/transactions", pending[0]); pending.shift(); } return list; }
      catch (e) { if (isNetworkError(e)) { await saveOffline(pending); return null; } throw e; }
    },
    onSuccess: (list) => { if (!list) return; ["transactions", "dashboard", "sites", "pending-count", "accounts", "site", "kasa", "reports", "reminders"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(list[0].type === "gider" ? "Ödeme kaydedildi — yönetici onayı bekliyor" : "Tahsilat kaydedildi"); onDone?.(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.kasa) return toast.error("Kasa seçimi zorunludur (Nakit / Çek)");
    if (isSub && !f.account_id) return toast.error("Taşeron seçin");
    if (isIncome && !f.account_id) return toast.error("Müşteri seçin");
    const base = { ...f, site_id: f.site_id || null, account_id: f.account_id || null, check_due_date: f.check_due_date || null };
    if (f.account_id && !isOffline()) {
      const amt = f.kasa === "karma" ? Number(split.nakit || 0) + Number(split.cek || 0) : Number(f.amount);
      try {
        const { data: d } = await api.get("/transactions/check-duplicate", { params: { amount: amt, date: f.date, account_id: f.account_id, type: f.type, exclude_id: editTx?.id } });
        if (d.duplicates?.length) {
          const list = d.duplicates.map((x) => `• ${fmtDate(x.date)} · ${fmtTL(x.amount)} · ${x.description || x.category} (${x.created_by_name || ""})`).join("\n");
          if (!window.confirm(`${d.warning}\n\n${list}\n\nYine de kaydedilsin mi?`)) return;
        }
      } catch { /* kontrol başarısızsa kayda engel olma */ }
    }
    if (isEdit) { const { id, type, status, created_by, created_by_name, created_at, approved_by, approved_by_name, approved_at, reject_reason, check_id, progress_payment_id, site_name, account_name, edit_log, edited_by, edited_by_name, edited_at, client_key, endorsed, ...body } = base; return edit.mutate({ ...body, amount: Number(f.amount), description: f.description || "" }); }
    if (f.kasa === "karma") {
      const n = Number(split.nakit || 0), c = Number(split.cek || 0);
      if (n <= 0 || c <= 0) return toast.error("Nakit ve çek tutarlarını girin");
      m.mutate([{ ...base, kasa: "nakit", amount: n, check_due_date: null }, { ...base, kasa: "cek", amount: c }]);
    } else m.mutate([{ ...base, amount: Number(f.amount) }]);
  };
  const hasCek = f.kasa === "cek" || f.kasa === "karma";
  return (
    <form onSubmit={submit} className="space-y-4 min-w-0 max-w-full overflow-x-hidden" data-testid="transaction-form">
      {!isEdit && <VoiceExpense onResult={(r) => setF((p) => ({ ...p, type: r.type || p.type, category: r.category || p.category, amount: r.amount != null ? String(r.amount) : p.amount, site_id: r.site_id || p.site_id, account_id: r.account_id || "", kasa: r.kasa || p.kasa, description: r.description || p.description }))} />}
      <div className={`grid grid-cols-2 gap-2 ${isEdit ? "hidden" : ""}`}>
        {["gider", "gelir"].map((t) => <Chip key={t} active={f.type === t} onClick={() => setF({ ...f, type: t, category: t === "gider" ? "Malzeme" : "Hakediş Tahsilatı", account_id: "" })} className="w-full" data-testid={`tx-type-${t}`}>{t === "gider" ? "Ödeme (Gider)" : "Tahsilat (Gelir)"}</Chip>)}
      </div>
      {!isIncome && <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2 flex items-center gap-2"><ShieldAlert className="w-4 h-4 shrink-0" /> Ödemeler yönetici onayı olmadan şantiye bakiyesine yansımaz.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Hangi Şantiye"><NSelect value={f.site_id} onChange={set("site_id")} data-testid="tx-site-select"><option value="">Genel (şantiye dışı)</option>
          {SITE_GROUPS.map(([st, label]) => { const g = sites.filter((s) => (s.status || "devam") === st); return g.length ? <optgroup key={st} label={label}>{g.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup> : null; })}</NSelect></Field>
        {!isIncome && <Field label="Ödeme Türü" hint={isSub ? "Taşeron avansı/ödemesi şantiye giderine yansımaz; hakediş onaylanınca gider yazılır, avans hakedişten düşülür." : undefined}><NSelect value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, account_id: "" })} data-testid="tx-category-select">{(cats?.gider || []).map((c) => <option key={c}>{c}</option>)}</NSelect></Field>}
        {isIncome && <Field label="Tahsilat Türü"><NSelect value={f.category} onChange={set("category")} data-testid="tx-category-select">{(cats?.gelir || []).map((c) => <option key={c}>{c}</option>)}</NSelect></Field>}
        <Field label={isIncome ? "Hangi Müşteri" : isSub ? "Hangi Taşeron" : "Cari / Tedarikçi (isteğe bağlı)"} hint={accType ? "Yalnızca aktif cariler listelenir" : undefined}>
          <NSelect value={f.account_id} onChange={pickAccount} data-testid="tx-account-select"><option value="">{accType ? "Seçin" : "Yok"}</option>{accOptions.map((a) => <option key={a.id} value={a.id}>{a.name}{!accType ? ` (${STATUS_LABELS[a.type]})` : ""}{a.is_active === false ? " (pasif)" : ""}</option>)}</NSelect>
        </Field>
        <Field label="Kasa (zorunlu)">
          <NSelect value={f.kasa} onChange={set("kasa")} required data-testid="tx-kasa-select">
            <option value="">Kasa seçin</option>{(cats?.kasa_list || [{ id: "nakit", name: "Devrantaş Nakit" }, { id: "cek", name: "Devrantaş Çek" }]).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            {!isIncome && !isEdit && <option value="karma">Karma (Nakit + Çek)</option>}
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
      <FileUpload value={f.attachment_file_id} onChange={(id) => setF({ ...f, attachment_file_id: id })} localFile={localFile} onLocalFile={setLocalFile} label={isIncome ? "Tahsilat Dekontu / Çek Fotoğrafı" : "Dekont / Fiş Fotoğrafı"} testId="tx-attachment" />
      <GoldButton type="submit" disabled={m.isPending} className="w-full" data-testid="tx-submit-button">{isEdit ? "Düzeltmeyi Kaydet" : isIncome ? "Tahsilatı Kaydet" : "Ödemeyi Kaydet"}</GoldButton>
    </form>
  );
}

export default function Transactions() {
  const qc = useQueryClient();
  const { user, isManager, can } = useAuth();
  const { kasaName } = useKasalar();
  const [sp, setSp] = useSearchParams();
  const [editTx, setEditTx] = useState(null);
  const [q, setQ] = useState("");
  const [waOpen, setWaOpen] = useState(!!sp.get("text"));
  const [waDefaults, setWaDefaults] = useState(null);
  const tab = sp.get("tab") || (sp.get("status") === "onay_bekliyor" ? "bekleyen" : "tumu");
  const [open, setOpen] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey: ["transactions"], queryFn: () => api.get("/transactions").then((r) => r.data) });
  const inv = () => ["transactions", "dashboard", "sites", "pending-count", "accounts", "site"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const approve = useMutation({ mutationFn: (id) => api.post(`/transactions/${id}/approve`), onSuccess: () => { inv(); toast.success("Gider onaylandı"); }, onError: (e) => toast.error(errMsg(e)) });
  const reject = useMutation({ mutationFn: ({ id, reason }) => api.post(`/transactions/${id}/reject`, { reason }), onSuccess: () => { inv(); toast.success("Gider reddedildi"); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id) => api.delete(`/transactions/${id}`), onSuccess: () => { inv(); toast.success("Silindi"); }, onError: (e) => toast.error(errMsg(e)) });

  const TABS = [["tumu", "Tümü"], ["bekleyen", "Onay Bekleyen"], ["gelir", "Gelirler"], ["gider", "Giderler"], ["onay", "Onay / Denetim Geçmişi"]];
  const norm = (s) => (s || "").toString().toLocaleLowerCase("tr");
  const nq = norm(q.trim());
  const matches = (t) => !nq || [t.description, t.category, t.site_name, t.account_name, t.created_by_name, kasaName(t.kasa), String(t.amount), fmtTL(t.amount), t.date].some((v) => norm(v).includes(nq));
  const rows = data.filter((t) => (tab === "tumu" || (tab === "bekleyen" && t.status === "onay_bekliyor") || (tab === "gelir" && t.type === "gelir") || (tab === "gider" && t.type === "gider") || (tab === "onay" && t.type === "gider" && t.status !== "onay_bekliyor")) && matches(t));
  const pending = data.filter((t) => t.status === "onay_bekliyor");
  const dupCount = rows.filter((t) => t.duplicate_of?.length).length;

  return (
    <div data-testid="transactions-page">
      <PageHeader title="Gelir / Gider" subtitle="Tüm giderler yönetici onayından geçer; onaylanmayan gider şantiye kâr/zararına yansımaz."
        actions={<><GoldButton variant="outline" onClick={() => setWaOpen(true)} data-testid="whatsapp-import-button"><MessageCircle className="w-4 h-4" /> WhatsApp'tan Al</GoldButton><GoldButton onClick={() => setOpen(true)} data-testid="add-transaction-button"><Plus className="w-4 h-4" /> Yeni İşlem</GoldButton></>} />
      {pending.length > 0 && isManager && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-center justify-between gap-3" data-testid="pending-banner">
          <p className="text-sm text-amber-900"><strong>{pending.length}</strong> gider onayınızı bekliyor · {fmtTL(pending.reduce((s, t) => s + t.amount, 0))}</p>
          <Chip active={tab === "bekleyen"} onClick={() => setSp({ tab: "bekleyen" })}>Onay Paneli</Chip>
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 md:mx-0 md:px-0">{TABS.map(([k, l]) => <Chip key={k} active={tab === k} onClick={() => setSp({ tab: k })} data-testid={`tx-tab-${k}`}>{l}{k === "bekleyen" && pending.length > 0 ? ` (${pending.length})` : ""}</Chip>)}</div>
      <div className="relative mb-5">
        <Search className="w-4 h-4 text-charcoal-muted absolute left-4 top-1/2 -translate-y-1/2" />
        <NInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: kişi, şantiye, tutar, açıklama… (ör. Ferdi, Ünalan, 50.000)" className="pl-11" data-testid="tx-search-input" />
        {q && <button onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-charcoal-muted hover:text-charcoal" data-testid="tx-search-clear">Temizle</button>}
      </div>
      {q && <p className="text-xs text-charcoal-light mb-3" data-testid="tx-search-count">{rows.length} kayıt · toplam {fmtTL(rows.reduce((s, t) => s + (t.type === "gider" ? t.amount : t.type === "gelir" ? t.amount : 0), 0))}</p>}
      {dupCount > 0 && isManager && <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2" data-testid="duplicate-banner"><ShieldAlert className="w-4 h-4 shrink-0" /><span><b>{dupCount}</b> kayıt olası mükerrer ödeme: aynı cariye aynı tutar 1 gün içinde tekrar girilmiş. Onaylamadan önce kontrol edin.</span></div>}
      {isLoading ? <div className="h-40 animate-pulse bg-white/60 rounded-2xl" /> : rows.length === 0 ? <EmptyState title={q ? "Aramayla eşleşen işlem yok" : "İşlem yok"} testId="transactions-empty" /> : (
        <div className="space-y-3" data-testid="transactions-list">
          {rows.map((t) => (
            <div key={t.id} className={`gold-card p-4 flex sm:items-center gap-3 ${t.duplicate_of?.length ? "border-red-300 bg-red-50/40" : ""}`} data-testid={`tx-row-${t.id}`}>
              <div className={`hidden sm:flex w-10 h-10 rounded-full items-center justify-center shrink-0 ${t.type === "gelir" ? "bg-emerald-50 text-emerald-700" : t.type === "virman" ? "bg-sky-50 text-sky-700" : "bg-red-50 text-red-700"}`}>{t.type === "gelir" ? "↙" : t.type === "virman" ? "⇄" : "↗"}</div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{t.description || t.category}</p>
                <p className="text-xs text-charcoal-light">{fmtDate(t.date)} · {t.category} · {t.site_name || "Genel"}{t.account_name ? ` · ${t.account_name}` : ""} · Kasa: {kasaName(t.kasa)}{t.source === "whatsapp" ? " · WhatsApp" : ""}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap"><StatusBadge status={t.status} testId={`tx-status-${t.id}`} /><AttachmentButton fileId={t.attachment_file_id} testId={`tx-attachment-${t.id}`} />
                  {t.duplicate_of?.length > 0 && <span className="text-[11px] font-semibold text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1" data-testid={`tx-duplicate-${t.id}`}><ShieldAlert className="w-3 h-3" /> Olası mükerrer ({t.duplicate_of.length})</span>}
                  {t.approved_by_name && t.type === "gider" && <span className="text-[11px] text-charcoal-muted">{t.status === "reddedildi" ? "Reddeden" : "Onaylayan"}: {t.approved_by_name}{t.reject_reason ? ` — ${t.reject_reason}` : ""}</span>}
                  <span className="text-[11px] text-charcoal-muted">Ekleyen: {t.created_by_name}</span></div>
              </div>
              <div className="flex flex-col items-end sm:flex-row sm:items-center gap-2 shrink-0">
                <Money value={t.type === "gider" ? -t.amount : t.amount} signed className="text-base sm:text-lg font-semibold whitespace-nowrap" />
                {t.status === "onay_bekliyor" && can("approve_expenses") && (
                  <div className="flex flex-col sm:flex-row gap-1">
                    <button onClick={() => approve.mutate(t.id)} className="h-9 px-3 rounded-full bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1 hover:bg-emerald-700" data-testid={`approve-expense-${t.id}`}><Check className="w-3.5 h-3.5" /> Onayla</button>
                    <button onClick={() => { const r = window.prompt("Red nedeni (isteğe bağlı):") ?? null; if (r !== null) reject.mutate({ id: t.id, reason: r }); }} className="h-9 px-3 rounded-full bg-white border border-red-200 text-red-700 text-xs font-semibold inline-flex items-center gap-1 hover:bg-red-50" data-testid={`reject-expense-${t.id}`}><X className="w-3.5 h-3.5" /> Reddet</button>
                  </div>
                )}
                {can("edit_transactions") && !t.endorsed && t.type !== "virman" && <button onClick={() => setEditTx(t)} className="p-2 rounded-full hover:bg-gold-bg text-charcoal-muted hover:text-gold" title="Düzelt" data-testid={`edit-tx-${t.id}`}><Pencil className="w-4 h-4" /></button>}
                {(can("delete_transactions") || (t.status !== "onaylandi" && t.created_by === user?.id)) && <button onClick={() => window.confirm("Silinsin mi?") && del.mutate(t.id)} className="p-2 rounded-full hover:bg-red-50 text-charcoal-muted hover:text-red-700" data-testid={`delete-tx-${t.id}`}><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl w-[calc(100vw-1rem)] sm:w-full max-h-[90vh] overflow-y-auto overflow-x-hidden"><DialogHeader><DialogTitle className="font-serif text-2xl">Yeni Gelir / Gider</DialogTitle></DialogHeader><TransactionForm onDone={() => setOpen(false)} /></DialogContent>
      </Dialog>
      <Dialog open={waOpen} onOpenChange={(o) => { setWaOpen(o); if (!o && sp.get("text")) setSp({}); }}>
        <DialogContent className="max-w-xl w-[calc(100vw-1rem)] sm:w-full max-h-[90vh] overflow-y-auto overflow-x-hidden" data-testid="whatsapp-dialog"><DialogHeader><DialogTitle className="font-serif text-2xl">WhatsApp'tan Kayıt Al</DialogTitle></DialogHeader>
          <WhatsAppImport initialText={sp.get("text") || ""} onParsed={(r) => { setWaDefaults({ type: r.type, category: r.category || "Diğer", amount: r.amount != null ? String(r.amount) : "", date: r.date, kasa: r.kasa || "", site_id: r.site_id || "", account_id: r.account_id || "", description: r.description || `WhatsApp: ${r.raw_fields?.odeme || ""}`.trim() }); setWaOpen(false); if (sp.get("text")) setSp({}); }} />
        </DialogContent>
      </Dialog>
      <Dialog open={!!waDefaults} onOpenChange={(o) => !o && setWaDefaults(null)}>
        <DialogContent className="max-w-xl w-[calc(100vw-1rem)] sm:w-full max-h-[90vh] overflow-y-auto overflow-x-hidden" data-testid="whatsapp-form-dialog"><DialogHeader><DialogTitle className="font-serif text-2xl">Kontrol Et ve Onayla</DialogTitle></DialogHeader>
          <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mb-3">WhatsApp mesajından dolduruldu. Alanları kontrol edin, dekontu ekleyin ve kaydedin.</p>
          {waDefaults && <TransactionForm key="wa" defaults={waDefaults} onDone={() => setWaDefaults(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!editTx} onOpenChange={(o) => !o && setEditTx(null)}>
        <DialogContent className="max-w-xl w-[calc(100vw-1rem)] sm:w-full max-h-[90vh] overflow-y-auto overflow-x-hidden" data-testid="edit-tx-dialog"><DialogHeader><DialogTitle className="font-serif text-2xl">{editTx?.type === "gelir" ? "Tahsilatı Düzelt" : "Gideri Düzelt"}</DialogTitle></DialogHeader>
          {editTx && <>
            {editTx.type === "gider" && editTx.status === "onaylandi" && !isManager && <p className="text-xs text-amber-800 bg-amber-50 rounded-xl px-3 py-2 mb-3">Tutar, kasa, kategori veya şantiye değişirse gider yeniden yönetici onayına düşer.</p>}
            {editTx.edit_log?.length > 0 && <p className="text-[11px] text-charcoal-light mb-3" data-testid="edit-tx-history">Son düzeltme: {editTx.edited_by_name} · {new Date(editTx.edited_at).toLocaleString("tr-TR")}</p>}
            <TransactionForm key={editTx.id} editTx={editTx} onDone={() => setEditTx(null)} />
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
