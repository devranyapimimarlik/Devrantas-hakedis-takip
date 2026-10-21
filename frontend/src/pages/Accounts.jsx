import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { fmtTL } from "@/lib/format";
import { PageHeader, EmptyState, Field, Money } from "@/components/shared/Bits";
import { NInput, NSelect, NTextarea, GoldButton } from "@/components/shared/Inputs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ChevronRight } from "lucide-react";

const EMPTY = { name: "", phone: "", email: "", tax_no: "", address: "", specialty: "", notes: "" };

export function AccountForm({ type, initial, onDone }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ ...EMPTY, ...(initial || {}) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: (b) => (initial?.id ? api.put(`/accounts/${initial.id}`, b) : api.post("/accounts", b)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Cari kaydedildi"); onDone?.(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate({ ...f, type, site_ids: initial?.site_ids || [] }); }} className="space-y-4" data-testid="account-form">
      <Field label={type === "musteri" ? "Müşteri Adı / Ünvan" : "Taşeron Adı / Ünvan"}><NInput value={f.name} onChange={set("name")} required data-testid="account-name-input" /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Telefon"><NInput value={f.phone} onChange={set("phone")} data-testid="account-phone-input" /></Field>
        <Field label="E-posta"><NInput type="email" value={f.email} onChange={set("email")} data-testid="account-email-input" /></Field>
        <Field label="Vergi No / TCKN"><NInput value={f.tax_no} onChange={set("tax_no")} data-testid="account-tax-input" /></Field>
        {type === "taseron" && <Field label="Uzmanlık (Kalıp, Sıva, Elektrik...)"><NInput value={f.specialty} onChange={set("specialty")} data-testid="account-specialty-input" /></Field>}
      </div>
      <Field label="Adres"><NInput value={f.address} onChange={set("address")} data-testid="account-address-input" /></Field>
      <Field label="Not"><NTextarea value={f.notes} onChange={set("notes")} /></Field>
      <GoldButton type="submit" disabled={m.isPending} className="w-full" data-testid="account-submit-button">{initial?.id ? "Güncelle" : "Kaydet"}</GoldButton>
    </form>
  );
}

function AssignDialog({ account, onClose }) {
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState("");
  const { data: sites = [] } = useQuery({ queryKey: ["sites"], queryFn: () => api.get("/sites").then((r) => r.data) });
  const m = useMutation({
    mutationFn: () => api.post(`/accounts/${account.id}/assign-site`, { site_id: siteId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Şantiye atandı"); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent><DialogHeader><DialogTitle className="font-serif text-2xl">Şantiye Ata — {account.name}</DialogTitle></DialogHeader>
        <Field label="Şantiye"><NSelect value={siteId} onChange={(e) => setSiteId(e.target.value)} data-testid="assign-site-select"><option value="">Seçiniz</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NSelect></Field>
        <GoldButton disabled={!siteId || m.isPending} onClick={() => m.mutate()} data-testid="assign-site-submit">Ata</GoldButton>
      </DialogContent>
    </Dialog>
  );
}

export default function Accounts({ type }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const params = useParams();
  const t = type || params.type;
  const isCust = t === "musteri";
  const [dlg, setDlg] = useState(null); // {mode:'new'|'edit'|'assign', account}
  const { data = [], isLoading } = useQuery({ queryKey: ["accounts", t], queryFn: () => api.get("/accounts", { params: { type: t } }).then((r) => r.data) });
  const del = useMutation({ mutationFn: (id) => api.delete(`/accounts/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Silindi"); } });
  const total = data.reduce((s, a) => s + a.balance, 0);

  return (
    <div data-testid={`accounts-page-${t}`}>
      <GoldButton size="lg" className="w-full mb-6 lg:hidden" onClick={() => setDlg({ mode: "new" })} data-testid="add-account-button-top"><Plus className="w-5 h-5" /> {isCust ? "Müşteri Ekle" : "Atama Yap / Taşeron Ekle"}</GoldButton>
      <PageHeader title={isCust ? "Müşteriler" : "Taşeronlar"} subtitle={`${data.length} kayıt · Toplam bakiye ${fmtTL(total)}`}
        actions={<GoldButton onClick={() => setDlg({ mode: "new" })} data-testid="add-account-button"><Plus className="w-4 h-4" /> Ekle</GoldButton>} />
      {isLoading ? <div className="h-40 animate-pulse bg-white/60 rounded-2xl" /> : data.length === 0 ? <EmptyState title={isCust ? "Müşteri yok" : "Taşeron yok"} testId="accounts-empty" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="accounts-list">
          {data.map((a, i) => (
            <div key={a.id} className="gold-card p-5 fade-up" style={{ animationDelay: `${i * 40}ms` }} data-testid={`account-card-${a.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h3 className="text-xl font-semibold text-charcoal truncate">{a.name}</h3><p className="text-sm text-charcoal-light">{a.phone || a.specialty || a.email || "-"}</p></div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setDlg({ mode: "edit", account: a })} className="p-2 rounded-full hover:bg-gold-bg" data-testid={`edit-account-${a.id}`}><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => window.confirm("Silinsin mi?") && del.mutate(a.id)} className="p-2 rounded-full hover:bg-red-50 text-red-700" data-testid={`delete-account-${a.id}`}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(a.site_names || []).map((n) => <span key={n} className="gold-badge !normal-case !tracking-normal !font-sans">{n}</span>)}
                <span className={`text-xs font-mono px-2.5 py-0.5 rounded-full border ${a.balance > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>Bakiye <Money value={a.balance} /></span>
              </div>
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <Link to={`/cari/${t}/${a.id}`} className="text-gold font-medium text-sm inline-flex items-center gap-1 mr-auto" data-testid={`statement-link-${a.id}`}>Cari ekstre <ChevronRight className="w-4 h-4" /></Link>
                <GoldButton variant="outline" size="sm" onClick={() => setDlg({ mode: "assign", account: a })} data-testid={`assign-site-${a.id}`}>+ Şantiye ata</GoldButton>
                <GoldButton size="sm" onClick={() => nav(`/hakedis/yeni?account_id=${a.id}&type=${t}`)} data-testid={`new-progress-${a.id}`}>+ Hakediş</GoldButton>
              </div>
            </div>
          ))}
        </div>
      )}
      {dlg && dlg.mode !== "assign" && (
        <Dialog open onOpenChange={() => setDlg(null)}>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="font-serif text-2xl">{dlg.mode === "new" ? (isCust ? "Yeni Müşteri" : "Yeni Taşeron") : "Düzenle"}</DialogTitle></DialogHeader>
            <AccountForm type={t} initial={dlg.account} onDone={() => setDlg(null)} /></DialogContent>
        </Dialog>
      )}
      {dlg?.mode === "assign" && <AssignDialog account={dlg.account} onClose={() => setDlg(null)} />}
    </div>
  );
}
