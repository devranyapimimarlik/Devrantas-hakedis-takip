import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Apple, Upload, CheckCircle2, AlertTriangle, Loader2, Trash2 } from "lucide-react";

export function ApnsKeyCard() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: ["native-config"], queryFn: () => api.get("/push/native-config").then((r) => r.data), enabled: isManager });
  if (!isManager) return null;
  const ready = !!data?.ios;
  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post("/push/apns-key", fd, { headers: { "Content-Type": "multipart/form-data" } });
      qc.invalidateQueries({ queryKey: ["native-config"] });
      toast.success("Apple anahtarı yüklendi — iPhone bildirimleri hazır");
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); e.target.value = ""; }
  };
  const remove = async () => { await api.delete("/push/apns-key"); qc.invalidateQueries({ queryKey: ["native-config"] }); toast.success("Anahtar kaldırıldı"); };
  return (
    <div className="soft-card p-5 space-y-3" data-testid="apns-key-card">
      <div className="flex items-center gap-2"><Apple className="w-5 h-5 text-charcoal" /><p className="font-semibold">App Store Uygulaması — iPhone Bildirim Anahtarı</p></div>
      <p className="text-xs text-charcoal-light">Apple Developer'dan indirdiğiniz <b>AuthKey_XXXXXXXXXX.p8</b> dosyasını buradan seçin. Metin kopyalamaya gerek yok.</p>
      <div className={`flex items-center gap-2 text-sm rounded-xl px-3 py-2 ${ready ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`} data-testid="apns-status">
        {ready ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
        <span>{ready ? `Hazır${data?.apns_key_file?.filename ? ` · ${data.apns_key_file.filename}` : ""} · ${data?.sandbox ? "Sandbox (Xcode/TestFlight)" : "Production (App Store)"}` : !data?.key_id_set || !data?.team_id_set ? "Key ID / Team ID eksik" : "Anahtar dosyası bekleniyor"}</span>
      </div>
      <input ref={ref} type="file" accept=".p8,.pem,text/plain,application/x-pem-file,application/octet-stream" className="hidden" onChange={pick} data-testid="apns-key-input" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => ref.current?.click()} disabled={busy} className="bg-charcoal hover:bg-black text-white" data-testid="apns-key-upload">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}{data?.apns_key_file ? ".p8 dosyasını değiştir" : ".p8 dosyasını yükle"}</Button>
        {data?.apns_key_file && <Button variant="ghost" onClick={remove} className="text-red-700" data-testid="apns-key-remove"><Trash2 className="w-4 h-4 mr-2" />Kaldır</Button>}
      </div>
    </div>
  );
}
