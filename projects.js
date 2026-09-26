const DB_NAME = "wavesrt";
const DB_VERSION = 3;
const ASSETS = "assets";
const PROJECTS = "projects";
const LOGOS = "logos";

export const WM_KEY = "watermark";
export const LOOK_KEY = "lookkit";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS);
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(LOGOS)) db.createObjectStore(LOGOS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS, "readonly");
    const q = tx.objectStore(ASSETS).get(key);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

export async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS, "readwrite");
    tx.objectStore(ASSETS).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDel(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS, "readwrite");
    tx.objectStore(ASSETS).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function newProjectId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listProjects() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS, "readonly");
    const q = tx.objectStore(PROJECTS).getAll();
    q.onsuccess = () => {
      const rows = (q.result || []).map((p) => ({
        id: p.id,
        name: p.name,
        updated: p.updated,
        created: p.created,
        hasRender: !!(p.render && p.render.blob),
        audioName: p.audioName || "",
      }));
      rows.sort((a, b) => (b.updated || 0) - (a.updated || 0));
      resolve(rows);
    };
    q.onerror = () => reject(q.error);
  });
}

export async function getProject(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS, "readonly");
    const q = tx.objectStore(PROJECTS).get(id);
    q.onsuccess = () => resolve(q.result || null);
    q.onerror = () => reject(q.error);
  });
}

export async function putProject(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS, "readwrite");
    tx.objectStore(PROJECTS).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteProject(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECTS, "readwrite");
    tx.objectStore(PROJECTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listLogos() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOGOS, "readonly");
    const q = tx.objectStore(LOGOS).getAll();
    q.onsuccess = () => {
      const rows = q.result || [];
      rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      resolve(rows);
    };
    q.onerror = () => reject(q.error);
  });
}

export async function getLogo(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOGOS, "readonly");
    const q = tx.objectStore(LOGOS).get(id);
    q.onsuccess = () => resolve(q.result || null);
    q.onerror = () => reject(q.error);
  });
}

export async function putLogo(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOGOS, "readwrite");
    tx.objectStore(LOGOS).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteLogo(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOGOS, "readwrite");
    tx.objectStore(LOGOS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function cloneRecord(record, name) {
  return {
    ...record,
    id: newProjectId(),
    name,
    created: Date.now(),
    updated: Date.now(),
    render: record.render
      ? { ...record.render, blob: record.render.blob }
      : null,
    photos: (record.photos || []).map((p) => ({ ...p })),
  };
}
