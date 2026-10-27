import { useState, useEffect } from "react";
import { NavLink, Outlet, useNavigate, Link } from "react-router-dom";
import { isNativeApp, registerNativePush } from "@/lib/native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  LayoutGrid, Building2, Users, HardHat, ReceiptText, FileText, BarChart3, Menu, LogOut, Bell,
  FileSignature, Banknote, CalendarClock, Sparkles, ShieldCheck, Wallet, Activity, UserCog, KeyRound, Palette, Smartphone, CalendarDays, Download,
} from "lucide-react";
import { InstallBanner } from "@/components/shared/PwaInstall";
import { OfflineBar } from "@/components/shared/OfflineQueue";

const TABS = [
  { to: "/", label: "Özet", icon: LayoutGrid, id: "dashboard" },
  { to: "/santiyeler", label: "Şantiye", icon: Building2, id: "sites" },
  { to: "/cari/musteri", label: "Müşteri", icon: Users, id: "customers" },
  { to: "/cari/taseron", label: "Taşeron", icon: HardHat, id: "subcontractors" },
  { to: "/islemler", label: "İşlemler", icon: ReceiptText, id: "transactions" },
  { to: "/hakedis", label: "Hakediş", icon: FileText, id: "progress" },
  { to: "/raporlar", label: "Raporlar", icon: BarChart3, id: "reports", perm: "view_reports" },
];

const MORE = [
  { to: "/islemler?tab=onay", label: "Onaylar ve Denetim Geçmişi", icon: ShieldCheck, id: "approvals" },
  { to: "/teklifler", label: "Teklifler", icon: FileSignature, id: "proposals" },
  { to: "/sozlesmeler", label: "Sözleşmeler", icon: FileSignature, id: "contracts" },
  { to: "/hakedis", label: "Hakedişler", icon: FileText, id: "progress" },
  { to: "/cekler", label: "Çekler", icon: Banknote, id: "checks" },
  { to: "/takvim", label: "Vade Takvimi", icon: CalendarDays, id: "calendar" },
  { to: "/odeme-takvimi", label: "Sabit Giderler (SSK, kredi, kira)", icon: CalendarClock, id: "payments" },
  { to: "/raporlar?tab=kasa", label: "Kasa / Banka", icon: Wallet, id: "cash", perm: "view_reports" },
  { to: "/kasalar", label: "Kasalar (ekle / düzenle)", icon: Wallet, id: "kasalar" },
  { to: "/raporlar?tab=para_akisi", label: "Para Akışı", icon: Activity, id: "cashflow" },
  { to: "/asistan", label: "Yapay Zeka Asistan", icon: Sparkles, id: "ai" },
  { to: "/yonetim/kullanicilar", label: "Yönetim (alt kullanıcılar ve yetkiler)", icon: UserCog, id: "users", admin: true },
  { to: "/ayarlar/gorunum", label: "Görünüm (logo ve renk)", icon: Palette, id: "appearance", admin: true },
  { to: "/telefona-kur", label: "Telefona kur (iOS / Android)", icon: Smartphone, id: "install" },
  { to: "/indir", label: "Uygulamayı indir (Windows · APK · TestFlight)", icon: Download, id: "downloads" },
  { to: "/sifre", label: "Şifremi değiştir", icon: KeyRound, id: "password" },
];

