import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { fmtDate, today } from "@/lib/format";
import { Field, SectionTitle } from "@/components/shared/Bits";
import { NInput, GoldButton } from "@/components/shared/Inputs";
import { FileUpload, SecureImage } from "@/components/shared/FileUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Camera, Trash2, Plus } from "lucide-react";

export function SitePhotos({ siteId }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);
  const [f, setF] = useState({ file_id: null, date: today(), note: "", progress_percent: "" });
  const { data = [] } = useQuery({ queryKey: ["site-photos", siteId], queryFn: () => api.get(`/sites/${siteId}/photos`).then((r) => r.data) });
  const inv = () => { qc.invalidateQueries({ queryKey: ["site-photos", siteId] }); qc.invalidateQueries({ queryKey: ["site", siteId] }); };
  const add = useMutation({
    mutationFn: () => api.post(`/sites/${siteId}/photos`, { ...f, progress_percent: f.progress_percent === "" ? null : Number(f.progress_percent) }),
    onSuccess: () => { inv(); setOpen(false); setF({ file_id: null, date: today(), note: "", progress_percent: "" }); toast.success("Fotoğraf günlüğe eklendi"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({ mutationFn: (id) => api.delete(`/sites/${siteId}/photos/${id}`), onSuccess: () => { inv(); toast.success("Silindi"); } });
  return (
    <div className="gold-card p-5 md:p-6" data-testid="site-photos-card">
      <SectionTitle right={<GoldButton size="sm" onClick={() => setOpen(true)} data-testid="add-photo-button"><Plus className="w-3.5 h-3.5" /> Fotoğraf Ekle</GoldButton>}><span className="inline-flex items-center gap-2"><Camera className="w-5 h-5 text-gold" /> Fotoğraf Günlüğü</span></SectionTitle>
      <p className="text-xs text-charcoal-muted -mt-2 mb-3">Tarihli ilerleme fotoğrafları; hakediş PDF'ine döneme ait kareler otomatik eklenir.</p>
      {data.length === 0 ? <p className="text-sm text-charcoal-muted">Henüz fotoğraf yok</p> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="site-photos-grid">
          {data.map((p) => (
            <div key={p.id} className="group relative rounded-xl overflow-hidden border border-gold-border bg-stone-50" data-testid={`site-photo-${p.id}`}>
              <button type="button" onClick={() => setView(p)} className="block w-full"><SecureImage fileId={p.file_id} className="w-full h-32 object-cover" alt={p.note} /></button>
              <div className="px-2 py-1.5 text-[11px] leading-tight"><p className="font-mono text-gold-dark">{fmtDate(p.date)}{p.progress_percent != null ? ` · %${p.progress_percent}` : ""}</p>{p.note && <p className="truncate text-charcoal-light">{p.note}</p>}</div>
              <button onClick={() => window.confirm("Fotoğraf silinsin mi?") && del.mutate(p.id)} className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-white/90 text-red-700 opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`delete-photo-${p.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="font-serif text-2xl">İlerleme Fotoğrafı</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!f.file_id) return toast.error("Fotoğraf seçin"); add.mutate(); }} className="space-y-4" data-testid="photo-form">
            <FileUpload value={f.file_id} onChange={(id) => setF({ ...f, file_id: id })} label="Fotoğraf" testId="photo-upload" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tarih"><NInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required data-testid="photo-date-input" /></Field>
              <Field label="İlerleme % (isteğe bağlı)" hint="Girilirse şantiye ilerlemesi güncellenir"><NInput type="number" min="0" max="100" value={f.progress_percent} onChange={(e) => setF({ ...f, progress_percent: e.target.value })} data-testid="photo-progress-input" /></Field>
            </div>
            <Field label="Not"><NInput value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="ör. 2. kat kalıp tamamlandı" data-testid="photo-note-input" /></Field>
            <GoldButton type="submit" disabled={add.isPending} className="w-full" data-testid="photo-submit-button">Günlüğe Ekle</GoldButton>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!view} onOpenChange={() => setView(null)}>
        <DialogContent className="max-w-3xl"><DialogHeader><DialogTitle className="font-serif">{view && fmtDate(view.date)} {view?.note}</DialogTitle></DialogHeader>{view && <SecureImage fileId={view.file_id} className="w-full max-h-[70vh] object-contain rounded-lg" />}</DialogContent>
      </Dialog>
    </div>
  );
}
