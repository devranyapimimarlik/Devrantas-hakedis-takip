import { cn } from "@/lib/utils";
import { fmtTL, STATUS_LABELS, STATUS_TONE } from "@/lib/format";
import { Inbox } from "lucide-react";

export function PageHeader({ eyebrow, title, subtitle, actions, testId }) {
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8 fade-up" data-testid={testId}>
      <div>
        {eyebrow && <p className="label-gold mb-2">{eyebrow}</p>}
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-serif font-bold text-charcoal">{title}</h1>
        {subtitle && <p className="text-sm md:text-base text-charcoal-light mt-2 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = "gold", testId, className, delay = 0 }) {
  const tones = {
    gold: "text-gold", green: "text-emerald-700", red: "text-red-700", amber: "text-amber-700", blue: "text-blue-700", gray: "text-charcoal-light",
  };
  return (
    <div className={cn("gold-card p-5 fade-up", className)} style={{ animationDelay: `${delay}ms` }} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <p className="label-gold">{label}</p>
        {Icon && <Icon className={cn("w-4 h-4 shrink-0", tones[tone])} />}
      </div>
      <p className={cn("money text-xl md:text-2xl font-semibold mt-3 break-words", tones[tone])}>{value}</p>
      {hint && <p className="text-xs text-charcoal-muted mt-1.5">{hint}</p>}
    </div>
  );
}

export function Money({ value, className, signed = false, ...rest }) {
  const n = Number(value || 0);
  return (
    <span {...rest} className={cn("money", signed && (n < 0 ? "text-red-700" : "text-emerald-700"), className)}>
      {signed && n > 0 ? "+" : ""}{fmtTL(n)}
    </span>
  );
}

export function StatusBadge({ status, className, testId }) {
  const tone = STATUS_TONE[status] || "gray";
  const map = {
    gold: "bg-gold-bg text-gold border-gold-border", green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200", amber: "bg-amber-50 text-amber-700 border-amber-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200", gray: "bg-stone-100 text-stone-600 border-stone-200",
  };
  return (
    <span data-testid={testId} className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold border whitespace-nowrap", map[tone], className)}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function EmptyState({ title = "Kayıt bulunamadı", desc, action, testId }) {
  return (
    <div className="border border-dashed border-gold-border rounded-xl py-14 px-6 text-center bg-white/60" data-testid={testId}>
      <Inbox className="w-8 h-8 mx-auto text-gold-light" />
      <p className="font-serif text-xl text-charcoal mt-3">{title}</p>
      {desc && <p className="text-sm text-charcoal-light mt-1">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, children, className, hint }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-semibold text-charcoal-light">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-charcoal-muted">{hint}</span>}
    </label>
  );
}

export function OverheadTag({ amount, rate = 6 }) {
  return (
    <span className="bg-gold-bg border border-gold-border text-gold-dark rounded-md px-2.5 py-1 text-[11px] font-mono" data-testid="overhead-tag">
      %{rate} Genel Gider: {fmtTL(amount)}
    </span>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg md:text-xl font-serif font-semibold text-charcoal">{children}</h2>
      {right}
    </div>
  );
}
