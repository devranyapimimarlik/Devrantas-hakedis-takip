import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const FALLBACK = { nakit: "Devrantaş Nakit", cek: "Devrantaş Çek", genel_gider: "Genel Gider Kasası (%6)" };

export function useKasalar() {
  const { data = [] } = useQuery({ queryKey: ["kasalar"], queryFn: () => api.get("/kasalar").then((r) => r.data), staleTime: 60_000 });
  const names = data.reduce((m, k) => ({ ...m, [k.id]: k.name }), { ...FALLBACK });
  const kasaName = (id) => names[id] || id || "Devrantaş Nakit";
  return { kasalar: data, kasaName };
}
