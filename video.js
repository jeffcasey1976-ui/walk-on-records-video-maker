import { state, $, setStatus, setProgress } from "./app.js";
import { idbGet, idbSet, idbDel, WM_KEY, LOOK_KEY, listLogos, getLogo, putLogo, deleteLogo, newProjectId } from "./projects.js";
let uploadPackToYoutube = async () => {
  throw new Error("youtube.js did not load. Upload that file and Force refresh.");
};
let describeYtQueue = () => "";
let initYoutube = () => {};
let initGrokImagine = () => {};

async function loadExtraModules() {
  try {
    const yt = await import("./youtube.js");
    if (typeof yt.initYoutube === "function") initYoutube = yt.initYoutube;
    if (typeof yt.uploadPackToYoutube === "function") uploadPackToYoutube = yt.uploadPackToYoutube;
    if (typeof yt.describeYtQueue === "function") describeYtQueue = yt.describeYtQueue;
  } catch (err) {
    console.error("youtube.js failed", err);
  }
  try {
    const grok = await import("./grok-imagine.js");
    if (typeof grok.initGrokImagine === "function") initGrokImagine = grok.initGrokImagine;
  } catch (err) {
    console.error("grok-imagine.js failed", err);
  }
}

const videoState = {
  photos: [],
  loopVideo: null,
  loopUrl: null,
  loopFile: null,
  watermark: null,
  watermarkUrl: null,
  watermarkName: "",
  watermarkFile: null,
  endLogo: null,
  endLogoUrl: null,
  endLogoName: "",
  endLogoFile: null,
  exporting: false,
  cancel: false,
  previewRaf: 0,
  result: null,
  resultUrl: null,
  main: null,
  mainUrl: null,
  shorts: [],
  scrubbing: false,
  stripDrag: null,
  releaseRoot: null,
  masters: { wide: null, tall: null },
};

export const APP_REV = "38";
export const APP_REV_DATE = "2026-09-26";

const FONT_LIST = [
  { name: "Sora", href: null },
  { name: "Oswald", href: "https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&display=swap" },
  { name: "Anton", href: "https://fonts.googleapis.com/css2?family=Anton&display=swap" },
  { name: "Bebas Neue", href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" },
  { name: "Montserrat", href: "https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&display=swap" },
  { name: "Playfair Display", href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&display=swap" },
  { name: "Rubik", href: "https://fonts.googleapis.com/css2?family=Rubik:wght@500;700&display=swap" },
  { name: "Archivo Black", href: "https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap" },
  { name: "Pacifico", href: "https://fonts.googleapis.com/css2?family=Pacifico&display=swap" },
  { name: "Permanent Marker", href: "https://fonts.googleapis.com/css2?family=Permanent+Marker&display=swap" },
  { name: "Barlow Condensed", href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700;800&display=swap" },
  { name: "Nunito", href: "https://fonts.googleapis.com/css2?family=Nunito:wght@600;800&display=swap" },
  { name: "Cinzel", href: "https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&display=swap" },
  { name: "Bangers", href: "https://fonts.googleapis.com/css2?family=Bangers&display=swap" },
  { name: "IBM Plex Sans", href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;700&display=swap" },
];

function fontStackFor(selectId) {
  const name = $(selectId)?.value || $("lyricFont")?.value || "Sora";
  return `"${name}", Sora, Segoe UI, sans-serif`;
}

function fontStack() {
  return fontStackFor("lyricFont");
}

function titleFontStack() {
  return fontStackFor("titleFont");
}

function titleTypeSize(h) {
  const pct = Number($("titleSize")?.value);
  const use = Number.isFinite(pct) && pct > 0 ? pct : 5;
  return Math.max(16, Math.round((h * use) / 100));
}

async function ensureFontByName(name) {
  const spec = FONT_LIST.find((f) => f.name === name);
  if (spec?.href && !document.getElementById(`gf-${name}`)) {
    const link = document.createElement("link");
    link.id = `gf-${name}`;
    link.rel = "stylesheet";
    link.href = spec.href;
    document.head.appendChild(link);
  }
  try {
    await document.fonts.load(`700 48px "${name}", Sora, sans-serif`);
    await document.fonts.ready;
  } catch (_) {}
}

async function ensureLyricFont() {
  await ensureFontByName($("lyricFont")?.value || "Sora");
  await ensureFontByName($("titleFont")?.value || $("lyricFont")?.value || "Sora");
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = url;
  });
}

function looksLikeImage(file) {
  if (!file) return false;
  if (/^image\//i.test(file.type || "")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(file.name || "");
}

async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromUrl(url);
    return { img, url };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function loadImageFromFile(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, bmp.width);
      canvas.height = Math.max(1, bmp.height);
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      const decoded = await blobToImage(blob || file);
      return { img: decoded.img, url: decoded.url, name: file.name, file };
    } catch (_) {}
  }
  const decoded = await blobToImage(file);
  return { img: decoded.img, url: decoded.url, name: file.name, file };
}

function targetSize(force916) {
  const ratio = force916 || $("aspect").value !== "16:9" ? "9:16" : "16:9";
  const quality = $("quality").value === "1080" ? 1080 : 720;
  if (ratio === "16:9") {
    return quality === 1080 ? { w: 1920, h: 1080 } : { w: 1280, h: 720 };
  }
  return quality === 1080 ? { w: 1080, h: 1920 } : { w: 720, h: 1280 };
}

function mediaSize(media) {
  return {
    iw: media.videoWidth || media.naturalWidth || media.width || 0,
    ih: media.videoHeight || media.naturalHeight || media.height || 0,
  };
}

function drawCover(ctx, media, w, h, alpha) {
  const { iw, ih } = mediaSize(media);
  if (!iw || !ih) {
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(media, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

function easeSmooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

const KEN_PRESETS = {
  in: { z0: 1.02, z1: 1.2, x0: 0, y0: 0.04, x1: 0, y1: -0.08 },
  out: { z0: 1.2, z1: 1.02, x0: 0, y0: -0.06, x1: 0, y1: 0.06 },
  "pan-l": { z0: 1.1, z1: 1.16, x0: -0.92, y0: 0.08, x1: 0.92, y1: -0.06 },
  "pan-r": { z0: 1.16, z1: 1.1, x0: 0.92, y0: -0.08, x1: -0.92, y1: 0.1 },
  "pan-up": { z0: 1.08, z1: 1.2, x0: 0.04, y0: 0.88, x1: -0.04, y1: -0.55 },
  "pan-down": { z0: 1.18, z1: 1.08, x0: -0.06, y0: -0.7, x1: 0.08, y1: 0.72 },
  "diag-in": { z0: 1.06, z1: 1.22, x0: -0.72, y0: -0.5, x1: 0.55, y1: 0.42 },
  "diag-out": { z0: 1.22, z1: 1.06, x0: 0.62, y0: 0.48, x1: -0.52, y1: -0.4 },
};

const AUTO_CYCLE = ["in", "pan-l", "out", "diag-in", "pan-up", "pan-r", "diag-out", "pan-down"];

function motionSpec(index, mode) {
  if (mode === "in") return KEN_PRESETS.in;
  if (mode === "out") return KEN_PRESETS.out;
  if (mode === "pan-h") return index % 2 ? KEN_PRESETS["pan-r"] : KEN_PRESETS["pan-l"];
  if (mode === "pan-v") return index % 2 ? KEN_PRESETS["pan-down"] : KEN_PRESETS["pan-up"];
  return KEN_PRESETS[AUTO_CYCLE[index % AUTO_CYCLE.length]];
}

function drawKenBurns(ctx, media, w, h, alpha, progress, spec, amount) {
  const { iw, ih } = mediaSize(media);
  if (!iw || !ih) {
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const cover = Math.max(w / iw, h / ih);
  const amt = Math.max(0.35, Math.min(1.8, amount || 1));
  const e = easeSmooth(progress);
  const z0 = 1 + (spec.z0 - 1) * amt;
  const z1 = 1 + (spec.z1 - 1) * amt;
  const z = z0 + (z1 - z0) * e;
  const xN = (spec.x0 + (spec.x1 - spec.x0) * e) * Math.min(1, amt);
  const yN = (spec.y0 + (spec.y1 - spec.y0) * e) * Math.min(1, amt);
  const dw = iw * cover * z;
  const dh = ih * cover * z;
  const maxX = Math.max(0, (dw - w) / 2);
  const maxY = Math.max(0, (dh - h) / 2);
  const x = (w - dw) / 2 - xN * maxX;
  const y = (h - dh) / 2 - yN * maxY;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(media, x, y, dw, dh);
  ctx.restore();
}

function motionSettings() {
  const modeEl = $("photoMotion");
  const amtEl = $("photoMotionAmt");
  return {
    mode: modeEl ? modeEl.value : "auto",
    amount: amtEl ? Number(amtEl.value) || 1 : 1,
  };
}

function drawStillOrKen(ctx, media, w, h, alpha, progress, index) {
  const { mode, amount } = motionSettings();
  if (mode === "off") {
    drawCover(ctx, media, w, h, alpha);
    return;
  }
  drawKenBurns(ctx, media, w, h, alpha, progress, motionSpec(index, mode), amount);
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function timedCues() {
  return (state.cues || []).filter(
    (c) => c && c.text && c.start != null && c.end != null && c.end > c.start
  );
}

function scrollPointer(cues, t) {
  if (!cues.length) return 0;
  if (t <= cues[0].start) return 0;
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const next = cues[i + 1];
    if (t >= c.start && t <= c.end) {
      const frac = (t - c.start) / Math.max(0.05, c.end - c.start);
      return i + Math.min(1, Math.max(0, frac));
    }
    if (next && t > c.end && t < next.start) return i + 1;
    if (t > c.end && !next) return i + 1;
  }
  return cues.length;
}

function photoHolds() {
  const n = videoState.photos.length;
  const fallback = Math.max(0.4, Number($("photoHold")?.value) || 5);
  if (!n) return [];
  if ($("photoEven")?.checked) {
    const dur = mediaDuration() || n * fallback;
    const each = Math.max(0.4, dur / n);
    return videoState.photos.map(() => each);
  }
  return videoState.photos.map((p) => Math.max(0.4, Number(p.hold) || fallback));
}

function photoPair(t) {
  const n = videoState.photos.length;
  if (!n) return null;
  const holds = photoHolds();
  const fadeAll = Math.max(0.05, Number($("photoFade")?.value) || 0.8);
  if (n === 1) {
    const hold = holds[0];
    const into = ((t % hold) + hold) % hold;
    return {
      a: videoState.photos[0].img,
      b: null,
      mix: 0,
      ia: 0,
      pa: into / hold,
    };
  }
  const cycle = holds.reduce((s, x) => s + x, 0);
  const pos = ((t % cycle) + cycle) % cycle;
  let acc = 0;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    if (pos < acc + holds[i]) {
      idx = i;
      break;
    }
    acc += holds[i];
    idx = i;
  }
  const hold = holds[idx];
  const into = pos - acc;
  const next = (idx + 1) % n;
  const fade = Math.max(0.05, Math.min(hold * 0.8, fadeAll));
  const startFade = Math.max(0, hold - fade);
  let mix = 0;
  if (into >= startFade) mix = (into - startFade) / fade;
  return {
    a: videoState.photos[idx].img,
    b: mix > 0 ? videoState.photos[next].img : null,
    mix: Math.min(1, Math.max(0, mix)),
    ia: idx,
    ib: next,
    pa: into / hold,
    pb: Math.min(1, Math.max(0, (into - startFade) / hold)),
  };
}

function drawWatermark(ctx, w, h) {
  const wm = videoState.watermark;
  if (!wm) return;
  const pct = Math.max(4, Math.min(40, Number($("wmSize").value) || 12)) / 100;
  const opacity = Math.max(0.05, Math.min(1, Number($("wmOpacity").value) || 0.7));
  const pos = $("wmPos").value || "top-right";
  const maxW = w * pct;
  const scale = maxW / Math.max(1, wm.naturalWidth || wm.width);
  const dw = (wm.naturalWidth || wm.width) * scale;
  const dh = (wm.naturalHeight || wm.height) * scale;
  const pad = Math.round(Math.min(w, h) * 0.03);
  let x = pad;
  let y = pad;
  if (pos.includes("right")) x = w - dw - pad;
  if (pos.includes("bottom")) y = h - dh - pad;
  if (pos === "center") {
    x = (w - dw) / 2;
    y = (h - dh) / 2;
  }
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(wm, x, y, dw, dh);
  ctx.restore();
}

function lyricLayout(w, h) {
  const preset = $("lyricPreset") ? $("lyricPreset").value : "bottom";
  let topPct = Number($("lyricTop")?.value);
  let heightPct = Number($("lyricHeight")?.value);
  if (!Number.isFinite(topPct) || !Number.isFinite(heightPct)) {
    topPct = 50;
    heightPct = 50;
  }
  if (preset === "bottom") {
    topPct = 50;
    heightPct = 50;
  } else if (preset === "lower-third") {
    topPct = 68;
    heightPct = 28;
  } else if (preset === "center") {
    topPct = 28;
    heightPct = 44;
  } else if (preset === "top") {
    topPct = 6;
    heightPct = 42;
  }
  heightPct = Math.max(16, Math.min(90, heightPct));
  topPct = Math.max(0, Math.min(100 - heightPct, topPct));
  const align = $("lyricAlign")?.value || "center";
  const widthPct = Math.max(50, Math.min(100, Number($("lyricWidth")?.value) || 100));
  const shade = Math.max(0, Math.min(1, Number($("lyricShade")?.value) || 0));
  const bandH = (heightPct / 100) * h;
  const bandTop = (topPct / 100) * h;
  const bandW = (widthPct / 100) * w;
  const bandX = (w - bandW) / 2;
  return { preset, topPct, heightPct, align, widthPct, shade, bandTop, bandH, bandX, bandW };
}

function applyLyricPreset() {
  const preset = $("lyricPreset")?.value;
  const map = {
    bottom: [50, 50],
    "lower-third": [68, 28],
    center: [28, 44],
    top: [6, 42],
  };
  if (preset && map[preset] && $("lyricTop") && $("lyricHeight")) {
    $("lyricTop").value = String(map[preset][0]);
    $("lyricHeight").value = String(map[preset][1]);
  }
  const custom = preset === "custom";
  if ($("lyricTop")) $("lyricTop").disabled = !custom;
  if ($("lyricHeight")) $("lyricHeight").disabled = !custom;
}

function textLook() {
  return $("textLook")?.value || "clean";
}

function drawFancyText(ctx, text, x, y, opts = {}) {
  const look = opts.look || textLook();
  const size = opts.size || 32;
  const active = opts.active !== false;
  ctx.save();
  ctx.textAlign = opts.align || "center";
  ctx.textBaseline = opts.baseline || "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  if (look === "neon") {
    ctx.shadowColor = active ? "rgba(255,60,200,0.9)" : "rgba(80,180,255,0.45)";
    ctx.shadowBlur = size * 0.55;
    ctx.lineWidth = Math.max(4, size * 0.1);
    ctx.strokeStyle = active ? "#ff4ad2" : "rgba(80,200,255,0.7)";
    ctx.strokeText(text, x, y);
    ctx.shadowBlur = size * 0.2;
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x, y);
  } else if (look === "sticker") {
    ctx.lineWidth = Math.max(10, size * 0.28);
    ctx.strokeStyle = "#fff";
    ctx.strokeText(text, x, y);
    ctx.lineWidth = Math.max(6, size * 0.16);
    ctx.strokeStyle = active ? "#c41b2b" : "#7a1420";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = active ? "#ffd54a" : "#ffe082";
    ctx.fillText(text, x, y);
  } else if (look === "poster") {
    const lift = Math.max(3, size * 0.08);
    ctx.fillStyle = "#1a3d12";
    ctx.fillText(text, x + lift, y + lift);
    ctx.fillStyle = "#c41b2b";
    ctx.fillText(text, x + lift * 0.4, y + lift * 0.4);
    ctx.lineWidth = Math.max(3, size * 0.07);
    ctx.strokeStyle = "#fff";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#2ecc71";
    ctx.fillText(text, x, y);
  } else if (look === "torn") {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(text, x - size * 0.04, y - size * 0.03);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(text, x + size * 0.05, y + size * 0.04);
    ctx.lineWidth = Math.max(5, size * 0.12);
    ctx.strokeStyle = "#111";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#f4f0e8";
    ctx.fillText(text, x, y);
  } else if (look === "banner") {
    const w = ctx.measureText(text).width;
    const padX = size * 0.35;
    const padY = size * 0.38;
    ctx.save();
    ctx.fillStyle = active ? "#8b1e1e" : "rgba(80,20,20,0.7)";
    const left = ctx.textAlign === "left" ? x - padX : ctx.textAlign === "right" ? x - w - padX : x - w / 2 - padX;
    roundRectPath(ctx, left, y - padY, w + padX * 2, padY * 2, size * 0.18);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#fff6d8";
    ctx.fillText(text, x, y);
  } else {
    ctx.lineWidth = Math.max(4, size * 0.08);
    ctx.strokeStyle = "rgba(0,0,0,0.82)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = active ? "#fff" : "rgba(230,236,246,0.82)";
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function wordWindows(cue) {
  const words = String(cue.text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const weights = words.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]+/gu, "").length || 1));
  const sum = weights.reduce((a, b) => a + b, 0) || words.length;
  const dur = Math.max(0.05, cue.end - cue.start);
  let t0 = cue.start;
  return words.map((text, i) => {
    const d = dur * (weights[i] / sum);
    const win = { text, start: t0, end: t0 + d };
    t0 += d;
    return win;
  });
}

