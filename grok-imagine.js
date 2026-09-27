import { state, $, setStatus } from "./app.js";
import { idbGet, idbSet } from "./projects.js";

export const GROK_KEY = "xai-api-key";
export const GROK_STYLE_KEY = "xai-style-lock";

const NO_TEXT = "no text, no captions, no letters, no numbers on signs, no watermark, no logo, no UI overlay";

const PRESETS = {
  night: "Walk On Records night. Cinematic country, red tail lights, sodium vapor, dusty air, Kodak film grain, photoreal.",
  day: "Walk On Records day. Hot west Texas sun, chrome and asphalt, hard shadows, photoreal, no haze filter.",
  stage: "Walk On Records stage. Dark room, one spotlight, light smoke, concert still, photoreal.",
  bw: "Walk On Records black and white documentary still, high contrast grain, photoreal, no color.",
};

let drafts = [];
let hooks = { addPhotos: async () => {}, replacePhotoAt: async () => {}, photoNames: () => [], evenOut: () => {} };

export async function loadGrokKey() {
  const saved = await idbGet(GROK_KEY);
  if (saved && $("grokKey")) $("grokKey").value = saved;
  const style = await idbGet(GROK_STYLE_KEY);
  if (style && $("grokStyle") && !$("grokStyle").value.trim()) $("grokStyle").value = style;
  return (saved || $("grokKey")?.value || "").trim();
}

export async function saveGrokKey() {
  const key = ($("grokKey")?.value || "").trim();
  if (!key) return setStatus("Paste an xAI API key first (console.x.ai).", "error");
  await idbSet(GROK_KEY, key);
  const style = ($("grokStyle")?.value || "").trim();
  if (style) await idbSet(GROK_STYLE_KEY, style);
  setStatus("Grok key and style lock saved in this browser only.", "ok");
  return key;
}

function slugShot() {
  return (state.fileName || $("songTitle")?.value || "still")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 24) || "still";
}

function b64ToFile(b64, name, mime) {
  const clean = String(b64 || "").replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], name, { type: mime || "image/jpeg" });
}

async function urlToFile(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not download the generated image.");
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

function fullPrompt(scene, extra) {
  const style = ($("grokStyle")?.value || "").trim();
  const ref = ($("grokRefNote")?.value || "").trim();
  return [scene, extra, style, ref ? `match this look: ${ref}` : "", NO_TEXT].filter(Boolean).join(". ");
}

function lyricBeats(n) {
  const title = ($("songTitle")?.value || "").trim();
  const artist = ($("songArtist")?.value || "").trim();
  const lines = String($("lyrics")?.value || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(verse|chorus|bridge|outro|intro)\b/i.test(l) && !/^[\[(]/.test(l));
  const stock = [
    title ? `${title} world, wide empty highway at golden hour` : "empty two-lane highway at golden hour",
    "cab interior at night, dashboard glow, one trucker silhouette",
    "semi on a west Texas grade, sun behind the trailer",
    "truck stop neon in the rain, wet asphalt",
    "wide sky, fence line, distant headlights",
    "end-card sky, last light, no people close to camera",
  ];
  const out = [];
  for (let i = 0; i < n; i++) {
    const lyric = lines[Math.floor((i * Math.max(1, lines.length)) / n)] || "";
    const base = stock[i % stock.length];
    out.push(lyric ? `${base}. mood of the line: ${lyric.slice(0, 80)}` : base);
    if (artist && i === 0) out[0] += `. artist world of ${artist}`;
  }
  return out;
}

export function fillShotList() {
  const n = Math.max(1, Math.min(6, Number($("grokCount")?.value) || 4));
  const beats = lyricBeats(n);
  if ($("grokPrompt")) $("grokPrompt").value = beats.map((b, i) => `${i + 1}. ${b}`).join("\n");
  setStatus(`Wrote ${n} shot prompts from the title and lyrics. Edit, then Generate.`, "ok");
}

function parseScenes(n) {
  const raw = ($("grokPrompt")?.value || "").trim();
  if (!raw) return [];
  const numbered = raw.split(/\n+/).map((l) => l.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
  if (numbered.length >= 2) return numbered.slice(0, n);
  return Array.from({ length: n }, () => raw);
}

async function callImagine(prompt, n) {
  const key = await saveGrokKey();
  if (!key) return [];
  const model = $("grokModel")?.value || "grok-imagine-image";
  const aspect = $("aspect")?.value === "16:9" ? "16:9" : "9:16";
  let res;
  try {
    res = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        n,
        aspect_ratio: aspect,
        resolution: "1k",
        response_format: "b64_json",
      }),
    });
  } catch {
    throw new Error("Browser could not reach api.x.ai (often CORS). Generate in this Grok chat and drop files on Photos.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error("Grok key rejected. Check console.x.ai and Imagine access.");
    if (res.status === 429) throw new Error("Grok Imagine quota or rate limit. Wait, or generate in this Grok chat.");
    throw new Error(String(data?.error?.message || data?.error || `Grok Imagine failed (${res.status})`));
  }
  const rows = data.data || data.images || [];
  const files = [];
  const slug = slugShot();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = `${slug}-${String(drafts.length + i + 1).padStart(2, "0")}.jpg`;
    if (row.b64_json) files.push(b64ToFile(row.b64_json, name, row.mime_type || "image/jpeg"));
    else if (row.url) files.push(await urlToFile(row.url, name));
  }
  if (!files.length) throw new Error("Grok returned no images.");
  return files;
}

