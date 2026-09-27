import { $, setStatus, setProgress } from "./app.js";
import { idbGet, idbSet, idbDel } from "./projects.js";

const YT_CLIENT_KEY = "yt-oauth-client-id";
const YT_SESSION_KEY = "yt-oauth-session";
const YT_CHANNEL_KEY = "yt-channel-id";

function originList() {
  try {
    return `${location.origin}`;
  } catch {
    return "https://jeffcasey1976-ui.github.io";
  }
}

function session() {
  try {
    return JSON.parse(sessionStorage.getItem(YT_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function setSession(data) {
  if (!data) sessionStorage.removeItem(YT_SESSION_KEY);
  else sessionStorage.setItem(YT_SESSION_KEY, JSON.stringify(data));
}

function tokenValid() {
  const s = session();
  return !!(s?.access_token && s.expires_at && Date.now() < s.expires_at - 30000);
}

export async function loadYtClientId() {
  const saved = await idbGet(YT_CLIENT_KEY);
  if (saved && $("ytClientId")) $("ytClientId").value = saved;
  return (saved || $("ytClientId")?.value || "").trim();
}

export async function saveYtClientId() {
  const id = ($("ytClientId")?.value || "").trim();
  if (!id) return setStatus("Paste a Google OAuth Client ID first.", "error");
  await idbSet(YT_CLIENT_KEY, id);
  setStatus("Client ID saved in this browser only.", "ok");
  return id;
}

function ytConnectedLabel() {
  const el = $("ytConnLabel");
  if (!el) return;
  el.textContent = tokenValid()
    ? "Connected. Token stays in this browser ~1 hour."
    : "Not connected.";
  el.className = tokenValid() ? "hint ok" : "hint";
}

function handleTokenResponse(resp) {
  if (resp?.error) {
    setStatus(resp.error_description || resp.error, "error");
    return;
  }
  setSession({
    access_token: resp.access_token,
    expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
  });
  ytConnectedLabel();
  listChannels().catch((e) => setStatus(String(e.message || e), "error"));
}

async function getToken(interactive) {
  if (tokenValid()) return session().access_token;
  const clientId = await loadYtClientId();
  if (!clientId) throw new Error("Save a Google OAuth Client ID first.");
  if (!window.google?.accounts?.oauth2) throw new Error("Google sign-in script did not load. Reload the page.");
  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      callback: (resp) => {
        if (resp?.error) return reject(new Error(resp.error_description || resp.error));
        handleTokenResponse(resp);
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

export async function connectYoutube() {
  try {
    await saveYtClientId();
    await getToken(true);
    setStatus("YouTube connected on this browser.", "ok");
  } catch (err) {
    setStatus(String(err.message || err), "error");
  }
}

export async function disconnectYoutube() {
  const s = session();
  if (s?.access_token && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(s.access_token, () => {});
    } catch (_) {}
  }
  setSession(null);
  await idbDel(YT_SESSION_KEY);
  ytConnectedLabel();
  if ($("ytChannel")) $("ytChannel").innerHTML = `<option value="">Connect first</option>`;
  setStatus("YouTube disconnected on this browser.", "ok");
}

async function listChannels() {
  const token = await getToken(false);
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Channel list failed (${res.status})`);
  const items = data.items || [];
  const sel = $("ytChannel");
  if (!sel) return;
  const saved = await idbGet(YT_CHANNEL_KEY);
  sel.innerHTML = items
    .map((ch) => `<option value="${ch.id}" ${ch.id === saved ? "selected" : ""}>${ch.snippet?.title || ch.id}</option>`)
    .join("") || `<option value="">No channels on this login</option>`;
  if (sel.value) await idbSet(YT_CHANNEL_KEY, sel.value);
}

function clip(s, n) {
  return String(s || "").trim().slice(0, n);
}

function tagsFrom(hashtags, extra) {
  const bits = `${hashtags || ""} ${extra || ""}`
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter((t) => t.length >= 2 && t.length <= 30);
  const out = [];
  const seen = new Set();
  for (const t of bits) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 15) break;
  }
  return out;
}

async function resumableUpload(blob, meta, onPct) {
  const token = await getToken(false);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(blob.size),
      "X-Upload-Content-Type": blob.type || "video/mp4",
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) {
    const err = await init.json().catch(() => ({}));
    throw new Error(err?.error?.message || `YouTube start failed (${init.status})`);
  }
  const loc = init.headers.get("Location");
  if (!loc) throw new Error("YouTube did not return an upload URL.");
  const chunk = 8 * 1024 * 1024;
  let start = 0;
  let last = null;
  while (start < blob.size) {
    const end = Math.min(blob.size, start + chunk);
    const slice = blob.slice(start, end);
    const put = await fetch(loc, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": blob.type || "video/mp4",
        "Content-Range": `bytes ${start}-${end - 1}/${blob.size}`,
      },
      body: slice,
    });
    if (put.status === 308) {
      start = end;
      if (onPct) onPct(start / blob.size);
      continue;
    }
    if (!put.ok) {
      const err = await put.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Upload failed (${put.status})`);
    }
    last = await put.json();
    if (onPct) onPct(1);
    start = blob.size;
  }
  return last;
}

export async function uploadPackToYoutube(media, copy) {
  if (!tokenValid()) await getToken(true);
  let privacy = $("ytPrivacy")?.value || "unlisted";
  const sched = $("ytSchedule")?.value ? new Date($("ytSchedule").value) : null;
  const when = sched && sched.getTime() > Date.now() + 60000 ? sched.toISOString() : "";
  if (when) privacy = "private";
  const jobs = [];
  const used = new Set();
  const looksShort = (item) => !!(item?.short || /short/i.test(item?.name || ""));
  const isWide = (item) => item && !looksShort(item) && (item.aspect === "16:9" || (item.w && item.h && item.w > item.h));
  const isTall = (item) => item && !looksShort(item) && (item.aspect === "9:16" || (item.w && item.h && item.h > item.w));
  const add = (kind, item, short, index) => {
    const blob = item?.blob;
    if (!blob || used.has(blob)) return false;
    used.add(blob);
    jobs.push({ kind, blob, item, short: !!short, index });
    return true;
  };
  if ($("ytUpWide")?.checked) {
    let item = isWide(media.wide) ? media.wide : isWide(media.main) ? media.main : null;
    if (!item && media.main?.blob && $("aspect")?.value === "16:9" && !looksShort(media.main)) item = media.main;
    if (!add("16:9 landscape", item, false)) {
      throw new Error("16:9 is checked, but there is no landscape file in memory. Set Aspect to 16:9, Render, wait until Download video is on, then Post.");
    }
  }
  if ($("ytUpTall")?.checked) {
    const item = media.tall || (isTall(media.main) && !isWide(media.main) ? media.main : null);
    if (!add("9:16 full video", item, false)) {
      throw new Error("9:16 full video is checked, but that file is not in memory. Render 9:16 or Build release pack.");
    }
  }
  if ($("ytUpMain")?.checked) add("current render", media.main, false);
  if ($("ytUpShorts")?.checked) {
    (media.shorts || []).forEach((s, i) => {
      const idx = s.index || i + 1;
      const box = $("ytShort" + idx);
      if (box && !box.checked) return;
      add(`Short ${idx}`, s, true, idx);
    });
  }
  if (!jobs.length && media.main?.blob) add("current render", media.main, false);
  if (!jobs.length) {
    throw new Error("Nothing to upload. Render a video first, then check one box.");
  }
  const preview = jobs
    .map((j) => `" ${j.kind} � ${j.item?.name || "file"} � ${(j.blob.size / 1e6).toFixed(1)} MB`)
    .join("\n");
  const ok = window.confirm(`Upload ${jobs.length} file(s) as ${privacy}${when ? " (scheduled)" : ""}?\n\n${preview}`);
  if (!ok) throw new Error("Upload cancelled.");
  const title = clip(copy.title, 100);
  const desc = clip(`${copy.description || ""}\n\nChapters\n${copy.chapters || ""}\n\n${copy.hashtags || ""}`, 4900);
  const tags = tagsFrom(copy.hashtags, "WalkOnRecords LyricVideo");
  const posted = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const useTitle = String(job.kind).startsWith("Short")
      ? clip(`${title} � Short ${job.index || ""}`.trim(), 100)
      : title;
    setStatus(`Uploading ${job.kind} to YouTube (${i + 1}/${jobs.length}) as ${privacy}&`);
    const video = await resumableUpload(
      job.blob,
      {
        snippet: { title: useTitle, description: desc, tags, categoryId: "10" },
        status: {
          privacyStatus: privacy,
          ...(when ? { publishAt: when } : {}),
          selfDeclaredMadeForKids: false,
        },
      },
      (pct) => setProgress((i + pct) / jobs.length)
    );
    posted.push({ kind: job.kind, id: video?.id, url: video?.id ? `https://youtu.be/${video.id}` : "" });
  }
  setProgress(1);
  setTimeout(() => setProgress(null), 1200);
  return posted;
}

export function describeYtQueue(media) {
  const bits = [];
  if ($("ytUpWide")?.checked) bits.push(media?.wide?.blob || (media?.main && media.main.aspect === "16:9") ? "16:9 landscape" : "16:9 (not rendered yet)");
  if ($("ytUpTall")?.checked) bits.push(media?.tall?.blob ? "9:16 full video" : "9:16 full (not rendered yet)");
  if ($("ytUpMain")?.checked) bits.push(media?.main?.blob ? `current render (${media.main.aspect || "?"})` : "current render (none)");
  if ($("ytUpShorts")?.checked) bits.push(`${(media?.shorts || []).length} Short hook(s)`);
  const text = bits.length ? `Will upload: ${bits.join(" � ")}` : "Nothing queued. Check one box.";
  if ($("ytQueueHint")) $("ytQueueHint").textContent = text;
  return text;
}

export function initYoutube() {
  loadYtClientId().then(() => ytConnectedLabel()).catch(() => {});
  if ($("ytSaveClient")) $("ytSaveClient").addEventListener("click", () => saveYtClientId());
  if ($("ytConnect")) $("ytConnect").addEventListener("click", () => connectYoutube());
  if ($("ytDisconnect")) $("ytDisconnect").addEventListener("click", () => disconnectYoutube());
  if ($("ytOriginHint")) $("ytOriginHint").textContent = originList();
  if ($("ytChannel")) {
    $("ytChannel").addEventListener("change", () => {
      if ($("ytChannel").value) idbSet(YT_CHANNEL_KEY, $("ytChannel").value);
    });
  }
}