function wrapWordRows(ctx, words, maxWidth, gap) {
  const rows = [];
  let row = [];
  let width = 0;
  words.forEach((w) => {
    const ww = ctx.measureText(w.text).width;
    if (row.length && width + gap + ww > maxWidth) {
      rows.push(row);
      row = [{ ...w, ww }];
      width = ww;
    } else {
      row.push({ ...w, ww });
      width += (row.length > 1 ? gap : 0) + ww;
    }
  });
  if (row.length) rows.push(row);
  return rows;
}

function drawKaraokeLine(ctx, cue, t, textX, y, size, lineGap, maxWidth, align, family, style) {
  const words = wordWindows(cue);
  if (!words.length) return y;
  ctx.font = `700 ${size}px ${family}`;
  const gap = Math.max(8, size * 0.28);
  const rows = wrapWordRows(ctx, words, maxWidth, gap);
  let yy = y;
  rows.forEach((row) => {
    const rowW = row.reduce((s, w, i) => s + w.ww + (i ? gap : 0), 0);
    let x =
      align === "left" ? textX : align === "right" ? textX - rowW : textX - rowW / 2;
    row.forEach((w) => {
      const live = t >= w.start && t < w.end;
      const mid = (w.start + w.end) / 2;
      const p = (t - w.start) / Math.max(0.04, w.end - w.start);
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, size * 0.08);
      ctx.strokeStyle = "rgba(0,0,0,0.82)";
      let dx = 0;
      let dy = 0;
      let sc = 1;
      if (live) {
        if (style === "pop") sc = 1.12;
        if (style === "bounce") dy = -Math.sin(Math.min(1, Math.max(0, p)) * Math.PI) * size * 0.28;
        if (style === "slide") dx = (1 - Math.min(1, Math.max(0, p))) * size * 0.45;
      }
      ctx.translate(x + dx, yy + dy);
      ctx.scale(sc, sc);
      drawFancyText(ctx, w.text, 0, 0, {
        size,
        look: textLook(),
        align: "left",
        active: live || t >= w.end,
      });
      ctx.restore();
      x += w.ww + gap;
    });
    yy += size * lineGap;
  });
  return yy;
}

function drawSafeZone(ctx, w, h) {
  if ($("safeZone")?.checked === false) return;
  const top = h * 0.12;
  const bot = h * 0.18;
  ctx.save();
  ctx.fillStyle = "rgba(255,80,80,0.12)";
  ctx.fillRect(0, 0, w, top);
  ctx.fillRect(0, h - bot, w, bot);
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "rgba(255,120,120,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(w, top);
  ctx.moveTo(0, h - bot);
  ctx.lineTo(w, h - bot);
  ctx.stroke();
  ctx.restore();
}

function drawLyrics(ctx, w, h, t, tight) {
  const cues = timedCues();
  const layout = lyricLayout(w, h);
  let { bandTop, bandH, bandX, bandW, align, shade } = layout;
  if (tight) {
    bandTop = h * 0.58;
    bandH = h * 0.26;
    bandX = w * 0.04;
    bandW = w * 0.92;
    shade = 0;
    align = "center";
  }
  const bandBot = bandTop + bandH;
  if (shade > 0.02) {
    const grad = ctx.createLinearGradient(0, bandTop, 0, bandBot);
    if (bandTop < h * 0.25) {
      grad.addColorStop(0, `rgba(0,0,0,${(shade * 0.82).toFixed(3)})`);
      grad.addColorStop(0.75, `rgba(0,0,0,${(shade * 0.35).toFixed(3)})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
    } else {
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.14, `rgba(0,0,0,${(shade * 0.4).toFixed(3)})`);
      grad.addColorStop(1, `rgba(0,0,0,${shade.toFixed(3)})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(bandX, bandTop, bandW, bandH);
  }

  if (!cues.length) return;

  const padX = Math.max(12, bandW * 0.06);
  const maxWidth = bandW - padX * 2;
  const baseSize = tight ? Math.max(22, Math.round(h * 0.026)) : Math.max(22, Math.round(h * 0.028));
  const activeSize = tight ? Math.max(28, Math.round(h * 0.038)) : Math.max(26, Math.round(h * 0.036));
  const lineGap = tight ? 1.12 : 1.18;
  const textX = align === "left" ? bandX + padX : align === "right" ? bandX + bandW - padX : bandX + bandW / 2;
  ctx.textAlign = align === "left" ? "left" : align === "right" ? "right" : "center";
  ctx.textBaseline = "middle";
  const family = fontStack();
  ctx.font = `600 ${baseSize}px ${family}`;

  const blocks = cues.map((c) => {
    ctx.font = `600 ${baseSize}px ${family}`;
    return wrapText(ctx, c.text, maxWidth);
  });
  const heights = blocks.map((lines, i) => {
    const size = baseSize;
    return lines.length * size * lineGap + Math.round(h * 0.028);
  });

  const pointer = scrollPointer(cues, t);
  const idx = Math.min(cues.length - 1, Math.max(0, Math.floor(pointer)));
  const frac = pointer - Math.floor(pointer);

  let scrollPx = 0;
  for (let i = 0; i < idx; i++) scrollPx += heights[i];
  scrollPx += heights[idx] * frac;

  const focusY = bandTop + bandH * (tight ? 0.46 : 0.42);
  let acc = 0;
  for (let i = 0; i < cues.length; i++) {
    const blockH = heights[i];
    const center = focusY + (acc + blockH / 2 - scrollPx);
    acc += blockH;
    if (center < bandTop - blockH || center > bandBot + blockH) continue;
    const dist = Math.abs(i - pointer);
    if (dist > (tight ? 1.15 : 2.6)) continue;
    const active = dist < 0.55;
    const appear = Math.max(0, 1 - dist / (tight ? 1.05 : 2.15));
    const edgeFadeTop = Math.min(1, Math.max(0, (center - bandTop) / Math.max(12, bandH * 0.18)));
    const edgeFadeBot = Math.min(1, Math.max(0, (bandBot - 8 - center) / Math.max(12, bandH * 0.16)));
    const alpha = appear * edgeFadeTop * edgeFadeBot;
    if (alpha < 0.03) continue;

    const size = active ? activeSize : baseSize;
    const karaoke = ($("karaokeStyle")?.value || "off") !== "off";
    ctx.save();
    ctx.globalAlpha = alpha;
    if (active && karaoke) {
      const style = $("karaokeStyle").value;
      drawKaraokeLine(ctx, cues[i], t, textX, center - size * 0.2, size, lineGap, maxWidth, align, family, style);
    } else {
      ctx.font = `${active ? 700 : 500} ${size}px ${family}`;
      const lines = wrapText(ctx, cues[i].text, maxWidth);
      const blockHeight = lines.length * size * lineGap;
      let y = center - blockHeight / 2 + size * 0.5;
      for (const line of lines) {
        drawFancyText(ctx, line, textX, y, {
          size,
          look: textLook(),
          align,
          active,
        });
        y += size * lineGap;
      }
    }
    ctx.restore();
  }
}

function vizSettings() {
  return {
    mode: $("vizMode")?.value || "off",
    place: $("vizPlace")?.value || "overlay",
    theme: $("vizTheme")?.value || "neon",
    sens: Math.max(0.3, Math.min(4, Number($("vizSens")?.value) || 1.2)),
  };
}

function themeColor(theme, t, a) {
  const alpha = a == null ? 1 : a;
  if (theme === "fire") return `hsla(${18 + t * 28}, 95%, ${48 + t * 22}%, ${alpha})`;
  if (theme === "ice") return `hsla(${198 + t * 24}, 85%, ${58 + t * 18}%, ${alpha})`;
  if (theme === "gold") return `hsla(${42 + t * 12}, 90%, ${52 + t * 16}%, ${alpha})`;
  return `hsla(${280 + t * 80}, 90%, ${58 + t * 12}%, ${alpha})`;
}

function energyAtTime(t) {
  const buf = state.audioBuffer;
  if (!buf) return 0;
  const ch = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const start = Math.max(0, Math.floor(t * sr));
  let e = 0;
  const n = 1400;
  for (let i = 0; i < n; i++) {
    const s = ch[start + i] || 0;
    e += s * s;
  }
  return Math.min(1, Math.sqrt(e / n) * 3.2);
}

function spectrumBins(t, count) {
  const n = count || 48;
  const bins = new Float32Array(n);
  const analyser = videoState.analyser;
  if (analyser && videoState.freqData) {
    analyser.getByteFrequencyData(videoState.freqData);
    const src = videoState.freqData;
    const step = src.length / n;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const a = Math.floor(i * step);
      const b = Math.floor((i + 1) * step);
      for (let j = a; j < b; j++) s += src[j] || 0;
      bins[i] = (s / Math.max(1, b - a)) / 255;
    }
  } else {
    const e = energyAtTime(t);
    for (let i = 0; i < n; i++) {
      const wobble = 0.55 + 0.45 * Math.sin(t * (2.1 + i * 0.07) + i);
      bins[i] = Math.min(1, e * wobble * (1 - i / (n * 1.6)));
    }
  }
  if (!videoState.smoothBins || videoState.smoothBins.length !== n) {
    videoState.smoothBins = new Float32Array(n);
  }
  const sm = videoState.smoothBins;
  const sens = vizSettings().sens;
  for (let i = 0; i < n; i++) {
    const v = Math.min(1, bins[i] * sens);
    sm[i] = sm[i] * 0.72 + v * 0.28;
  }
  return sm;
}

function bassLevel(t) {
  const bins = spectrumBins(t, 32);
  let s = 0;
  for (let i = 0; i < 6; i++) s += bins[i];
  return Math.min(1, s / 4.2);
}

function drawVisualizer(ctx, w, h, t, alpha) {
  const { mode, theme } = vizSettings();
  if (mode === "off") return;
  const bins = spectrumBins(t, mode === "bars" ? 40 : 48);
  ctx.save();
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.globalCompositeOperation = alpha < 0.99 ? "screen" : "source-over";
  if (mode === "bars") {
    const gap = 2;
    const bw = (w - gap * bins.length) / bins.length;
    const base = h * 0.92;
    const maxH = h * 0.62;
    for (let i = 0; i < bins.length; i++) {
      const bh = Math.max(3, bins[i] * maxH);
      ctx.fillStyle = themeColor(theme, i / bins.length, 0.92);
      ctx.fillRect(i * (bw + gap) + gap, base - bh, bw, bh);
    }
  } else if (mode === "circle") {
    const cx = w / 2;
    const cy = h * 0.42;
    const r = Math.min(w, h) * 0.16;
    const outer = Math.min(w, h) * 0.28;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.85 + bassLevel(t) * 0.18), 0, Math.PI * 2);
    ctx.strokeStyle = themeColor(theme, 0.3, 0.55);
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < bins.length; i++) {
      const ang = (i / bins.length) * Math.PI * 2 - Math.PI / 2;
      const len = r + bins[i] * outer;
      ctx.strokeStyle = themeColor(theme, i / bins.length, 0.9);
      ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.006);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      ctx.stroke();
    }
  } else {
    const cx = w / 2;
    const cy = h * 0.46;
    for (let i = 0; i < 7; i++) {
      const e = bins[i * 4] || bins[i];
      const rad = Math.min(w, h) * (0.08 + i * 0.055) * (0.7 + e * 0.7);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.strokeStyle = themeColor(theme, i / 7, 0.35 + e * 0.45);
      ctx.lineWidth = 2 + e * 6;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPictureLayer(ctx, w, h, t, react) {
  const zoom = react ? 1 + bassLevel(t) * 0.12 * vizSettings().sens : 1;
  if (zoom !== 1) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);
  }
  const vid = videoState.loopVideo;
  if (vid && vid.readyState >= 2 && (vid.videoWidth || 0) > 0) {
    syncLoopVideo(t, false);
    const { mode } = motionSettings();
    if (mode === "off") drawCover(ctx, vid, w, h, 1);
    else {
      const cycle = Math.max(8, Number($("photoHold").value) || 8);
      const p = (((t % cycle) + cycle) % cycle) / cycle;
      drawStillOrKen(ctx, vid, w, h, 1, p, 0);
    }
  } else {
    const pair = photoPair(t);
    if (pair) drawPhotoTransition(ctx, pair, w, h);
  }
  if (zoom !== 1) ctx.restore();
}

