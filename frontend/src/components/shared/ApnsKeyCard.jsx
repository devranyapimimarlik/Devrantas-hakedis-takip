import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Apple, Upload, CheckCircle2, AlertTriangle, Loader2, Trash2, Smartphone } from "lucide-react";

function KeyUpload({ endpoint, accept, label, hint, fileInfo, ready, statusText, icon: Icon, testId, successMsg }) {
  const qc = useQueryClient();
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post(endpoint, fd, { headers: { "Content-Type": "multipart/form-data" } });
      qc.invalidateQueries({ queryKey: ["native-config"] });
      toast.success(successMsg);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); e.target.value = ""; }
  };
  const remove = async () => { await api.delete(endpoint); qc.invalidateQueries({ queryKey: ["native-config"] }); toast.success("Anahtar kaldırıldı"); };
  return (
    <div className="soft-card p-5 space-y-3" data-testid={`${testId}-card`}>
      <div className="flex items-center gap-2"><Icon className="w-5 h-5 text-charcoal" /><p className="font-semibold">{label}</p></div>
      <p className="text-xs text-charcoal-light">{hint}</p>
      <div className={`flex items-center gap-2 text-sm rounded-xl px-3 py-2 ${ready ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`} data-testid={`${testId}-status`}>
        {ready ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}<span>{statusText}</span>
      </div>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={pick} data-testid={`${testId}-input`} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => ref.current?.click()} disabled={busy} className="bg-charcoal hover:bg-black text-white" data-testid={`${testId}-upload`}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}{fileInfo ? "Dosyayı değiştir" : "Dosyayı yükle"}</Button>
        {fileInfo && <Button variant="ghost" onClick={remove} className="text-red-700" data-testid={`${testId}-remove`}><Trash2 className="w-4 h-4 mr-2" />Kaldır</Button>}
      </div>
    </div>
  );
}

export function ApnsKeyCard() {
  const { isManager } = useAuth();
  const { data } = useQuery({ queryKey: ["native-config"], queryFn: () => api.get("/push/native-config").then((r) => r.data), enabled: isManager });
  if (!isManager) return null;
  const iosReady = !!data?.ios;
  const iosStatus = iosReady ? `Hazır${data?.apns_key_file?.filename ? ` · ${data.apns_key_file.filename}` : ""} · ${data?.sandbox ? "Sandbox (Xcode/TestFlight)" : "Production (App Store)"}` : !data?.key_id_set || !data?.team_id_set ? "Key ID / Team ID eksik" : "Anahtar dosyası bekleniyor";
  const andReady = !!data?.android;
  const andStatus = andReady ? `Hazır${data?.fcm_key_file?.project_id ? ` · Firebase projesi: ${data.fcm_key_file.project_id}` : ""}` : "Firebase servis hesabı JSON dosyası bekleniyor";
  return (
    <>
      <KeyUpload endpoint="/push/apns-key" accept=".p8,.pem,text/plain,application/x-pem-file,application/octet-stream" icon={Apple} testId="apns-key"
        label="App Store Uygulaması — iPhone Bildirim Anahtarı" hint={<>Apple Developer'dan indirdiğiniz <b>AuthKey_XXXXXXXXXX.p8</b> dosyasını seçin. Metin kopyalamaya gerek yok.</>}
        fileInfo={data?.apns_key_file} ready={iosReady} statusText={iosStatus} successMsg="Apple anahtarı yüklendi — iPhone bildirimleri hazır" />
      <KeyUpload endpoint="/push/fcm-key" accept=".json,application/json" icon={Smartphone} testId="fcm-key"
        label="Google Play Uygulaması — Android Bildirim Anahtarı" hint={<>Firebase Console → Proje Ayarları → <b>Servis hesapları</b> → <b>Yeni özel anahtar oluştur</b> ile inen JSON dosyasını seçin. Ayrıca <b>google-services.json</b> dosyasını <code>mobile/android/app/</code> klasörüne koyun.</>}
        fileInfo={data?.fcm_key_file} ready={andReady} statusText={andStatus} successMsg="Firebase anahtarı yüklendi — Android bildirimleri hazır" />
    </>
  );
}
