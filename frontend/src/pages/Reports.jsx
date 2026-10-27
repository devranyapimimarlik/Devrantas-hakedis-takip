import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, errMsg, openPdf, downloadFile } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtTL, fmtDate, STATUS_LABELS } from "@/lib/format";
import { PageHeader, EmptyState, Field, Money, StatusBadge } from "@/components/shared/Bits";
import { NInput, NSelect, GoldButton, Chip } from "@/components/shared/Inputs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { Sparkles, Loader2, Printer, FileDown } from "lucide-react";

const TABS = [["kasa", "Kasa"], ["musteri_risk", "Müşteri Risk"], ["cek", "Çek"], ["odeme", "Ödeme"], ["tahsilat", "Tahsilat"], ["kar_zarar", "Kâr / Zarar"], ["taseron", "Taşeron"], ["para_akisi", "Para Akışı"], ["ai", "AI Analizi"]];

function Row({ label, value, bold, sub, neg }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-3 border-b border-stone-100 last:border-0 ${bold ? "font-semibold text-base" : "text-sm"}`}>
      <div className="min-w-0"><p>{label}</p>{sub && <p className="text-xs text-charcoal-muted">{sub}</p>}</div>
      <span className={`money whitespace-nowrap shrink-0 ${neg ? "text-red-700" : bold ? "text-charcoal" : ""}`}>{typeof value === "number" ? fmtTL(value) : value}</span>
    </div>
  );
}

function Card({ title, children, testId }) {
  return <div className="gold-card p-5 md:p-6 mb-5" data-testid={testId}><h3 className="text-xl font-semibold mb-2">{title}</h3>{children}</div>;
}

function Movements({ rows }) {
  if (!rows.length) return <p className="text-sm text-charcoal-muted py-3">Hareket yok</p>;
  const tone = (t) => t === "gelir" ? "bg-emerald-50 text-emerald-700" : t === "virman" ? "bg-sky-50 text-sky-700" : "bg-red-50 text-red-700";
  return rows.map((m) => (
    <div key={m.id} className="soft-card p-3 flex items-center gap-3 mb-2" data-testid={`movement-${m.id}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tone(m.type)}`}>{m.type === "gelir" ? "↙" : m.type === "virman" ? "⇄" : "↗"}</div>
      <div className="flex-1 min-w-0"><p className="font-semibold truncate">{m.title}</p><p className="text-xs text-charcoal-light">{fmtDate(m.date)} · {m.site_name ? `Şantiye: ${m.site_name} · ` : ""}{m.account_name ? `${m.account_name} · ` : ""}{m.type === "virman" ? `${m.kasa_from_name || m.kasa_from} → ${m.kasa_name}` : (m.kasa_name || m.kasa)}</p>
        <span className={`inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full ${tone(m.type)}`}>{{ gelir: "Tahsilat", gider: "Ödeme", virman: "Virman (kasalar arası)" }[m.type] || m.type}</span></div>
      <Money value={m.type === "gider" ? -m.amount : m.amount} signed={m.type !== "virman"} className="font-semibold text-lg shrink-0" />
    </div>
  ));
}

export default function Reports() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || "kar_zarar";
  const [filt, setFilt] = useState({ start: "", end: "", site_id: "", account_id: "" });
  const { data: sites = [] } = useQuery({ queryKey: ["sites"], queryFn: () => api.get("/sites").then((r) => r.data) });
  const { data: subs = [] } = useQuery({ queryKey: ["accounts", "taseron"], queryFn: () => api.get("/accounts", { params: { type: "taseron" } }).then((r) => r.data) });
  const { data, isLoading } = useQuery({ queryKey: ["reports", filt], enabled: can("view_reports"), queryFn: () => api.get("/reports", { params: Object.fromEntries(Object.entries(filt).filter(([, v]) => v)) }).then((r) => r.data) });
  const ai = useMutation({ mutationFn: () => api.post("/ai/financial-analysis"), onError: (e) => toast.error(errMsg(e)) });
  const set = (k) => (e) => setFilt({ ...filt, [k]: e.target.value });
  const exportReport = async (format) => {
    const q = new URLSearchParams({ tab, format, ...Object.fromEntries(Object.entries(filt).filter(([, v]) => v)) }).toString();
    try { if (format === "pdf") await openPdf(`/reports/export?${q}`, `rapor-${tab}.pdf`); else await downloadFile(`/reports/export?${q}`, `rapor-${tab}.xlsx`); }
    catch (e) { toast.error(errMsg(e)); }
  };

  if (!can("view_reports")) return <div data-testid="reports-denied"><PageHeader title="Raporlar" /><EmptyState title="Bu bölüm için yetkiniz yok" desc="Raporları görmek için yöneticinizden 'Raporları görme' yetkisi isteyin." testId="reports-denied-empty" /></div>;
  return (
    <div data-testid="reports-page">
      <PageHeader title="Raporlar" actions={<>
        {tab !== "ai" && <GoldButton variant="outline" onClick={() => exportReport("xlsx")} data-testid="report-excel-button"><FileDown className="w-4 h-4" /> Excel</GoldButton>}
        {tab !== "ai" && <GoldButton variant="outline" onClick={() => exportReport("pdf")} data-testid="report-pdf-button"><FileDown className="w-4 h-4" /> PDF</GoldButton>}
        <GoldButton variant="outline" onClick={() => window.print()} data-testid="reports-print-button"><Printer className="w-4 h-4" /> Yazdır</GoldButton></>} />
      <div className="gold-card p-4 mb-5 grid grid-cols-2 lg:grid-cols-4 gap-3 print:hidden" data-testid="reports-filters">
        <Field label="Başlangıç"><NInput type="date" value={filt.start} onChange={set("start")} data-testid="report-start-input" /></Field>
        <Field label="Bitiş"><NInput type="date" value={filt.end} onChange={set("end")} data-testid="report-end-input" /></Field>
        <Field label="Şantiye"><NSelect value={filt.site_id} onChange={set("site_id")} data-testid="report-site-select"><option value="">Tüm şantiyeler</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NSelect></Field>
        <Field label="Taşeron"><NSelect value={filt.account_id} onChange={set("account_id")} data-testid="report-account-select"><option value="">Tüm taşeronlar</option>{subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NSelect></Field>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-4 px-4 md:mx-0 md:px-0 print:hidden">{TABS.map(([k, l]) => <Chip key={k} active={tab === k} onClick={() => setSp({ tab: k })} data-testid={`report-tab-${k}`}>{l}</Chip>)}</div>
      {isLoading || !data ? <div className="h-40 animate-pulse bg-white/60 rounded-2xl" /> : (
        <>
          {tab === "kasa" && <>
            <Card title="Kasa Raporu" testId="report-kasa">
              <Row label="Devrantaş Nakit" sub="Nakit tahsilat − nakit ödeme" value={data.kasa.nakit} neg={data.kasa.nakit < 0} />
              <Row label="Devrantaş Çek" sub="Çek ile tahsilat − çek ile ödeme" value={data.kasa.cek_kasasi} neg={data.kasa.cek_kasasi < 0} />
              <Row label="Toplam" value={data.kasa.toplam} bold neg={data.kasa.toplam < 0} />
            </Card>
            <Card title="Hesap hareketleri (tarih · tür · tutar · belge)"><Movements rows={data.kasa.movements} /></Card>
          </>}
          {tab === "kar_zarar" && <>
            <Card title="Genel Kâr / Zarar (Gerçekleşen)" testId="report-pl">
              <Row label="Toplam gelir" sub="Onaylı tahsilatlar" value={data.kar_zarar.gelir} />
              <Row label="Toplam gider" sub="Onaylı giderler + onaylı taşeron hakedişleri" value={-data.kar_zarar.gider} />
              <Row label="Genel gider (%6)" sub="Tahsil edilen gelir üzerinden hesaplanır" value={-data.kar_zarar.genel_gider} />
              <Row label="Net kâr" value={data.kar_zarar.net} bold neg={data.kar_zarar.net < 0} />
              <div className="mt-3 pt-3 border-t border-dashed border-stone-200" data-testid="report-pl-projection">
                <Row label="Sözleşme toplamı" value={data.kar_zarar.sozlesme} />
                <Row label="Tahmini kâr (sözleşme bazlı)" sub={`Sözleşme − %6 genel gider (${fmtTL(data.kar_zarar.tahmini_genel_gider)}) − giderler`} value={data.kar_zarar.tahmini_kar} neg={data.kar_zarar.tahmini_kar < 0} />
              </div>
            </Card>
            {data.kar_zarar.sites.map((s) => (
              <Card key={s.id} title={s.name} testId={`report-pl-site-${s.id}`}>
                <Row label="Sözleşme" value={s.contract_amount} /><Row label="Tahsilat" sub={`Tahsilat oranı %${s.collection_rate}`} value={s.total_income} />
                <Row label="Gider" sub={`Doğrudan ${fmtTL(s.direct_expense)} + Taşeron hakediş ${fmtTL(s.subcontractor_expense)}`} value={-s.total_expense} />
                <Row label="Genel gider (%6)" sub="Tahsilat üzerinden" value={-s.realized_overhead} />
                <Row label="Gerçekleşen kâr" sub={`İlerleme %${s.progress_percent}`} value={s.realized_profit} bold neg={s.realized_profit < 0} />
                <Row label="Tahmini kâr (sözleşme bazlı)" sub={`Marj %${s.profit_margin}`} value={s.estimated_profit} neg={s.estimated_profit < 0} />
              </Card>))}
          </>}
          {tab === "musteri_risk" && <Card title="Müşteri Risk Analizi" testId="report-risk">
            {data.musteri_risk.length === 0 ? <p className="text-sm text-charcoal-muted">Müşteri yok</p> : data.musteri_risk.map((r) => (
              <div key={r.id} className="py-3 border-b border-stone-100 last:border-0 flex items-center gap-3"><div className="flex-1"><p className="font-semibold">{r.name}</p><p className="text-xs text-charcoal-light">Hakediş {fmtTL(r.total_progress)} · Tahsil {fmtTL(r.total_paid)}{r.overdue ? ` · Vadesi geçen çek ${fmtTL(r.overdue)}` : ""}{r.bounced ? ` · Karşılıksız ${fmtTL(r.bounced)}` : ""}</p></div>
                <Money value={r.balance} className="font-semibold" /><span className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border ${r.risk === "yuksek" ? "bg-red-50 text-red-700 border-red-200" : r.risk === "orta" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>{{ yuksek: "YÜKSEK", orta: "ORTA", dusuk: "DÜŞÜK" }[r.risk]}</span></div>))}
          </Card>}
          {tab === "cek" && <>
            <Card title="Çek Özeti" testId="report-checks"><Row label="Portföydeki alınan çekler" value={data.cek.summary.alinan_portfoy} /><Row label="Verilen çek yükü" value={-data.cek.summary.verilen_portfoy} /><Row label="Tahsil edilen" value={data.cek.summary.tahsil} /><Row label="Ödenen" value={-data.cek.summary.odenen} /><Row label="Karşılıksız" value={data.cek.summary.karsiliksiz} neg={data.cek.summary.karsiliksiz > 0} /></Card>
            <Card title="Çek Listesi">{data.cek.rows.length === 0 ? <p className="text-sm text-charcoal-muted">Çek yok</p> : data.cek.rows.map((c) => <div key={c.id} className="py-2.5 border-b border-stone-100 last:border-0 flex items-center gap-3 text-sm"><div className="flex-1 min-w-0"><p className="font-medium truncate">{STATUS_LABELS[c.direction]} · {c.bank} {c.check_no} · {c.account_name || c.drawer || "-"}</p><p className="text-xs text-charcoal-light">Vade {fmtDate(c.due_date)} · {c.status === "portfoyde" ? (c.days_left < 0 ? `${-c.days_left} gün gecikti` : `${c.days_left} gün`) : ""}</p></div><StatusBadge status={c.status} /><Money value={c.amount} className="font-semibold" /></div>)}</Card>
          </>}
          {tab === "odeme" && <>
            <Card title="Ödeme Raporu" testId="report-payments"><Row label="Toplam onaylı ödeme" value={-data.odeme.toplam} bold />{data.odeme.by_category.map((c) => <Row key={c.category} label={c.category} value={-c.total} />)}</Card>
            {data.odeme.planned.length > 0 && <Card title="Planlanan Sabit Giderler">{data.odeme.planned.map((p) => <Row key={p.id} label={p.title} sub={`${STATUS_LABELS[p.type]} · ${fmtDate(p.due_date)}`} value={p.amount} />)}</Card>}
            <Card title="Ödeme Hareketleri"><Movements rows={data.odeme.rows} /></Card>
          </>}
          {tab === "tahsilat" && <><Card title="Tahsilat Raporu" testId="report-income"><Row label="Toplam tahsilat" value={data.tahsilat.toplam} bold /></Card><Card title="Tahsilat Hareketleri"><Movements rows={data.tahsilat.rows} /></Card></>}
          {tab === "taseron" && <div data-testid="report-subs">{data.taseron.length === 0 ? <EmptyState title="Taşeron yok" /> : data.taseron.map((s) => (
            <Card key={s.id} title={s.name}><p className="text-xs text-charcoal-light -mt-1 mb-2">{s.specialty || ""} · {s.hakedis_count} hakediş</p>
              <Row label="Toplam hakediş" value={s.total_progress} /><Row label="Ödenen" sub={`Nakit ${fmtTL(s.paid_nakit)} · Çek ${fmtTL(s.paid_cek)}`} value={-s.total_paid} />{s.advance_total > 0 && <Row label="Verilen avans (ödenen içinde)" value={s.advance_total} />}
              <Row label={s.balance < 0 ? "Avans alacağı (hakedişten düşülecek)" : "Kalan borç"} value={Math.abs(s.balance)} bold neg={s.balance > 0} />
              {s.hakedis.map((h) => <Row key={h.number + h.date} label={`Hakediş No ${h.number} · ${h.site_name || ""}`} sub={`${fmtDate(h.date)} · ${STATUS_LABELS[h.status]}`} value={h.net_amount} />)}
            </Card>))}</div>}
          {tab === "para_akisi" && <Card title="Aylık Para Akışı" testId="report-cashflow">{data.para_akisi.length === 0 ? <p className="text-sm text-charcoal-muted">Veri yok</p> : <div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.para_akisi}><CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={50} /><Tooltip formatter={(v) => fmtTL(v)} /><Bar dataKey="gelir" name="Tahsilat" fill="#B8860B" radius={[6, 6, 0, 0]} /><Bar dataKey="gider" name="Ödeme" fill="#1C1917" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>}
            {data.para_akisi.map((m) => <Row key={m.month} label={m.month} sub={`Tahsilat ${fmtTL(m.gelir)} · Ödeme ${fmtTL(m.gider)}`} value={m.gelir - m.gider} neg={m.gelir - m.gider < 0} />)}</Card>}
          {tab === "ai" && <Card title="Yapay Zeka Finansal Analiz" testId="report-ai">
            <p className="text-sm text-charcoal-light mb-3">Şirket geneli finansal sağlık, en riskli şantiye, nakit akışı uyarıları ve öncelikli aksiyonlar.</p>
            <GoldButton onClick={() => ai.mutate()} disabled={ai.isPending} data-testid="report-ai-button">{ai.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Analizi Başlat</GoldButton>
            {ai.data && <div className="mt-5 text-sm leading-relaxed whitespace-pre-wrap bg-gold-bg border border-gold-border rounded-2xl p-4" data-testid="report-ai-result">{ai.data.data.analysis}</div>}
          </Card>}
        </>
      )}
    </div>
  );
}
