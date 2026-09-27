import { initVideoMaker, videoReady, paintPreview, videoSnapshot, applyVideoSnapshot, clearRenderResult } from "./video.js";
import { listProjects, getProject, putProject, deleteProject, newProjectId } from "./projects.js";

export const $ = (id) => document.getElementById(id);

export const state = {
  fileName: "subtitles",
  audioUrl: null,
  audioBuffer: null,
  peaks: [],
  duration: 0,
  lines: [],
  cues: [],
  active: 0,
  tapArmed: false,
  tapPhase: "start",
  whisper: null,
  capcut: [],
  capcutName: "",
  capcutRaw: "",
  audioBlob: null,
  projectId: null,
  projectSavedName: "",
  dirty: false,
};

const audioFile = $("audioFile");
const textFile = $("textFile");
const player = $("player");
const lyricsEl = $("lyrics");
const statusEl = $("status");
const progressEl = $("progress");
const progressBar = progressEl.querySelector("span");

export function setStatus(msg, kind = "") {
  statusEl.className = "status" + (kind ? " " + kind : "");
  statusEl.textContent = msg;
}

export function setProgress(p) {
  progressEl.style.display = p == null ? "none" : "block";
  const pct = p == null ? 0 : Math.max(0, Math.min(100, p * 100));
  progressBar.style.width = `${pct}%`;
  const label = $("progressPct");
  if (label) {
    label.hidden = p == null;
    label.textContent = p == null ? "" : `${Math.round(pct)}%`;
  }
  const videoLabel = $("renderPctReadout");
  if (videoLabel) {
    videoLabel.hidden = p == null;
    videoLabel.textContent = p == null ? "" : `${Math.round(pct)}% rendered`;
  }
}

function fmtClock(sec, srt = false) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  if (srt) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  }
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const cc = String(Math.floor(ms / 10)).padStart(2, "0");
  return `${mm}:${ss}.${cc}`;
}

function parseClock(value) {
  const t = String(value).trim().replace(",", ".");
  const parts = t.split(":");
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return Number(t);
}

function parseSrtTime(h, m, s, ms) {
  const milli = String(ms).padEnd(3, "0").slice(0, 3);
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(milli) / 1000;
}

