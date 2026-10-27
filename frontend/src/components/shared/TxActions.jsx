import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { TransactionForm } from "@/pages/Transactions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const KEYS = ["transactions", "dashboard", "sites", "site", "pending-count", "accounts", "statement", "kasa", "reports", "reminders", "checks"];

export function TxActions({ tx, size = "sm" }) {
  const qc = useQueryClient();
  const { user, can } = useAuth();
  const [edit, setEdit] = useState(false);
  const inv = () => KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const del = useMutation({ mutationFn: () => api.delete(`/transactions/${tx.id}`), onSuccess: () => { inv(); toast.success("Silindi"); }, onError: (e) => toast.error(errMsg(e)) });
  const canEdit = can("edit_transactions") && !tx.endorsed;
  const canDel = can("delete_transactions") || (tx.status !== "onaylandi" && tx.created_by === user?.id);
  if (!canEdit && !canDel) return null;
  const cls = size === "sm" ? "p-1.5" : "p-2";
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      {canEdit && <button type="button" onClick={() => setEdit(true)} className={`${cls} rounded-full hover:bg-gold-bg text-charcoal-muted hover:text-gold`} title="Düzelt" data-testid={`edit-tx-${tx.id}`}><Pencil className="w-3.5 h-3.5" /></button>}
      {canDel && <button type="button" onClick={() => window.confirm("Bu kayıt silinsin mi?") && del.mutate()} className={`${cls} rounded-full hover:bg-red-50 text-charcoal-muted hover:text-red-700`} title="Sil" data-testid={`delete-tx-${tx.id}`}><Trash2 className="w-3.5 h-3.5" /></button>}
      <Dialog open={edit} onOpenChange={setEdit}>
        <DialogContent className="max-w-xl w-[calc(100vw-1rem)] sm:w-full max-h-[90vh] overflow-y-auto overflow-x-hidden" data-testid="edit-tx-dialog">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{tx.type === "gelir" ? "Tahsilatı Düzelt" : "Ödemeyi Düzelt"}</DialogTitle></DialogHeader>
          <TransactionForm key={tx.id} editTx={tx} onDone={() => { setEdit(false); inv(); }} />
        </DialogContent>
      </Dialog>
    </span>
  );
}
