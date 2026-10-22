import { api } from "@/lib/api";

const DB_NAME = "devrantas-offline";
const STORE = "queue";
const EVT = "offline-queue-changed";

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}
const notify = () => window.dispatchEvent(new Event(EVT));

export const isOffline = () => !navigator.onLine;
export const isNetworkError = (e) => !e?.response && (e?.code === "ERR_NETWORK" || e?.message === "Network Error" || isOffline());

export async function enqueue(item) {
  const rec = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), attempts: 0, ...item };
  await tx("readwrite", (s) => s.put(rec));
  notify();
  if ("serviceWorker" in navigator && "SyncManager" in window) navigator.serviceWorker.ready.then((r) => r.sync.register("offline-queue")).catch(() => {});
  return rec;
}
export async function listQueue() { return (await tx("readonly", (s) => s.getAll())) || []; }
export async function removeItem(id) { await tx("readwrite", (s) => s.delete(id)); notify(); }
export async function clearQueue() { await tx("readwrite", (s) => s.clear()); notify(); }

async function sendOne(item) {
  let fileId = item.payload.attachment_file_id || item.payload.file_id || null;
  if (item.file) {
    const fd = new FormData();
    fd.append("file", item.file, item.fileName || "foto.jpg");
    const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
    fileId = data.id;
  }
  if (item.kind === "transaction") return api.post("/transactions", { ...item.payload, attachment_file_id: fileId });
  if (item.kind === "photo") return api.post(`/sites/${item.siteId}/photos`, { ...item.payload, file_id: fileId });
  throw new Error("Bilinmeyen kayıt türü");
}

let flushing = false;
export async function flushQueue() {
  if (flushing || isOffline()) return { sent: 0, failed: 0, remaining: (await listQueue()).length };
  flushing = true;
  let sent = 0, failed = 0;
  try {
    for (const item of await listQueue()) {
      try { await sendOne(item); await removeItem(item.id); sent++; }
      catch (e) {
        if (isNetworkError(e)) { failed++; break; }
        await tx("readwrite", (s) => s.put({ ...item, attempts: (item.attempts || 0) + 1, lastError: e?.response?.data?.detail || e.message }));
        failed++;
      }
    }
  } finally { flushing = false; notify(); }
  return { sent, failed, remaining: (await listQueue()).length };
}

export function onQueueChange(fn) { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); }
