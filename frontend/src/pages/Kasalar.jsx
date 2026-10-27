import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Wallet, Banknote, Landmark, PiggyBank, Check, X } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { fmtTL } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Field } from "@/components/shared/Bits";
import { NInput, NSelect, GoldButton } from "@/components/shared/Inputs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const KIND = { nakit: ["Nakit", Wallet], cek: ["Çek", Banknote], banka: ["Banka", Landmark], fon: ["Fon / Ayrılan Pay", PiggyBank] };

export default function Kasalar() {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [f, setF] = useState({ name: "", kind: "banka" });
  const { data = [], isLoading } = useQuery({ queryKey: ["kasalar"], queryFn: () => api.get("/kasalar").then((r) => r.data) });
  const inv = () => ["kasalar", "dashboard", "reports", "categories"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const create = useMutation({ mutationFn: () => api.post("/kasalar", f), onSuccess: () => { inv(); setOpen(false); setF({ name: "", kind: "banka" }); toast.success("Kasa eklendi"); }, onError: (e) => toast.error(errMsg(e)) });
  const rename = useMutation({ mutationFn: (k) => api.put(`/kasalar/${k.id}`, { name: k.name, kind: k.kind }), onSuccess: () => { inv(); setEdit(null); toast.success("Kasa güncellendi"); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id) => api.delete(`/kasalar/${id}`), onSuccess: () => { inv(); toast.success("Kasa silindi"); }, onError: (e) => toast.error(errMsg(e)) });
  const total = data.reduce((s, k) => s + k.balance, 0);
  return (
    <div data-testid="kasalar-page">
      <PageHeader eyebrow="Kasa Yönetimi" title="Kasalar" subtitle={`Toplam ${fmtTL(total)} · Ödeme ve tahsilatlarda bu kasalar seçilir. Genel Gider Kasası, onaylanan müşteri hakedişlerinin KDV hariç tutarından %6 alır.`}
        actions={isManager && <GoldButton onClick={() => setOpen(true)} data-testid="add-kasa-button"><Plus className="w-4 h-4" /> Kasa Ekle</GoldButton>} />
      {isLoading ? <div className="h-40 animate-pulse bg-white/60 rounded-2xl" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="kasalar-list">
          {data.map((k) => { const [label, Icon] = KIND[k.kind] || KIND.banka; const editing = edit?.id === k.id; return (
            <div key={k.id} className="gold-card p-5" data-testid={`kasa-card-${k.id}`}>
              <div className="flex items-start gap-3">
                <Icon className="w-8 h-8 text-gold shrink-0" />
                <div className="flex-1 min-w-0">
                  {editing ? <div className="flex gap-2"><NInput value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid={`kasa-edit-input-${k.id}`} /><NSelect value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} className="w-32">{Object.entries(KIND).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}</NSelect></div>
                    : <><p className="text-lg font-semibold truncate">{k.name}</p><p className="text-xs text-charcoal-light">{label}{k.system ? " · sistem kasası" : ""}</p></>}
                  <p className={`money text-2xl font-semibold mt-2 ${k.balance < 0 ? "text-red-700" : "text-charcoal"}`} data-testid={`kasa-balance-${k.id}`}>{fmtTL(k.balance)}</p>
                </div>
                {isManager && <div className="flex gap-1 shrink-0">
                  {editing ? <><button onClick={() => rename.mutate(edit)} className="p-2 rounded-full hover:bg-emerald-50 text-emerald-700" data-testid={`kasa-save-${k.id}`}><Check className="w-4 h-4" /></button><button onClick={() => setEdit(null)} className="p-2 rounded-full hover:bg-stone-100"><X className="w-4 h-4" /></button></>
                    : <><button onClick={() => setEdit({ id: k.id, name: k.name, kind: k.kind || "banka" })} className="p-2 rounded-full hover:bg-gold-bg" data-testid={`kasa-edit-${k.id}`}><Pencil className="w-4 h-4" /></button>
                      {!k.system && <button onClick={() => window.confirm("Kasa silinsin mi?") && del.mutate(k.id)} className="p-2 rounded-full hover:bg-red-50 text-red-700" data-testid={`kasa-delete-${k.id}`}><Trash2 className="w-4 h-4" /></button>}</>}
                </div>}
              </div>
            </div>); })}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="font-serif text-2xl">Yeni Kasa</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4" data-testid="kasa-form">
            <Field label="Kasa Adı"><NInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="ör. Ziraat Bankası, Yedek Akçe" data-testid="kasa-name-input" /></Field>
            <Field label="Tür"><NSelect value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} data-testid="kasa-kind-select">{Object.entries(KIND).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}</NSelect></Field>
            <GoldButton type="submit" className="w-full" disabled={create.isPending} data-testid="kasa-submit-button">Kasa Oluştur</GoldButton>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
