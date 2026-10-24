import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { fmtTL, fmtDate } from "@/lib/format";
import { PageHeader, StatCard, Money, StatusBadge, SectionTitle, EmptyState } from "@/components/shared/Bits";
import { ReminderBanners } from "@/pages/Payments";
import { DailySummaryCard } from "@/components/shared/DailySummary";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Wallet, TrendingUp, TrendingDown, Percent, Building2, ClipboardCheck, Banknote } from "lucide-react";

const tip = (v) => fmtTL(v);

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get("/dashboard").then((r) => r.data) });
  if (isLoading || !data) return <div className="h-64 animate-pulse rounded-xl bg-white/60" />;
  const t = data.totals;
  return (
    <div data-testid="dashboard-page">
      <PageHeader eyebrow="Genel Bakış" title="Finansal Durum" subtitle={`${data.active_sites} aktif şantiye · Toplam ${data.site_count} proje · Bugün ${fmtDate(data.today)}`} />
      <ReminderBanners compact />
      <DailySummaryCard compact />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard label="Toplam Sözleşme" value={fmtTL(t.contract)} hint={`Tahmini %6 genel gider: ${fmtTL(t.overhead)}`} icon={Wallet} testId="stat-contract" />
        <StatCard label="Toplam Tahsilat" value={fmtTL(t.income)} hint={`%6 genel gider (tahsilat üzerinden): ${fmtTL(t.realized_overhead)}`} tone="green" icon={TrendingUp} testId="stat-income" delay={60} />
        <StatCard label="Onaylı Gider" value={fmtTL(t.expense)} hint={`Onay bekleyen: ${fmtTL(t.pending)}`} tone="red" icon={TrendingDown} testId="stat-expense" delay={120} />
        <StatCard label="Gerçekleşen Kâr" value={fmtTL(t.realized_profit)} hint={`Tahsilat − %6 − gider · Tahmini (sözleşme): ${fmtTL(t.profit)}`} tone={t.realized_profit >= 0 ? "green" : "red"} icon={Percent} testId="stat-profit" delay={180} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="gold-card p-5 flex items-center gap-4" data-testid="kasa-nakit-card"><Wallet className="w-8 h-8 text-gold" /><div><p className="label-gold">Devrantaş Nakit Kasa</p><p className={`money text-xl font-semibold ${data.kasa.nakit < 0 ? "text-red-700" : "text-charcoal"}`}>{fmtTL(data.kasa.nakit)}</p></div></div>
        <div className="gold-card p-5 flex items-center gap-4" data-testid="kasa-cek-card"><Banknote className="w-8 h-8 text-gold" /><div><p className="label-gold">Devrantaş Çek Kasa</p><p className={`money text-xl font-semibold ${data.kasa.cek < 0 ? "text-red-700" : "text-charcoal"}`}>{fmtTL(data.kasa.cek)}</p></div></div>
        <div className="gold-card p-5 flex items-center gap-4 bg-gold-bg/60" data-testid="kasa-toplam-card"><Wallet className="w-8 h-8 text-gold-dark" /><div><p className="label-gold">Toplam Kasa</p><p className="money text-xl font-semibold text-gold-dark">{fmtTL(data.kasa.toplam)}</p></div></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Link to="/islemler?status=onay_bekliyor" className="gold-card p-5 flex items-center gap-4 hover:bg-gold-bg/40" data-testid="pending-approvals-card">
          <ClipboardCheck className="w-8 h-8 text-amber-600" />
          <div><p className="label-gold">Onay Bekleyen Gider</p><p className="money text-2xl font-semibold text-amber-700">{data.pending_approvals}</p></div>
        </Link>
        <Link to="/cekler?direction=alinan" className="gold-card p-5 flex items-center gap-4 hover:bg-gold-bg/40" data-testid="checks-in-card">
          <Banknote className="w-8 h-8 text-emerald-700" />
          <div><p className="label-gold">Portföydeki Alınan Çek</p><p className="money text-lg font-semibold text-emerald-700">{fmtTL(data.checks_in.total)} <span className="text-xs text-charcoal-muted">({data.checks_in.count})</span></p></div>
        </Link>
        <Link to="/cekler?direction=verilen" className="gold-card p-5 flex items-center gap-4 hover:bg-gold-bg/40" data-testid="checks-out-card">
          <Banknote className="w-8 h-8 text-red-700" />
          <div><p className="label-gold">Verilen Çek Yükü</p><p className="money text-lg font-semibold text-red-700">{fmtTL(data.checks_out.total)} <span className="text-xs text-charcoal-muted">({data.checks_out.count})</span></p></div>
        </Link>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-3 gold-card p-5 md:p-6">
          <SectionTitle>Aylık Nakit Akışı</SectionTitle>
          {data.cashflow.length === 0 ? <EmptyState title="Henüz onaylı işlem yok" /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.cashflow} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} />
                  <YAxis tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={50} />
                  <Tooltip formatter={tip} contentStyle={{ borderRadius: 12, borderColor: "#E2D3B4", fontFamily: "Manrope" }} />
                  <Bar dataKey="gelir" name="Gelir" fill="#B8860B" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="gider" name="Gider" fill="#1C1917" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="xl:col-span-2 gold-card p-5 md:p-6">
          <SectionTitle>Şantiye Kâr/Zarar</SectionTitle>
          {data.sites.length === 0 ? <EmptyState title="Şantiye yok" action={<Link className="text-gold text-sm underline" to="/santiyeler">Şantiye ekle</Link>} /> : (
            <ul className="divide-y divide-stone-100" data-testid="dashboard-site-list">
              {data.sites.map((s) => (
                <li key={s.id} className="py-3">
                  <Link to={`/santiyeler/${s.id}`} className="flex items-center justify-between gap-3 hover:text-gold">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate flex items-center gap-2"><Building2 className="w-3.5 h-3.5 text-gold shrink-0" />{s.name}</p>
                      <p className="text-[11px] text-charcoal-muted mt-0.5">İlerleme %{s.progress_percent} · Bütçe %{s.budget_used_percent}</p>
                    </div>
                    <div className="text-right"><Money value={s.estimated_profit} signed className="text-sm font-semibold" /><p className="text-[11px] text-charcoal-muted">%{s.profit_margin}</p></div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mt-6">
        <div className="xl:col-span-3 gold-card p-5 md:p-6">
          <SectionTitle right={<Link to="/islemler" className="text-xs text-gold hover:underline">Tümü</Link>}>Son İşlemler</SectionTitle>
          {data.recent.length === 0 ? <EmptyState title="İşlem yok" /> : (
            <ul className="divide-y divide-stone-100">
              {data.recent.map((r) => (
                <li key={r.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0"><p className="truncate font-medium">{r.description || r.category}</p><p className="text-[11px] text-charcoal-muted">{fmtDate(r.date)} · {r.category}</p></div>
                  <div className="flex items-center gap-2"><StatusBadge status={r.status} /><Money value={r.type === "gider" ? -r.amount : r.amount} signed className="text-sm font-semibold" /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="xl:col-span-2 gold-card p-5 md:p-6">
          <SectionTitle>Gider Dağılımı</SectionTitle>
          {data.expense_categories.length === 0 ? <EmptyState title="Onaylı gider yok" /> : data.expense_categories.map((c) => {
            const pct = t.expense ? (c.total / t.expense) * 100 : 0;
            return (
              <div key={c.category} className="mb-3">
                <div className="flex justify-between text-xs mb-1"><span className="font-medium">{c.category}</span><span className="money text-charcoal-light">{fmtTL(c.total)}</span></div>
                <div className="h-1.5 rounded-full bg-stone-100"><div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
