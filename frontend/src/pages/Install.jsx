import { PageHeader } from "@/components/shared/Bits";
import { InstallGuide } from "@/components/shared/PwaInstall";
import { PushToggle } from "@/components/shared/PushToggle";
import { useSettings } from "@/context/SettingsContext";
import { ShieldCheck, WifiOff, Bell, Palette } from "lucide-react";

const PERKS = [
  { icon: Palette, t: "Logonuz ve renginiz", d: "Ana ekran simgesi ve açılış ekranı firma logonuzla gelir." },
  { icon: ShieldCheck, t: "Tam ekran, uygulama gibi", d: "Tarayıcı çubuğu olmadan, bildirim rozetli, hızlı açılış." },
  { icon: WifiOff, t: "Zayıf internette dayanıklı", d: "Son açılan ekranlar önbellekte tutulur, bağlantı gelince yenilenir." },
  { icon: Bell, t: "Günlük özet ve uyarılar", d: "Vadesi gelen çek ve ödemeler zil rozetiyle görünür." },
];

export default function Install() {
  const { settings, logoUrl } = useSettings();
  return (
    <div data-testid="install-page">
      <PageHeader title="Telefona Kur (iOS ve Android)" subtitle="Mağaza gerekmez; uygulama tarayıcıdan tek dokunuşla iPhone ve Android ana ekranına kurulur." />
      <div className="gold-card p-6 mb-6 flex items-center gap-5">
        <img src={logoUrl} alt="" className="w-20 h-20 rounded-[22%] object-contain bg-white shadow-lg" data-testid="install-icon-preview" />
        <div><p className="font-serif text-2xl font-bold">{settings?.short_name || "Devrantaş"}</p><p className="text-sm text-charcoal-light">Ana ekranda bu simge ve bu isimle görünür. Görünüm sayfasından logo/renk değiştirince simge de güncellenir.</p></div>
      </div>
      <InstallGuide />
      <div className="mt-6"><PushToggle /></div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {PERKS.map((p) => (
          <div key={p.t} className="soft-card p-4 flex gap-3"><p.icon className="w-5 h-5 text-gold shrink-0 mt-0.5" /><div><p className="text-sm font-semibold">{p.t}</p><p className="text-xs text-charcoal-light">{p.d}</p></div></div>
        ))}
      </div>
    </div>
  );
}
