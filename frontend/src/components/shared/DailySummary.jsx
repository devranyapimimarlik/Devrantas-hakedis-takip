import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { GoldButton } from "@/components/shared/Inputs";
import { toast } from "sonner";
import { MessageCircle, Send, Loader2, ChevronDown, ChevronUp, BellRing } from "lucide-react";

export function DailySummaryCard({ compact = false }) {
  const { isManager } = useAuth();
  const [open, setOpen] = useState(!compact);
  const { data } = useQuery({ queryKey: ["daily-summary"], queryFn: () => api.get("/alerts/daily-summary").then((r) => r.data), refetchInterval: 300000 });
  const send = useMutation({ mutationFn: () => api.post("/alerts/send", {}), onSuccess: () => toast.success("WhatsApp/SMS gönderildi"), onError: (e) => toast.error(errMsg(e)) });
  if (!data) return null;
  const wa = () => window.open(`https://wa.me/${(data.manager_phone || "").replace(/[^\d]/g, "")}?text=${encodeURIComponent(data.message.replace(/\*/g, "*"))}`, "_blank");
  const critical = data.loss_risks.length + data.customer_risks.length;
  return (
    <div className={`gold-card p-5 mb-6 ${critical ? "border-red-200" : ""}`} data-testid="daily-summary-card">
      <div className="flex items-start sm:items-center gap-3 flex-wrap">
        <BellRing className={`w-5 h-5 ${data.alert_count ? "text-red-600" : "text-emerald-600"}`} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold">Günlük Özet · {data.alert_count} uyarı</p>
          <p className="text-xs text-charcoal-light">{data.due_items.length} vade · {data.loss_risks.length} zarar riski · {data.customer_risks.length} riskli müşteri · {data.anomalies.length} şüpheli kayıt · Her sabah 09:00 · {(data.manager_phone || "").replace(/^(\+?\d{2,3})\d+(\d{2})$/, "$1•••$2")} {data.twilio_configured ? "(WhatsApp/SMS aktif)" : "(WhatsApp/SMS pasif)"}</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
        <GoldButton size="sm" variant="outline" onClick={wa} data-testid="daily-summary-whatsapp"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp'a Gönder</GoldButton>
        {isManager && <GoldButton size="sm" onClick={() => send.mutate()} disabled={send.isPending || !data.twilio_configured} title={data.twilio_configured ? "" : "Twilio anahtarları eklenince aktif olur"} data-testid="daily-summary-send"><Send className="w-3.5 h-3.5" /> {send.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Şimdi Gönder"}</GoldButton>}
        <button onClick={() => setOpen(!open)} className="p-2 rounded-full hover:bg-gold-bg ml-auto sm:ml-0" data-testid="daily-summary-toggle">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
        </div>
      </div>
      {open && <pre className="mt-4 text-sm whitespace-pre-wrap font-sans leading-relaxed bg-[#FDFBF7] border border-gold-border rounded-2xl p-4" data-testid="daily-summary-message">{data.message.replace(/\*/g, "")}</pre>}
    </div>
  );
}