function drawBackground(ctx, w, h, t) {
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, w, h);
  const viz = vizSettings();
  const hasPic = !!(videoState.photos.length || (videoState.loopVideo && videoState.loopVideo.readyState >= 2));
  if (viz.mode !== "off" && (viz.place === "replace" || !hasPic)) {
    drawVisualizer(ctx, w, h, t, 1);
    return;
  }
  drawPictureLayer(ctx, w, h, t, viz.mode !== "off" && viz.place === "photo");
  if (viz.mode !== "off" && (viz.place === "overlay" || viz.place === "photo")) {
    if (viz.place === "photo") {
      ctx.save();
      ctx.fillStyle = themeColor(viz.theme, bassLevel(t), 0.12 + bassLevel(t) * 0.18);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    drawVisualizer(ctx, w, h, t, viz.place === "photo" ? 0.42 : 0.72);
  }
}

function drawPhotoTransition(ctx, pair, w, h) {
  const type = $("photoTrans")?.value || "fade";
  if (!pair.b || pair.mix <= 0) {
    drawStillOrKen(ctx, pair.a, w, h, 1, pair.pa, pair.ia);
    return;
  }
  const mix = pair.mix;
  if (type === "flash") {
    drawStillOrKen(ctx, mix < 0.5 ? pair.a : pair.b, w, h, 1, mix < 0.5 ? pair.pa : pair.pb, mix < 0.5 ? pair.ia : pair.ib);
    const flash = Math.max(0, 1 - Math.abs(mix - 0.5) * 5);
    if (flash > 0.02) {
      ctx.fillStyle = `rgba(0,0,0,${flash})`;
      ctx.fillRect(0, 0, w, h);
    }
    return;
  }
  if (type === "zoom") {
    ctx.save();
    const shrink = 1 - mix * 0.12;
    ctx.translate(w / 2, h / 2);
    ctx.scale(shrink, shrink);
    ctx.translate(-w / 2, -h / 2);
    drawStillOrKen(ctx, pair.a, w, h, 1, pair.pa, pair.ia);
    ctx.restore();
    drawStillOrKen(ctx, pair.b, w, h, mix, pair.pb, pair.ib);
    return;
  }
  if (type.startsWith("wipe")) {
    drawStillOrKen(ctx, pair.a, w, h, 1, pair.pa, pair.ia);
    ctx.save();
    ctx.beginPath();
    if (type === "wipe-left") ctx.rect(0, 0, w * mix, h);
    else if (type === "wipe-right") ctx.rect(w * (1 - mix), 0, w * mix, h);
    else ctx.rect(0, 0, w, h * mix);
    ctx.clip();
    drawStillOrKen(ctx, pair.b, w, h, 1, pair.pb, pair.ib);
    ctx.restore();
    return;
  }
  drawStillOrKen(ctx, pair.a, w, h, 1, pair.pa, pair.ia);
  drawStillOrKen(ctx, pair.b, w, h, mix, pair.pb, pair.ib);
}

function introMeta() {
  return {
    title: ($("songTitle")?.value || "").trim(),
    artist: ($("songArtist")?.value || "").trim(),
    album: ($("songAlbum")?.value || "").trim(),
    seconds: Math.max(0, Number($("introSec")?.value) || 0),
  };
}

function endMeta() {
  return {
    seconds: Math.max(0, Number($("endSec")?.value) || 0),
    text: ($("endText")?.value || "").trim(),
  };
}

