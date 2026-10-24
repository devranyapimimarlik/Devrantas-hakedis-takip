import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { STATUS_LABELS } from "@/lib/format";
import { GoldButton } from "@/components/shared/Inputs";
import { toast } from "sonner";
import { ShieldCheck, RotateCcw, Loader2 } from "lucide-react";

export function PermissionsMatrix() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["permissions"], queryFn: () => api.get("/auth/permissions").then((r) => r.data) });
  const [roles, setRoles] = useState(null);
  useEffect(() => { if (data) setRoles(data.roles); }, [data]);
  const save = useMutation({
    mutationFn: () => api.put("/auth/permissions", { roles }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["permissions"] }); toast.success("Yetkiler güncellendi — kullanıcılar bir sonraki yenilemede yeni yetkileri alır"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!data || !roles) return null;
  const roleKeys = Object.keys(data.defaults);
  const dirty = JSON.stringify(roles) !== JSON.stringify(data.roles);
  return (
    <div className="gold-card p-5 mt-8" data-testid="permissions-card">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-gold" /><h3 className="font-serif text-xl font-bold">Yetki Sınırları</h3></div>
        <div className="flex gap-2">
          <GoldButton variant="ghost" onClick={() => setRoles(data.defaults)} data-testid="permissions-reset"><RotateCcw className="w-4 h-4" /> Varsayılan</GoldButton>
          <GoldButton onClick={() => save.mutate()} disabled={!dirty || save.isPending} data-testid="permissions-save">{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Kaydet</GoldButton>
        </div>
      </div>
      <p className="text-xs text-charcoal-light mb-4">Muhasebe ve şantiye şefinin neleri düzenleyebileceğini buradan belirlersiniz. Yönetici her zaman tüm yetkilere sahiptir.</p>
      <div className="sm:hidden space-y-4" data-testid="permissions-mobile">
        {roleKeys.map((r) => (
          <div key={r} className="rounded-2xl border border-gold-border p-3">
            <p className="label-gold mb-2">{STATUS_LABELS[r] || r}</p>
            {Object.entries(data.labels).map(([k, label]) => (
              <label key={k} className="flex items-center justify-between gap-3 py-2 border-b border-stone-100 last:border-0 text-sm">
                <span>{label}</span>
                <input type="checkbox" className="w-5 h-5 accent-[rgb(var(--gold))]" checked={!!roles[r]?.[k]} onChange={(e) => setRoles({ ...roles, [r]: { ...roles[r], [k]: e.target.checked } })} data-testid={`perm-m-${r}-${k}`} />
              </label>))}
          </div>))}
      </div>
      <div className="hidden sm:block overflow-x-auto -mx-5 px-5">
        <table className="w-full text-sm min-w-[420px]">
          <thead><tr className="text-left label-gold border-b border-gold-border"><th className="py-2 pr-3">Yetki</th>{roleKeys.map((r) => <th key={r} className="py-2 px-3 text-center whitespace-nowrap">{STATUS_LABELS[r] || r}</th>)}</tr></thead>
          <tbody>
            {Object.entries(data.labels).map(([k, label]) => (
              <tr key={k} className="border-b border-stone-100 last:border-0">
                <td className="py-2.5 pr-3">{label}</td>
                {roleKeys.map((r) => (
                  <td key={r} className="py-2.5 px-3 text-center">
                    <input type="checkbox" className="w-5 h-5 accent-[rgb(var(--gold))]" checked={!!roles[r]?.[k]} onChange={(e) => setRoles({ ...roles, [r]: { ...roles[r], [k]: e.target.checked } })} data-testid={`perm-${r}-${k}`} />
                  </td>))}
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
