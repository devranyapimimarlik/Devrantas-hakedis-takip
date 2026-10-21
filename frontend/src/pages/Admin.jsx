import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { STATUS_LABELS, fmtDate } from "@/lib/format";
import { PageHeader, Field } from "@/components/shared/Bits";
import { NInput, NSelect, GoldButton } from "@/components/shared/Inputs";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";

export function Users() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [f, setF] = useState({ name: "", email: "", password: "", role: "muhasebe" });
  const { data = [] } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/auth/users").then((r) => r.data) });
  const inv = () => qc.invalidateQueries({ queryKey: ["users"] });
  const role = useMutation({ mutationFn: ({ id, role }) => api.patch(`/auth/users/${id}/role`, { role }), onSuccess: () => { inv(); toast.success("Yetki güncellendi"); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id) => api.delete(`/auth/users/${id}`), onSuccess: () => { inv(); toast.success("Kullanıcı silindi"); }, onError: (e) => toast.error(errMsg(e)) });
  const add = useMutation({ mutationFn: () => api.post("/auth/register-sub", f), onSuccess: () => { inv(); setF({ name: "", email: "", password: "", role: "muhasebe" }); toast.success("Kullanıcı eklendi"); }, onError: (e) => toast.error(errMsg(e)) });
  const cleanup = useMutation({ mutationFn: () => api.post("/admin/cleanup-test-data"), onSuccess: (r) => { qc.invalidateQueries(); toast.success(`Test verileri temizlendi: ${r.data.total} kayıt silindi`); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <div data-testid="users-page">
      <PageHeader title="Kullanıcılar ve Yetkiler" subtitle="Yönetici: tüm yetkiler + gider onayı · Muhasebe: hakediş durumu · Şantiye Şefi: kayıt girişi"
        actions={<GoldButton variant="danger" onClick={() => window.confirm("TEST_ önekli tüm deneme kayıtları (şantiye, cari, işlem, hakediş, çek, teklif, sözleşme, test kullanıcıları) kalıcı olarak silinecek. Devam edilsin mi?") && cleanup.mutate()} disabled={cleanup.isPending} data-testid="cleanup-test-data-button"><Trash2 className="w-4 h-4" /> Test Verilerini Temizle</GoldButton>} />
      <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} className="gold-card p-5 grid grid-cols-1 sm:grid-cols-5 gap-3 mb-6 items-end" data-testid="add-user-form">
        <Field label="Ad Soyad"><NInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="user-name-input" /></Field>
        <Field label="E-posta"><NInput type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required data-testid="user-email-input" /></Field>
        <Field label="Şifre"><NInput type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required data-testid="user-password-input" /></Field>
        <Field label="Rol"><NSelect value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} data-testid="user-role-select"><option value="muhasebe">Muhasebe</option><option value="santiye_sefi">Şantiye Şefi</option><option value="yonetici">Yönetici</option></NSelect></Field>
        <GoldButton type="submit" disabled={add.isPending} data-testid="add-user-button"><Plus className="w-4 h-4" /> Ekle</GoldButton>
      </form>
      <div className="space-y-3" data-testid="users-list">
        {data.map((u) => (
          <div key={u.id} className="gold-card p-4 flex items-center gap-3" data-testid={`user-row-${u.id}`}>
            <div className="flex-1 min-w-0"><p className="font-semibold truncate">{u.name} {u.id === user.id && <span className="text-xs text-gold">(siz)</span>}</p><p className="text-xs text-charcoal-light">{u.email} · {fmtDate(u.created_at)}</p></div>
            <NSelect value={u.role} disabled={u.id === user.id} onChange={(e) => role.mutate({ id: u.id, role: e.target.value })} className="!w-40 !h-9" data-testid={`user-role-${u.id}`}>{["yonetici", "santiye_sefi", "muhasebe"].map((r) => <option key={r} value={r}>{STATUS_LABELS[r]}</option>)}</NSelect>
            {u.id !== user.id && <button onClick={() => window.confirm("Kullanıcı silinsin mi?") && del.mutate(u.id)} className="p-2 rounded-full hover:bg-red-50 text-red-700" data-testid={`delete-user-${u.id}`}><Trash2 className="w-4 h-4" /></button>}
          </div>))}
      </div>
    </div>
  );
}

export function ChangePassword() {
  const [f, setF] = useState({ current_password: "", new_password: "", again: "" });
  const m = useMutation({ mutationFn: () => api.post("/auth/change-password", { current_password: f.current_password, new_password: f.new_password }), onSuccess: () => { toast.success("Şifre değiştirildi"); setF({ current_password: "", new_password: "", again: "" }); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <div data-testid="password-page">
      <PageHeader title="Şifremi Değiştir" />
      <form onSubmit={(e) => { e.preventDefault(); if (f.new_password !== f.again) return toast.error("Yeni şifreler eşleşmiyor"); m.mutate(); }} className="gold-card p-6 max-w-md space-y-4" data-testid="password-form">
        <Field label="Mevcut Şifre"><NInput type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} required data-testid="current-password-input" /></Field>
        <Field label="Yeni Şifre"><NInput type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} required minLength={6} data-testid="new-password-input" /></Field>
        <Field label="Yeni Şifre (Tekrar)"><NInput type="password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} required data-testid="again-password-input" /></Field>
        <GoldButton type="submit" disabled={m.isPending} className="w-full" data-testid="change-password-button">Şifreyi Güncelle</GoldButton>
      </form>
    </div>
  );
}
