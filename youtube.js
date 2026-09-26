import { $, setStatus, setProgress } from "./app.js";
import { idbGet, idbSet, idbDel } from "./projects.js";

export const YT_CLIENT_KEY = "yt-client-id";
export const YT_SESSION_KEY = "yt-session";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

let tokenClient = null;

function session() {
  return window.__worYt || null;
}

function setSession(next) {
  window.__worYt = next;
}

function originList() {
  const here = location.origin + location.pathname.replace(/index\.html$/, "");
  return here.replace(/\/$/, "") || location.origin;
}

export async function loadYtClientId() {
  const saved = await idbGet(YT_CLIENT_KEY);
  if (saved && $("ytClientId")) $("ytClientId").value = saved;
  return saved || ($("ytClientId")?.value || "").trim();
}

export async function saveYtClientId() {
  const id = ($("ytClientId")?.value || "").trim();
  if (!id) return setStatus("Paste your Google OAuth Client ID first.", "error");
  await idbSet(YT_CLIENT_KEY, id);
  setStatus("Client ID saved in this browser only. Not uploaded to GitHub.", "ok");
  return id;
}

function waitForGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve(window.google.accounts.oauth2);
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (window.google?.accounts?.oauth2) {
        clearInterval(t);
        resolve(window.google.accounts.oauth2);
      } else if (n > 50) {
        clearInterval(t);
        reject(new Error("Google sign-in script did not load. Check the network and try again."));
      }
    }, 100);
  });
}

async function ensureTokenClient() {
  const clientId = await saveYtClientId();
  if (!clientId) return null;
  const gis = await waitForGis();
  tokenClient = gis.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: () => {},
  });
  return tokenClient;
}

function tokenValid() {
  const s = session();
  return !!(s?.access_token && s.expires_at && Date.now() < s.expires_at - 15000);
}

async function getToken(prompt) {
  if (tokenValid() && !prompt) return session().access_token;
  await ensureTokenClient();
  if (!tokenClient) return null;
  const tok = await new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp?.error) reject(new Error(resp.error_description || resp.error));
      else resolve(resp);
    };
    tokenClient.requestAccessToken({ prompt: prompt ? "consent" : "" });
  });
  setSession({
    access_token: tok.access_token,
    expires_at: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
  });
  await idbSet(YT_SESSION_KEY, { expires_at: session().expires_at, channel: session().channel || null });
  return tok.access_token;
}

async function ytFetch(url, opts = {}) {
  const token = await getToken(false);
  if (!token) throw new Error("Not connected to YouTube.");
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    await getToken(true);
    return ytFetch(url, opts);
  }
  return res;
}

export async function listYtChannels() {
  const res = await ytFetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true&maxResults=50");
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Could not list channels.");
  return data.items || [];
}

function paintChannelSelect(channels) {
  const sel = $("ytChannel");
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = channels.length
    ? channels.map((c) => `<option value="${c.id}">${(c.snippet?.title || c.id).replace(/</g, "")}</option>`).join("")
    : `<option value="">No channel on this Google login</option>`;
  if (keep && channels.some((c) => c.id === keep)) sel.value = keep;
  const s = session() || {};
  s.channel = sel.value;
  setSession(s);
}

export function ytConnectedLabel() {
  const el = $("ytAuthState");
  if (!el) return;
  if (tokenValid()) el.textContent = "Connected. Token stays in this browser ~1 hour.";
  else el.textContent = "Not connected.";
}

export async function connectYoutube() {
  try {
    await getToken(true);
    const channels = await listYtChannels();
    paintChannelSelect(channels);
    ytConnectedLabel();
    if (!channels.length) {
      setStatus("Connected, but this Google login has no uploadable channel. Switch brand account in the Google popup and connect again.", "error");
    } else {
      setStatus(`Connected to YouTube. Using “${channels[0].snippet?.title || channels[0].id}”. Switch the list if you have more than one.`, "ok");
    }
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
      if (onPct) onPct(end / blob.size);
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
  const privacy = $("ytPrivacy")?.value || "unlisted";
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
    (media.shorts || []).forEach((s, i) => add(`Short ${s.index || i + 1}`, s, true, s.index || i + 1));
  }
  if (!jobs.length && media.main?.blob) {
    add("current render", media.main, false);
  }
  if (!jobs.length) {
    throw new Error("Nothing to upload. Render a video first (Download video should turn on), then check one box or Post again to send the current render.");
  }
  const preview = jobs.map((j) => {
    const shape = j.item?.aspect || (j.short ? "9:16" : "video");
    const mb = (j.blob.size / 1e6).toFixed(1);
    const warn = j.short && j.item?.duration > 180 ? " (over 3 min — YouTube may put this in Videos, not Shorts)" : "";
    return `• ${j.kind} · ${j.item?.name || "file"} · ${shape} · ${mb} MB${warn}`;
  }).join("\n");
  const ok = window.confirm(`Upload ${jobs.length} file(s) as ${privacy}?\n\n${preview}\n\nYouTube puts a file in Shorts only if it is vertical and about 3 minutes or less. A 16:9 master should land in Videos.`);
  if (!ok) throw new Error("Upload cancelled.");

  const title = clip(copy.title, 100);
  const desc = clip(`${copy.description || ""}\n\nChapters\n${copy.chapters || ""}\n\n${copy.hashtags || ""}`, 4900);
  const tags = tagsFrom(copy.hashtags, "WalkOnRecords LyricVideo");
  const posted = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const useTitle = String(job.kind).startsWith("Short")
      ? clip(`${title} · Short ${job.index || ""}`.trim(), 100)
      : title;
    setStatus(`Uploading ${job.kind} to YouTube (${i + 1}/${jobs.length}) as ${privacy}…`);
    const video = await resumableUpload(
      job.blob,
      {
        snippet: {
          title: useTitle,
          description: desc,
          tags,
          categoryId: "10",
        },
        status: {
          privacyStatus: privacy,
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
  const text = bits.length ? `Will upload: ${bits.join(" · ")}` : "Nothing queued. Check one box.";
  if ($("ytQueueHint")) $("ytQueueHint").textContent = text;
  return text;
}

export function initYoutube() {
  loadYtClientId().then(() => ytConnectedLabel());
  if ($("ytSaveClient")) $("ytSaveClient").addEventListener("click", () => saveYtClientId());
  if ($("ytConnect")) $("ytConnect").addEventListener("click", () => connectYoutube());
  if ($("ytDisconnect")) $("ytDisconnect").addEventListener("click", () => disconnectYoutube());
  if ($("ytOriginHint")) $("ytOriginHint").textContent = originList();
}