function parseSrt(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "").replace(/\r/g, "");
  const blocks = text.split(/\n\s*\n/);
  const timeRe =
    /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const tLine = lines.find((l) => timeRe.test(l));
    if (!tLine) continue;
    const m = tLine.match(timeRe);
    const start = parseSrtTime(m[1], m[2], m[3], m[4]);
    const end = parseSrtTime(m[5], m[6], m[7], m[8]);
    if (!(end > start)) continue;
    const idx = lines.indexOf(tLine);
    const body = lines
      .slice(idx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    cues.push({ start, end, text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

function lineWeight(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  return Math.max(3, compact.length);
}

const ALIASES = {
  gonna: "going", wanna: "want", gotta: "got",
  cause: "because", cos: "because", cuz: "because",
  runnin: "running", whisperin: "whispering", tryin: "trying",
  beggin: "begging", standin: "standing", talkin: "talking",
};

function normWord(tok) {
  let t = String(tok || "").toLowerCase().replace(/[’`]/g, "'");
  t = t.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "").replace(/[^a-z0-9']+/g, "");
  return ALIASES[t] || t;
}

function tokenizeWords(text) {
  const parts = String(text || "").replace(/[’]/g, "'").match(/[A-Za-z0-9']+|\[.*?\]/g) || [];
  return parts.map((raw) => ({ raw, norm: normWord(raw) })).filter((w) => w.norm && !/^\[/.test(w.raw));
}

function wordScore(a, b) {
  if (a === b) return 0;
  if (a && b && (a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 3) return 0.2;
  if (a && b && a[0] === b[0] && Math.abs(a.length - b.length) <= 2) return 0.55;
  const pairs = new Set(["who|you", "you|who", "its|his", "his|its", "head|hand", "hand|head"]);
  if (pairs.has(`${a}|${b}`)) return 0.35;
  return 1.15;
}

function alignLyricsToCapcutWords(lines, srtCues) {
  const cwords = [];
  srtCues.forEach((cue) => {
    const toks = tokenizeWords(cue.text);
    if (!toks.length) return;
    const dur = cue.end - cue.start;
    toks.forEach((tok, i) => {
      cwords.push({
        ...tok,
        start: cue.start + (dur * i) / toks.length,
        end: cue.start + (dur * (i + 1)) / toks.length,
      });
    });
  });
  const lwords = [];
  lines.forEach((line, li) => {
    tokenizeWords(line).forEach((tok) => lwords.push({ ...tok, line: li }));
  });
  if (!cwords.length || !lwords.length) return null;

  const n = lwords.length;
  const m = cwords.length;
  const INF = 1e9;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const bt = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
  dp[0][0] = 0;
  for (let j = 1; j <= m; j++) dp[0][j] = j * 0.25;
  for (let i = 1; i <= n; i++) dp[i][0] = i * 1.2;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = dp[i - 1][j - 1] + wordScore(lwords[i - 1].norm, cwords[j - 1].norm);
      const skipC = dp[i][j - 1] + 0.28;
      const skipL = dp[i - 1][j] + 1.05;
      let best = match;
      let which = 0;
      if (skipC < best) {
        best = skipC;
        which = 1;
      }
      if (skipL < best) {
        best = skipL;
        which = 2;
      }
      dp[i][j] = best;
      bt[i][j] = which;
    }
  }
  const map = Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const w = bt[i][j];
    if (w === 0) {
      map[i - 1] = j - 1;
      i--;
      j--;
    } else if (w === 1) j--;
    else i--;
  }
  const matched = map.filter((x) => x >= 0).length;
  if (matched / n < 0.45) return null;

  const cues = lines.map((text) => ({ text, start: null, end: null, from: "capcut-words" }));
  lwords.forEach((lw, idx) => {
    const aj = map[idx];
    if (aj < 0) return;
    const w = cwords[aj];
    const cue = cues[lw.line];
    if (cue.start == null || w.start < cue.start) cue.start = w.start;
    if (cue.end == null || w.end > cue.end) cue.end = w.end;
  });
  let last = srtCues[0]?.start ?? 0;
  cues.forEach((cue, idx) => {
    if (isHeader(cue.text) && (cue.start == null || cue.end - cue.start < 0.4)) {
      const next = cues.slice(idx + 1).find((x) => x.start != null);
      cue.start = last;
      cue.end = next ? Math.max(cue.start, Math.min(next.start - 0.04, cue.start + 0.6)) : last + 0.4;
    } else if (cue.start == null) {
      const next = cues.slice(idx + 1).find((x) => x.start != null);
      cue.start = last;
      cue.end = next ? Math.max(cue.start + 0.2, next.start - 0.04) : last + 1;
    }
    if (cue.end == null) cue.end = cue.start + 0.6;
    if (cue.start < last) cue.start = last;
    if (cue.end <= cue.start) cue.end = cue.start + 0.2;
    last = cue.end + 0.02;
  });
  return cues;
}

function reflowLyricsOntoSrt(lines, srtCues) {
  const lyrics = lines.filter((l) => l && l.trim());
  if (!lyrics.length || !srtCues.length) return [];

  const n = srtCues.length;
  const m = lyrics.length;
  const ratio = Math.min(n, m) / Math.max(n, m);

  // Close cue counts: keep SRT windows, group or split in order.
  if (ratio >= 0.55) {
    if (m === n) {
      return lyrics.map((text, i) => ({
        text,
        start: srtCues[i].start,
        end: srtCues[i].end,
        from: "capcut-1to1",
      }));
    }
    if (m < n) {
      const base = Math.floor(n / m);
      let extra = n % m;
      let i = 0;
      return lyrics.map((text) => {
        const take = Math.max(1, base + (extra > 0 ? 1 : 0));
        if (extra > 0) extra -= 1;
        const group = srtCues.slice(i, Math.min(n, i + take));
        i += take;
        return {
          text,
          start: group[0].start,
          end: group[group.length - 1].end,
          from: "capcut-merge",
        };
      });
    }
    // More lyric lines than SRT cues: split each window by character weight.
    const out = [];
    let li = 0;
    for (let ci = 0; ci < n; ci++) {
      const remainingCues = n - ci;
      const remainingLines = m - li;
      const take = Math.max(1, Math.round(remainingLines / remainingCues));
      const group = lyrics.slice(li, Math.min(m, li + take));
      li += group.length;
      const cue = srtCues[ci];
      const weights = group.map(lineWeight);
      const sumW = weights.reduce((a, b) => a + b, 0) || 1;
      const span = Math.max(0.12, cue.end - cue.start);
      let t = cue.start;
      group.forEach((text, gi) => {
        const dur = (weights[gi] / sumW) * span;
        const start = t;
        const end = gi === group.length - 1 ? cue.end : Math.min(cue.end, t + dur);
        out.push({ text, start, end, from: "capcut-split" });
        t = end;
      });
    }
    while (li < m) {
      const last = out[out.length - 1];
      const start = last ? last.end : srtCues[n - 1].end;
      out.push({
        text: lyrics[li],
        start,
        end: start + 0.4,
        from: "capcut-split",
      });
      li += 1;
    }
    return out;
  }

  // Counts differ a lot: walk SRT speech time and place lines by length.
  const weights = lyrics.map(lineWeight);
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const total = srtCues.reduce((s, c) => s + Math.max(0.05, c.end - c.start), 0);
  const out = [];
  let ci = 0;
  let usedInCue = 0;
  const pos = () => {
    const cue = srtCues[Math.min(ci, n - 1)];
    return cue.start + usedInCue;
  };
  const consume = (need) => {
    let left = need;
    const start = pos();
    while (left > 0.0001 && ci < n) {
      const cue = srtCues[ci];
      const avail = Math.max(0, cue.end - cue.start - usedInCue);
      const take = Math.min(avail, left);
      usedInCue += take;
      left -= take;
      if (usedInCue >= cue.end - cue.start - 0.001) {
        ci += 1;
        usedInCue = 0;
      }
    }
    return { start, end: Math.max(start + 0.12, pos()) };
  };
  lyrics.forEach((text, i) => {
    const need = Math.max(0.18, (weights[i] / sumW) * total);
    const { start, end } = consume(need);
    out.push({ text, start, end, from: "capcut-reflow" });
  });
  return out;
}

function snapToCapcutOnsets(cues, srtCues) {
  if (!srtCues.length) return cues;
  const starts = srtCues.map((c) => c.start);
  return cues.map((cue, i) => {
    let best = cue.start;
    let bestDist = 0.28;
    for (const s of starts) {
      const d = Math.abs(s - cue.start);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    const nextStart = i + 1 < cues.length ? cues[i + 1].start : cue.end;
    const start = Math.min(best, Math.max(0, nextStart - 0.12));
    return { ...cue, start, end: Math.max(start + 0.12, cue.end) };
  });
}

function applyCapcutTimes() {
  state.lines = parseLyrics(lyricsEl.value);
  if (!state.lines.length) return setStatus("Add the correct lyrics first.", "error");
  if (!state.capcut.length) return setStatus("Drop an SRT first.", "error");
  let mapped = alignLyricsToCapcutWords(state.lines, state.capcut);
  if (!mapped || !mapped.length) mapped = reflowLyricsOntoSrt(state.lines, state.capcut);
  mapped = snapToCapcutOnsets(mapped, state.capcut);
  state.cues = mapped.map((c) => ({ text: c.text, start: c.start, end: c.end }));
  snapCues();
  state.active = 0;
  renderCues();
  renderCurrent();
  const method = mapped[0]?.from || "capcut";
  setStatus(
    `Used ${state.capcut.length} SRT cues → ${state.cues.length} lyric lines (${method}). Words are yours; clocks are from the SRT.`,
    "ok"
  );
}

function isBracketTag(line) {
  const raw = String(line || "").trim();
  return /^\[.*\]$/.test(raw) || /^【.*】$/.test(raw) || /^\{.*\}$/.test(raw);
}

function isHeader(line) {
  const raw = String(line || "").trim();
  if (!raw) return false;
  if (isBracketTag(raw)) return true;
  const stripped = raw
    .replace(/^[\s\[\(\{<]+/, "")
    .replace(/[\s\]\)\}>:.\-–—]+$/, "")
    .trim();
  return /^(pre[-\s]?)?(verse|chorus|hook|bridge|intro|outro|refrain|interlude|tag|breakdown|spoken|instrumental|ending|drop|post[-\s]?chorus)(\s*[-:]?\s*(\d+|[ivx]+|one|two|three|a|b))?(\s*[\-(]?\s*(repeat|x\d+|\d+x))?$/i.test(
    stripped
  );
}

function parseLyrics(raw) {
  const keepHeaders = $("keepHeaders").checked;
  const splitLong = $("splitLong").checked;
  const out = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isBracketTag(line)) continue;
    if (isHeader(line) && !keepHeaders) continue;
    if (splitLong && line.length > 84 && /\s/.test(line)) {
      const words = line.split(/\s+/);
      let buf = "";
      for (const w of words) {
        if ((buf + " " + w).trim().length > 42 && buf) {
          out.push(buf.trim());
          buf = w;
        } else buf = (buf + " " + w).trim();
      }
      if (buf) out.push(buf);
    } else out.push(line);
  }
  return out;
}

function rebuildCuesKeepTimes() {
  const prev = state.cues;
  state.lines = parseLyrics(lyricsEl.value);
  state.cues = state.lines.map((text, i) => ({
    text,
    start: prev[i]?.start ?? null,
    end: prev[i]?.end ?? null,
  }));
  if (state.active >= state.cues.length) state.active = Math.max(0, state.cues.length - 1);
  renderCues();
  renderCurrent();
}

function renderCurrent() {
  const n = state.cues.length;
  $("lineMeta").textContent = n ? `Line ${state.active + 1} / ${n}` : "Line 0 / 0";
  $("lineText").textContent = n ? state.cues[state.active].text : "Load lyrics to begin.";
  const ready = n > 0 && state.duration > 0;
  $("markStart").disabled = !ready;
  $("markEnd").disabled = !ready;
  document.querySelectorAll(".cue").forEach((el, i) => el.classList.toggle("active", i === state.active));
}

function renderCues() {
  const root = $("cues");
  root.innerHTML = "";
  state.cues.forEach((cue, i) => {
    const el = document.createElement("div");
    el.className = "cue" + (i === state.active ? " active" : "");
    el.innerHTML = `
      <div class="idx">${i + 1}</div>
      <textarea data-i="${i}">${escapeHtml(cue.text)}</textarea>
      <div class="times">
        <input data-k="start" data-i="${i}" value="${cue.start == null ? "" : fmtClock(cue.start)}" placeholder="start" />
        <input data-k="end" data-i="${i}" value="${cue.end == null ? "" : fmtClock(cue.end)}" placeholder="end" />
      </div>`;
    el.querySelector("textarea").addEventListener("input", (e) => {
      state.cues[i].text = e.target.value;
      state.lines[i] = e.target.value;
      if (i === state.active) renderCurrent();
    });
    el.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => {
        const v = parseClock(inp.value);
        state.cues[i][inp.dataset.k] = Number.isFinite(v) ? v : null;
        enableExport();
      });
    });
    el.addEventListener("click", (e) => {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
      state.active = i;
      if (state.cues[i].start != null) seekTo(state.cues[i].start);
      renderCurrent();
    });
    root.appendChild(el);
  });
  enableExport();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function enableExport() {
  const ok = state.cues.some((c) => c.start != null && c.end != null && c.end > c.start);
  $("downloadSrt").disabled = !ok;
  $("downloadLrc").disabled = !ok;
  $("copySrt").disabled = !ok;
  window.dispatchEvent(new Event("wavesrt-ready"));
}

function wireDropInput(box, input) {
  if (!box || !input) return;
  input.removeAttribute("hidden");
  input.hidden = false;
  input.classList.add("drop-input");
  if (input.parentElement !== box) box.insertBefore(input, box.firstChild);
  box.classList.add("has-file-input");
}

function bindDrop(el, input, onFile) {
  if (!el || !input) return;
  wireDropInput(el, input);
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("over");
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  });
  input.addEventListener("change", () => {
    const f = input.files[0];
    if (f) onFile(f);
  });
}

async function loadAudio(file) {
  state.fileName = file.name.replace(/\.[^.]+$/, "") || "subtitles";
  state.audioBlob = file;
  markDirty();
  $("audioName").textContent = file.name;
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = URL.createObjectURL(file);
  player.src = state.audioUrl;
  setStatus("Decoding audio…");
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext();
  state.audioBuffer = await ctx.decodeAudioData(buf.slice(0));
  state.duration = state.audioBuffer.duration;
  state.peaks = computePeaks(state.audioBuffer, 1200);
  drawWave();
  setStatus(`Audio loaded · ${fmtClock(state.duration)}`, "ok");
}

function computePeaks(buffer, bars) {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const block = Math.max(1, Math.floor(ch0.length / bars));
  const peaks = [];
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    const start = i * block;
    const end = Math.min(ch0.length, start + block);
    for (let j = start; j < end; j += 4) {
      peak = Math.max(peak, Math.abs(ch0[j]), Math.abs(ch1[j]));
    }
    peaks.push(peak);
  }
  return peaks;
}

function drawWave() {
  const canvas = $("wave");
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const mid = canvas.height / 2;
  const peaks = state.peaks;
  if (!peaks.length) return;
  const w = canvas.width / peaks.length;
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(1, peaks[i] * (canvas.height * 0.88));
    const x = i * w;
    ctx.fillStyle = i % 2 ? "#2ee6a6" : "#7c5cff";
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x, mid - h / 2, Math.max(1, w * 0.7), h);
  }
  ctx.globalAlpha = 1;
}

function seekTo(t) {
  player.currentTime = Math.max(0, Math.min(state.duration || player.duration || 0, t));
}

function updatePlayhead() {
  const dur = state.duration || player.duration || 0;
  const t = player.currentTime || 0;
  $("timeLabel").textContent = `${fmtClock(t)} / ${fmtClock(dur)}`;
  $("seek").value = dur ? String(Math.round((t / dur) * 1000)) : "0";
  $("playhead").style.left = dur ? `${(t / dur) * 100}%` : "0";
  $("playBtn").textContent = player.paused ? "Play" : "Pause";
}

function rmsEnvelope(buffer, hopSec = 0.02) {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const hop = Math.max(1, Math.floor(sr * hopSec));
  const env = [];
  for (let i = 0; i < data.length; i += hop) {
    let s = 0;
    const end = Math.min(data.length, i + hop);
    for (let j = i; j < end; j++) s += data[j] * data[j];
    env.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  return { env, hopSec };
}

function voicedSpans(buffer) {
  const { env, hopSec } = rmsEnvelope(buffer);
  const sorted = [...env].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.35)] || 0.01;
  const thr = Math.max(0.012, noise * 2.2);
  const spans = [];
  let start = null;
  env.forEach((v, i) => {
    const on = v >= thr;
    if (on && start == null) start = i;
    if (!on && start != null) {
      const a = start * hopSec;
      const b = i * hopSec;
      if (b - a >= 0.18) spans.push([a, b]);
      start = null;
    }
  });
  if (start != null) spans.push([start * hopSec, env.length * hopSec]);
  if (!spans.length) return [[0.15, Math.max(0.3, buffer.duration - 0.1)]];
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] - last[1] < 0.35) last[1] = sp[1];
    else merged.push(sp.slice());
  }
  return merged;
}

function guessTimings() {
  rebuildCuesKeepTimes();
  if (!state.cues.length) return setStatus("Add lyrics first.", "error");
  if (state.capcut.length) {
    applyCapcutTimes();
    return;
  }
  if (!state.audioBuffer) return setStatus("Load audio first, or drop an SRT.", "error");
  const spans = voicedSpans(state.audioBuffer);
  const totalVoice = spans.reduce((s, [a, b]) => s + (b - a), 0);
  const weights = state.cues.map((c) => Math.max(4, c.text.replace(/\s+/g, "").length));
  const sumW = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  const gap = 0.06;
  state.cues.forEach((cue, i) => {
    const need = Math.max(0.45, (weights[i] / sumW) * totalVoice);
    let placed = 0;
    let start = null;
    let end = null;
    for (const [a, b] of spans) {
      const avail = b - a;
      if (cursor >= b) continue;
      const from = Math.max(a, cursor);
      const take = Math.min(need - placed, b - from);
      if (take <= 0) continue;
      if (start == null) start = from;
      end = from + take;
      placed += take;
      cursor = end + gap;
      if (placed >= need * 0.98) break;
    }
    if (start == null) {
      const t = Math.min(state.duration - 0.4, i * (state.duration / state.cues.length));
      start = t;
      end = Math.min(state.duration, t + need);
    }
    cue.start = Math.max(0, start);
    cue.end = Math.max(cue.start + 0.35, end ?? start + need);
  });
  snapCues();
  state.active = 0;
  renderCues();
  renderCurrent();
  setStatus(`Guessed ${state.cues.length} cues from loudness. Tap-sync any line that drifts.`, "ok");
}

function snapCues() {
  for (let i = 0; i < state.cues.length; i++) {
    const c = state.cues[i];
    if (c.start == null || c.end == null) continue;
    if (i > 0 && state.cues[i - 1].end != null && c.start < state.cues[i - 1].end) {
      const mid = (state.cues[i - 1].end + c.start) / 2;
      state.cues[i - 1].end = Math.max(state.cues[i - 1].start + 0.2, mid - 0.04);
      c.start = state.cues[i - 1].end + 0.06;
    }
    if (c.end <= c.start) c.end = c.start + 0.4;
    if (c.end > state.duration) c.end = state.duration;
  }
}

function normalizeToken(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af']+/g, "");
}

function tokenize(text) {
  return text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => ({ raw: w, norm: normalizeToken(w) }))
    .filter((w) => w.norm);
}

function alignLyricsToWords(lines, words) {
  const lyricTok = [];
  lines.forEach((line, li) => {
    tokenize(line).forEach((tok) => lyricTok.push({ ...tok, line: li }));
  });
  if (!lyricTok.length || !words.length) return null;

  const asr = words.map((w) => ({
    start: w.start,
    end: w.end,
    norm: normalizeToken(w.text || w.word || ""),
  }));

  const n = lyricTok.length;
  const m = asr.length;
  const INF = 1e9;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const bt = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
  dp[0][0] = 0;
  for (let j = 1; j <= m; j++) dp[0][j] = j * 0.4;
  for (let i = 1; i <= n; i++) dp[i][0] = i * 1.15;

  const score = (a, b) => {
    if (!a || !b) return 1.2;
    if (a === b) return 0;
    if (a.length > 2 && b.length > 2 && (a.startsWith(b) || b.startsWith(a))) return 0.25;
    if (a[0] === b[0] && Math.abs(a.length - b.length) <= 1) return 0.55;
    return 1.15;
  };

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = dp[i - 1][j - 1] + score(lyricTok[i - 1].norm, asr[j - 1].norm);
      const skipAsr = dp[i][j - 1] + 0.35;
      const skipLyc = dp[i - 1][j] + 1.1;
      let best = match;
      let which = 0;
      if (skipAsr < best) {
        best = skipAsr;
        which = 1;
      }
      if (skipLyc < best) {
        best = skipLyc;
        which = 2;
      }
      dp[i][j] = best;
      bt[i][j] = which;
    }
  }

  const map = Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const w = bt[i][j];
    if (w === 0) {
      map[i - 1] = j - 1;
      i--;
      j--;
    } else if (w === 1) j--;
    else i--;
  }

  const cues = lines.map((text) => ({ text, start: null, end: null }));
  lyricTok.forEach((tok, idx) => {
    const aj = map[idx];
    if (aj < 0) return;
    const w = asr[aj];
    const cue = cues[tok.line];
    if (cue.start == null || w.start < cue.start) cue.start = w.start;
    if (cue.end == null || w.end > cue.end) cue.end = w.end;
  });

  let lastEnd = 0;
  cues.forEach((c, idx) => {
    if (c.start == null) {
      const next = cues.slice(idx + 1).find((x) => x.start != null);
      c.start = lastEnd;
      c.end = next ? Math.max(c.start + 0.4, next.start - 0.05) : Math.min(state.duration, c.start + 1.2);
    }
    if (c.end == null) c.end = Math.min(state.duration, c.start + 1.2);
    if (c.start < lastEnd) c.start = lastEnd;
    if (c.end <= c.start) c.end = Math.min(state.duration, c.start + 0.45);
    lastEnd = c.end + 0.04;
  });
  return cues;
}

async function downsampleMono16k(buffer) {
  let src = buffer.getChannelData(0);
  if (buffer.numberOfChannels > 1) {
    const b = buffer.getChannelData(1);
    const mix = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) mix[i] = (src[i] + b[i]) * 0.5;
    src = mix;
  }
  let peak = 1e-6;
  for (let i = 0; i < src.length; i += 8) {
    const a = Math.abs(src[i]);
    if (a > peak) peak = a;
  }
  const gain = peak > 0.02 ? Math.min(0.95 / peak, 4) : 1;
  const ratio = buffer.sampleRate / 16000;
  const len = Math.floor(src.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const i0 = Math.floor(i * ratio);
    out[i] = Math.max(-1, Math.min(1, src[i0] * gain));
  }
  return out;
}

async function aiAlign() {
  if (!state.audioBuffer) return setStatus("Load audio first.", "error");
  rebuildCuesKeepTimes();
  if (!state.cues.length) return setStatus("Add lyrics first.", "error");
  const model = $("whisperModel")?.value || "Xenova/whisper-base.en";
  if (/whisper-small/.test(model)) {
    const ok = window.confirm(
      "Best / small will freeze this tab for several minutes while Chrome downloads and runs a large model.\n\nClick Wait if Chrome says the page is unresponsive.\n\nCancel and pick Better · base unless you have a strong PC."
    );
    if (!ok) return;
  }
  $("aiBtn").disabled = true;
  setProgress(0.05);
  setStatus("Loading Whisper… click Wait if Chrome says the page is unresponsive.");
  await new Promise((r) => setTimeout(r, 40));
  try {
    const { pipeline } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1");
    const lang = $("lang").value;
    const model = $("whisperModel")?.value || "Xenova/whisper-base.en";
    if (state.whisperModel !== model) {
      state.whisper = null;
      state.whisperModel = model;
    }
    if (!state.whisper) {
      setStatus(`Loading ${model.split("/").pop()} (first time downloads into this browser)…`);
      state.whisper = await pipeline("automatic-speech-recognition", model, {
        dtype: "q8",
        progress_callback: (info) => {
          if (info.status === "progress" && info.total) {
            setProgress(0.08 + 0.45 * (info.loaded / info.total));
            setStatus(`Downloading model ${(100 * info.loaded / info.total).toFixed(0)}%`);
          }
        },
      });
    }
    setProgress(0.58);
    setStatus("Transcribing for timestamps. Your lyric words are kept.");
    const audio = await downsampleMono16k(state.audioBuffer);
    const options = {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
    };
    if (lang !== "auto" && lang !== "en") options.language = lang;
    let result = await state.whisper(audio, options);
    let chunks = result.chunks || [];
    if (chunks.length < 8) {
      setStatus("Word times were thin. Trying line-level timestamps…");
      result = await state.whisper(audio, { ...options, return_timestamps: true });
      chunks = result.chunks || chunks;
    }
    const words = [];
    chunks.forEach((ch) => {
      const ts = ch.timestamp || [null, null];
      words.push({
        text: ch.text || "",
        start: Number(ts[0] ?? 0),
        end: Number(ts[1] ?? ts[0] ?? 0),
      });
    });
    setProgress(0.9);
    if (!words.length) {
      setStatus("Whisper returned no times. Using energy guess instead.", "error");
      guessTimings();
      return;
    }
    const aligned = alignLyricsToWords(state.lines, words);
    if (!aligned) {
      setStatus("Could not match lyrics to transcription. Using energy guess.", "error");
      guessTimings();
      return;
    }
    state.cues = aligned;
    snapCues();
    state.active = 0;
    renderCues();
    renderCurrent();
    setProgress(1);
    setStatus(`AI aligned ${state.cues.length} lines to your lyrics. Preview and fix any drift.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(`AI align failed (${err.message || err}). Try Guess timings or tap sync.`, "error");
  } finally {
    $("aiBtn").disabled = false;
    setTimeout(() => setProgress(null), 800);
  }
}

function toSrt() {
  const rows = [];
  let n = 1;
  state.cues.forEach((c) => {
    if (c.start == null || c.end == null || !c.text.trim()) return;
    rows.push(`${n}`);
    rows.push(`${fmtClock(c.start, true)} --> ${fmtClock(c.end, true)}`);
    rows.push(c.text.trim());
    rows.push("");
    n += 1;
  });
  return rows.join("\n");
}

function toLrc() {
  return state.cues
    .filter((c) => c.start != null && c.text.trim())
    .map((c) => {
      const m = Math.floor(c.start / 60);
      const s = c.start % 60;
      return `[${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}]${c.text.trim()}`;
    })
    .join("\n");
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function markStart() {
  if (!state.cues.length) return;
  const t = player.currentTime || 0;
  const cue = state.cues[state.active];
  cue.start = t;
  if (state.active > 0) {
    const prev = state.cues[state.active - 1];
    if (prev.end == null || prev.end > t) prev.end = Math.max((prev.start ?? 0) + 0.2, t - 0.05);
  }
  state.tapPhase = "end";
  renderCues();
  renderCurrent();
  buzz(12);
}

function markEnd() {
  if (!state.cues.length) return;
  const t = player.currentTime || 0;
  const cue = state.cues[state.active];
  if (cue.start == null) cue.start = Math.max(0, t - 1);
  cue.end = Math.max(cue.start + 0.2, t);
  if (state.active < state.cues.length - 1) {
    state.active += 1;
    state.tapPhase = "start";
  }
  renderCues();
  renderCurrent();
  buzz(18);
}

function buzz(ms) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (_) {}
}

bindDrop($("audioDrop"), audioFile, loadAudio);
bindDrop($("textDrop"), textFile, async (file) => {
  $("textName").textContent = file.name;
  lyricsEl.value = await file.text();
  rebuildCuesKeepTimes();
  if (state.capcut.length) applyCapcutTimes();
  else setStatus(`Loaded ${state.lines.length} lyric lines.`);
});

bindDrop($("srtDrop"), $("srtFile"), async (file) => {
  const raw = await file.text();
  const cues = parseSrt(raw);
  if (!cues.length) {
    setStatus("Could not read that SRT. Export a .srt and try again.", "error");
    return;
  }
  state.capcut = cues;
  state.capcutName = file.name;
  state.capcutRaw = raw;
  markDirty();
  $("srtName").textContent = `${file.name} · ${cues.length} cues`;
  if (parseLyrics(lyricsEl.value).length) applyCapcutTimes();
  else setStatus(`Loaded ${cues.length} SRT cues. Add lyrics next, then times will attach.`);
});

$("capcutBtn").addEventListener("click", applyCapcutTimes);
$("clearSrt").addEventListener("click", () => {
  state.capcut = [];
  state.capcutName = "";
  $("srtName").textContent = "";
  $("srtFile").value = "";
  setStatus("SRT removed. Guess / Auto time / tap will build times from audio.");
});

function lyricsChanged() {
  if (state.capcut.length && lyricsEl.value.trim()) applyCapcutTimes();
  else rebuildCuesKeepTimes();
}
lyricsEl.addEventListener("change", lyricsChanged);
$("keepHeaders").addEventListener("change", lyricsChanged);
$("splitLong").addEventListener("change", lyricsChanged);

$("playBtn").addEventListener("click", async () => {
  if (!player.src) return;
  if (player.paused) {
    try {
      await player.play();
    } catch (e) {
      setStatus("Could not play. Tap Play again after a user gesture.", "error");
    }
  } else player.pause();
});

$("seek").addEventListener("input", () => {
  const dur = state.duration || player.duration || 0;
  seekTo((Number($("seek").value) / 1000) * dur);
});

$("waveWrap").addEventListener("click", (e) => {
  const dur = state.duration || player.duration || 0;
  if (!dur) return;
  const rect = $("waveWrap").getBoundingClientRect();
  seekTo(((e.clientX - rect.left) / rect.width) * dur);
});

player.addEventListener("timeupdate", updatePlayhead);
player.addEventListener("loadedmetadata", () => {
  if (!state.duration) state.duration = player.duration || 0;
  updatePlayhead();
});
player.addEventListener("play", updatePlayhead);
player.addEventListener("pause", updatePlayhead);

$("guessBtn").addEventListener("click", guessTimings);
$("aiBtn").addEventListener("click", aiAlign);
$("tapBtn").addEventListener("click", async () => {
  rebuildCuesKeepTimes();
  state.tapArmed = true;
  state.tapPhase = "start";
  state.active = state.cues.findIndex((c) => c.start == null);
  if (state.active < 0) state.active = 0;
  renderCurrent();
  if (player.src && player.paused) {
    try {
      await player.play();
    } catch (_) {}
  }
  setStatus("Tap sync on. Mark start when the line begins, mark end when it finishes.", "ok");
});
$("resetTimes").addEventListener("click", () => {
  state.cues.forEach((c) => {
    c.start = null;
    c.end = null;
  });
  state.active = 0;
  renderCues();
  renderCurrent();
  setStatus("Times cleared. Lyric text kept.");
});
$("markStart").addEventListener("click", markStart);
$("markEnd").addEventListener("click", markEnd);

$("downloadSrt").addEventListener("click", () => download(`${state.fileName}.srt`, toSrt()));
$("downloadLrc").addEventListener("click", () => download(`${state.fileName}.lrc`, toLrc()));
$("copySrt").addEventListener("click", async () => {
  await navigator.clipboard.writeText(toSrt());
  setStatus("SRT copied.", "ok");
});

window.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "TEXTAREA" || tag === "INPUT") return;
  if (e.code === "Space") {
    e.preventDefault();
    if (state.tapPhase === "end" && state.cues[state.active]?.start != null) markEnd();
    else markStart();
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    seekTo((player.currentTime || 0) - 2);
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    seekTo((player.currentTime || 0) + 2);
  }
});

window.addEventListener("resize", drawWave);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function markDirty() {
  state.dirty = true;
  updateProjMeta();
}

function updateProjMeta() {
  const el = $("projMeta");
  if (!el) return;
  if (!state.projectId) {
    el.textContent = state.dirty ? "Not saved yet · unsaved changes" : "Not saved yet";
    return;
  }
  const name = state.projectSavedName || currentProjectName();
  el.textContent = state.dirty ? `Saved as “${name}” · unsaved changes` : `Saved as “${name}”`;
}

function currentProjectName() {
  return ($("projectName")?.value || "").trim() || state.fileName || "Untitled project";
}

function buildRecord(id, name) {
  const vid = videoSnapshot();
  return {
    id,
    name,
    created: state.projectCreated || Date.now(),
    updated: Date.now(),
    fileName: state.fileName,
    audioName: state.audioBlob?.name || "",
    audioBlob: state.audioBlob || null,
    lyrics: lyricsEl.value,
    capcutName: state.capcutName,
    capcutRaw: state.capcutRaw,
    cues: state.cues.map((c) => ({ text: c.text, start: c.start, end: c.end })),
    settings: vid.settings,
    photos: vid.photos,
    loop: vid.loop,
    watermark: vid.watermark,
    endLogo: vid.endLogo,
    render: vid.render,
    shorts: vid.shorts,
  };
}

async function saveProject({ asNew } = {}) {
  const name = currentProjectName();
  let id = state.projectId;
  if (asNew || !id) {
    id = newProjectId();
    state.projectCreated = Date.now();
  }
  const rec = buildRecord(id, name);
  if (asNew) rec.created = Date.now();
  await putProject(rec);
  state.projectId = id;
  state.projectSavedName = name;
  state.dirty = false;
  try {
    localStorage.setItem("wavesrt-last-project", id);
  } catch (_) {}
  $("projectName").value = name;
  updateProjMeta();
  setStatus(`Saved project “${name}”.`, "ok");
}

async function duplicateProject() {
  if (!state.projectId) await saveProject();
  const original = state.projectSavedName || currentProjectName();
  $("projectName").value = `${original} copy`;
  await saveProject({ asNew: true });
  setStatus(`Now editing “${currentProjectName()}”. “${original}” is unchanged.`, "ok");
}

async function applyProject(rec) {
  state.projectId = rec.id;
  state.projectCreated = rec.created || Date.now();
  state.projectSavedName = rec.name || "Untitled project";
  state.fileName = rec.fileName || rec.name || "subtitles";
  $("projectName").value = rec.name || "";
  lyricsEl.value = rec.lyrics || "";
  state.capcutName = rec.capcutName || "";
  state.capcutRaw = rec.capcutRaw || "";
  state.capcut = rec.capcutRaw ? parseSrt(rec.capcutRaw) : [];
  $("srtName").textContent = state.capcut.length
    ? `${state.capcutName || "SRT"} · ${state.capcut.length} cues`
    : "";
  if (rec.audioBlob) {
    const file =
      rec.audioBlob instanceof File
        ? rec.audioBlob
        : new File([rec.audioBlob], rec.audioName || "audio.wav");
    await loadAudio(file);
  } else {
    state.audioBlob = null;
    state.audioBuffer = null;
    state.duration = 0;
    state.peaks = [];
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = null;
    player.removeAttribute("src");
    $("audioName").textContent = "";
    drawWave();
  }
  await applyVideoSnapshot({
    settings: rec.settings,
    photos: rec.photos,
    loop: rec.loop,
    watermark: rec.watermark,
    endLogo: rec.endLogo,
    render: rec.render,
    shorts: rec.shorts,
  });
  if (rec.cues?.length) {
    state.cues = rec.cues.map((c) => ({ text: c.text, start: c.start, end: c.end }));
    state.lines = state.cues.map((c) => c.text);
    state.active = 0;
    renderCues();
    renderCurrent();
  } else {
    rebuildCuesKeepTimes();
    if (state.capcut.length && state.lines.length) applyCapcutTimes();
  }
  state.dirty = false;
  try {
    localStorage.setItem("wavesrt-last-project", rec.id);
  } catch (_) {}
  updateProjMeta();
  setStatus(`Opened “${rec.name}”.`, "ok");
}

function confirmLoseWork() {
  if (!state.dirty) return true;
  return window.confirm("This project has unsaved changes. Continue without saving?");
}

async function newProject() {
  if (!confirmLoseWork()) return;
  state.projectId = null;
  state.projectCreated = null;
  state.projectSavedName = "";
  state.fileName = "subtitles";
  state.audioBlob = null;
  state.audioBuffer = null;
  state.duration = 0;
  state.peaks = [];
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = null;
  player.removeAttribute("src");
  $("audioName").textContent = "";
  lyricsEl.value = "";
  state.capcut = [];
  state.capcutName = "";
  state.capcutRaw = "";
  $("srtName").textContent = "";
  $("projectName").value = "";
  state.cues = [];
  state.lines = [];
  state.active = 0;
  renderCues();
  renderCurrent();
  drawWave();
  await applyVideoSnapshot({ settings: null, photos: [], loop: null, watermark: null, render: null });
  clearRenderResult();
  state.dirty = false;
  updateProjMeta();
  setStatus("New empty project.");
}

async function openProjectById(id) {
  const rec = await getProject(id);
  if (!rec) return setStatus("That project is missing.", "error");
  await applyProject(rec);
}

async function refreshProjectList() {
  const root = $("projList");
  const rows = await listProjects();
  if (!rows.length) {
    root.innerHTML = `<p class="hint">No saved projects yet. Load files and press Save.</p>`;
    return;
  }
  root.innerHTML = rows
    .map((p) => {
      const when = p.updated ? new Date(p.updated).toLocaleString() : "";
      const extra = [p.audioName, p.hasRender ? "video ready" : ""]
        .filter(Boolean)
        .join(" · ");
      return `<div class="proj-row" data-id="${p.id}">
        <div><strong>${escapeHtml(p.name || "Untitled")}</strong><span>${escapeHtml(when)}${extra ? " · " + escapeHtml(extra) : ""}</span></div>
        <button type="button" data-open="${p.id}">Open</button>
        <button type="button" class="secondary" data-export="${p.id}">Export</button>
        <button type="button" class="ghost" data-del="${p.id}">Delete</button>
      </div>`;
    })
    .join("");
  root.querySelectorAll("button[data-open]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirmLoseWork()) return;
      await openProjectById(btn.dataset.open);
      $("projDialog").close();
    });
  });
  root.querySelectorAll("button[data-export]").forEach((btn) => {
    btn.addEventListener("click", () => exportProjectById(btn.dataset.export).catch((e) => setStatus(String(e.message || e), "error")));
  });
  root.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.del;
      const row = rows.find((r) => r.id === id);
      if (!window.confirm(`Delete saved project “${row?.name || id}”?`)) return;
      await deleteProject(id);
      if (state.projectId === id) {
        state.projectId = null;
        state.projectSavedName = "";
        markDirty();
      }
      if (localStorage.getItem("wavesrt-last-project") === id) localStorage.removeItem("wavesrt-last-project");
      await refreshProjectList();
      updateProjMeta();
      setStatus(`Deleted “${row?.name || id}”.`, "ok");
    });
  });
}

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function b64ToFile(entry, fallbackName) {
  if (!entry?.b64) return null;
  const bin = atob(entry.b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], entry.name || fallbackName || "file", { type: entry.type || "application/octet-stream" });
}