function parseTimeField(id) {
  const raw = String($(id)?.value || "").trim();
  if (!raw) return null;
  if (raw.includes(":")) {
    const p = raw.split(":").map((x) => Number(x));
    if (p.some((n) => !Number.isFinite(n))) return null;
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function formatTimeField(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function shortRange() {
  const dur = mediaDuration();
  let start = parseTimeField("shortStart");
  let end = parseTimeField("shortEnd");
  if (start == null && end == null) return null;
  if (start == null) start = 0;
  if (end == null) end = dur;
  start = Math.max(0, Math.min(dur || start, start));
  end = Math.max(start + 0.4, Math.min(dur || end, end));
  return { start, end, len: end - start };
}

function floatTitleMode() {
  return $("titleFloat")?.value || "off";
}

function titleDrift(t, seed) {
  const x =
    Math.sin(t * 0.41 + seed) * 0.34 +
    Math.sin(t * 0.13 + seed * 1.9) * 0.38 +
    Math.sin(t * 0.77 + 2.4) * 0.16 +
    Math.sin(t * 0.067 + seed * 0.4) * 0.22;
  const y =
    Math.cos(t * 0.33 + seed * 1.2) * 0.28 +
    Math.sin(t * 0.19 + 0.8) * 0.32 +
    Math.cos(t * 0.61 + seed) * 0.18 +
    Math.sin(t * 0.09 + 1.7) * 0.2;
  return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
}

function drawFloatingTitle(ctx, w, h, t) {
  const mode = floatTitleMode();
  if (mode === "off") return;
  const meta = introMeta();
  const title = meta.title || ($("projectName")?.value || "").trim();
  if (!title) return;
  const drift = titleDrift(t, title.length * 0.37 + 1.1);
  const x = w * 0.5 + drift.x * w * 0.28;
  const y = h * 0.22 + drift.y * h * 0.16;
  const family = titleFontStack();
  const size = Math.max(16, Math.round(titleTypeSize(h) * 0.72));
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${size}px ${family}`;
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#fff";
  const lines = wrapText(ctx, title, w * 0.7);
  let yy = y - ((lines.length - 1) * size * 1.08) / 2;
  lines.forEach((line) => {
    drawFancyText(ctx, line, x, yy, { size, look: textLook(), align: "center", active: true });
    yy += size * 1.08;
  });
  if (meta.artist) {
    ctx.font = `600 ${Math.max(13, Math.round(size * 0.48))}px ${family}`;
    ctx.globalAlpha = 0.8;
    ctx.fillText(meta.artist, x, yy + size * 0.15);
  }
  ctx.restore();
}

function energySnap(center, len, dur) {
  const buf = state.audioBuffer;
  if (!buf || !dur) return Math.max(0, Math.min(Math.max(0, dur - len), center));
  const ch = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const from = Math.max(0, center - 8);
  const to = Math.max(from, Math.min(dur - len, center + 8));
  let best = from;
  let bestE = -1;
  for (let t = from; t <= to; t += 0.3) {
    const a = Math.floor(t * sr);
    const b = Math.min(ch.length, Math.floor((t + 1.1) * sr));
    let e = 0;
    for (let i = a; i < b; i += 40) e += ch[i] * ch[i];
    if (e > bestE) {
      bestE = e;
      best = t;
    }
  }
  return best;
}

function autoShortWindows(dur) {
  if (!(dur > 120)) return [];
  const lengths = [32, 34, 31];
  const fracs = [0.1, 0.4, 0.7];
  return lengths.map((len, i) => {
    const raw = dur * fracs[i];
    const start = energySnap(raw, len, dur);
    return { start, end: start + len, len };
  });
}

function paintShortDownloads() {
  const box = $("shortDownloads");
  if (!box) return;
  const rows = videoState.shorts || [];
  box.innerHTML = "";
  rows.forEach((row) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "accent";
    btn.textContent = `Download Short ${row.index} (${(row.blob.size / 1e6).toFixed(1)} MB)`;
    btn.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(row.blob);
      a.download = row.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    box.appendChild(btn);
  });
  const picks = $("ytShortPicks");
  if (picks) {
    picks.innerHTML = rows
      .map((row) => `<label class="inline-check"><input type="checkbox" id="ytShort${row.index}" checked /> Short ${row.index}</label>`)
      .join("") || `<span class="hint">No Shorts rendered yet.</span>`;
  }
  paintSongCheck();
}

function updateShortHint() {
  const el = $("shortHint");
  if (!el) return;
  const r = shortRange();
  if (!r) {
    el.textContent = "No short range yet. Play, then Mark start and Mark end. Keep the hook under 60 seconds if you can.";
    return;
  }
  const note = r.len > 60 ? " Over 60s still uploads as a Short (up to 3 min) but under 60 travels farther." : " Ready for a Short.";
  el.textContent = `Hook ${formatTimeField(r.start)} → ${formatTimeField(r.end)} (${r.len.toFixed(1)}s). Title and Like & Subscribe overlay the first and last ~2 seconds — music starts immediately.${note}`;
}

function drawIntroCard(ctx, w, h, t, forced) {
  const meta = introMeta();
  const seconds = forced
    ? Math.min(2.2, Math.max(1.2, meta.seconds || 1.8))
    : Math.max(0, meta.seconds || 0);
  const title = meta.title || (forced ? ($("projectName")?.value || "").trim() || "Walk On Records" : "");
  const artist = meta.artist;
  const album = meta.album;
  if (!seconds || !(title || artist || album)) return;
  if (t > seconds) return;
  const fadeIn = Math.min(1, t / 0.35);
  const fadeOut = t > seconds - 0.55 ? Math.max(0, (seconds - t) / 0.55) : 1;
  const a = fadeIn * fadeOut;
  if (a < 0.02) return;
  ctx.save();
  const dim = Math.max(0, Math.min(0.9, Number($("introDim")?.value) ?? 0));
  if (dim > 0.01) {
    ctx.fillStyle = `rgba(5,6,10,${dim * a})`;
    ctx.fillRect(0, 0, w, h);
  }
  const family = titleFontStack();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(255,255,255,${a})`;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = Math.round(h * 0.02);
  let y = h * 0.38;
  if (title) {
    const size = titleTypeSize(h);
    ctx.font = `700 ${size}px ${family}`;
    const lines = wrapText(ctx, title, w * 0.86);
    lines.forEach((line) => {
      ctx.globalAlpha = a;
      drawFancyText(ctx, line, w / 2, y, { size, look: textLook(), align: "center", active: true });
      y += size * 1.12;
    });
    y += size * 0.2;
  }
  if (artist) {
    const size = Math.max(18, Math.round(h * 0.028));
    ctx.font = `600 ${size}px ${family}`;
    ctx.fillStyle = `rgba(232,237,247,${0.92 * a})`;
    ctx.fillText(artist, w / 2, y);
    y += size * 1.35;
  }
  if (album) {
    const size = Math.max(14, Math.round(h * 0.02));
    ctx.font = `500 ${size}px ${family}`;
    ctx.fillStyle = `rgba(154,166,189,${0.95 * a})`;
    ctx.fillText(album, w / 2, y);
  }
  ctx.restore();
}

function drawEndCard(ctx, w, h, t, timelineDur, forced) {
  const duration = timelineDur || state.duration || $("player")?.duration || 0;
  const meta = endMeta();
  const seconds = forced
    ? Math.min(2.8, Math.max(1.6, meta.seconds || 2.2))
    : Math.max(0, meta.seconds || 0);
  if (!seconds || duration < 0.4) return;
  const start = Math.max(0, duration - seconds);
  if (t < start) return;
  const into = t - start;
  const fadeIn = Math.min(1, into / 0.45);
  ctx.save();
  const dim = Math.max(0, Math.min(0.9, Number($("endDim")?.value) ?? 0));
  if (dim > 0.01) {
    ctx.fillStyle = `rgba(5,6,10,${dim * fadeIn})`;
    ctx.fillRect(0, 0, w, h);
  }
  const logo = videoState.endLogo;
  const family = fontStack();
  ctx.globalAlpha = fadeIn;
  const pos = $("endPos")?.value || "center";
  const sizePct = Math.max(8, Math.min(90, Number($("endSize")?.value) || (forced ? 55 : 42))) / 100;
  const nudgeX = (Number($("endX")?.value) || 0) / 100;
  const nudgeY = (Number($("endY")?.value) || 0) / 100;
  const textPos = $("endTextPos")?.value || "below";
  const pad = Math.round(Math.min(w, h) * 0.045);
  let dw = 0;
  let dh = 0;
  if (logo) {
    const iw = logo.naturalWidth || logo.width;
    const ih = logo.naturalHeight || logo.height;
    dw = w * sizePct;
    dh = dw * (ih / Math.max(1, iw));
    if (dh > h * 0.62) {
      dh = h * 0.62;
      dw = dh * (iw / Math.max(1, ih));
    }
  }
  const label = textPos === "off" ? "" : meta.text || "Like & Subscribe";
  const fontSize = label ? Math.max(20, Math.round(h * (forced ? 0.036 : 0.03))) : 0;
  const textH = label ? fontSize * 1.4 : 0;
  const stackH = dh + (dh && textH ? pad * 0.4 : 0) + textH;
  let anchorX = w / 2;
  let anchorY = h / 2;
  if (pos.includes("left")) anchorX = pad + Math.max(dw, w * 0.2) / 2;
  if (pos.includes("right")) anchorX = w - pad - Math.max(dw, w * 0.2) / 2;
  if (pos === "top" || pos.startsWith("top-")) anchorY = pad + stackH / 2;
  if (pos === "bottom" || pos.startsWith("bottom-")) anchorY = h - pad - stackH / 2;
  anchorX += nudgeX * w;
  anchorY += nudgeY * h;
  const top = anchorY - stackH / 2;
  const logoX = anchorX - dw / 2;
  const logoY = textPos === "above" ? top + textH + (label ? pad * 0.3 : 0) : top;
  const textY = textPos === "above" ? top + fontSize * 0.55 : logoY + dh + fontSize * 0.7;
  if (logo && dw) ctx.drawImage(logo, logoX, logoY, dw, dh);
  if (label) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fontSize}px ${family}`;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 12;
    ctx.fillText(label, anchorX, textY);
  }
  ctx.restore();
}

function mapShortTime(outT, pack) {
  if (!pack) return { songT: outT, phase: "song", local: outT };
  const songT = pack.range.start + Math.max(0, Math.min(pack.range.len, outT));
  if (outT < pack.intro) return { songT, phase: "intro", local: outT };
  if (outT >= pack.duration - pack.end) {
    return { songT, phase: "end", local: outT - (pack.duration - pack.end) };
  }
  return { songT, phase: "song", local: outT - pack.intro };
}

function shortPack() {
  const range = shortRange();
  if (!range) return null;
  const intro = Math.min(2.2, Math.max(1.2, introMeta().seconds || 1.8));
  const end = Math.min(2.8, Math.max(1.6, endMeta().seconds || 2.2));
  return { range, intro, end, duration: range.len };
}

export function drawFrame(ctx, w, h, t, pack) {
  const mapped = mapShortTime(t, pack);
  const songT = mapped.songT;
  drawBackground(ctx, w, h, songT);
  const duration = pack ? pack.duration : state.duration || $("player")?.duration || 0;
  if (pack) {
    drawWatermark(ctx, w, h);
    if (mapped.phase === "intro") {
      drawIntroCard(ctx, w, h, mapped.local, true);
    } else if (mapped.phase === "end") {
      drawEndCard(ctx, w, h, pack.duration - pack.end + mapped.local, pack.duration, true);
    } else {
      drawLyrics(ctx, w, h, songT, true);
      if (floatTitleMode() !== "off") drawFloatingTitle(ctx, w, h, songT);
    }
    return;
  }
  const intro = introMeta();
  const end = endMeta();
  const inIntro = intro.seconds > 0 && t <= intro.seconds && (intro.title || intro.artist || intro.album);
  const inEnd = end.seconds > 0 && duration > 0 && t >= duration - end.seconds;
  if (!inIntro && !inEnd) {
    drawWatermark(ctx, w, h);
    drawLyrics(ctx, w, h, t);
    if (floatTitleMode() !== "off") drawFloatingTitle(ctx, w, h, t);
  } else if (inIntro) {
    drawIntroCard(ctx, w, h, t);
    if (floatTitleMode() === "always") drawFloatingTitle(ctx, w, h, t);
  } else {
    drawWatermark(ctx, w, h);
    drawEndCard(ctx, w, h, t, duration);
    if (floatTitleMode() === "always") drawFloatingTitle(ctx, w, h, t);
  }
}

function previewCanvas() {
  return $("videoPreview");
}

function sizePreviewCanvas() {
  const canvas = previewCanvas();
  if (!canvas) return;
  const { w, h } = targetSize();
  const wrap = $("videoPreviewWrap");
  wrap.classList.toggle("wide", $("aspect").value === "16:9");
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = Math.max(160, rect.width);
  const cssH = cssW * (h / w);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

function fmtReview(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function mediaDuration() {
  return state.duration || $("player")?.duration || 0;
}

function seekReview(t) {
  const dur = mediaDuration();
  const time = Math.max(0, Math.min(dur || 0, t));
  const player = $("player");
  if (player && dur) player.currentTime = time;
  syncLoopVideo(time, true);
  paintPreview(time);
  syncReviewSlider(time);
}

function syncReviewSlider(t) {
  const slider = $("reviewSeek");
  const label = $("reviewTime");
  if (!slider && !label) return;
  const dur = mediaDuration();
  if (slider && !videoState.scrubbing) {
    slider.value = dur ? String(Math.round((Math.max(0, t) / dur) * 1000)) : "0";
  }
  if (label) label.textContent = `${fmtReview(t || 0)} / ${fmtReview(dur)}`;
}

export function paintPreview(t) {
  const canvas = previewCanvas();
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  drawFrame(ctx, canvas.width, canvas.height, t || 0);
  if ($("safeZone")?.checked) drawSafeZone(ctx, canvas.width, canvas.height);
  updateStripPlayhead(t || 0);
  if (!videoState.scrubbing) syncReviewSlider(t || 0);
}

function syncPreviewFromPlayer() {
  const player = $("player");
  const t = player.currentTime || 0;
  paintPreview(t);
}

function hasBackground() {
  const vizOn = ($("vizMode")?.value || "off") !== "off";
  return vizOn || videoState.photos.length > 0 || (videoState.loopVideo && videoState.loopVideo.readyState >= 1);
}

function updateDownloadButtons() {
  const main = videoState.main || videoState.result;
  const ready = !!(main && main.blob);
  ["downloadVideo", "dockDownloadVideo"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.disabled = !ready;
    if (ready) {
      const mb = (main.blob.size / 1e6).toFixed(1);
      el.textContent = `Download main video (${mb} MB)`;
    } else el.textContent = "Download main video";
  });
}

export function paintSongCheck() {
  const el = $("songCheck");
  if (!el) return;
  const hasAudio = !!(state.audioBuffer || state.duration);
  const hasLyrics = !!String($("lyrics")?.value || "").trim();
  const hasSrt = !!(state.capcut && state.capcut.length);
  const hasStills = videoState.photos.length > 0;
  const hasWide = !!(videoState.masters.wide?.blob || (videoState.main?.blob && videoState.main.aspect === "16:9"));
  const hasTall = !!(videoState.masters.tall?.blob || (videoState.main?.blob && videoState.main.aspect === "9:16"));
  const hasShorts = (videoState.shorts || []).length > 0;
  const hasPack = !!(videoState.releaseRoot || (hasWide && hasTall));
  const hasYt = !!String($("ytPostLog")?.textContent || "").includes("youtu");
  const map = { audio: hasAudio, lyrics: hasLyrics, srt: hasSrt, stills: hasStills, wide: hasWide, tall: hasTall, shorts: hasShorts, pack: hasPack, yt: hasYt };
  el.querySelectorAll("[data-chk]").forEach((span) => {
    span.classList.toggle("done", !!map[span.dataset.chk]);
  });
}

export function loudnessNote() {
  const buf = state.audioBuffer;
  const el = $("loudnessNote");
  if (!buf) {
    if (el) el.textContent = "";
    return "";
  }
  const ch = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  const step = Math.max(1, Math.floor(ch.length / 20000));
  let n = 0;
  for (let i = 0; i < ch.length; i += step) {
    const a = Math.abs(ch[i]);
    if (a > peak) peak = a;
    sum += a * a;
    n += 1;
  }
  const peakDb = 20 * Math.log10(peak || 1e-6);
  const rmsDb = 20 * Math.log10(Math.sqrt(sum / Math.max(1, n)) || 1e-6);
  let msg = `Peak ${peakDb.toFixed(1)} dBFS · RMS ${rmsDb.toFixed(1)} dBFS`;
  if (peakDb > -0.3) msg += " — hot, may clip on YouTube";
  else if (peakDb < -12) msg += " — quiet, consider raising the master";
  if (el) el.textContent = msg;
  return msg;
}

export function videoReady() {
  paintSongCheck();
  loudnessNote();
  const hasAudio = !!(state.audioBuffer || (state.duration && $("player").src));
  const ok = hasAudio && hasBackground();
  const btn = $("renderVideo");
  const prev = $("previewVideo");
  const dock = $("dockRender");
  if (btn) btn.disabled = !ok || videoState.exporting;
  if (prev) prev.disabled = !ok;
  if (dock) dock.disabled = !ok || videoState.exporting;
  if ($("renderShort")) $("renderShort").disabled = !ok || videoState.exporting;
  if ($("renderAutoShorts")) $("renderAutoShorts").disabled = !ok || videoState.exporting;
  if ($("releaseDesk")) $("releaseDesk").disabled = !ok || videoState.exporting;
  updateDownloadButtons();
  return ok;
}

export function currentSettings() {
  const ids = [
    "aspect",
    "quality",
    "photoHold",
    "photoFade",
    "photoMotion",
    "photoMotionAmt",
    "lyricPreset",
    "lyricTop",
    "lyricHeight",
    "lyricWidth",
    "lyricAlign",
    "lyricShade",
    "wmSize",
    "wmOpacity",
    "wmPos",
    "wmSave",
    "keepHeaders",
    "splitLong",
    "lang",
    "lyricFont",
    "songTitle",
    "titleFont",
    "titleSize",
    "photoEven",
    "vizMode",
    "vizPlace",
    "vizTheme",
    "vizSens",
    "songArtist",
    "songAlbum",
    "introSec",
    "introDim",
    "endSec",
    "endText",
    "endPos",
    "endSize",
    "endX",
    "endY",
    "endTextPos",
    "endDim",
    "photoTrans",
    "shortStart",
    "shortEnd",
    "titleFloat",
    "autoShortsAfter",
    "renderPct",
    "karaokeStyle",
    "safeZone",
    "textLook",
  ];
  const out = {};
  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    out[id] = el.type === "checkbox" ? el.checked : el.value;
  });
  return out;
}

const LOOK_PRESETS = {
  "night-drive": {
    lyricFont: "Oswald",
    titleFont: "Anton",
    titleSize: "6",
    lyricPreset: "lower-third",
    lyricAlign: "center",
    lyricShade: "0",
    introDim: "0",
    endDim: "0",
    vizMode: "bars",
    vizPlace: "overlay",
    vizTheme: "neon",
    vizSens: "1.3",
    textLook: "neon",
    karaokeStyle: "pop",
    photoMotion: "auto",
    photoMotionAmt: "1",
    titleFloat: "off",
    wmPos: "top-right",
    wmSize: "10",
    endPos: "center",
    endSize: "38",
  },
  "stage-gold": {
    lyricFont: "Cinzel",
    titleFont: "Playfair Display",
    titleSize: "5.5",
    lyricPreset: "bottom",
    lyricAlign: "center",
    lyricShade: "0",
    introDim: "0",
    endDim: "0",
    vizMode: "circle",
    vizPlace: "photo",
    vizTheme: "gold",
    vizSens: "1.4",
    textLook: "poster",
    karaokeStyle: "bounce",
    photoMotion: "in",
    photoMotionAmt: "0.65",
    titleFloat: "song",
    wmPos: "top-left",
    wmSize: "11",
    endPos: "bottom",
    endSize: "36",
  },
  "clean-cover": {
    lyricFont: "Sora",
    titleFont: "Sora",
    titleSize: "4.5",
    lyricPreset: "lower-third",
    lyricAlign: "center",
    lyricShade: "0",
    introDim: "0",
    endDim: "0",
    vizMode: "off",
    vizPlace: "overlay",
    vizTheme: "gold",
    vizSens: "1",
    textLook: "clean",
    karaokeStyle: "hold",
    photoMotion: "auto",
    photoMotionAmt: "0.65",
    titleFloat: "off",
    wmPos: "top-right",
    wmSize: "9",
    endPos: "center",
    endSize: "34",
  },
};

function applyLookValues(values) {
  if (!values) return;
  Object.entries(values).forEach(([id, value]) => {
    const el = $(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
  });
  applyLyricPreset?.();
  ensureLyricFont?.();
  sizePreviewCanvas();
  paintPreview($("player")?.currentTime || 0);
  videoReady();
}

async function saveBrandKit() {
  const kit = currentSettings();
  await idbSet(LOOK_KEY, kit);
  setStatus("Walk On Records look kit saved in this browser.", "ok");
}

async function loadBrandKit() {
  const kit = await idbGet(LOOK_KEY);
  if (!kit) return setStatus("No saved look kit yet. Set the look, then Save look kit.", "error");
  applyLookValues(kit);
  setStatus("Look kit applied.", "ok");
}

function applyLookPreset(name) {
  const preset = LOOK_PRESETS[name];
  if (!preset) return setStatus("Unknown look.", "error");
  applyLookValues(preset);
  setStatus(`Applied ${name.replace("-", " ")} look.`, "ok");
}

function slugName() {
  const typed = ($("releaseFolder")?.value || "").trim();
  const raw = typed || introMeta().title || $("projectName")?.value || state.fileName || "release";
  return raw.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "release";
}

function defaultReleaseParts() {
  const title = introMeta().title || $("projectName")?.value || state.fileName || "New single";
  const artist = introMeta().artist || "Walk On Records";
  const album = introMeta().album;
  const cues = timedCues();
  const chapters = [];
  const header = /^(verse\s*\d*|chorus|bridge|outro|intro|hook|pre-?chorus)(\s*\([^)]+\))?$/i;
  let cueI = 0;
  String($("lyrics")?.value || "")
    .split(/\n/)
    .forEach((raw) => {
      const t = raw.trim().replace(/^[\[("']+|[\])"']+$/g, "").trim();
      if (!t || !header.test(t)) return;
      if (!cues.length) return;
      const cue = cues[Math.min(cueI, cues.length - 1)];
      const mm = String(Math.floor(cue.start / 60)).padStart(2, "0");
      const ss = String(Math.floor(cue.start % 60)).padStart(2, "0");
      chapters.push(`${mm}:${ss} ${t}`);
      cueI = Math.min(cues.length - 1, cueI + Math.max(1, Math.floor(cues.length / 8)));
    });
  if (!chapters.length) {
    let lastMin = -1;
    cues.forEach((c) => {
      const m = Math.floor(c.start / 60);
      if (m !== lastMin) {
        lastMin = m;
        const mm = String(m).padStart(2, "0");
        const ss = String(Math.floor(c.start % 60)).padStart(2, "0");
        chapters.push(`${mm}:${ss} ${c.text.slice(0, 42)}`);
      }
    });
  }
  const tags = [
    "#WalkOnRecords",
    "#LyricVideo",
    "#Country",
    "#Trucking",
    artist.replace(/\s+/g, ""),
    title.replace(/\s+/g, ""),
  ]
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : "#" + t));
  return {
    title: `${title} — ${artist}`,
    description: [
      `${title} — ${artist}${album ? " | " + album : ""}`,
      "",
      "Official lyric video from Walk On Records.",
      "",
      "Stream / follow:",
      "Walk On Records",
    ].join("\n"),
    chapters: chapters.join("\n") || "00:00 Start",
    hashtags: tags.join(" "),
  };
}

export function readReleaseParts() {
  const gen = defaultReleaseParts();
  return {
    title: ($("ytTitle")?.value || "").trim() || gen.title,
    description: ($("ytDescription")?.value || "").trim() || gen.description,
    chapters: ($("ytChapters")?.value || "").trim() || gen.chapters,
    hashtags: ($("ytHashtags")?.value || "").trim() || gen.hashtags,
  };
}

function fillReleaseFields(force) {
  const gen = defaultReleaseParts();
  if ($("ytTitle") && (force || !$("ytTitle").value.trim())) $("ytTitle").value = gen.title;
  if ($("ytDescription") && (force || !$("ytDescription").value.trim())) $("ytDescription").value = gen.description;
  if ($("ytChapters") && (force || !$("ytChapters").value.trim())) $("ytChapters").value = gen.chapters;
  if ($("ytHashtags") && (force || !$("ytHashtags").value.trim())) $("ytHashtags").value = gen.hashtags;
  if ($("releaseFolder") && !$("releaseFolder").value.trim()) $("releaseFolder").value = slugName();
}

function releaseCopy() {
  const p = readReleaseParts();
  return [p.title, "", p.description, "", "Chapters", p.chapters, "", p.hashtags].join("\n");
}

const DESC_LIB_KEY = "release-desc-lib";
const TAG_LIB_KEY = "release-tag-lib";

async function loadCopyLib(key) {
  const rows = await idbGet(key);
  return Array.isArray(rows) ? rows : [];
}

async function refreshCopyLibs() {
  const desc = await loadCopyLib(DESC_LIB_KEY);
  const tags = await loadCopyLib(TAG_LIB_KEY);
  const fill = (id, rows, empty) => {
    const sel = $(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">${empty}</option>` + rows.map((r) => `<option value="${r.id}">${escapeChip(r.name)}</option>`).join("");
    if (cur && rows.some((r) => r.id === cur)) sel.value = cur;
  };
  fill("ytDescLib", desc, "Saved descriptions…");
  fill("ytTagLib", tags, "Saved hashtags…");
}

async function saveCopyLib(key, name, text) {
  const label = (name || "").trim();
  const body = (text || "").trim();
  if (!label || !body) return setStatus("Need a name and some text to save.", "error");
  const rows = await loadCopyLib(key);
  const existing = rows.find((r) => r.name.toLowerCase() === label.toLowerCase());
  if (existing) existing.text = body;
  else rows.push({ id: newProjectId(), name: label, text: body, updated: Date.now() });
  await idbSet(key, rows);
  await refreshCopyLibs();
  setStatus(`Saved “${label}”.`, "ok");
}

async function applyCopyLib(key, selectId, targetId) {
  const id = $(selectId)?.value;
  if (!id) return setStatus("Pick a saved item first.", "error");
  const rows = await loadCopyLib(key);
  const hit = rows.find((r) => r.id === id);
  if (!hit) return setStatus("That saved item is gone.", "error");
  if ($(targetId)) $(targetId).value = hit.text;
  setStatus(`Loaded “${hit.name}”.`, "ok");
}

async function snapshotThumbs() {
  const dur = mediaDuration();
  const wins = dur > 120 ? autoShortWindows(dur) : [
    { start: Math.min(8, dur * 0.1) },
    { start: Math.min(dur * 0.4, Math.max(0, dur - 40)) },
    { start: Math.max(0, dur - 35) },
  ];
  const canvas = document.createElement("canvas");
  const { w, h } = targetSize(true);
  canvas.width = Math.min(720, w);
  canvas.height = Math.round(canvas.width * (h / w));
  const ctx = canvas.getContext("2d");
  const out = [];
  for (let i = 0; i < 3; i++) {
    const t = wins[i]?.start || 0;
    drawFrame(ctx, canvas.width, canvas.height, t);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    if (blob) out.push({ blob, name: `thumb-${i + 1}.jpg` });
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32Bytes(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function le32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function le16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xffff, true);
  return b;
}

async function makeZip(entries) {
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = String(entry.path || "file").replace(/\\/g, "/");
    const nameBytes = new TextEncoder().encode(name);
    const data = entry.blob
      ? new Uint8Array(await entry.blob.arrayBuffer())
      : new TextEncoder().encode(entry.text || "");
    const crc = crc32Bytes(data);
    const local = new Blob([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(crc), le32(data.length), le32(data.length),
      le16(nameBytes.length), le16(0),
      nameBytes, data,
    ]);
    chunks.push(local);
    centrals.push(new Blob([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
      le16(20), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(crc), le32(data.length), le32(data.length),
      le16(nameBytes.length), le16(0), le16(0), le16(0), le16(0), le32(0),
      le32(offset), nameBytes,
    ]));
    offset += 30 + nameBytes.length + data.length;
  }
  const centralBlob = new Blob(centrals);
  const end = new Blob([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    le16(0), le16(0), le16(entries.length), le16(entries.length),
    le32(centralBlob.size), le32(offset), le16(0),
  ]);
  return new Blob([...chunks, centralBlob, end], { type: "application/zip" });
}

async function pickReleaseRoot() {
  if (!window.showDirectoryPicker) {
    return setStatus("This browser cannot pick a folder. The pack will download as a zip instead.", "error");
  }
  try {
    videoState.releaseRoot = await window.showDirectoryPicker({ mode: "readwrite", id: "wor-release" });
    if ($("releaseFolderPath")) $("releaseFolderPath").textContent = `Parent: ${videoState.releaseRoot.name}`;
    setStatus(`Releases will go in a subfolder under “${videoState.releaseRoot.name}”.`, "ok");
  } catch (err) {
    if (err?.name !== "AbortError") setStatus("Could not open that folder.", "error");
  }
}

export async function writeSongPhotos(files) {
  if (!videoState.releaseRoot || !files?.length) return;
  const folder = slugName();
  const entries = files.map((f, i) => ({
    path: `${folder}/photos/${f.name || `photo-${i + 1}.jpg`}`,
    blob: f,
  }));
  await writeReleaseEntries(entries);
}

async function writeDirFile(root, parts, data) {
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const w = await file.createWritable();
  await w.write(data);
  await w.close();
}

function youtubeEntries(parts, folder) {
  return [
    { path: `${folder}/youtube/title.txt`, text: parts.title + "\n" },
    { path: `${folder}/youtube/description.txt`, text: parts.description + "\n" },
    { path: `${folder}/youtube/chapters.txt`, text: parts.chapters + "\n" },
    { path: `${folder}/youtube/hashtags.txt`, text: parts.hashtags + "\n" },
    { path: `${folder}/youtube/full-listing.txt`, text: releaseCopy() + "\n" },
  ];
}

async function writeReleaseEntries(entries) {
  if (videoState.releaseRoot) {
    for (const e of entries) {
      const rel = e.path.split("/").filter(Boolean);
      await writeDirFile(videoState.releaseRoot, rel, e.blob || e.text || "");
    }
    return "folder";
  }
  const zip = await makeZip(entries);
  downloadBlob(`${slugName()}-release.zip`, zip);
  return "zip";
}

async function downloadCopyZip() {
  fillReleaseFields(false);
  const folder = slugName();
  const parts = readReleaseParts();
  const thumbs = await snapshotThumbs();
  const entries = [
    ...youtubeEntries(parts, folder),
    ...thumbs.map((th) => ({ path: `${folder}/thumbnails/${th.name}`, blob: th.blob })),
  ];
  const how = await writeReleaseEntries(entries);
  setStatus(how === "folder" ? `Wrote youtube + thumbs under ${folder}.` : "Downloaded youtube + thumbs zip.", "ok");
}

async function buildReleaseDesk() {
  if (videoState.exporting) return;
  if (!hasBackground() || !(state.audioBuffer || (state.duration && $("player").src))) {
    return setStatus("Need audio plus photos, a loop, or a visualizer first.", "error");
  }
  fillReleaseFields(false);
  const folder = slugName();
  const parts = readReleaseParts();
  const thumbs = await snapshotThumbs();
  const textEntries = [
    ...youtubeEntries(parts, folder),
    ...thumbs.map((th) => ({ path: `${folder}/thumbnails/${th.name}`, blob: th.blob })),
  ];
  if (videoState.releaseRoot) await writeReleaseEntries(textEntries);
  const reuse = $("skipRerender") ? $("skipRerender").checked : true;
  setStatus(reuse ? "Using existing masters when present, then rendering what’s missing…" : "Rendering 16:9, then 9:16, then Shorts…", "ok");
  const aspectEl = $("aspect");
  const prev = aspectEl.value;
  const videos = [];
  let wide = reuse && videoState.masters.wide?.blob ? videoState.masters.wide : null;
  if (!wide) {
    aspectEl.value = "16:9";
    sizePreviewCanvas();
    wide = await renderVideo({ batch: true });
    if (wide?.blob) videoState.masters.wide = wide;
  }
  if (wide?.blob) videos.push({ path: `${folder}/video/master-16x9.${extForMime(wide.mime || wide.blob.type)}`, blob: wide.blob });
  if (videoState.cancel) {
    aspectEl.value = prev;
    sizePreviewCanvas();
    return;
  }
  let tall = reuse && videoState.masters.tall?.blob ? videoState.masters.tall : null;
  if (!tall) {
    aspectEl.value = "9:16";
    sizePreviewCanvas();
    tall = await renderVideo({ batch: true });
    if (tall?.blob) videoState.masters.tall = tall;
  }
  if (tall?.blob) videos.push({ path: `${folder}/video/master-9x16.${extForMime(tall.mime || tall.blob.type)}`, blob: tall.blob });
  aspectEl.value = prev;
  sizePreviewCanvas();
  const dur = mediaDuration();
  if (dur > 120 && !videoState.cancel && !((videoState.shorts || []).length >= 3 && reuse)) await renderAutoShorts();
  (videoState.shorts || []).forEach((s, i) => {
    if (s?.blob) videos.push({ path: `${folder}/video/short-${s.index || i + 1}-9x16.${extForMime(s.blob.type)}`, blob: s.blob });
  });
  if (videoState.releaseRoot) {
    if (videos.length) await writeReleaseEntries(videos);
    setStatus(`Release pack written to ${videoState.releaseRoot.name}/${folder}/ (youtube, thumbnails, video).`, "ok");
  } else {
    const zip = await makeZip([...textEntries, ...videos]);
    downloadBlob(`${folder}-release.zip`, zip);
    setStatus(`Downloaded ${folder}-release.zip with youtube/, thumbnails/, and video/.`, "ok");
  }
}

export function applySettings(settings) {
  if (!settings) return;
  Object.entries(settings).forEach(([id, value]) => {
    const el = $(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
  });
  ["lyricShade", "introDim", "endDim"].forEach((id) => {
    if ($(id)) $(id).value = "0";
  });
  applyLyricPreset();
  ensureLyricFont();
}

export function videoSnapshot() {
  return {
    settings: currentSettings(),
    photos: videoState.photos
      .filter((p) => p.file)
      .map((p) => ({ name: p.name, file: p.file, hold: p.hold })),
    loop: videoState.loopFile ? { name: videoState.loopFile.name, file: videoState.loopFile } : null,
    watermark: videoState.watermarkFile
      ? { name: videoState.watermarkName || videoState.watermarkFile.name, file: videoState.watermarkFile }
      : null,
    endLogo: videoState.endLogoFile
      ? { name: videoState.endLogoName || videoState.endLogoFile.name, file: videoState.endLogoFile }
      : null,
    render: (videoState.main || videoState.result)
      ? {
          name: (videoState.main || videoState.result).name,
          mime: (videoState.main || videoState.result).mime,
          blob: (videoState.main || videoState.result).blob,
        }
      : null,
    shorts: (videoState.shorts || []).map((s) => ({
      name: s.name,
      blob: s.blob,
      index: s.index,
    })),
  };
}

export async function applyVideoSnapshot(snap) {
  clearPhotos();
  clearLoopVideo();
  if (videoState.watermarkUrl) URL.revokeObjectURL(videoState.watermarkUrl);
  videoState.watermark = null;
  videoState.watermarkUrl = null;
  videoState.watermarkName = "";
  videoState.watermarkFile = null;
  if ($("wmName")) $("wmName").textContent = "";
  if (videoState.endLogoUrl) URL.revokeObjectURL(videoState.endLogoUrl);
  videoState.endLogo = null;
  videoState.endLogoUrl = null;
  videoState.endLogoName = "";
  videoState.endLogoFile = null;
  if ($("endName")) $("endName").textContent = "";
  clearRenderResult();
  applySettings(snap?.settings);
  if (snap?.photos?.length) {
    for (const p of snap.photos) {
      if (!p.file) continue;
      const file = p.file instanceof File ? p.file : new File([p.file], p.name || "photo.jpg");
      try {
        const item = await loadImageFromFile(file);
        if (p.hold) item.hold = p.hold;
        videoState.photos.push(item);
      } catch (_) {}
    }
    renderPhotoList();
    if ($("photoName")) {
      $("photoName").textContent = `${videoState.photos.length} photo${videoState.photos.length === 1 ? "" : "s"}`;
    }
  }
  if (snap?.loop?.file) {
    const file = snap.loop.file instanceof File ? snap.loop.file : new File([snap.loop.file], snap.loop.name || "loop.mp4");
    await setLoopVideo(file);
  }
  if (snap?.watermark?.file) {
    const file =
      snap.watermark.file instanceof File
        ? snap.watermark.file
        : new File([snap.watermark.file], snap.watermark.name || "logo.png");
    await setWatermarkFromFile(file, false);
  }
  if (snap?.endLogo?.file) {
    const file =
      snap.endLogo.file instanceof File
        ? snap.endLogo.file
        : new File([snap.endLogo.file], snap.endLogo.name || "end.png");
    await setEndLogoFromFile(file);
  }
  if (snap?.render?.blob) {
    setMainResult(snap.render.blob, snap.render.name, snap.render.mime);
  }
  if (snap?.shorts?.length) {
    videoState.shorts = snap.shorts.filter((s) => s?.blob);
    paintShortDownloads();
  }
  videoReady();
  paintPreview($("player")?.currentTime || 0);
}

export function clearRenderResult() {
  if (videoState.mainUrl && videoState.mainUrl !== videoState.resultUrl) {
    URL.revokeObjectURL(videoState.mainUrl);
  }
  if (videoState.resultUrl) URL.revokeObjectURL(videoState.resultUrl);
  videoState.main = null;
  videoState.mainUrl = null;
  videoState.result = null;
  videoState.resultUrl = null;
  updateDownloadButtons();
}

function setMainResult(blob, name, mime, extra) {
  if (videoState.mainUrl) URL.revokeObjectURL(videoState.mainUrl);
  videoState.main = { blob, name, mime: mime || blob.type, ...(extra || {}) };
  videoState.mainUrl = URL.createObjectURL(blob);
  videoState.result = videoState.main;
  videoState.resultUrl = videoState.mainUrl;
  updateDownloadButtons();
}

function setRenderResult(blob, name, mime, asShort, extra) {
  if (asShort) return;
  setMainResult(blob, name, mime, extra);
}

export function releaseMedia() {
  return {
    wide: videoState.masters.wide,
    tall: videoState.masters.tall,
    main: videoState.main || videoState.result,
    shorts: videoState.shorts || [],
  };
}

export async function postReleaseToYoutube() {
  try {
    const media = releaseMedia();
    const posted = await uploadPackToYoutube(media, readReleaseParts());
    const lines = posted.map((p) => `${p.kind}: ${p.url || p.id}`).join(" · ");
    setStatus(`Posted ${posted.length} file(s) as ${$("ytPrivacy")?.value || "unlisted"}. ${lines}`, "ok");
    if ($("ytPostLog")) $("ytPostLog").textContent = posted.map((p) => `${p.kind}\n${p.url}`).join("\n\n");
    window.alert(`Posted ${posted.length} file(s).\n\n${posted.map((p) => `${p.kind}\n${p.url}`).join("\n\n")}`);
  } catch (err) {
    const msg = String(err.message || err);
    setStatus(msg, "error");
    if (msg !== "Upload cancelled.") window.alert(msg);
  }
}

export function downloadRender() {
  const main = videoState.main || videoState.result;
  if (!main?.blob) return setStatus("No main video yet. Render the full song first.", "error");
  downloadBlob(main.name, main.blob);
  setStatus("Main video download started.", "ok");
}

function pickMime() {
  const types = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.4D401F,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function extForMime(mime) {
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function defaultPhotoHold() {
  return Math.max(0.4, Number($("photoHold")?.value) || 5);
}

function evenOutPhotoTimes() {
  const n = videoState.photos.length;
  if (!n) return setStatus("Add photos first.", "error");
  const dur = mediaDuration();
  if (!(dur > 0.5)) return setStatus("Load the WAV first so times can split across the song.", "error");
  const each = Math.max(0.4, Math.round((dur / n) * 10) / 10);
  videoState.photos.forEach((p) => {
    p.hold = each;
  });
  if ($("photoHold")) $("photoHold").value = String(each);
  if ($("photoEven")) $("photoEven").checked = true;
  renderPhotoList();
  paintPreview($("player")?.currentTime || 0);
  setStatus(`Each of ${n} photos shows ${each}s (song ÷ photos).`, "ok");
}

function movePhoto(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= videoState.photos.length) return;
  const arr = videoState.photos;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderPhotoList();
  paintPreview($("player")?.currentTime || 0);
}

function renderPhotoList() {
  const el = $("photoList");
  if (!el) return;
  if (!videoState.photos.length) {
    el.textContent = "";
    renderPhotoStrip();
    return;
  }
  const fallback = defaultPhotoHold();
  el.innerHTML = videoState.photos
    .map((p, i) => {
      const hold = Math.max(0.4, Number(p.hold) || fallback);
      return `<div class="photo-item" data-i="${i}">
        <span class="ord">${i + 1}</span>
        <span class="name">${escapeChip(p.name)}</span>
        <label class="hold">sec <input type="number" min="0.4" max="300" step="0.1" value="${hold}" data-hold="${i}" /></label>
        <button type="button" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
        <button type="button" data-dn="${i}" ${i === videoState.photos.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
        <button type="button" data-rm="${i}" aria-label="Remove">×</button>
      </div>`;
    })
    .join("");
  el.querySelectorAll("button[data-rm]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.rm);
      const gone = videoState.photos.splice(i, 1)[0];
      if (gone?.url) URL.revokeObjectURL(gone.url);
      renderPhotoList();
      videoReady();
      paintPreview($("player").currentTime || 0);
    });
  });
  el.querySelectorAll("button[data-up]").forEach((btn) => {
    btn.addEventListener("click", () => movePhoto(Number(btn.dataset.up), -1));
  });
  el.querySelectorAll("button[data-dn]").forEach((btn) => {
    btn.addEventListener("click", () => movePhoto(Number(btn.dataset.dn), 1));
  });
  el.querySelectorAll("input[data-hold]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const i = Number(inp.dataset.hold);
      if (videoState.photos[i]) videoState.photos[i].hold = Math.max(0.4, Number(inp.value) || fallback);
      if ($("photoEven")) $("photoEven").checked = false;
      renderPhotoStrip();
      paintPreview($("player")?.currentTime || 0);
    });
  });
  renderPhotoStrip();
}