function MoreMenu({ open, onOpenChange }) {
  const { logout, isManager, can } = useAuth();
  const nav = useNavigate();
  const go = (to) => { onOpenChange(false); nav(to); };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl bg-[#FDFBF7] max-h-[88vh] overflow-y-auto px-5 pb-8" data-testid="more-menu">
        <SheetHeader><SheetTitle className="font-serif text-3xl text-center">Menü</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-3 max-w-2xl mx-auto">
          {MORE.filter((m) => (!m.admin || isManager) && (!m.perm || can(m.perm))).map((m) => (
            <button key={m.id} onClick={() => go(m.to)} data-testid={`more-${m.id}`}
              className="w-full text-left flex items-center gap-3 border border-gold-border bg-white rounded-full px-5 py-3.5 text-base text-charcoal hover:border-gold hover:bg-gold-bg/40 transition-colors">
              <m.icon className="w-4 h-4 text-gold shrink-0" />{m.label}
            </button>
          ))}
          <button onClick={() => logout().then(() => nav("/giris"))} className="flex items-center gap-2 text-red-700 font-medium px-4 py-3 text-base" data-testid="logout-button">
            <LogOut className="w-5 h-5" /> Çıkış yap
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AppLayout() {
  const { user, isManager, can } = useAuth();
  const { settings, logoUrl } = useSettings();
  const brand = settings?.short_name || "Devrantaş";
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  useEffect(() => { if (isNativeApp()) registerNativePush(nav).catch(() => {}); }, [nav]);
  const { data: rem } = useQuery({ queryKey: ["reminders"], queryFn: () => api.get("/reminders").then((r) => r.data), refetchInterval: 60000 });
  const { data: pend } = useQuery({ queryKey: ["pending-count"], queryFn: () => api.get("/transactions", { params: { status: "onay_bekliyor" } }).then((r) => r.data.length), refetchInterval: 60000 });

  const linkCls = ({ isActive }) => cn("flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-colors",
    isActive ? "bg-gradient-to-r from-gold to-gold-dark text-white shadow-sm" : "text-charcoal-light hover:bg-gold-bg hover:text-charcoal");

  return (
    <div className="min-h-screen flex overflow-x-hidden">
      <aside className="hidden lg:flex w-72 shrink-0 fixed inset-y-0 left-0 z-30 flex-col border-r border-gold-border/70 bg-[#F5F0E6]/70 backdrop-blur">
        <Link to="/" className="flex items-center gap-3 px-6 pt-6 pb-5">
          <img src={logoUrl} alt={brand} className="w-12 h-12 rounded-full shadow-sm object-contain" />
          <div><p className="font-serif text-2xl font-bold text-charcoal leading-none">{brand}</p><p className="text-xs text-charcoal-light mt-0.5">Yönetici paneli</p></div>
        </Link>
        <nav className="flex-1 overflow-y-auto px-4 pb-4 space-y-1" data-testid="sidebar-nav">
          {TABS.filter((n) => !n.perm || can(n.perm)).map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} className={linkCls} data-testid={`nav-${t.id}`}>
              <t.icon className="w-4 h-4" /><span className="flex-1">{t.label}</span>
              {t.id === "transactions" && pend > 0 && <span className="text-[10px] font-mono bg-amber-500 text-black px-1.5 rounded-full">{pend}</span>}
            </NavLink>
          ))}
          <p className="label-gold px-4 pt-5 pb-2">Diğer</p>
          {MORE.filter((m) => (!m.admin || isManager) && (!m.perm || can(m.perm))).map((m) => (
            <NavLink key={m.id} to={m.to} className={linkCls} data-testid={`nav-${m.id}`}>
              <m.icon className="w-4 h-4" /><span className="flex-1 truncate">{m.label}</span>
              {m.id === "payments" && rem?.total > 0 && <span className="text-[10px] font-mono bg-red-600 text-white px-1.5 rounded-full">{rem.total}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-1 lg:pl-72 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 backdrop-blur-md bg-[#FDFBF7]/85 border-b border-gold-border/70">
          <div className="flex items-center gap-3 px-4 md:px-8 h-[72px]">
            <img src={logoUrl} alt="" className="w-10 h-10 rounded-full lg:hidden object-contain" />
            <div className="lg:hidden"><p className="font-serif text-xl font-bold text-charcoal leading-none">{brand}</p><p className="text-[11px] text-charcoal-light">{isManager ? "Yönetici paneli" : STATUS_LABELS[user?.role]}</p></div>
            <div className="flex-1" />
            <button onClick={() => nav("/odeme-takvimi")} className="relative p-2 rounded-full hover:bg-gold-bg" data-testid="reminder-bell">
              <Bell className="w-5 h-5 text-charcoal-light" />
              {rem?.total > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-mono flex items-center justify-center">{rem.total}</span>}
            </button>
            <p className="hidden sm:block text-sm text-charcoal-light truncate max-w-[200px] md:max-w-none" data-testid="user-email">{user?.email}</p>
            <button onClick={() => setMore(true)} className="hidden lg:inline-flex p-2 rounded-full hover:bg-gold-bg" data-testid="desktop-more-button"><Menu className="w-5 h-5" /></button>
          </div>
        </header>
        <main className="flex-1 px-4 md:px-8 py-6 md:py-8 pb-28 lg:pb-10 max-w-[1500px] w-full"><OfflineBar /><InstallBanner /><Outlet /></main>
      </div>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[#FDFBF7]/95 backdrop-blur border-t border-gold-border/70 px-1 pb-[env(safe-area-inset-bottom)]" data-testid="bottom-nav">
        <div className="grid grid-cols-8">
          {TABS.filter((n) => !n.perm || can(n.perm)).map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} data-testid={`tab-${t.id}`}
              className={({ isActive }) => cn("flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] text-[10px] font-medium", isActive ? "text-gold" : "text-charcoal-light")}>
              <t.icon className="w-5 h-5" /><span className="truncate w-full text-center">{t.label}</span>
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className="flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] text-[10px] font-medium text-charcoal-light" data-testid="tab-more">
            <Menu className="w-5 h-5" /><span>Diğer</span>
          </button>
        </div>
      </nav>
      <MoreMenu open={more} onOpenChange={setMore} />
    </div>
  );
}
