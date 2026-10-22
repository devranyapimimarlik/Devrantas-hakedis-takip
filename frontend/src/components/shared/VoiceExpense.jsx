import { useRef, useState, useEffect } from "react";
import { api, errMsg } from "@/lib/api";
import { toast } from "sonner";
import { Mic, Square, Loader2, Sparkles } from "lucide-react";

const MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", ""].find((m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m)));

export function VoiceExpense({ onResult }) {
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
  const [state, setState] = useState("idle");
  const [secs, setSecs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const rec = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);

  useEffect(() => () => { clearInterval(timer.current); rec.current?.stream?.getTracks().forEach((t) => t.stop()); }, []);

  const send = async (blob) => {
    setState("processing");
    try {
      const fd = new FormData();
      const ext = (blob.type || "audio/webm").includes("mp4") ? "mp4" : (blob.type || "").includes("ogg") ? "ogg" : "webm";
      fd.append("audio", blob, `kayit.${ext}`);
      const { data } = await api.post("/voice/expense", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setTranscript(data.transcript);
      onResult(data);
      toast.success(data.amount ? `Anlaşıldı: ${Number(data.amount).toLocaleString("tr-TR")} ₺ · ${data.category}` : "Anlaşıldı — tutarı kontrol edin");
    } catch (e) { toast.error(errMsg(e)); } finally { setState("idle"); }
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); clearInterval(timer.current); send(new Blob(chunks.current, { type: mr.mimeType || "audio/webm" })); };
      mr.start();
      rec.current = mr;
      setSecs(0);
      setState("recording");
      timer.current = setInterval(() => setSecs((s) => { if (s + 1 >= 20) stop(); return s + 1; }), 1000);
    } catch { toast.error("Mikrofona erişilemedi. Tarayıcı izinlerini kontrol edin."); }
  };
  const stop = () => { if (rec.current?.state === "recording") rec.current.stop(); };

  if (!supported) return null;
  return (
    <div className="rounded-2xl border border-gold-border bg-gold-bg p-3 flex items-center gap-3" data-testid="voice-expense">
      <button type="button" onClick={state === "recording" ? stop : start} disabled={state === "processing"}
        className={`w-12 h-12 rounded-full flex items-center justify-center text-white shrink-0 transition-transform active:scale-95 ${state === "recording" ? "bg-red-600 animate-pulse" : "bg-gold hover:bg-gold-dark"}`}
        data-testid="voice-record-button" aria-label={state === "recording" ? "Kaydı bitir" : "Sesle gider gir"}>
        {state === "processing" ? <Loader2 className="w-5 h-5 animate-spin" /> : state === "recording" ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight" data-testid="voice-status">
          {state === "recording" ? `Dinliyorum… ${secs} sn — bitirmek için dokunun` : state === "processing" ? "Yazıya çevriliyor ve form dolduruluyor…" : "Sesle gir"}
        </p>
        <p className="text-xs text-charcoal-light truncate" data-testid="voice-transcript">
          {transcript ? <><Sparkles className="w-3 h-3 inline mr-1 text-gold" />"{transcript}"</> : "Örn. “beş yüz lira çimento Çekmeköy” deyin, form otomatik dolsun"}
        </p>
      </div>
    </div>
  );
}
