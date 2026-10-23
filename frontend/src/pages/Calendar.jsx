import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { fmtTL, fmtDate, STATUS_LABELS } from "@/lib/format";
import { PageHeader, StatusBadge, EmptyState } from "@/components/shared/Bits";
import { Chip } from "@/components/shared/Inputs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, ArrowDownLeft, ArrowUpRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const short = (v) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}B` : `${Math.round(v)}`);

function DayCell({ day, info, isToday, selected, onClick }) {
  if (!day) return <div className="min-h-[72px] md:min-h-[96px]" />;
  const past = info && new Date(day.iso) < new Date(new Date().toDateString());
  return (
    <button type="button" onClick={onClick} data-testid={`cal-day-${day.iso}`}
      className={cn("min-h-[72px] md:min-h-[96px] rounded-xl border p-1.5 md:p-2 text-left flex flex-col transition-colors",
        selected ? "border-gold bg-gold-bg ring-2 ring-gold/30" : info?.open ? "border-gold-border bg-white hover:bg-gold-bg/60" : "border-transparent bg-white/60 hover:bg-white",
        past && info?.open && "border-red-200 bg-red-50/60")}>
      <span className={cn("text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full", isToday ? "bg-gold text-white" : "text-charcoal-light")}>{day.n}</span>
      {info && (
        <div className="mt-auto space-y-0.5 text-[10px] md:text-[11px] font-mono leading-tight">
          {info.in > 0 && <p className="text-emerald-700 flex items-center gap-0.5"><ArrowDownLeft className="w-3 h-3" />{short(info.in)}</p>}
          {info.out > 0 && <p className="text-red-700 flex items-center gap-0.5"><ArrowUpRight className="w-3 h-3" />{short(info.out)}</p>}
          {info.open === 0 && info.count > 0 && <p className="text-charcoal-muted">{info.count} kapandı</p>}
        </div>
      )}
    </button>
  );
}