function photoCycle() {
  const holds = photoHolds();
  return holds.reduce((s, x) => s + x, 0) || 1;
}

function photoStartAt(i) {
  const holds = photoHolds();
  let acc = 0;
  for (let n = 0; n < i && n < holds.length; n++) acc += holds[n];
  return acc;
}

function updateStripPlayhead(t) {
  const head = $("stripPlayhead");
  const strip = $("photoStrip");
  if (!head || !strip || !videoState.photos.length) return;
  const holds = photoHolds();
  const cycle = holds.reduce((s, x) => s + x, 0) || 1;
  const pos = (((t || 0) % cycle) + cycle) % cycle;
  head.style.left = `${(pos / cycle) * 100}%`;
  let acc = 0;
  let idx = 0;
  for (let i = 0; i < holds.length; i++) {
    if (pos < acc + holds[i]) {
      idx = i;
      break;
    }
    acc += holds[i];
    idx = i;
  }
  strip.querySelectorAll(".strip-clip").forEach((c) => {
    c.classList.toggle("active", Number(c.dataset.i) === idx);
  });
}

function renderPhotoStrip() {
  const wrap = $("photoStripWrap");
  const el = $("photoStrip");
  if (!wrap || !el) return;
  if (!videoState.photos.length) {
    wrap.hidden = true;
    el.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  const holds = photoHolds();
  el.innerHTML =
    videoState.photos
      .map((p, i) => {
        const src = p.url || p.img?.src || "";
        return `<div class="strip-clip" data-i="${i}" style="flex-grow:${Math.max(0.4, holds[i])}">
        <div class="strip-edge" data-edge="l" data-i="${i}"></div>
        <img alt="" src="${src}" />
        <span class="strip-meta">${i + 1} · ${holds[i].toFixed(1)}s</span>
        <div class="strip-edge" data-edge="r" data-i="${i}"></div>
      </div>`;
      })
      .join("") + `<div id="stripPlayhead" class="strip-playhead"></div>`;
  el.querySelectorAll(".strip-clip").forEach((clip) => bindStripClip(clip));
  updateStripPlayhead($("player")?.currentTime || 0);
}

function bindStripClip(clip) {
  clip.addEventListener("pointerdown", (e) => {
    const edge = e.target.closest(".strip-edge");
    const i = Number(clip.dataset.i);
    if (edge) {
      e.preventDefault();
      e.stopPropagation();
      startStripResize(e, i, edge.dataset.edge);
      return;
    }
    startStripMove(e, i, clip);
  });
}

function startStripResize(e, i, side) {
  const strip = $("photoStrip");
  const startX = e.clientX;
  const startHold = photoHolds()[i];
  const cycle = photoCycle();
  const width = strip.getBoundingClientRect().width || 1;
  videoState.stripDrag = { kind: "resize", i, side, startX, startHold };
  const move = (ev) => {
    const dx = ev.clientX - startX;
    const signed = side === "l" ? -dx : dx;
    const next = Math.max(0.4, startHold + (signed / width) * cycle);
    if ($("photoEven")) $("photoEven").checked = false;
    if (videoState.photos[i]) videoState.photos[i].hold = Math.round(next * 10) / 10;
    const clip = strip.querySelector(`.strip-clip[data-i="${i}"]`);
    if (clip) {
      clip.style.flexGrow = String(videoState.photos[i].hold);
      const meta = clip.querySelector(".strip-meta");
      if (meta) meta.textContent = `${i + 1} · ${videoState.photos[i].hold.toFixed(1)}s`;
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    videoState.stripDrag = null;
    renderPhotoList();
    paintPreview($("player")?.currentTime || 0);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startStripMove(e, i, clip) {
  const startX = e.clientX;
  let dragging = false;
  const move = (ev) => {
    if (!dragging && Math.abs(ev.clientX - startX) < 8) return;
    dragging = true;
    clip.classList.add("dragging");
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".strip-clip");
    if (!over || over === clip) return;
    const j = Number(over.dataset.i);
    if (!Number.isFinite(j) || j === i) return;
    const arr = videoState.photos;
    const [item] = arr.splice(i, 1);
    arr.splice(j, 0, item);
    i = j;
    renderPhotoStrip();
    const now = $("photoStrip")?.querySelector(`.strip-clip[data-i="${i}"]`);
    if (now) now.classList.add("dragging");
  };
  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!dragging) {
      const t = photoStartAt(Number(clip.dataset.i));
      const player = $("player");
      if (player && Number.isFinite(t)) player.currentTime = t;
      paintPreview(t);
    } else {
      renderPhotoList();
      paintPreview($("player")?.currentTime || 0);
    }
    videoState.stripDrag = null;
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function escapeChip(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function clearPhotos() {
  videoState.photos.forEach((p) => p.url && URL.revokeObjectURL(p.url));
  videoState.photos = [];
  $("photoFile").value = "";
  renderPhotoList();
}

function clearLoopVideo() {
  if (videoState.loopUrl) URL.revokeObjectURL(videoState.loopUrl);
  if (videoState.loopVideo) {
    videoState.loopVideo.pause();
    videoState.loopVideo.removeAttribute("src");
    videoState.loopVideo.load();
  }
  videoState.loopVideo = null;
  videoState.loopUrl = null;
  videoState.loopFile = null;
  if ($("loopName")) $("loopName").textContent = "";
  if ($("loopFile")) $("loopFile").value = "";
}

export async function addPhotos(fileList) {
  const incoming = [...(fileList || [])];
  let files = incoming.filter(looksLikeImage);
  if (!files.length) files = incoming.filter((f) => f && f.size);
  if (!files.length) return setStatus("Drop image files (JPG, PNG, WebP). HEIC from a phone may need to be saved as JPG first.", "error");
  clearLoopVideo();
  let failed = 0;
  for (const file of files) {
    try {
      const item = await loadImageFromFile(file);
      item.hold = defaultPhotoHold();
      videoState.photos.push(item);
    } catch {
      failed += 1;
      setStatus(`Could not read ${file.name || "that photo"}. If it is HEIC, export JPG from Gallery and drop that.`, "error");
    }
  }
  try {
    renderPhotoList();
    if ($("photoName")) {
      $("photoName").textContent = `${videoState.photos.length} photo${videoState.photos.length === 1 ? "" : "s"}`;
    }
    videoReady();
    paintPreview($("player")?.currentTime || 0);
  } catch (err) {
    setStatus(`Photos loaded but the storyboard hit a snag: ${err.message || err}`, "error");
  }
  if (videoState.photos.length) {
    setStatus(
      `Loaded ${videoState.photos.length} photo${videoState.photos.length === 1 ? "" : "s"} for the video.` +
        (failed ? ` ${failed} file${failed === 1 ? "" : "s"} skipped.` : ""),
      "ok"
    );
  }
}

export function photoNames() {
  return videoState.photos.map((p) => p.name || "photo");
}

export async function replacePhotoAt(index, file) {
  if (!file || index < 0 || index >= videoState.photos.length) {
    throw new Error("Pick a photo slot to replace.");
  }
  const item = await loadImageFromFile(file);
  item.hold = videoState.photos[index].hold || defaultPhotoHold();
  const old = videoState.photos[index];
  if (old?.url) URL.revokeObjectURL(old.url);
  videoState.photos[index] = item;
  renderPhotoList();
  if ($("photoName")) $("photoName").textContent = `${videoState.photos.length} photos`;
  videoReady();
  paintPreview($("player")?.currentTime || 0);
}

async function setLoopVideo(file) {
  if (!file) return;
  clearPhotos();
  $("photoName").textContent = "";
  if (videoState.loopUrl) URL.revokeObjectURL(videoState.loopUrl);
  const url = URL.createObjectURL(file);
  videoState.loopUrl = url;
  videoState.loopFile = file;
  const vid = document.createElement("video");
  vid.muted = true;
  vid.loop = true;
  vid.playsInline = true;
  vid.preload = "auto";
  vid.src = url;
  videoState.loopVideo = vid;
  await new Promise((resolve, reject) => {
    vid.onloadeddata = () => resolve();
    vid.onerror = () => reject(new Error("Could not read that video"));
  });
  try {
    await vid.play();
    vid.pause();
  } catch (_) {}
  $("loopName").textContent = `${file.name} · ${Number.isFinite(vid.duration) ? vid.duration.toFixed(1) + "s loop" : "loop"}`;
  videoReady();
  paintPreview(0);
  setStatus("Loop video loaded. It will repeat for the length of the song.", "ok");
}

async function setWatermarkFromFile(file, persist) {
  const item = await loadImageFromFile(file);
  if (videoState.watermarkUrl) URL.revokeObjectURL(videoState.watermarkUrl);
  videoState.watermark = item.img;
  videoState.watermarkUrl = item.url;
  videoState.watermarkName = file.name;
  videoState.watermarkFile = file;
  $("wmName").textContent = file.name + (persist ? " · saved in this browser" : "");
  paintPreview($("player").currentTime || 0);
  if (persist) {
    await idbSet(WM_KEY, { blob: file, name: file.name });
    setStatus("Watermark saved in this app (this browser only).", "ok");
  } else {
    setStatus("Watermark loaded for this session.", "ok");
  }
}

async function setEndLogoFromFile(file) {
  if (!file) return;
  const item = await loadImageFromFile(file);
  if (videoState.endLogoUrl) URL.revokeObjectURL(videoState.endLogoUrl);
  videoState.endLogo = item.img;
  videoState.endLogoUrl = item.url;
  videoState.endLogoName = file.name;
  videoState.endLogoFile = file;
  if ($("endName")) $("endName").textContent = file.name;
  paintPreview($("player").currentTime || 0);
}

function clearEndLogo() {
  if (videoState.endLogoUrl) URL.revokeObjectURL(videoState.endLogoUrl);
  videoState.endLogo = null;
  videoState.endLogoUrl = null;
  videoState.endLogoName = "";
  videoState.endLogoFile = null;
  if ($("endName")) $("endName").textContent = "";
  if ($("endFile")) $("endFile").value = "";
  paintPreview($("player").currentTime || 0);
}

function fileFromLogoRecord(rec) {
  if (!rec?.blob) return null;
  return rec.blob instanceof File ? rec.blob : new File([rec.blob], rec.name || "logo.png");
}

async function refreshLogoLibrary() {
  const sel = $("logoLibrary");
  if (!sel) return;
  const rows = await listLogos();
  const current = sel.value;
  sel.innerHTML = `<option value="">Logo library…</option>` +
    rows.map((r) => `<option value="${r.id}">${escapeChip(r.name || "logo")}</option>`).join("");
  if (current && rows.some((r) => r.id === current)) sel.value = current;
}

async function saveFileToLibrary(file, fallbackName) {
  if (!file) return setStatus("Load a logo first.", "error");
  const name = window.prompt("Name this logo in the library", fallbackName || file.name.replace(/\.[^.]+$/, ""));
  if (!name) return;
  await putLogo({
    id: newProjectId(),
    name: name.trim(),
    blob: file,
    created: Date.now(),
  });
  await refreshLogoLibrary();
  setStatus(`Saved “${name.trim()}” in the logo library.`, "ok");
}

async function loadSavedWatermark() {
  try {
    const rec = await idbGet(WM_KEY);
    if (!rec || !rec.blob) return false;
    const file = rec.blob instanceof File ? rec.blob : new File([rec.blob], rec.name || "logo.png");
    await setWatermarkFromFile(file, false);
    $("wmName").textContent = (rec.name || "logo") + " · saved in this browser";
    return true;
  } catch {
    return false;
  }
}

function bindMultiDrop(box, input, onFiles) {
  if (!box || !input) return;
  input.removeAttribute("hidden");
  input.hidden = false;
  input.classList.add("drop-input");
  if (input.parentElement !== box) box.insertBefore(input, box.firstChild);
  box.addEventListener("dragover", (e) => {
    e.preventDefault();
    box.classList.add("over");
  });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("over");
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  });
  input.addEventListener("change", () => {
    if (input.files?.length) onFiles(input.files);
  });
}

function loopTargetTime(t) {
  const vid = videoState.loopVideo;
  const dur = vid?.duration;
  if (!vid || !Number.isFinite(dur) || dur < 0.05) return 0;
  return ((t % dur) + dur) % dur;
}

function syncLoopVideo(t, force) {
  const vid = videoState.loopVideo;
  if (!vid || vid.readyState < 2) return;
  const dur = vid.duration;
  if (!Number.isFinite(dur) || dur < 0.05) return;
  const vt = loopTargetTime(t);
  const cur = vid.currentTime || 0;
  const drift = Math.min(Math.abs(cur - vt), dur - Math.abs(cur - vt));
  if (!force && (vid.seeking || drift < 0.55)) return;
  try {
    vid.currentTime = vt;
  } catch (_) {}
}

function pauseLoopVideo() {
  const vid = videoState.loopVideo;
  if (!vid) return;
  try {
    vid.pause();
  } catch (_) {}
}

async function ensureLoopPlaying(t) {
  const vid = videoState.loopVideo;
  if (!vid) return;
  vid.loop = true;
  vid.muted = true;
  vid.playsInline = true;
  if (t != null) syncLoopVideo(t, true);
  try {
    await vid.play();
  } catch (_) {}
}

async function ensurePreviewAnalyser() {
  const player = $("player");
  if (!player) return;
  if (!videoState.previewActx) {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    videoState.previewActx = ctx;
    videoState.previewAnalyser = analyser;
    videoState.previewFreq = new Uint8Array(analyser.frequencyBinCount);
    try {
      const src = ctx.createMediaElementSource(player);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      videoState.mediaElSrc = src;
    } catch (_) {
      try {
        videoState.previewAnalyser.connect(ctx.destination);
      } catch (e) {}
    }
  }
  if (videoState.previewActx.state === "suspended") {
    try {
      await videoState.previewActx.resume();
    } catch (_) {}
  }
  if (!videoState.micOn) {
    videoState.analyser = videoState.previewAnalyser;
    videoState.freqData = videoState.previewFreq;
  }
}

function startVizPreviewLoop() {
  const tick = () => {
    if (videoState.exporting) return;
    const player = $("player");
    const live = videoState.micOn || (player && !player.paused);
    if (!live) return;
    paintPreview(player?.currentTime || 0);
    videoState.vizRaf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(videoState.vizRaf);
  videoState.vizRaf = requestAnimationFrame(tick);
}

async function startMicPreview() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    await ensurePreviewAnalyser();
    const ctx = videoState.previewActx;
    if (videoState.micSource) {
      try {
        videoState.micSource.disconnect();
      } catch (_) {}
    }
    videoState.micStream = stream;
    videoState.micSource = ctx.createMediaStreamSource(stream);
    videoState.micAnalyser = ctx.createAnalyser();
    videoState.micAnalyser.fftSize = 256;
    videoState.micAnalyser.smoothingTimeConstant = 0.7;
    videoState.micSource.connect(videoState.micAnalyser);
    videoState.analyser = videoState.micAnalyser;
    videoState.freqData = new Uint8Array(videoState.micAnalyser.frequencyBinCount);
    videoState.micOn = true;
    startVizPreviewLoop();
    setStatus("Microphone live. Preview only — render still uses the uploaded track.", "ok");
  } catch (e) {
    setStatus("Could not open the microphone. Allow access in the browser.", "error");
  }
}

function stopMicPreview() {
  videoState.micOn = false;
  if (videoState.micStream) {
    videoState.micStream.getTracks().forEach((tr) => tr.stop());
    videoState.micStream = null;
  }
  if (videoState.micSource) {
    try {
      videoState.micSource.disconnect();
    } catch (_) {}
    videoState.micSource = null;
  }
  videoState.analyser = videoState.previewAnalyser || null;
  videoState.freqData = videoState.previewFreq || null;
  setStatus("Microphone off.");
}

async function renderAutoShorts() {
  if (videoState.exporting) return;
  if (!hasBackground() || !(state.audioBuffer || (state.duration && $("player").src))) {
    return setStatus("Need audio plus photos or a loop video. Lyrics are optional.", "error");
  }
  const dur = mediaDuration();
  if (!(dur > 120)) {
    return setStatus("Auto 3 Shorts needs a song longer than 2 minutes. Use Mark start/end for one Short.", "error");
  }
  const wins = autoShortWindows(dur);
  videoState.shorts = [];
  videoState.cancel = false;
  paintShortDownloads();
  setStatus("Cutting 3 Shorts (30–35s hooks + title + Like & Subscribe). Leave this tab open.");
  for (let i = 0; i < wins.length; i++) {
    if (videoState.cancel) break;
    $("shortStart").value = formatTimeField(wins[i].start);
    $("shortEnd").value = formatTimeField(wins[i].end);
    updateShortHint();
    const res = await renderVideo({ short: true, batch: true, index: i + 1 });
    if (res?.blob) videoState.shorts.push({ blob: res.blob, name: res.name, index: i + 1 });
    paintShortDownloads();
  }
  if (videoState.cancel) setStatus("Auto Shorts stopped.");
  else if (videoState.shorts.length) {
    setStatus(`${videoState.shorts.length} Shorts ready. Download each below.`, "ok");
  }
}

async function renderVideo(opts = {}) {
  if (videoState.exporting) return null;
  if (!hasBackground() || !(state.audioBuffer || (state.duration && $("player").src))) {
    setStatus("Need audio plus photos or a loop video. Lyrics are optional.", "error");
    return null;
  }
  const pack = opts.short ? shortPack() : null;
  if (opts.short && !pack) {
    setStatus("Set Short start and Short end, or mark them on the preview bar.", "error");
    return null;
  }
  const mime = pickMime();
  if (!mime) {
    setStatus("This browser cannot record video. Try Chrome on the Chromebook.", "error");
    return null;
  }
  const { w, h } = targetSize(!!opts.short);
  const songDur = state.duration || state.audioBuffer?.duration || $("player").duration || 0;
  const amount = Math.max(10, Math.min(100, Number($("renderPct")?.value) || 100)) / 100;
  const fullDuration = pack ? pack.duration : songDur;
  const duration = fullDuration * amount;
  if (!(duration > 0.2)) {
    setStatus("Audio duration missing. Load the WAV again.", "error");
    return null;
  }

  videoState.exporting = true;
  if (!opts.batch) videoState.cancel = false;
  videoReady();
  ["cancelRender", "dockCancelRender"].forEach((id) => {
    if ($(id)) $(id).style.display = "inline-flex";
  });
  setProgress(0.01);
  setStatus(
    pack
      ? `Rendering YouTube Short ${opts.index ? opts.index + "/3 " : ""}${w}×${h} · ${Math.round(amount * 100)}% (~${Math.ceil(duration)}s).`
      : `Rendering ${w}×${h} · ${Math.round(amount * 100)}% (~${Math.ceil(duration)}s). Leave this tab open.`
  );

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.style.position = "fixed";
  canvas.style.left = "-9999px";
  canvas.style.pointerEvents = "none";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: false });
  await ensureLyricFont();
  await (document.fonts?.ready || Promise.resolve());

  const fps = 30;
  const vStream = canvas.captureStream(fps);
  const actx = new AudioContext();
  if (actx.state === "suspended") await actx.resume();
  const dest = actx.createMediaStreamDestination();
  let stopAudio = () => {};

  if (state.audioBuffer) {
    const src = actx.createBufferSource();
    src.buffer = state.audioBuffer;
    const analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    src.connect(analyser);
    analyser.connect(dest);
    videoState.analyser = analyser;
    videoState.freqData = new Uint8Array(analyser.frequencyBinCount);
    if (pack) src.start(0, pack.range.start, duration);
    else src.start(0, 0, duration);
    stopAudio = () => {
      try {
        src.stop();
      } catch (_) {}
    };
  } else {
    const player = $("player");
    const prevMuted = player.muted;
    player.muted = true;
    const elSrc = actx.createMediaElementSource(player);
    elSrc.connect(dest);
    player.currentTime = pack ? pack.range.start : 0;
    await player.play();
    stopAudio = () => {
      player.pause();
      player.muted = prevMuted;
    };
  }

  const mixed = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  let rec;
  try {
    rec = new MediaRecorder(mixed, {
      mimeType: mime,
      videoBitsPerSecond: h >= 1080 ? 8_000_000 : 4_500_000,
      audioBitsPerSecond: 192000,
    });
  } catch {
    rec = new MediaRecorder(mixed);
  }
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => {
    rec.onstop = () => resolve();
  });
  rec.start(250);
  const loopStart = pack ? pack.range.start : 0;
  await ensureLoopPlaying(loopStart);

  const t0 = actx.currentTime;
  const started = performance.now();
  let lastUi = 0;

  await new Promise((resolve) => {
    const tick = () => {
      if (videoState.cancel) {
        resolve();
        return;
      }
      const t = Math.min(duration, actx.currentTime - t0);
      drawFrame(ctx, w, h, t, pack);
      const now = performance.now();
      if (now - lastUi > 200) {
        lastUi = now;
        const pct = duration ? t / duration : 0;
        setProgress(pct);
        const left = Math.max(0, duration - t);
        setStatus(`Rendering ${Math.round(pct * 100)}% · ~${Math.ceil(left)}s left`);
      }
      if (t >= duration - 1 / fps) {
        drawFrame(ctx, w, h, duration, pack);
        resolve();
        return;
      }
      const elapsedWall = (performance.now() - started) / 1000;
      if (elapsedWall > duration + 20) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });

  try {
    if (rec.state === "recording") rec.stop();
  } catch (_) {}
  stopAudio();
  await stopped;
  try {
    await actx.close();
  } catch (_) {}
  videoState.analyser = videoState.previewAnalyser || null;
  videoState.freqData = videoState.previewFreq || null;
  canvas.remove();

  ["cancelRender", "dockCancelRender"].forEach((id) => {
    if ($(id)) $(id).style.display = "none";
  });
  videoState.exporting = false;
  videoReady();

  if (videoState.cancel) {
    setProgress(null);
    setStatus("Render cancelled.");
    return null;
  }
  if (!chunks.length) {
    setProgress(null);
    setStatus("Recorder produced an empty file. Try 720p, or use Chrome.", "error");
    return null;
  }
  const outMime = rec.mimeType || mime;
  const blob = new Blob(chunks, { type: outMime });
  const ext = extForMime(outMime);
  const tag = `${pack ? `short${opts.index ? "-" + opts.index : ""}-9x16` : $("aspect").value.replace(":", "x")}${amount < 1 ? `-draft${Math.round(amount * 100)}` : ""}`;
  const name = `${state.fileName || "video"}-${tag}.${ext}`;
  const extra = {
    aspect: pack ? "9:16" : $("aspect")?.value || "9:16",
    w,
    h,
    duration,
    short: !!pack,
  };
  setRenderResult(blob, name, outMime, !!opts.short, extra);
  if (opts.batch && !opts.short) {
    if (extra.aspect === "16:9") videoState.masters.wide = { blob, name, mime: outMime, ...extra };
    if (extra.aspect === "9:16") videoState.masters.tall = { blob, name, mime: outMime, ...extra };
  }
  if (opts.short && !opts.batch) {
    videoState.shorts = videoState.shorts || [];
    videoState.shorts.push({ blob, name, index: videoState.shorts.length + 1 });
    paintShortDownloads();
  }
  window.dispatchEvent(new CustomEvent("wavesrt-rendered"));
  setProgress(1);
  setStatus(
    ext === "mp4"
      ? `Video ready (${(blob.size / 1e6).toFixed(1)} MB MP4). Use Download video — it is also stored in the project when you Save.`
      : `Video ready (${(blob.size / 1e6).toFixed(1)} MB WebM). Use Download video. YouTube / VLC open WebM.`,
    "ok"
  );
  setTimeout(() => setProgress(null), 1200);
  if (!opts.short && !opts.batch && $("autoShortsAfter")?.checked && songDur > 120) {
    await renderAutoShorts();
  }
  return { blob, name, mime: outMime };
}