function paintDrafts() {
  const el = $("grokDrafts");
  if (!el) return;
  if (!drafts.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = drafts
    .map((d, i) => {
      const src = d.url || "";
      return `<div class="grok-draft${d.keep ? " keep" : ""}" data-i="${i}">
        <img src="${src}" alt="${d.file.name}" />
        <div class="grok-draft-bar">
          <label><input type="checkbox" data-keep="${i}" ${d.keep ? "checked" : ""}/> Keep</label>
          <button type="button" class="ghost" data-ref="${i}">Use look</button>
        </div>
      </div>`;
    })
    .join("");
  el.querySelectorAll("input[data-keep]").forEach((box) => {
    box.addEventListener("change", () => {
      const i = Number(box.dataset.keep);
      if (drafts[i]) drafts[i].keep = box.checked;
      paintDrafts();
    });
  });
  el.querySelectorAll("button[data-ref]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.ref);
      if (!drafts[i]) return;
      if ($("grokRefNote")) $("grokRefNote").value = `same truck, same lighting, same color grade as ${drafts[i].file.name}`;
      setStatus("Look lock set from that still. Next generate will aim at the same shoot.", "ok");
    });
  });
}

function paintSlotSelect() {
  const sel = $("grokSlot");
  if (!sel) return;
  const names = hooks.photoNames() || [];
  const cur = sel.value;
  sel.innerHTML = `<option value="">New photos (do not replace)</option>` +
    names.map((n, i) => `<option value="${i}">Replace ${i + 1}: ${n}</option>`).join("");
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

async function runGenerate() {
  const n = Math.max(1, Math.min(6, Number($("grokCount")?.value) || 3));
  const scenes = parseScenes(n);
  if (!scenes.length) {
    setStatus("Write a prompt, or Fill shot list from the song.", "error");
    return;
  }
  drafts.forEach((d) => d.url && URL.revokeObjectURL(d.url));
  drafts = [];
  paintDrafts();
  for (let i = 0; i < scenes.length; i++) {
    setStatus(`Grok Imagine ${i + 1}/${scenes.length}…`);
    const files = await callImagine(fullPrompt(scenes[i]), 1);
    files.forEach((file) => {
      drafts.push({ file, url: URL.createObjectURL(file), keep: true, scene: scenes[i] });
    });
    paintDrafts();
  }
  setStatus(`${drafts.length} preview${drafts.length === 1 ? "" : "s"} ready. Uncheck any you do not want, then Keep selected.`, "ok");
}

async function keepSelected() {
  const chosen = drafts.filter((d) => d.keep);
  if (!chosen.length) return setStatus("Check Keep on at least one preview.", "error");
  const slot = $("grokSlot")?.value;
  if (slot !== "" && slot != null && chosen.length) {
    await hooks.replacePhotoAt(Number(slot), chosen[0].file);
    setStatus(`Replaced photo ${Number(slot) + 1}.`, "ok");
  } else {
    await hooks.addPhotos(chosen.map((d) => d.file));
    if ($("photoEven")?.checked) hooks.evenOut();
  }
  paintSlotSelect();
}

export function initGrokImagine(api) {
  hooks = { ...hooks, ...(api || {}) };
  loadGrokKey().catch(() => {});
  paintSlotSelect();
  if ($("grokSaveKey")) $("grokSaveKey").addEventListener("click", () => saveGrokKey());
  if ($("grokShots")) $("grokShots").addEventListener("click", fillShotList);
  if ($("grokGenerate")) {
    $("grokGenerate").addEventListener("click", () => runGenerate().catch((e) => setStatus(String(e.message || e), "error")));
  }
  if ($("grokKeep")) $("grokKeep").addEventListener("click", () => keepSelected().catch((e) => setStatus(String(e.message || e), "error")));
  if ($("grokClearDrafts")) {
    $("grokClearDrafts").addEventListener("click", () => {
      drafts.forEach((d) => d.url && URL.revokeObjectURL(d.url));
      drafts = [];
      paintDrafts();
    });
  }
  document.querySelectorAll("[data-grok-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = PRESETS[btn.dataset.grokPreset];
      if (p && $("grokStyle")) $("grokStyle").value = p;
      idbSet(GROK_STYLE_KEY, p);
      setStatus("Style lock set. All new stills use this look.", "ok");
    });
  });
}
