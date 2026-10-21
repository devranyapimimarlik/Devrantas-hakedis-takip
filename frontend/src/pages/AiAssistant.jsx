import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, streamChat } from "@/lib/api";
import { PageHeader } from "@/components/shared/Bits";
import { GoldButton, NInput } from "@/components/shared/Inputs";
import { Sparkles, Send, Plus, Trash2, Loader2 } from "lucide-react";

const SUGGESTIONS = ["Şirketin genel finansal durumunu özetle", "En riskli şantiye hangisi ve neden?", "Önümüzdeki 7 günde hangi ödemeler var?", "Taşeron bakiyelerinde dikkat etmem gereken ne var?", "Nakit akışını iyileştirmek için 3 öneri ver"];

export default function AiAssistant() {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef();
  const { data: sessions = [] } = useQuery({ queryKey: ["ai-sessions"], queryFn: () => api.get("/ai/sessions").then((r) => r.data) });
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const openSession = async (id) => { setSessionId(id); const { data } = await api.get(`/ai/sessions/${id}/messages`); setMsgs(data.map((m) => ({ role: m.role, content: m.content }))); };
  const send = async (text) => {
    const q = (text || input).trim();
    if (!q || busy) return;
    setInput(""); setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);
    try {
      await streamChat({ session_id: sessionId, message: q }, (ev) => {
        if (ev.session_id) setSessionId(ev.session_id);
        if (ev.delta) setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + ev.delta }; return c; });
        if (ev.error) setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: `Hata: ${ev.error}` }; return c; });
      });
    } catch (e) { setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: `Hata: ${e.message}` }; return c; }); }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["ai-sessions"] });
  };
  const del = async (id) => { await api.delete(`/ai/sessions/${id}`); qc.invalidateQueries({ queryKey: ["ai-sessions"] }); if (id === sessionId) { setSessionId(null); setMsgs([]); } };

  return (
    <div data-testid="ai-page" className="flex flex-col h-[calc(100vh-200px)] lg:h-[calc(100vh-150px)]">
      <PageHeader eyebrow="GPT 6 Sol" title="Yapay Zeka Asistan" subtitle="Finansal verilerinize göre risk analizi, bütçe tahmini ve anlık soru-cevap." actions={<GoldButton variant="outline" onClick={() => { setSessionId(null); setMsgs([]); }} data-testid="ai-new-session"><Plus className="w-4 h-4" /> Yeni sohbet</GoldButton>} />
      <div className="flex-1 min-h-0 grid lg:grid-cols-[260px_1fr] gap-5">
        <aside className="hidden lg:block gold-card p-3 overflow-y-auto" data-testid="ai-sessions">
          <p className="label-gold px-2 py-1">Geçmiş</p>
          {sessions.map((s) => (
            <div key={s.id} className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm cursor-pointer ${s.id === sessionId ? "bg-gold-bg text-gold-dark" : "hover:bg-stone-50"}`} onClick={() => openSession(s.id)} data-testid={`ai-session-${s.id}`}>
              <span className="flex-1 truncate">{s.title}</span><button onClick={(e) => { e.stopPropagation(); del(s.id); }} className="opacity-0 group-hover:opacity-100 text-charcoal-muted hover:text-red-700"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>))}
        </aside>
        <div className="gold-card flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4" data-testid="ai-messages">
            {msgs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-full bg-gold-bg border border-gold-border flex items-center justify-center mb-4"><Sparkles className="w-6 h-6 text-gold" /></div>
                <p className="font-serif text-2xl font-semibold">Size nasıl yardımcı olabilirim?</p>
                <div className="flex flex-wrap justify-center gap-2 mt-5 max-w-xl">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="text-xs border border-gold-border bg-white rounded-full px-3 py-2 hover:border-gold hover:text-gold transition-colors" data-testid="ai-suggestion">{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-charcoal text-[#F5F0E6]" : "bg-gold-bg border border-gold-border text-charcoal"}`} data-testid={`ai-msg-${m.role}`}>
                  {m.content || (busy && i === msgs.length - 1 ? <Loader2 className="w-4 h-4 animate-spin text-gold" /> : "")}
                </div>
              </div>))}
            <div ref={endRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-gold-border p-3 flex gap-2">
            <NInput value={input} onChange={(e) => setInput(e.target.value)} placeholder="Finansal sorunuzu yazın..." disabled={busy} data-testid="ai-input" />
            <GoldButton type="submit" disabled={busy || !input.trim()} data-testid="ai-send-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</GoldButton>
          </form>
        </div>
      </div>
    </div>
  );
}