async function packBlob(file, name) {
  if (!file) return null;
  const blob = file instanceof Blob ? file : new Blob([file]);
  return { name: name || file.name || "file", type: blob.type || "", b64: await blobToB64(blob) };
}

async function recordToExport(rec) {
  const files = {
    audio: rec.audioBlob ? await packBlob(rec.audioBlob, rec.audioName) : null,
    photos: [],
    loop: rec.loop?.file ? await packBlob(rec.loop.file, rec.loop.name) : null,
    watermark: rec.watermark?.file ? await packBlob(rec.watermark.file, rec.watermark.name) : null,
    endLogo: rec.endLogo?.file ? await packBlob(rec.endLogo.file, rec.endLogo.name) : null,
    render: rec.render?.blob ? await packBlob(rec.render.blob, rec.render.name) : null,
    shorts: [],
  };
  for (const p of rec.photos || []) {
    if (!p.file) continue;
    const packed = await packBlob(p.file, p.name);
    packed.hold = p.hold;
    files.photos.push(packed);
  }
  for (const s of rec.shorts || []) {
    if (!s?.blob) continue;
    files.shorts.push({ index: s.index, name: s.name, ...(await packBlob(s.blob, s.name)) });
  }
  return {
    kind: "walk-on-records-project",
    rev: 18,
    exported: Date.now(),
    project: {
      name: rec.name,
      fileName: rec.fileName,
      lyrics: rec.lyrics,
      capcutName: rec.capcutName,
      capcutRaw: rec.capcutRaw,
      cues: rec.cues,
      settings: rec.settings,
    },
    files,
  };
}

