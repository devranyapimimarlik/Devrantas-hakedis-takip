import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader, Field } from "@/components/shared/Bits";
import { NInput, GoldButton } from "@/components/shared/Inputs";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "sonner";
import { Smartphone } from "lucide-react";
import { Link } from "react-router-dom";

const PRESETS = ["#B8860B", "#1D4ED8", "#047857", "#B91C1C", "#6D28D9", "#0F766E", "#C2410C", "#1C1917"];

export default function Appearance() {
  const { settings, refresh, applyTheme, logoUrl } = useSettings();
  const [f, setF] = useState(null);
  useEffect(() => { if (settings && !f) setF({ ...settings }); }, [settings, f]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({ mutationFn: () => api.put("/settings", f), onSuccess: async () => { await refresh(); toast.success("Görünüm kaydedildi — logo ve renk tüm belgelere uygulandı"); }, onError: (e) => toast.error(errMsg(e)) });
  if (!f) return <div className="h-40 animate-pulse bg-white/60 rounded-2xl" />;
  return (
    <div data-testid="appearance-page">
      <PageHeader title="Görünüm ve Firma Bilgileri" subtitle="Logo, renk ve firma bilgileri; uygulama, PDF/Excel belgeleri, teklif/sözleşme başlıkları ve telefon ana ekran simgesi buradan beslenir." />
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid lg:grid-cols-[1fr_320px] gap-6" data-testid="appearance-form">
        <div className="gold-card p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Firma Ünvanı (tam)" className="sm:col-span-2"><NInput value={f.company_name} onChange={set("company_name")} required data-testid="settings-company-input" /></Field>
            <Field label="Kısa Ad (başlık)"><NInput value={f.short_name} onChange={set("short_name")} required data-testid="settings-short-input" /></Field>
            <Field label="Alt Başlık"><NInput value={f.tagline || ""} onChange={set("tagline")} data-testid="settings-tagline-input" /></Field>
            <Field label="Adres" className="sm:col-span-2"><NInput value={f.address || ""} onChange={set("address")} data-testid="settings-address-input" /></Field>
            <Field label="Telefon"><NInput value={f.phone || ""} onChange={set("phone")} data-testid="settings-phone-input" /></Field>
            <Field label="E-posta"><NInput value={f.email || ""} onChange={set("email")} data-testid="settings-email-input" /></Field>
            <Field label="Vergi Dairesi"><NInput value={f.tax_office || ""} onChange={set("tax_office")} /></Field>
            <Field label="Vergi No"><NInput value={f.tax_no || ""} onChange={set("tax_no")} /></Field>
            <Field label="IBAN" className="sm:col-span-2"><NInput value={f.iban || ""} onChange={set("iban")} /></Field>
          </div>
          <div>
            <p className="text-xs font-semibold text-charcoal-light mb-2">Ana Renk</p>
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((c) => <button key={c} type="button" onClick={() => { setF({ ...f, primary_color: c }); applyTheme(c); }} className={`w-9 h-9 rounded-full border-2 ${f.primary_color === c ? "border-charcoal scale-110" : "border-white"} shadow`} style={{ background: c }} data-testid={`color-preset-${c.slice(1)}`} />)}
              <input type="color" value={f.primary_color} onChange={(e) => { setF({ ...f, primary_color: e.target.value }); applyTheme(e.target.value); }} className="w-12 h-9 rounded-lg border border-gold-border cursor-pointer" data-testid="settings-color-input" />
              <span className="font-mono text-xs">{f.primary_color}</span>
            </div>
          </div>
          <GoldButton type="submit" disabled={save.isPending} className="w-full sm:w-auto" data-testid="settings-save-button">Kaydet</GoldButton>
        </div>
        <div className="space-y-4">
          <div className="gold-card p-5 text-center">
            <img src={logoUrl} alt="Logo" className="w-28 h-28 mx-auto rounded-2xl object-contain bg-white shadow" data-testid="settings-logo-preview" />
            <p className="font-serif text-xl font-bold mt-3">{f.short_name}</p><p className="text-xs text-charcoal-light">{f.tagline}</p>
            <div className="mt-4"><FileUpload value={f.logo_file_id} onChange={(id) => setF({ ...f, logo_file_id: id })} label="Logo (PNG/JPG, kare önerilir)" testId="settings-logo" /></div>
            {f.logo_file_id !== settings.logo_file_id && <p className="text-[11px] text-amber-700 mt-2">Kaydet'e basınca logo uygulanır.</p>}
          </div>
          <div className="soft-card p-4 text-xs text-charcoal-light flex gap-3"><Smartphone className="w-5 h-5 text-gold shrink-0" /><p><b>Telefon ana ekranına ekleme:</b> Simge olarak bu logo, isim olarak kısa ad kullanılır. Adım adım kurulum için <Link to="/telefona-kur" className="text-gold underline" data-testid="appearance-install-link">Telefona Kur</Link> sayfasına bakın.</p></div>
        </div>
      </form>
    </div>
  );
}