function ItemRow({ it }) {
  const inc = it.direction === "alinan";
  return (
    <Link to={it.kind === "cek" ? "/cekler" : "/odeme-takvimi"} className="block rounded-xl border border-gold-border bg-white p-3 hover:bg-gold-bg/50 transition-colors" data-testid={`cal-item-${it.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{it.title}</p>
          <p className="text-xs text-charcoal-light truncate">{[it.party, it.site].filter(Boolean).join(" · ") || STATUS_LABELS[it.kind] || it.kind}</p>
        </div>
        <p className={cn("font-mono font-semibold whitespace-nowrap", inc ? "text-emerald-700" : "text-red-700")}>{inc ? "+" : "−"}{fmtTL(it.amount)}</p>
      </div>
      <div className="flex items-center gap-2 mt-2"><StatusBadge status={it.status} />{it.open && <span className={cn("text-[11px] font-mono", it.days_left < 0 ? "text-red-700" : it.days_left <= 3 ? "text-amber-700" : "text-charcoal-light")}>{it.days_left < 0 ? `${-it.days_left} gün gecikti` : it.days_left === 0 ? "bugün" : `${it.days_left} gün kaldı`}</span>}</div>
    </Link>
  );
}

export default function Calendar() {
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState("hepsi");
  const month = ym(cur);
  const { data, isLoading } = useQuery({ queryKey: ["calendar", month], queryFn: () => api.get("/calendar", { params: { month } }).then((r) => r.data) });
  const items = (data?.items || []).filter((i) => filter === "hepsi" || (filter === "alinan" ? i.direction === "alinan" : filter === "verilen" ? i.direction === "verilen" : i.open));
  const byDay = {};
  items.forEach((i) => { const d = byDay[i.date] || (byDay[i.date] = { in: 0, out: 0, count: 0, open: 0 }); d.count++; if (i.open) { d.open++; d[i.direction === "alinan" ? "in" : "out"] += i.amount; } });
  const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const dim = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => ({ n: i + 1, iso: `${month}-${String(i + 1).padStart(2, "0")}` }))];
  const todayIso = new Date().toISOString().slice(0, 10);
  const selItems = sel ? items.filter((i) => i.date === sel) : [];
  const shift = (k) => { setSel(null); setCur(new Date(cur.getFullYear(), cur.getMonth() + k, 1)); };

  return (
    <div data-testid="calendar-page">
      <PageHeader eyebrow="Vade Takvimi" title="Çek ve Ödeme Vadeleri" subtitle="Alınan çekler yeşil (giriş), verilen çek ve sabit ödemeler kırmızı (çıkış). Güne dokununca detay açılır." />
      <div className="gold-card p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="w-9 h-9 rounded-full border border-gold-border flex items-center justify-center hover:bg-gold-bg" data-testid="cal-prev"><ChevronLeft className="w-4 h-4" /></button>
            <h2 className="font-serif text-xl md:text-2xl font-bold min-w-[160px] text-center" data-testid="cal-month-label">{MONTHS[cur.getMonth()]} {cur.getFullYear()}</h2>
            <button onClick={() => shift(1)} className="w-9 h-9 rounded-full border border-gold-border flex items-center justify-center hover:bg-gold-bg" data-testid="cal-next"><ChevronRight className="w-4 h-4" /></button>
            <button onClick={() => { setCur(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); setSel(todayIso); }} className="text-xs text-gold underline ml-1" data-testid="cal-today">Bugün</button>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {[["hepsi", "Hepsi"], ["acik", "Açık"], ["alinan", "Girişler"], ["verilen", "Çıkışlar"]].map(([k, l]) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)} data-testid={`cal-filter-${k}`}>{l}</Chip>)}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
          <div className="soft-card p-2 md:p-3"><p className="text-[10px] uppercase tracking-wider text-charcoal-light">Beklenen Giriş</p><p className="font-mono font-semibold text-emerald-700 text-xs md:text-base" data-testid="cal-total-in">{fmtTL(data?.totals?.in)}</p></div>
          <div className="soft-card p-2 md:p-3"><p className="text-[10px] uppercase tracking-wider text-charcoal-light">Beklenen Çıkış</p><p className="font-mono font-semibold text-red-700 text-xs md:text-base" data-testid="cal-total-out">{fmtTL(data?.totals?.out)}</p></div>
          <div className="soft-card p-2 md:p-3"><p className="text-[10px] uppercase tracking-wider text-charcoal-light">Net</p><p className={cn("font-mono font-semibold text-xs md:text-base", (data?.totals?.net || 0) >= 0 ? "text-emerald-700" : "text-red-700")} data-testid="cal-total-net">{fmtTL(data?.totals?.net)}</p></div>
        </div>
        <div className="grid grid-cols-7 gap-1 md:gap-2 mb-1">{DOW.map((d) => <p key={d} className="text-[11px] text-center font-semibold text-charcoal-light">{d}</p>)}</div>
        <div className={cn("grid grid-cols-7 gap-1 md:gap-2", isLoading && "opacity-50")} data-testid="cal-grid">
          {cells.map((c, i) => <DayCell key={i} day={c} info={c ? byDay[c.iso] : null} isToday={c?.iso === todayIso} selected={c?.iso === sel} onClick={() => setSel(c.iso)} />)}
        </div>
        {!isLoading && items.length === 0 && <div className="mt-4"><EmptyState title="Bu ayda vade yok" desc="Çek veya sabit ödeme eklendiğinde vadeleri burada görünür." testId="cal-empty" /></div>}
      </div>

      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[80vh] overflow-y-auto" data-testid="cal-day-sheet">
          <SheetHeader><SheetTitle className="font-serif text-2xl flex items-center gap-2"><CalendarDays className="w-5 h-5 text-gold" />{sel && fmtDate(sel)}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-2" data-testid="cal-day-items">
            {selItems.length === 0 && <p className="text-sm text-charcoal-light">Bu günde vade yok.</p>}
            {selItems.map((it) => <ItemRow key={it.id} it={it} />)}
          </div>
          {selItems.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 text-center">
              <div className="soft-card p-2"><p className="text-[10px] uppercase text-charcoal-light">Giriş</p><p className="font-mono text-emerald-700 font-semibold">{fmtTL(selItems.filter((i) => i.open && i.direction === "alinan").reduce((a, b) => a + b.amount, 0))}</p></div>
              <div className="soft-card p-2"><p className="text-[10px] uppercase text-charcoal-light">Çıkış</p><p className="font-mono text-red-700 font-semibold">{fmtTL(selItems.filter((i) => i.open && i.direction === "verilen").reduce((a, b) => a + b.amount, 0))}</p></div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
