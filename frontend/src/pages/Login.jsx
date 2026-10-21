import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { errMsg } from "@/lib/api";
import { NInput, GoldButton } from "@/components/shared/Inputs";
import { Field } from "@/components/shared/Bits";
import { Loader2 } from "lucide-react";

const HERO = "https://images.unsplash.com/photo-1613490493576-7fde63acd811?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await login(form.email, form.password);
      nav("/");
    } catch (ex) { setErr(errMsg(ex)); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden lg:block relative overflow-hidden bg-[#18181B]">
        <img src={HERO} alt="Mimari" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#18181B] via-[#18181B]/40 to-transparent" />
        <div className="absolute bottom-0 left-0 p-14 max-w-xl">
          <p className="label-gold !text-[#E6CA65] mb-4">Şantiye Finans · Hakediş · Cari</p>
          <h2 className="font-serif text-5xl font-bold text-white leading-[1.05]">Her şantiyenin kârı, <span className="text-[#E6CA65]">tek bakışta.</span></h2>
          <p className="text-stone-300 mt-5 text-base leading-relaxed">Gelir-gider takibi, yönetici onaylı harcamalar, %6 genel gider kesintili hakedişler, çek vade hatırlatıcıları ve yapay zeka destekli finansal analiz.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md fade-up">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="Devrantaş" className="w-16 h-16 rounded-full shadow" />
            <div><p className="font-serif text-4xl font-bold text-charcoal leading-none">Devrantaş</p>
            <p className="font-serif text-sm text-gold tracking-[0.3em] uppercase mt-1">Yapı Mimarlık</p></div>
          </div>
          <h1 className="text-2xl font-serif font-semibold text-charcoal mt-10">Kurumsal Giriş</h1>
          <p className="text-sm text-charcoal-light mt-1">Hesabınızla devam edin. Yeni kullanıcılar yönetici tarafından tanımlanır.</p>
          <form onSubmit={submit} className="mt-8 space-y-4" data-testid="auth-form">
            <Field label="E-posta"><NInput type="email" value={form.email} onChange={set("email")} required autoComplete="email" data-testid="login-email-input" /></Field>
            <Field label="Şifre"><NInput type="password" value={form.password} onChange={set("password")} required autoComplete="current-password" data-testid="login-password-input" /></Field>
            {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="auth-error">{err}</p>}
            <GoldButton type="submit" disabled={busy} className="w-full" data-testid="login-submit-button">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}Giriş Yap
            </GoldButton>
          </form>
        </div>
      </div>
    </div>
  );
}
