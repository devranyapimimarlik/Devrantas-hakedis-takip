import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API } from "@/lib/api";
import { fmtTL, fmtDate, STATUS_LABELS } from "@/lib/format";
import { applyTheme } from "@/context/SettingsContext";

export default function Portal() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetch(`${API}/portal/${token}`).then(async (r) => { if (!r.ok) throw new Error((await r.json()).detail || "Hata"); return r.json(); }).then((x) => { setD(x); applyTheme(x.company.primary_color); }).catch((e) => setErr(e.message)); }, [token]);
  if (err) return <div className="min-h-screen flex items-center justify-center p-6 text-center"><div><p className="font-serif text-3xl">Bağlantı geçersiz</p><p className="text-charcoal-light mt-2">{err}</p></div></div>;
  if (!d) return <div className="min-h-screen flex items-center justify-center"><div className="w-16 h-16 rounded-full bg-gold-bg animate-pulse" /></div>;
  const logo = `${API}/settings/logo`;
  return (
    <div className="min-h-screen max-w-4xl mx-auto px-4 py-8" data-testid="portal-page">
      <header className="flex items-center gap-4 mb-8"><img src={logo} alt="" className="w-14 h-14 rounded-full object-contain" /><div className="flex-1"><p className="font-serif text-2xl font-bold">{d.company.name}</p><p className="text-xs text-charcoal-light">{d.company.phone} · {d.company.email}</p></div><span className="gold-badge">Müşteri Portalı</span></header>
      <h1 className="text-3xl sm:text-4xl font-serif font-bold">Sayın {d.customer.name}</h1>
      <p className="text-sm text-charcoal-light mt-1">Proje ilerlemesi, hakedişler ve ödeme durumunuz (salt okunur) · {fmtDate(d.generated_at)}</p>
      <div className="grid grid-cols-3 gap-3 mt-6">
        {[["Toplam Hakediş", d.balance.total_progress], ["Ödenen", d.balance.total_paid], ["Kalan Bakiye", d.balance.balance]].map(([l, v]) => <div key={l} className="gold-card p-4"><p className="label-gold">{l}</p><p className="money text-lg md:text-2xl font-semibold mt-2" data-testid={`portal-${l}`}>{fmtTL(v)}</p></div>)}
      </div>
      {d.sites.map((s) => (
        <section key={s.id} className="gold-card p-5 mt-6" data-testid={`portal-site-${s.id}`}>
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{s.name}</h2><p className="text-xs text-charcoal-light">{s.location} · {fmtDate(s.start_date)} → {fmtDate(s.end_date)} · {STATUS_LABELS[s.status]}</p></div><span className="font-mono text-gold font-bold">%{s.progress_percent}</span></div>
          <div className="h-2 rounded-full bg-stone-100 mt-3"><div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, s.progress_percent)}%` }} /></div>
          {s.photos.length > 0 && <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-4">{s.photos.map((p) => <figure key={p.id}><img src={`${API}/portal/${token}/photo/${p.file_id}`} alt={p.note || ""} className="w-full h-28 object-cover rounded-xl border border-gold-border" loading="lazy" /><figcaption className="text-[10px] text-charcoal-light mt-1 truncate">{fmtDate(p.date)}{p.progress_percent != null ? ` · %${p.progress_percent}` : ""} {p.note}</figcaption></figure>)}</div>}
        </section>
      ))}
      <section className="gold-card p-5 mt-6"><h2 className="text-xl font-semibold mb-3">Hakedişler</h2>
        {d.progress_payments.length === 0 ? <p className="text-sm text-charcoal-muted">Henüz onaylı hakediş yok</p> : d.progress_payments.map((h) => <div key={h.id} className="row-line"><span>No {h.number} · {h.site_name} · {fmtDate(h.date)} {h.period && `· ${h.period}`} <span className="gold-badge ml-1">{STATUS_LABELS[h.status]}</span></span><span className="money font-semibold">{fmtTL(h.net_amount)}</span></div>)}
      </section>
      <section className="gold-card p-5 mt-6"><h2 className="text-xl font-semibold mb-3">Ödemeleriniz</h2>
        {d.payments.length === 0 ? <p className="text-sm text-charcoal-muted">Henüz ödeme kaydı yok</p> : d.payments.map((p) => <div key={p.id} className="row-line"><span>{fmtDate(p.date)} · {p.category} · {p.kasa === "cek" ? "Çek" : "Nakit/Havale"} {p.description && `· ${p.description}`}</span><span className="money font-semibold text-emerald-700">{fmtTL(p.amount)}</span></div>)}
      </section>
      <footer className="text-center text-xs text-charcoal-light mt-10">{d.company.name} · {d.company.address}</footer>
    </div>
  );
}
