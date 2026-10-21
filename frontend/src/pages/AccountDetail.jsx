import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, openPdf, errMsg } from "@/lib/api";
import { fmtTL, fmtDate } from "@/lib/format";
import { PageHeader, StatCard, EmptyState, Money } from "@/components/shared/Bits";
import { GoldButton } from "@/components/shared/Inputs";
import { toast } from "sonner";
import { FileDown, ArrowLeft } from "lucide-react";

export default function AccountDetail() {
  const { type, id } = useParams();
  const { data, isLoading } = useQuery({ queryKey: ["statement", id], queryFn: () => api.get(`/accounts/${id}/statement`).then((r) => r.data) });
  if (isLoading || !data) return <div className="h-64 animate-pulse bg-white/60 rounded-2xl" />;
  const { account: a, rows } = data;
  const pdf = (detailed) => openPdf(`/pdf/statement/${id}?detailed=${detailed}`, `ekstre-${a.name}.pdf`).catch((e) => toast.error(errMsg(e)));
  return (
    <div data-testid="account-detail-page">
      <Link to={`/cari/${type}`} className="inline-flex items-center gap-1 text-sm text-charcoal-light hover:text-gold mb-4"><ArrowLeft className="w-4 h-4" /> {type === "musteri" ? "Müşteriler" : "Taşeronlar"}</Link>
      <PageHeader eyebrow={type === "musteri" ? "Müşteri Cari" : "Taşeron Cari"} title={a.name} subtitle={[a.phone, a.email, a.tax_no && `VKN: ${a.tax_no}`].filter(Boolean).join(" · ") || "-"}
        actions={<>
          <GoldButton variant="outline" onClick={() => pdf(false)} data-testid="statement-pdf-button"><FileDown className="w-4 h-4" /> Cari Ekstre PDF</GoldButton>
          <GoldButton onClick={() => pdf(true)} data-testid="statement-detailed-pdf-button"><FileDown className="w-4 h-4" /> Detaylı Ekstre PDF</GoldButton>
        </>} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Toplam Hakediş (Borç)" value={fmtTL(a.total_progress)} testId="stat-total-progress" />
        <StatCard label={type === "musteri" ? "Toplam Tahsilat" : "Toplam Ödenen"} value={fmtTL(a.total_paid)} tone="green" testId="stat-total-paid" delay={60} />
        <StatCard label="Kalan Bakiye" value={fmtTL(a.balance)} tone={a.balance > 0 ? "amber" : "green"} hint={a.balance > 0 ? (type === "musteri" ? "Müşteriden alacak" : "Taşerona borç") : "Kapanmış"} testId="stat-balance" delay={120} />
      </div>
      <div className="gold-card p-5 md:p-6">
        <h2 className="text-xl font-semibold mb-4">Hesap Hareketleri</h2>
        {rows.length === 0 ? <EmptyState title="Hareket yok" /> : (
          <div className="overflow-x-auto -mx-5 md:mx-0">
            <table className="w-full text-sm min-w-[640px]" data-testid="statement-table">
              <thead><tr className="text-left label-gold border-b border-gold-border"><th className="py-2 px-3">Tarih</th><th className="py-2 px-3">Açıklama</th><th className="py-2 px-3 text-right">Borç</th><th className="py-2 px-3 text-right">Alacak</th><th className="py-2 px-3 text-right">Bakiye</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} className="border-b border-stone-100 hover:bg-gold-bg/30">
                  <td className="py-2.5 px-3 font-mono text-xs">{fmtDate(r.date)}</td><td className="py-2.5 px-3">{r.description}</td>
                  <td className="py-2.5 px-3 text-right">{r.debit ? <Money value={r.debit} className="text-red-700" /> : ""}</td>
                  <td className="py-2.5 px-3 text-right">{r.credit ? <Money value={r.credit} className="text-emerald-700" /> : ""}</td>
                  <td className="py-2.5 px-3 text-right font-semibold"><Money value={r.balance} /></td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
