import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { isOffline, isNetworkError } from "@/lib/offline";
import { Upload, X, Image as ImageIcon, Loader2, FileText, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function FileUpload({ value, onChange, label = "Dekont / Fiş Fotoğrafı", testId = "file-upload", localFile = null, onLocalFile }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (onLocalFile && isOffline()) { onLocalFile(f); setName(f.name); toast.info("Çevrimdışı: fotoğraf cihazda tutuldu, bağlantı gelince yüklenecek"); e.target.value = ""; return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange(data.id);
      setName(f.name);
      toast.success("Dosya yüklendi");
    } catch (err) {
      if (onLocalFile && isNetworkError(err)) { onLocalFile(f); setName(f.name); toast.info("Bağlantı yok: fotoğraf cihazda tutuldu, bağlantı gelince yüklenecek"); }
      else toast.error(errMsg(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const has = value || localFile;
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-semibold text-charcoal-light">{label}</span>
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={pick} data-testid={`${testId}-input`} />
      {has ? (
        <div className="flex items-center gap-2 border border-gold-border bg-gold-bg rounded-lg px-3 py-2 text-sm">
          {localFile ? <WifiOff className="w-4 h-4 text-amber-700" /> : <ImageIcon className="w-4 h-4 text-gold" />}
          <span className="truncate flex-1 text-charcoal">{name || localFile?.name || "Dosya eklendi"}{localFile ? " (çevrimdışı)" : ""}</span>
          <button type="button" onClick={() => { onChange(null); onLocalFile?.(null); setName(""); }} className="text-charcoal-muted hover:text-red-700" data-testid={`${testId}-remove`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => ref.current?.click()} data-testid={`${testId}-button`}
          className="w-full flex items-center justify-center gap-2 border border-dashed border-gold-border rounded-lg px-3 py-3 text-sm text-charcoal-light hover:bg-gold-bg hover:border-gold transition-colors min-h-[44px]">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {busy ? "Yükleniyor..." : "Fotoğraf / PDF seç (max 10MB)"}
        </button>
      )}
    </div>
  );
}

export function SecureImage({ fileId, className, alt = "Ek" }) {
  const [url, setUrl] = useState(null);
  const [type, setType] = useState("");
  useEffect(() => {
    if (!fileId) return;
    let obj;
    api.get(`/files/${fileId}`, { responseType: "blob" }).then((r) => {
      obj = URL.createObjectURL(r.data);
      setType(r.data.type);
      setUrl(obj);
    }).catch(() => setUrl("error"));
    return () => obj && URL.revokeObjectURL(obj);
  }, [fileId]);
  if (!fileId) return null;
  if (!url) return <div className={`bg-stone-100 animate-pulse rounded ${className}`} />;
  if (url === "error") return <div className={`bg-stone-100 rounded flex items-center justify-center text-xs text-charcoal-muted ${className}`}>Yüklenemedi</div>;
  if (type === "application/pdf") return <iframe title={alt} src={url} className={className} />;
  return <img src={url} alt={alt} className={className} />;
}

export function AttachmentButton({ fileId, testId }) {
  const [open, setOpen] = useState(false);
  if (!fileId) return <span className="text-xs text-charcoal-muted">-</span>;
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-gold hover:underline" data-testid={testId}>
        <FileText className="w-3.5 h-3.5" /> Görüntüle
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="font-serif">Ek Görüntüsü</DialogTitle></DialogHeader>
          <SecureImage fileId={fileId} className="w-full max-h-[70vh] object-contain rounded-lg" />
        </DialogContent>
      </Dialog>
    </>
  );
}
