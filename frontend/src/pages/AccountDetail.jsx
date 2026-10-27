import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, openPdf, errMsg } from "@/lib/api";
import { fmtTL, fmtDate } from "@/lib/format";
import { PageHeader, StatCard, EmptyState, Money } from "@/components/shared/Bits";
import { GoldButton } from "@/components/shared/Inputs";
import { toast } from "sonner";
import { FileDown, ArrowLeft } from "lucide-react";
import { TxActions } from "@/components/shared/TxActions";

export default function AccountDetail() {
  const { id } = useParams();
  const { data, isLoading } = useQuery({ queryKey: ["statement", id], queryFn: () => api.get(`/accounts/${id}/statement`).then((r) => r.data) });
  const { data: pendingTx = [] } = useQuery({ queryKey: ["transactions", "pending", id], queryFn: () => api.get("/transactions", { params: { account_id: id, status: "onay_bekliyor" } }).then((r) => r.data) });
  if (isLoading || !data) return <div className="h-64 animate-pulse bg-white/60 rounded-2xl" />;
  const { account: a, rows } = data;
  const type = a.type;
  const pdf = (detailed) => openPdf(`/pdf/statement/${id}?detailed=${detailed}`, `ekstre-${a.name}.pdf`).catch((e) => toast.error(errMsg(e)));
  return (
    <div data-testid="account-detail-page">
      <Link to={`/cari/${type}`} className="inline-flex items-center gap-1 text-sm text-charcoal-light hover:text-gold mb-4"><ArrowLeft className="w-4 h-4" /> {type === "musteri" ? "Müşteriler" : "Taşeronlar"}</Link>
      <PageHeader eyebrow={type === "musteri" ? "Müşteri Cari" : "Taşeron Cari"} title={a.name} subtitle={[a.phone, a.email, a.tax_no && `VKN: ${a.tax_no}`, a.is_active === false && "PASİF"].filter(Boolean).join(" · ") || "-"}
        actions={<>
          <GoldButton variant="outline" onClick={() => pdf(false)} data-testid="statement-pdf-button"><FileDown className="w-4 h-4" /> Cari Ekstre PDF</GoldButton>
          <GoldButton onClick={() => pdf(true)} data-testid="statement-detailed-pdf-button"><FileDown className="w-4 h-4" /> Detaylı Ekstre PDF</GoldButton>
        </>} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label={type === "musteri" ? "Toplam Hakediş (Müşteri Borcu)" : "Toplam Hakediş (Taşeron Alacağı)"} value={fmtTL(a.total_progress)} hint="Avans mahsubu öncesi brüt" testId="stat-total-progress" />
        <StatCard label={type === "musteri" ? "Toplam Tahsilat (avans dahil)" : "Ödenen Avans (Taşeron Borcu)"} value={fmtTL(a.total_paid)} tone="green" testId="stat-total-paid" delay={60} />
        <StatCard label={type === "musteri" ? "Net: Hakediş − Tahsilat" : "Net: Hakediş − Avans"} value={fmtTL(Math.abs(a.balance))} tone={a.balance === 0 ? "green" : a.balance > 0 ? "amber" : "red"}
          hint={a.balance === 0 ? "Hesap kapalı" : type === "musteri" ? (a.balance > 0 ? "Müşteriden alacağımız (kalan)" : "Müşteri alacaklı (fazla tahsilat / avans)") : (a.balance > 0 ? "Taşerona borcumuz (kalan)" : "Taşeron avans borçlu (hakediş bekleniyor)")} testId="stat-balance" delay={120} />
      </div>
      {pendingTx.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-6" data-testid="account-pending-list">
          <p className="text-sm font-semibold text-amber-900 mb-2">Onay bekleyen {type === "musteri" ? "tahsilatlar" : "avans ödemeleri"} ({pendingTx.length}) — bakiyeye henüz yansımadı</p>
          {pendingTx.map((t) => <div key={t.id} className="flex items-center gap-2 text-sm py-1 border-b border-amber-100 last:border-0"><span className="flex-1 min-w-0 truncate">{fmtDate(t.date)} · {t.description || t.category} · {t.site_name || "Genel"}</span><Money value={t.amount} className="font-semibold" /><TxActions tx={t} /></div>)}
        </div>
      )}
      <div className="gold-card p-5 md:p-6">
        <h2 className="text-xl font-semibold mb-1">Hesap Hareketleri</h2>
        <p className="text-xs text-charcoal-light mb-4">{type === "musteri" ? "Hakediş = borç, tahsilat/avans = alacak. Avans mahsubu yapılan hakedişlerde brüt tutar gösterilir." : "Hakediş = alacak, verilen her ödeme = avans (borç). Avanslar hakedişten düşülür; şantiye giderine yansımaz."} Kalem simgesiyle düzeltin, çöp kutusuyla silin.</p>
        {rows.length === 0 ? <EmptyState title="Hareket yok" /> : (
          <div className="overflow-x-auto -mx-5 md:mx-0">
            <table className="w-full text-sm min-w-[640px]" data-testid="statement-table">
              <thead><tr className="text-left label-gold border-b border-gold-border"><th className="py-2 px-3">Tarih</th><th className="py-2 px-3">Açıklama</th><th className="py-2 px-3 text-right">{type === "musteri" ? "Borç (Hakediş)" : "Borç (Avans)"}</th><th className="py-2 px-3 text-right">{type === "musteri" ? "Alacak (Tahsilat)" : "Alacak (Hakediş)"}</th><th className="py-2 px-3 text-right">Bakiye</th><th className="py-2 px-1"></th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} className="border-b border-stone-100 hover:bg-gold-bg/30" data-testid={`statement-row-${r.ref_id}`}>
                  <td className="py-2.5 px-3 font-mono text-xs">{fmtDate(r.date)}</td><td className="py-2.5 px-3">{r.type === "hakedis" ? <Link to={`/hakedis/${r.ref_id}`} className="hover:text-gold underline-offset-2 hover:underline">{r.description}</Link> : r.description}</td>
                  <td className="py-2.5 px-3 text-right">{r.debit ? <Money value={r.debit} className="text-red-700" /> : ""}</td>
                  <td className="py-2.5 px-3 text-right">{r.credit ? <Money value={r.credit} className="text-emerald-700" /> : ""}</td>
                  <td className="py-2.5 px-3 text-right font-semibold"><Money value={r.balance} /></td>
                  <td className="py-2.5 px-1 text-right">{r.tx && <TxActions tx={r.tx} />}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