async function exportProjectById(id) {
  const rec = await getProject(id);
  if (!rec) throw new Error("Project not found.");
  setStatus("Packing project file…");
  const payload = await recordToExport(rec);
  const text = JSON.stringify(payload);
  const blob = new Blob([text], { type: "application/json" });
  const safe = (rec.name || "project").replace(/[^\w.-]+/g, "_").slice(0, 40);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}.wor.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  setStatus(`Exported “${rec.name}”.`, "ok");
}

async function exportCurrentProject() {
  if (!state.projectId) await saveProject();
  if (!state.projectId) throw new Error("Save the project first.");
  await exportProjectById(state.projectId);
}

async function importProjectFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not a project JSON.");
  }
  if (data?.kind !== "walk-on-records-project" || !data.project) {
    throw new Error("Not a Walk On Records export.");
  }
  const p = data.project;
  const f = data.files || {};
  const rec = {
    id: newProjectId(),
    name: (p.name || file.name.replace(/\.wor\.json$/i, "") || "Imported") + "",
    created: Date.now(),
    updated: Date.now(),
    fileName: p.fileName || "subtitles",
    lyrics: p.lyrics || "",
    capcutName: p.capcutName || "",
    capcutRaw: p.capcutRaw || "",
    cues: p.cues || [],
    settings: p.settings || {},
    audioName: f.audio?.name || "",
    audioBlob: f.audio ? b64ToFile(f.audio, f.audio.name || "audio.wav") : null,
    photos: (f.photos || []).map((ph) => ({ name: ph.name, hold: ph.hold, file: b64ToFile(ph, ph.name || "photo.jpg") })),
    loop: f.loop ? { name: f.loop.name, file: b64ToFile(f.loop, f.loop.name || "loop.mp4") } : null,
    watermark: f.watermark ? { name: f.watermark.name, file: b64ToFile(f.watermark, f.watermark.name || "logo.png") } : null,
    endLogo: f.endLogo ? { name: f.endLogo.name, file: b64ToFile(f.endLogo, f.endLogo.name || "end.png") } : null,
    render: f.render
      ? { name: f.render.name, mime: f.render.type, blob: b64ToFile(f.render, f.render.name || "video.webm") }
      : null,
    shorts: (f.shorts || []).map((s) => ({
      index: s.index,
      name: s.name,
      blob: b64ToFile(s, s.name || "short.webm"),
    })),
  };
  await putProject(rec);
  await applyProject(rec);
  setStatus(`Imported “${rec.name}”. Saved in this browser.`, "ok");
}

