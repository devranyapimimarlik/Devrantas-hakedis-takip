import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, LOGO_URL } from "@/lib/api";

const Ctx = createContext(null);

function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
export function applyTheme(primary) {
  if (!/^#[0-9a-fA-F]{6}$/.test(primary || "")) return;
  const c = hexToRgb(primary), white = [255, 255, 255], black = [0, 0, 0];
  const root = document.documentElement.style;
  root.setProperty("--gold", c.join(" "));
  root.setProperty("--gold-light", mix(c, white, 0.25).join(" "));
  root.setProperty("--gold-dark", mix(c, black, 0.25).join(" "));
  root.setProperty("--gold-bg", mix(c, white, 0.9).join(" "));
  root.setProperty("--gold-border", mix(c, white, 0.72).join(" "));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", primary);
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [logoVersion, setLogoVersion] = useState(Date.now());
  const refresh = useCallback(async () => {
    const { data } = await api.get("/settings");
    setSettings(data);
    applyTheme(data.primary_color);
    setLogoVersion(Date.now());
    document.title = `${data.short_name} ${data.tagline || ""} | Şantiye Finans Yönetimi`.trim();
    return data;
  }, []);
  useEffect(() => { refresh().catch(() => {}); }, [refresh]);
  const logoUrl = `${LOGO_URL}?v=${logoVersion}`;
  return <Ctx.Provider value={{ settings, refresh, logoUrl, applyTheme }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx) || { settings: null, logoUrl: LOGO_URL, refresh: async () => {}, applyTheme };

export function DocHeader({ title }) {
  const { settings, logoUrl } = useSettings();
  const name = settings?.company_name || "";
  const short = settings?.short_name || "";
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><img src={logoUrl} alt={short} className="w-14 h-14 rounded-full object-contain" /><div><p className="font-serif text-2xl font-bold tracking-wide uppercase">{short}</p><p className="text-[11px] text-charcoal-light tracking-wider uppercase">{name.replace(new RegExp("^" + short, "i"), "").trim()}</p></div></div>
        <p className="font-serif text-2xl md:text-3xl text-gold font-bold">{title}</p>
      </div>
      <div className="border-t-2 border-gold my-5" />
    </>
  );
}

export function DocFooter() {
  const { settings: s } = useSettings();
  if (!s) return null;
  return (
    <div className="border-t border-gold-border mt-8 pt-5 text-center text-xs text-charcoal-light space-y-1">
      <p className="font-semibold text-charcoal text-sm">{s.company_name}</p>{s.address && <p>{s.address}</p>}
      <p>{[s.phone && `Tel: ${s.phone}`, s.email && `E-posta: ${s.email}`].filter(Boolean).join(" · ")}</p>
      {(s.tax_office || s.tax_no) && <p>{[s.tax_office && `V.D.: ${s.tax_office}`, s.tax_no && `VKN: ${s.tax_no}`].filter(Boolean).join(" · ")}</p>}
    </div>
  );
}
