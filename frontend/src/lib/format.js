export const fmtTL = (v) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(Number(v || 0));

export const fmtNum = (v, d = 0) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: d }).format(Number(v || 0));

export const fmtDate = (s) => {
  if (!s) return "-";
  const d = new Date(s.length === 10 ? s + "T00:00:00" : s);
  return isNaN(d) ? s : d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export const today = () => new Date().toISOString().slice(0, 10);

export const STATUS_LABELS = {
  onay_bekliyor: "Onay Bekliyor", onaylandi: "Onaylandı", reddedildi: "Reddedildi",
  taslak: "Taslak", odendi: "Ödendi", gonderildi: "Gönderildi", kabul: "Kabul Edildi", red: "Reddedildi",
  portfoyde: "Portföyde", tahsil_edildi: "Tahsil Edildi", karsiliksiz: "Karşılıksız", ciro_edildi: "Ciro Edildi",
  bekliyor: "Bekliyor", planlama: "Planlama", devam: "Devam Ediyor", tamamlandi: "Tamamlandı", durduruldu: "Durduruldu",
  musteri: "Müşteri", taseron: "Taşeron", gelir: "Gelir", gider: "Gider", alinan: "Alınan", verilen: "Verilen",
  kira: "Kira", kredi_karti: "Kredi Kartı", kredi: "Kredi", cek: "Çek", diger: "Diğer",
  yonetici: "Yönetici", santiye_sefi: "Şantiye Şefi", muhasebe: "Muhasebe",
  nakit: "Nakit", havale: "Havale/EFT",
};

export const STATUS_TONE = {
  onay_bekliyor: "amber", onaylandi: "green", reddedildi: "red", taslak: "gray", odendi: "green", gonderildi: "blue",
  kabul: "green", red: "red", portfoyde: "amber", tahsil_edildi: "green", karsiliksiz: "red", ciro_edildi: "blue",
  bekliyor: "amber", planlama: "blue", devam: "gold", tamamlandi: "green", durduruldu: "red", gelir: "green", gider: "red",
  alinan: "green", verilen: "amber",
};