export function initVideoMaker() {
  bindMultiDrop($("photoDrop"), $("photoFile"), (files) => addPhotos(files));
  bindMultiDrop($("loopDrop"), $("loopFile"), (files) => setLoopVideo(files[0]));
  bindMultiDrop($("wmDrop"), $("wmFile"), (files) => setWatermarkFromFile(files[0], $("wmSave").checked));
  if ($("endDrop") && $("endFile")) {
    bindMultiDrop($("endDrop"), $("endFile"), (files) => {
      setEndLogoFromFile(files[0]).then(() => setStatus("End-card logo loaded. Save it to the library to reuse on other videos.", "ok"));
    });
  }

  if ($("applyLook")) {
    $("applyLook").addEventListener("click", () => applyLookPreset($("lookPreset")?.value));
  }
  if ($("saveLook")) $("saveLook").addEventListener("click", () => saveBrandKit().catch((e) => setStatus(String(e.message || e), "error")));
  if ($("loadLook")) $("loadLook").addEventListener("click", () => loadBrandKit().catch((e) => setStatus(String(e.message || e), "error")));
  if ($("lyrics")) $("lyrics").addEventListener("input", paintSongCheck);
  const paintYtQueue = () => {
    try {
      describeYtQueue(releaseMedia());
    } catch (_) {}
  };
  loadExtraModules()
    .then(() => {
      initGrokImagine({
        addPhotos,
        replacePhotoAt,
        photoNames,
        evenOut: evenOutPhotoTimes,
        writeSongPhotos,
      });
      initYoutube();
      paintYtQueue();
    })
    .catch((err) => console.error(err));
  ["ytUpWide", "ytUpTall", "ytUpShorts", "ytUpMain"].forEach((id) => {
    if ($(id)) $(id).addEventListener("change", paintYtQueue);
  });
  paintYtQueue();
  if ($("ytPost")) $("ytPost").addEventListener("click", () => postReleaseToYoutube());
  if ($("releaseDesk")) $("releaseDesk").addEventListener("click", () => buildReleaseDesk().catch((e) => setStatus(String(e.message || e), "error")));
  if ($("releaseZipOnly")) $("releaseZipOnly").addEventListener("click", () => downloadCopyZip().catch((e) => setStatus(String(e.message || e), "error")));
  if ($("releasePickFolder")) $("releasePickFolder").addEventListener("click", () => pickReleaseRoot());
  if ($("ytDescLoad")) $("ytDescLoad").addEventListener("click", () => applyCopyLib(DESC_LIB_KEY, "ytDescLib", "ytDescription"));
  if ($("ytTagLoad")) $("ytTagLoad").addEventListener("click", () => applyCopyLib(TAG_LIB_KEY, "ytTagLib", "ytHashtags"));
  if ($("ytDescSave")) {
    $("ytDescSave").addEventListener("click", () => {
      const name = window.prompt("Name this description", introMeta().title || "Description");
      if (name) saveCopyLib(DESC_LIB_KEY, name, $("ytDescription")?.value);
    });
  }
  if ($("ytTagSave")) {
    $("ytTagSave").addEventListener("click", () => {
      const name = window.prompt("Name this hashtag set", "Walk On Records tags");
      if (name) saveCopyLib(TAG_LIB_KEY, name, $("ytHashtags")?.value);
    });
  }
  if ($("ytDescUpload") && $("ytDescFile")) {
    $("ytDescUpload").addEventListener("click", () => $("ytDescFile").click());
    $("ytDescFile").addEventListener("change", async () => {
      const f = $("ytDescFile").files?.[0];
      if (!f) return;
      $("ytDescription").value = await f.text();
      $("ytDescFile").value = "";
      setStatus("Description loaded from file.", "ok");
    });
  }
  if ($("ytTagUpload") && $("ytTagFile")) {
    $("ytTagUpload").addEventListener("click", () => $("ytTagFile").click());
    $("ytTagFile").addEventListener("change", async () => {
      const f = $("ytTagFile").files?.[0];
      if (!f) return;
      $("ytHashtags").value = await f.text();
      $("ytTagFile").value = "";
      setStatus("Hashtags loaded from file.", "ok");
    });
  }
  if ($("ytDescCopy")) $("ytDescCopy").addEventListener("click", () => navigator.clipboard.writeText($("ytDescription")?.value || "").then(() => setStatus("Description copied.", "ok")));
  if ($("ytTagCopy")) $("ytTagCopy").addEventListener("click", () => navigator.clipboard.writeText($("ytHashtags")?.value || "").then(() => setStatus("Hashtags copied.", "ok")));
  if ($("ytDescFill")) $("ytDescFill").addEventListener("click", () => { fillReleaseFields(true); setStatus("Filled title, description, chapters from this song.", "ok"); });
  if ($("ytTagFill")) $("ytTagFill").addEventListener("click", () => { const g = defaultReleaseParts(); $("ytHashtags").value = g.hashtags; setStatus("Filled default hashtags.", "ok"); });
  refreshCopyLibs().catch(() => {});
  fillReleaseFields(false);
  if ($("vizMic")) $("vizMic").addEventListener("click", () => startMicPreview());
  if ($("vizMicOff")) $("vizMicOff").addEventListener("click", () => stopMicPreview());
  if ($("vizFull")) {
    $("vizFull").addEventListener("click", () => {
      const wrap = $("videoPreviewWrap");
      if (!wrap) return;
      const fn = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
      if (fn) fn.call(wrap);
    });
  }
  ["vizMode", "vizPlace", "vizTheme", "vizSens"].forEach((id) => {
    if ($(id)) $(id).addEventListener("change", () => videoReady());
  });
  if ($("evenPhotos")) $("evenPhotos").addEventListener("click", evenOutPhotoTimes);
  if ($("photoEven")) {
    $("photoEven").addEventListener("change", () => paintPreview($("player")?.currentTime || 0));
  }
  $("clearPhotos").addEventListener("click", () => {
    clearPhotos();
    $("photoName").textContent = "";
    videoReady();
    paintPreview(0);
  });
  $("clearLoop").addEventListener("click", () => {
    clearLoopVideo();
    videoReady();
    paintPreview(0);
  });
  $("saveWmNow").addEventListener("click", async () => {
    const f = $("wmFile").files?.[0];
    if (!f && !videoState.watermark) return setStatus("Load a logo first.", "error");
    if (f) await setWatermarkFromFile(f, true);
    else if (videoState.watermarkName) setStatus("That logo is already in use. Re-drop it with Save checked to store it.", "ok");
  });
  $("useSavedWm").addEventListener("click", async () => {
    const ok = await loadSavedWatermark();
    if (!ok) setStatus("No saved logo in this browser yet.", "error");
    else setStatus("Loaded the logo saved in this app.", "ok");
  });
  if ($("clearEnd")) {
    $("clearEnd").addEventListener("click", () => {
      clearEndLogo();
      setStatus("End-card logo removed.");
    });
  }
  if ($("saveEndLib")) {
    $("saveEndLib").addEventListener("click", () =>
      saveFileToLibrary(videoState.endLogoFile || $("endFile")?.files?.[0], videoState.endLogoName || "Like and subscribe")
    );
  }
  if ($("saveWmLib")) {
    $("saveWmLib").addEventListener("click", () =>
      saveFileToLibrary(videoState.watermarkFile || $("wmFile")?.files?.[0], videoState.watermarkName || "Watermark")
    );
  }
  if ($("libAsWm")) {
    $("libAsWm").addEventListener("click", async () => {
      const id = $("logoLibrary")?.value;
      if (!id) return setStatus("Pick a logo from the library first.", "error");
      const rec = await getLogo(id);
      const file = fileFromLogoRecord(rec);
      if (!file) return setStatus("Could not open that logo.", "error");
      await setWatermarkFromFile(file, false);
      setStatus(`Watermark set to “${rec.name}”.`, "ok");
    });
  }
  if ($("libAsEnd")) {
    $("libAsEnd").addEventListener("click", async () => {
      const id = $("logoLibrary")?.value;
      if (!id) return setStatus("Pick a logo from the library first.", "error");
      const rec = await getLogo(id);
      const file = fileFromLogoRecord(rec);
      if (!file) return setStatus("Could not open that logo.", "error");
      await setEndLogoFromFile(file);
      setStatus(`End card set to “${rec.name}”.`, "ok");
    });
  }
  if ($("libDelete")) {
    $("libDelete").addEventListener("click", async () => {
      const id = $("logoLibrary")?.value;
      if (!id) return setStatus("Pick a logo from the library first.", "error");
      const rec = await getLogo(id);
      if (!window.confirm(`Remove “${rec?.name || "logo"}” from the library?`)) return;
      await deleteLogo(id);
      await refreshLogoLibrary();
      setStatus("Logo removed from the library.");
    });
  }
  $("clearWm").addEventListener("click", async () => {
    if (videoState.watermarkUrl) URL.revokeObjectURL(videoState.watermarkUrl);
    videoState.watermark = null;
    videoState.watermarkUrl = null;
    videoState.watermarkName = "";
    $("wmName").textContent = "";
    $("wmFile").value = "";
    await idbDel(WM_KEY);
    paintPreview($("player").currentTime || 0);
    setStatus("Watermark removed (including the saved copy).");
  });

  ["aspect", "quality", "photoHold", "photoFade", "photoTrans", "photoMotion", "photoMotionAmt", "photoEven", "vizMode", "vizPlace", "vizTheme", "vizSens", "karaokeStyle", "safeZone", "textLook", "lyricPreset", "lyricTop", "lyricHeight", "lyricWidth", "lyricAlign", "lyricShade", "lyricFont", "songTitle", "songArtist", "songAlbum", "titleFont", "titleSize", "introSec", "introDim", "endSec", "endText", "endPos", "endSize", "endX", "endY", "endTextPos", "endDim", "titleFloat", "shortStart", "shortEnd", "wmSize", "wmOpacity", "wmPos", "ytTitle", "ytDescription", "ytChapters", "ytHashtags", "releaseFolder"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const refresh = () => {
      if (id === "lyricPreset") applyLyricPreset();
      if (id === "lyricFont") ensureLyricFont().then(() => paintPreview($("player").currentTime || 0));
      if (id === "lyricTop" || id === "lyricHeight") {
        if ($("lyricPreset")) $("lyricPreset").value = "custom";
        if ($("lyricTop")) $("lyricTop").disabled = false;
        if ($("lyricHeight")) $("lyricHeight").disabled = false;
      }
      sizePreviewCanvas();
      paintPreview($("player").currentTime || 0);
    };
    el.addEventListener("input", refresh);
    el.addEventListener("change", refresh);
  });

  $("previewVideo").addEventListener("click", async () => {
    sizePreviewCanvas();
    const player = $("player");
    await ensureLoopPlaying();
    if (player.src && player.paused) {
      try {
        await player.play();
      } catch (_) {}
    }
    paintPreview(player.currentTime || 0);
    setStatus("Preview follows the song. Drag the slider under the preview to jump to the title card, lyrics, or end card.", "ok");
  });
  const review = $("reviewSeek");
  if (review) {
    review.addEventListener("pointerdown", () => {
      videoState.scrubbing = true;
    });
    review.addEventListener("input", () => {
      videoState.scrubbing = true;
      const dur = mediaDuration();
      const t = dur ? (Number(review.value) / 1000) * dur : 0;
      const label = $("reviewTime");
      if (label) label.textContent = `${fmtReview(t)} / ${fmtReview(dur)}`;
      paintPreview(t);
    });
    const commit = () => {
      const dur = mediaDuration();
      const t = dur ? (Number(review.value) / 1000) * dur : 0;
      videoState.scrubbing = false;
      seekReview(t);
    };
    review.addEventListener("change", commit);
    review.addEventListener("pointerup", commit);
  }
  if ($("reviewIntro")) {
    $("reviewIntro").addEventListener("click", () => {
      seekReview(0);
      setStatus("Showing the start / title card.", "ok");
    });
  }
  if ($("reviewEnd")) {
    $("reviewEnd").addEventListener("click", () => {
      const dur = mediaDuration();
      const end = endMeta();
      const t = dur ? Math.max(0, dur - Math.max(0.2, end.seconds || 5)) : 0;
      seekReview(t);
      setStatus("Showing the end card.", "ok");
    });
  }
  const syncPlayBtn = () => {
    const btn = $("reviewPlay");
    if (btn) btn.textContent = $("player").paused ? "Play" : "Pause";
  };
  if ($("reviewPlay")) {
    $("reviewPlay").addEventListener("click", async () => {
      const player = $("player");
      if (!player.src) return setStatus("Load audio first.", "error");
      if (player.paused) {
        try {
          await player.play();
        } catch (_) {
          setStatus("Tap Play again after Chrome allows sound.", "error");
        }
      } else player.pause();
      syncPlayBtn();
    });
  }
  if ($("markShortStart")) {
    $("markShortStart").addEventListener("click", () => {
      const t = $("player").currentTime || 0;
      $("shortStart").value = formatTimeField(t);
      updateShortHint();
      setStatus(`Short start ${formatTimeField(t)}.`, "ok");
    });
  }
  if ($("markShortEnd")) {
    $("markShortEnd").addEventListener("click", () => {
      const t = $("player").currentTime || 0;
      $("shortEnd").value = formatTimeField(t);
      updateShortHint();
      setStatus(`Short end ${formatTimeField(t)}.`, "ok");
    });
  }
  if ($("previewShort")) {
    $("previewShort").addEventListener("click", () => {
      const r = shortRange();
      if (!r) return setStatus("Mark short start and end first.", "error");
      seekReview(r.start);
      setStatus(`Jumped to short start ${formatTimeField(r.start)}.`, "ok");
    });
  }
  if ($("renderShort")) {
    $("renderShort").addEventListener("click", () => renderVideo({ short: true }));
  }
  if ($("renderAutoShorts")) {
    $("renderAutoShorts").addEventListener("click", () => renderAutoShorts());
  }
  if ($("shortStart")) $("shortStart").addEventListener("input", updateShortHint);
  if ($("shortEnd")) $("shortEnd").addEventListener("input", updateShortHint);
  $("player").addEventListener("play", syncPlayBtn);
  $("player").addEventListener("pause", syncPlayBtn);
  $("renderVideo").addEventListener("click", () => renderVideo());
  $("dockRender").addEventListener("click", () => renderVideo());
  const cancel = () => {
    videoState.cancel = true;
  };
  $("cancelRender").addEventListener("click", cancel);
  if ($("dockCancelRender")) $("dockCancelRender").addEventListener("click", cancel);
  if ($("downloadVideo")) $("downloadVideo").addEventListener("click", downloadRender);
  if ($("dockDownloadVideo")) $("dockDownloadVideo").addEventListener("click", downloadRender);

  const player = $("player");
  player.addEventListener("timeupdate", syncPreviewFromPlayer);
  player.addEventListener("seeked", syncPreviewFromPlayer);
  player.addEventListener("play", () => {
    ensurePreviewAnalyser();
    ensureLoopPlaying(player.currentTime || 0);
    const loop = () => {
      if (player.paused) return;
      paintPreview(player.currentTime || 0);
      videoState.previewRaf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(videoState.previewRaf);
    videoState.previewRaf = requestAnimationFrame(loop);
  });
  player.addEventListener("pause", () => {
    cancelAnimationFrame(videoState.previewRaf);
    pauseLoopVideo();
  });
  player.addEventListener("seeked", () => syncLoopVideo(player.currentTime || 0, true));

  window.addEventListener("resize", () => {
    sizePreviewCanvas();
    paintPreview(player.currentTime || 0);
  });

  loadSavedWatermark().then(() => {
    sizePreviewCanvas();
    paintPreview(0);
  });
  applyLyricPreset();
  refreshLogoLibrary().catch(() => {});
  ensureLyricFont().then(() => paintPreview(0));
  sizePreviewCanvas();
  paintPreview(0);
  videoReady();
}