function initProjects() {
  $("projSave").addEventListener("click", () => saveProject().catch((e) => setStatus(String(e.message || e), "error")));
  $("projSaveAs").addEventListener("click", () => {
    const name = window.prompt("Name for the new project", `${currentProjectName()} copy`);
    if (!name) return;
    $("projectName").value = name.trim();
    saveProject({ asNew: true }).catch((e) => setStatus(String(e.message || e), "error"));
  });
  $("projDup").addEventListener("click", () => duplicateProject().catch((e) => setStatus(String(e.message || e), "error")));
  $("projNew").addEventListener("click", () => newProject().catch((e) => setStatus(String(e.message || e), "error")));
  $("projOpen").addEventListener("click", async () => {
    await refreshProjectList();
    $("projDialog").showModal();
  });
  $("projClose").addEventListener("click", () => $("projDialog").close());
  if ($("projExport")) {
    $("projExport").addEventListener("click", () => exportCurrentProject().catch((e) => setStatus(String(e.message || e), "error")));
  }
  if ($("projImport") && $("projImportFile")) {
    $("projImport").addEventListener("click", () => $("projImportFile").click());
    $("projImportFile").addEventListener("change", async () => {
      const file = $("projImportFile").files?.[0];
      $("projImportFile").value = "";
      if (!file) return;
      try {
        await importProjectFile(file);
      } catch (e) {
        setStatus(String(e.message || e), "error");
      }
    });
  }
  $("projDelete").addEventListener("click", async () => {
    if (!state.projectId) return setStatus("Nothing saved to delete.", "error");
    const name = state.projectSavedName || currentProjectName();
    if (!window.confirm(`Delete saved project “${name}”? This does not delete a copy you already duplicated.`)) return;
    const id = state.projectId;
    await deleteProject(id);
    if (localStorage.getItem("wavesrt-last-project") === id) localStorage.removeItem("wavesrt-last-project");
    state.projectId = null;
    state.projectSavedName = "";
    markDirty();
    setStatus(`Deleted “${name}” from this browser. The open files are still here until you New or Close.`, "ok");
  });
  $("projectName").addEventListener("input", markDirty);
  if ($("appReload")) {
    $("appReload").addEventListener("click", async () => {
      setStatus("Clearing cached app files…");
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (_) {}
      const url = new URL(location.href);
      url.searchParams.set("reload", String(Date.now()));
      location.replace(url.toString());
    });
  }
  window.addEventListener("wavesrt-rendered", () => {
    markDirty();
    if (state.projectId) {
      saveProject().catch(() => {});
    }
  });
  const last = localStorage.getItem("wavesrt-last-project");
  if (last) {
    getProject(last)
      .then((rec) => {
        if (rec) {
          setStatus(`Opened last project “${rec.name}”.`, "ok");
          return applyProject(rec);
        }
      })
      .catch(() => {});
  }
  updateProjMeta();
}

window.addEventListener("wavesrt-ready", () => {
  try {
    videoReady();
    paintPreview(player.currentTime || 0);
  } catch (_) {}
});

lyricsEl.addEventListener("input", markDirty);

initVideoMaker();
initProjects();
rebuildCuesKeepTimes();
setStatus("Load a WAV and lyrics to start, or Open a saved project.");
