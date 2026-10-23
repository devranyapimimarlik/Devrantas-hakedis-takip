import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { Field } from "@/components/shared/Bits";
import { NInput, GoldButton } from "@/components/shared/Inputs";
import { toast } from "sonner";
import { Download, Upload, ArrowRightLeft, Loader2, Database } from "lucide-react";

const LABELS = { users: "Kullanıcı", sites: "Şantiye", accounts: "Cari", transactions: "İşlem", checks: "Çek", payments: "Sabit ödeme", progress_payments: "Hakediş", proposals: "Teklif", contracts: "Sözleşme", site_photos: "Fotoğraf", files: "Dosya" };
const SRC_DEFAULT = window.location.hostname.endsWith("emergent.host") ? "https://hakedis-takip-3.preview.emergentagent.com" : "";

export function DataTransfer() {
  const qc = useQueryClient();
  const ref = useRef();
  const [src, setSrc] = useState({ source_url: SRC_DEFAULT, email: "", password: "" });
  const [preview, setPreview] = useState(null);
  const { data: stats } = useQuery({ queryKey: ["admin-stats"], queryFn: () => api.get("/admin/stats").then((r) => r.data) });
  const done = (counts, msg) => { qc.invalidateQueries(); setPreview(null); toast.success(`${msg}: ${Object.entries(counts).filter(([k]) => LABELS[k]).map(([k, v]) => `${v} ${LABELS[k].toLowerCase()}`).join(", ")}`); };
  const pullPreview = useMutation({ mutationFn: () => api.post("/admin/pull", { ...src, dry_run: true }).then((r) => r.data.preview), onSuccess: setPreview, onError: (e) => toast.error(errMsg(e)) });
  const pull = useMutation({ mutationFn: () => api.post("/admin/pull", src).then((r) => r.data.counts), onSuccess: (c) => done(c, "Veriler aktarıldı"), onError: (e) => toast.error(errMsg(e)) });
  const imp = useMutation({
    mutationFn: (file) => { const fd = new FormData(); fd.append("file", file); return api.post("/admin/import", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data.counts); },
    onSuccess: (c) => done(c, "Yedek yüklendi"), onError: (e) => toast.error(errMsg(e)),
  });
  const exportAll = async () => {
    try {
      const r = await api.get("/admin/export", { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = `devrantas-yedek-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success("Yedek dosyası indirildi");
    } catch (e) { toast.error(errMsg(e)); }
  };
  const busy = pull.isPending || pullPreview.isPending || imp.isPending;
  return (
    <div className="gold-card p-5 space-y-5 mt-8" data-testid="data-transfer-card">
      <div className="flex items-center gap-2"><Database className="w-5 h-5 text-gold" /><h3 className="font-serif text-xl font-bold">Veri Taşıma ve Yedek</h3></div>
      {stats && <p className="text-xs text-charcoal-light" data-testid="data-stats">Bu uygulamada: {Object.entries(stats).filter(([k]) => LABELS[k]).map(([k, v]) => `${v} ${LABELS[k].toLowerCase()}`).join(" · ")}{stats.test_records > 0 && <span className="text-amber-700"> · {stats.test_records} TEST_ kaydı var</span>}</p>}

      <div className="rounded-2xl border border-gold-border p-4 space-y-3" data-testid="pull-section">
        <p className="font-semibold text-sm flex items-center gap-2"><ArrowRightLeft className="w-4 h-4 text-gold" />Diğer uygulamadan verileri buraya aktar</p>
        <p className="text-xs text-charcoal-light">Telefon ana ekranında kullandığınız uygulamanın adresini ve giriş bilgilerinizi yazın. <b>Buradaki tüm veriler silinir</b>, oradaki gerçek veriler (şantiye, cari, işlem, hakediş, çek, fotoğraf, logo ve kullanıcılar) buraya kopyalanır. Kaynaktaki veriler silinmez.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Kaynak adres"><NInput value={src.source_url} onChange={(e) => setSrc({ ...src, source_url: e.target.value })} placeholder="https://..." data-testid="pull-url-input" /></Field>
          <Field label="E-posta"><NInput type="email" value={src.email} onChange={(e) => setSrc({ ...src, email: e.target.value })} data-testid="pull-email-input" /></Field>
          <Field label="Şifre"><NInput type="password" value={src.password} onChange={(e) => setSrc({ ...src, password: e.target.value })} data-testid="pull-password-input" /></Field>
        </div>
        {preview && (
          <div className="rounded-xl bg-gold-bg p-3 text-sm" data-testid="pull-preview">
            <p className="font-semibold mb-1">Kaynakta bulunan veriler:</p>
            <p className="text-xs text-charcoal-light">{Object.entries(preview).filter(([k]) => LABELS[k]).map(([k, v]) => `${v} ${LABELS[k].toLowerCase()}`).join(" · ")}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!preview
            ? <GoldButton onClick={() => pullPreview.mutate()} disabled={busy || !src.source_url || !src.email || !src.password} data-testid="pull-preview-button">{pullPreview.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />} Kaynağı Kontrol Et</GoldButton>
            : <>
              <GoldButton variant="danger" onClick={() => window.confirm("Bu uygulamadaki TÜM veriler silinip kaynaktaki verilerle değiştirilecek. Devam edilsin mi?") && pull.mutate()} disabled={busy} data-testid="pull-confirm-button">{pull.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />} Evet, Verileri Aktar</GoldButton>
              <GoldButton variant="ghost" onClick={() => setPreview(null)} data-testid="pull-cancel-button">Vazgeç</GoldButton>
            </>}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-gold-border p-4 space-y-2">
          <p className="font-semibold text-sm flex items-center gap-2"><Download className="w-4 h-4 text-gold" />Yedek indir</p>
          <p className="text-xs text-charcoal-light">Tüm verileri tek dosya olarak telefonunuza/bilgisayarınıza kaydeder.</p>
          <GoldButton variant="outline" onClick={exportAll} data-testid="export-button"><Download className="w-4 h-4" /> Yedeği İndir (.json)</GoldButton>
        </div>
        <div className="rounded-2xl border border-gold-border p-4 space-y-2">
          <p className="font-semibold text-sm flex items-center gap-2"><Upload className="w-4 h-4 text-gold" />Yedekten geri yükle</p>
          <p className="text-xs text-charcoal-light">Daha önce indirilen yedek dosyasını seçin; buradaki veriler yedekle değiştirilir.</p>
          <input ref={ref} type="file" accept=".json,application/json" className="hidden" data-testid="import-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f && window.confirm("Buradaki tüm veriler yedek dosyasıyla değiştirilecek. Devam edilsin mi?")) imp.mutate(f); }} />
          <GoldButton variant="outline" onClick={() => ref.current?.click()} disabled={busy} data-testid="import-button">{imp.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Yedek Dosyası Seç</GoldButton>
        </div>
      </div>
    </div>
  );
}
