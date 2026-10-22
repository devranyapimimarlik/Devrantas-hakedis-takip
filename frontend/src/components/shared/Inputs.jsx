import { cn } from "@/lib/utils";

const base = "w-full min-w-0 max-w-full h-11 md:h-10 rounded-xl border border-gold-border bg-[#FDFBF7] px-3 text-sm text-charcoal focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold transition-colors disabled:opacity-60";

export function NInput({ className, ...p }) {
  return <input className={cn(base, className)} {...p} />;
}

export function NSelect({ className, children, ...p }) {
  return <select className={cn(base, "appearance-none", className)} {...p}>{children}</select>;
}

export function NTextarea({ className, ...p }) {
  return <textarea className={cn(base, "h-auto min-h-[90px] py-2", className)} {...p} />;
}

export function GoldButton({ className, variant = "solid", size = "md", ...p }) {
  const v = {
    solid: "text-white shadow-sm bg-gradient-to-r from-gold via-gold-light to-gold-dark hover:brightness-105",
    outline: "border border-gold-border bg-white text-charcoal hover:border-gold hover:text-gold",
    ghost: "text-charcoal-light hover:bg-gold-bg hover:text-charcoal",
    danger: "bg-red-700 text-white hover:bg-red-800",
    dark: "bg-charcoal text-gold-light hover:bg-black",
  }[variant];
  const s = { md: "h-11 md:h-10 px-5 text-sm", sm: "h-9 px-4 text-xs", lg: "h-12 px-6 text-base" }[size];
  return <button className={cn("inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap", v, s, className)} {...p} />;
}

export function Chip({ active, className, ...p }) {
  return <button type="button" className={cn("h-10 px-4 rounded-full text-sm font-medium border whitespace-nowrap transition-all shrink-0",
    active ? "text-white border-transparent bg-gradient-to-r from-gold to-gold-dark shadow-sm" : "bg-white border-gold-border text-charcoal hover:border-gold", className)} {...p} />;
}
