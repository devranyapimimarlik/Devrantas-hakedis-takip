import { useState } from "react";
import { ArrowRightLeft, Copy, Check, Smartphone, Trash2, Share, PlusSquare, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export const LIVE_URL = "https://hakedis-takip-3.emergent.host";

const STEPS = {
  ios: [
    { icon: Trash2, t: "Eski kısayolu kaldır", d: "Ana ekranda eski Devrantaş simgesine basılı tutun → 'Uygulamayı Kaldır' → 'Ana Ekrandan Kaldır'. Verileriniz silinmez; kayıtlar sunucuda durur." },
    { icon: Smartphone, t: "Safari ile kalıcı adresi aç", d: "Safari'de aşağıdaki adresi açın (Chrome değil, Safari olmalı). Kullanıcı adı ve şifrenizle giriş yapın." },
    { icon: Share, t: "Paylaş → Ana Ekrana Ekle", d: "Alt ortadaki Paylaş (kare-ok) simgesine dokunun, listede 'Ana Ekrana Ekle' seçin, sağ üstten 'Ekle' deyin." },
    { icon: PlusSquare, t: "Yeni simgeden aç", d: "Yeni simge logonuzla gelir. İlk açılışta 'Bildirimlere izin ver' sorusunu onaylayın." },
  ],
  android: [
    { icon: Trash2, t: "Eski kısayolu kaldır", d: "Eski simgeye basılı tutun → 'Kaldır'. Veriler sunucuda kalır, hiçbir kayıt silinmez." },
    { icon: Smartphone, t: "Chrome ile kalıcı adresi aç", d: "Chrome'da aşağıdaki adresi açın ve giriş yapın." },
    { icon: MoreVertical, t: "Menü (⋮) → Ana ekrana ekle / Uygulamayı yükle", d: "Sağ üstteki üç noktaya dokunun; 'Uygulamayı yükle' veya 'Ana ekrana ekle' seçin ve onaylayın." },
    { icon: PlusSquare, t: "Yeni simgeden aç", d: "Yeni simgeden girip bildirim iznini onaylayın." },
  ],
};

export const MigrationGuide = () => {
  const [os, setOs] = useState(/iphone|ipad/i.test(navigator.userAgent) ? "ios" : "android");
  const [copied, setCopied] = useState(false);
  const onLive = window.location.origin === LIVE_URL;
  const copy = async () => {
    try { await navigator.clipboard.writeText(LIVE_URL); setCopied(true); toast.success("Adres kopyalandı"); setTimeout(() => setCopied(false), 2000); }
    catch { toast.error("Kopyalanamadı, adresi elle yazın"); }
  };
  return (
    <div className="gold-card p-5 sm:p-6" data-testid="migration-guide">
      <div className="flex items-start gap-3 mb-4">
        <ArrowRightLeft className="w-6 h-6 text-gold shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-serif text-lg font-bold">Kalıcı adrese geçiş</p>
          <p className="text-sm text-charcoal-light">Önizleme adresi değişebilir; ana ekran kısayolunuzu kalıcı adresle yeniden kurun. Tüm kayıtlarınız kalıcı adreste hazır.</p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white rounded-xl border border-gold-border p-3 mb-4">
        <code className="flex-1 text-sm font-mono break-all text-charcoal" data-testid="migration-live-url">{LIVE_URL}</code>
        <div className="flex gap-2">
          <Button onClick={copy} size="sm" variant="outline" className="border-gold-border" data-testid="migration-copy-url">{copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />} Kopyala</Button>
          {!onLive && <Button asChild size="sm" className="bg-gold hover:bg-gold-dark text-white"><a href={LIVE_URL} target="_blank" rel="noreferrer" data-testid="migration-open-live">Kalıcı adresi aç</a></Button>}
        </div>
      </div>
      {onLive && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4" data-testid="migration-on-live">Şu an kalıcı adrestesiniz. Ana ekrana bu adresten ekleyin.</p>}
      <div className="flex gap-2 mb-4">
        {[["ios", "iPhone / iPad"], ["android", "Android"]].map(([k, l]) => (
          <button key={k} onClick={() => setOs(k)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${os === k ? "bg-charcoal text-white border-charcoal" : "bg-white border-stone-200 text-charcoal-light"}`} data-testid={`migration-os-${k}`}>{l}</button>
        ))}
      </div>
      <ol className="space-y-3">
        {STEPS[os].map((s, i) => (
          <li key={s.t} className="flex gap-3" data-testid={`migration-step-${os}-${i + 1}`}>
            <span className="w-6 h-6 rounded-full bg-gold text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
            <div><p className="text-sm font-semibold flex items-center gap-1.5"><s.icon className="w-3.5 h-3.5 text-gold" />{s.t}</p><p className="text-xs text-charcoal-light">{s.d}</p></div>
          </li>
        ))}
      </ol>
    </div>
  );
};
