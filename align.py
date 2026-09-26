#!/usr/bin/env python3
"""Align lyrics text to a WAV/audio file and write SRT.

Uses faster-whisper when installed. Otherwise falls back to an energy +
line-length guess so the script still runs on a basic Chromebook Linux
container.
"""

from __future__ import annotations

import argparse
import math
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


HEADER_RE = re.compile(
    r"""
    ^\s*[\[\(\{<]*\s*
    (pre[-\s]?)?
    (verse|chorus|hook|bridge|intro|outro|refrain|interlude|tag|
     breakdown|spoken|instrumental|ending|drop|post[-\s]?chorus)
    (\s*[-:]?\s*(\d+|[ivx]+|one|two|three|a|b))?
    (\s*[\-(]?\s*(repeat|x\d+|\d+x))?
    \s*[\]\)\}>:.\-–—]*\s*$
    """,
    re.I | re.X,
)


SRT_TIME = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})"
)


def srt_stamp(h, m, s, ms) -> float:
    milli = str(ms).ljust(3, "0")[:3]
    return int(h) * 3600 + int(m) * 60 + int(s) + int(milli) / 1000.0


def parse_srt(text: str) -> list[dict]:
    cues = []
    for block in re.split(r"\n\s*\n", text.replace("\r", "").lstrip("\ufeff")):
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        tline = next((ln for ln in lines if SRT_TIME.search(ln)), None)
        if not tline:
            continue
        m = SRT_TIME.search(tline)
        start = srt_stamp(*m.groups()[:4])
        end = srt_stamp(*m.groups()[4:])
        if end <= start:
            continue
        idx = lines.index(tline)
        body = " ".join(lines[idx + 1 :])
        body = re.sub(r"<[^>]+>", "", body).strip()
        cues.append({"start": start, "end": end, "text": body})
    cues.sort(key=lambda c: c["start"])
    return cues


def reflow_lyrics_onto_srt(lines: list[str], srt_cues: list[dict]) -> list[dict]:
    lyrics = [ln for ln in lines if ln.strip()]
    n, m = len(srt_cues), len(lyrics)
    if not n or not m:
        return []
    ratio = min(n, m) / max(n, m)
    if ratio >= 0.55:
        if m == n:
            return [{"text": t, "start": srt_cues[i]["start"], "end": srt_cues[i]["end"]} for i, t in enumerate(lyrics)]
        if m < n:
            base, extra, i = n // m, n % m, 0
            out = []
            for text in lyrics:
                take = max(1, base + (1 if extra > 0 else 0))
                extra = max(0, extra - 1)
                group = srt_cues[i : i + take]
                i += take
                out.append({"text": text, "start": group[0]["start"], "end": group[-1]["end"]})
            return out
        out, li = [], 0
        for ci, cue in enumerate(srt_cues):
            remaining_cues = n - ci
            remaining_lines = m - li
            take = max(1, round(remaining_lines / remaining_cues))
            group = lyrics[li : li + take]
            li += len(group)
            weights = [max(3, len(re.sub(r"\s+", "", t))) for t in group]
            sum_w = sum(weights) or 1
            span = max(0.12, cue["end"] - cue["start"])
            t0 = cue["start"]
            for gi, text in enumerate(group):
                dur = (weights[gi] / sum_w) * span
                end = cue["end"] if gi == len(group) - 1 else min(cue["end"], t0 + dur)
                out.append({"text": text, "start": t0, "end": end})
                t0 = end
        return out
    weights = [max(3, len(re.sub(r"\s+", "", t))) for t in lyrics]
    sum_w = sum(weights) or 1
    total = sum(max(0.05, c["end"] - c["start"]) for c in srt_cues)
    ci, used, out = 0, 0.0, []

    def pos() -> float:
        cue = srt_cues[min(ci, n - 1)]
        return cue["start"] + used

    def consume(need: float) -> tuple[float, float]:
        nonlocal ci, used
        left = need
        start = pos()
        while left > 1e-4 and ci < n:
            cue = srt_cues[ci]
            avail = max(0.0, cue["end"] - cue["start"] - used)
            take = min(avail, left)
            used += take
            left -= take
            if used >= cue["end"] - cue["start"] - 1e-3:
                ci += 1
                used = 0.0
        return start, max(start + 0.12, pos())

    for text, w in zip(lyrics, weights):
        start, end = consume(max(0.18, (w / sum_w) * total))
        out.append({"text": text, "start": start, "end": end})
    return out


def parse_lyrics(text: str, keep_headers: bool = False) -> list[str]:
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if HEADER_RE.match(line) and not keep_headers:
            continue
        lines.append(line)
    return lines


def fmt_srt_time(sec: float) -> str:
    if sec < 0:
        sec = 0
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int(round((sec - math.floor(sec)) * 1000))
    if ms == 1000:
        s += 1
        ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(path: Path, cues: list[dict]) -> None:
    parts = []
    n = 1
    for cue in cues:
        text = cue["text"].strip()
        if not text:
            continue
        parts.append(str(n))
        parts.append(f"{fmt_srt_time(cue['start'])} --> {fmt_srt_time(cue['end'])}")
        parts.append(text)
        parts.append("")
        n += 1
    path.write_text("\n".join(parts), encoding="utf-8")


def to_wav_mono16k(src: Path) -> Path:
    if src.suffix.lower() == ".wav":
        try:
            with wave.open(str(src), "rb") as wf:
                if wf.getnchannels() == 1 and wf.getframerate() == 16000 and wf.getsampwidth() == 2:
                    return src
        except wave.Error:
            pass
    if not shutil.which("ffmpeg"):
        return src
    out = Path(tempfile.mkstemp(suffix=".wav")[1])
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
        str(out),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


def read_wav_samples(path: Path) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())
    if sw == 2:
        import array
        ints = array.array("h")
        ints.frombytes(raw)
        samples = [v / 32768.0 for v in ints]
    else:
        samples = [b / 128.0 - 1.0 for b in raw]
    if nch > 1:
        samples = [sum(samples[i:i + nch]) / nch for i in range(0, len(samples), nch)]
    return samples, sr


def energy_cues(audio: Path, lines: list[str]) -> list[dict]:
    wav = to_wav_mono16k(audio)
    samples, sr = read_wav_samples(wav)
    if wav != audio:
        wav.unlink(missing_ok=True)
    hop = max(1, int(sr * 0.02))
    env = []
    for i in range(0, len(samples), hop):
        chunk = samples[i:i + hop]
        env.append(math.sqrt(sum(x * x for x in chunk) / max(1, len(chunk))))
    ordered = sorted(env)
    noise = ordered[int(len(ordered) * 0.35)] if ordered else 0.01
    thr = max(0.012, noise * 2.2)
    spans = []
    start = None
    for i, v in enumerate(env):
        on = v >= thr
        if on and start is None:
            start = i
        if not on and start is not None:
            a, b = start * 0.02, i * 0.02
            if b - a >= 0.18:
                spans.append([a, b])
            start = None
    if start is not None:
        spans.append([start * 0.02, len(env) * 0.02])
    duration = len(samples) / float(sr) if samples else 0
    if not spans:
        spans = [[0.15, max(0.4, duration - 0.1)]]
    merged = []
    for a, b in spans:
        if merged and a - merged[-1][1] < 0.35:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    total = sum(b - a for a, b in merged)
    weights = [max(4, len(re.sub(r"\s+", "", line))) for line in lines]
    sum_w = sum(weights) or 1
    cues = []
    cursor = 0.0
    gap = 0.06
    for line, w in zip(lines, weights):
        need = max(0.45, (w / sum_w) * total)
        placed = 0.0
        start_t = None
        end_t = None
        for a, b in merged:
            if cursor >= b:
                continue
            frm = max(a, cursor)
            take = min(need - placed, b - frm)
            if take <= 0:
                continue
            if start_t is None:
                start_t = frm
            end_t = frm + take
            placed += take
            cursor = end_t + gap
            if placed >= need * 0.98:
                break
        if start_t is None:
            start_t = min(max(0, duration - 0.4), len(cues) * (duration / max(1, len(lines))))
            end_t = min(duration, start_t + need)
        cues.append({"text": line, "start": start_t, "end": max(start_t + 0.35, end_t)})
    return snap_cues(cues, duration)


def snap_cues(cues: list[dict], duration: float) -> list[dict]:
    last = 0.0
    min_len = 0.25
    gap = 0.05
    for cue in cues:
        start = max(0.0, float(cue["start"]))
        end = float(cue["end"])
        if start < last:
            start = last
        if end <= start:
            end = start + min_len
        if duration:
            end = min(end, duration)
        cue["start"] = start
        cue["end"] = max(start + 0.12, end)
        last = cue["end"] + gap
    if duration and cues and cues[-1]["end"] > duration:
        # Pack from the end when the guess ran past the file.
        t = duration
        for cue in reversed(cues):
            length = max(0.12, cue["end"] - cue["start"])
            cue["end"] = t
            cue["start"] = max(0.0, t - length)
            t = max(0.0, cue["start"] - gap)
        last = 0.0
        for cue in cues:
            if cue["start"] < last:
                cue["start"] = last
            if cue["end"] <= cue["start"]:
                cue["end"] = min(duration, cue["start"] + 0.12)
            last = cue["end"] + gap
    return cues


def norm(tok: str) -> str:
    tok = tok.lower()
    return re.sub(r"[^a-z0-9']+", "", tok)


def whisper_cues(audio: Path, lines: list[str], model: str, language: str | None) -> list[dict]:
    from faster_whisper import WhisperModel

    wm = WhisperModel(model, device="cpu", compute_type="int8")
    kwargs = {"word_timestamps": True, "vad_filter": True}
    if language and language != "auto":
        kwargs["language"] = language
    segments, _info = wm.transcribe(str(audio), **kwargs)
    words = []
    for seg in segments:
        if not seg.words:
            continue
        for w in seg.words:
            words.append({"text": w.word, "start": w.start or 0.0, "end": w.end or (w.start or 0.0)})
    if not words:
        raise RuntimeError("Whisper produced no word timestamps")

    lyric_tok = []
    for i, line in enumerate(lines):
        for raw in line.split():
            n = norm(raw)
            if n:
                lyric_tok.append((i, n))
    asr = [(norm(w["text"]), w["start"], w["end"]) for w in words]
    n, m = len(lyric_tok), len(asr)
    INF = 10**9
    dp = [[INF] * (m + 1) for _ in range(n + 1)]
    bt = [[0] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    for j in range(1, m + 1):
        dp[0][j] = j * 0.4
    for i in range(1, n + 1):
        dp[i][0] = i * 1.15

    def score(a: str, b: str) -> float:
        if a == b:
            return 0.0
        if len(a) > 2 and len(b) > 2 and (a.startswith(b) or b.startswith(a)):
            return 0.25
        if a and b and a[0] == b[0] and abs(len(a) - len(b)) <= 1:
            return 0.55
        return 1.15

    for i in range(1, n + 1):
        la = lyric_tok[i - 1][1]
        for j in range(1, m + 1):
            match = dp[i - 1][j - 1] + score(la, asr[j - 1][0])
            skip_a = dp[i][j - 1] + 0.35
            skip_l = dp[i - 1][j] + 1.1
            best, which = match, 0
            if skip_a < best:
                best, which = skip_a, 1
            if skip_l < best:
                best, which = skip_l, 2
            dp[i][j] = best
            bt[i][j] = which

    mapping = [-1] * n
    i, j = n, m
    while i > 0 and j > 0:
        w = bt[i][j]
        if w == 0:
            mapping[i - 1] = j - 1
            i -= 1
            j -= 1
        elif w == 1:
            j -= 1
        else:
            i -= 1

    cues = [{"text": line, "start": None, "end": None} for line in lines]
    for idx, (li, _tok) in enumerate(lyric_tok):
        aj = mapping[idx]
        if aj < 0:
            continue
        _n, st, en = asr[aj]
        cue = cues[li]
        cue["start"] = st if cue["start"] is None else min(cue["start"], st)
        cue["end"] = en if cue["end"] is None else max(cue["end"], en)

    last = 0.0
    for cue in cues:
        if cue["start"] is None:
            cue["start"] = last
            cue["end"] = last + 1.0
        if cue["end"] is None:
            cue["end"] = cue["start"] + 1.0
        if cue["start"] < last:
            cue["start"] = last
        if cue["end"] <= cue["start"]:
            cue["end"] = cue["start"] + 0.4
        last = cue["end"] + 0.04
    return cues


def main() -> None:
    p = argparse.ArgumentParser(description="Align lyrics to audio and write SRT")
    p.add_argument("audio", type=Path)
    p.add_argument("lyrics", type=Path)
    p.add_argument("-o", "--output", type=Path)
    p.add_argument("-m", "--model", default="base")
    p.add_argument("-l", "--language", default="auto")
    p.add_argument("--srt", type=Path, help="CapCut / existing SRT whose timings should be kept")
    p.add_argument("--keep-headers", action="store_true")
    p.add_argument("--energy-only", action="store_true")
    args = p.parse_args()
    if not args.audio.exists():
        sys.exit(f"Missing audio: {args.audio}")
    if not args.lyrics.exists():
        sys.exit(f"Missing lyrics: {args.lyrics}")
    lines = parse_lyrics(args.lyrics.read_text(encoding="utf-8"), args.keep_headers)
    if not lines:
        sys.exit("No lyric lines found")
    out = args.output or args.audio.with_suffix(".srt")
    if args.srt and args.srt.exists():
        cap = parse_srt(args.srt.read_text(encoding="utf-8"))
        if not cap:
            sys.exit(f"No cues in {args.srt}")
        cues = reflow_lyrics_onto_srt(lines, cap)
        write_srt(out, cues)
        print(f"Wrote {out} ({len(cues)} cues from {len(cap)} CapCut windows)")
        return
    used = "energy"
    try:
        if args.energy_only:
            raise RuntimeError("energy-only")
        import faster_whisper  # noqa: F401
        cues = whisper_cues(args.audio, lines, args.model, None if args.language == "auto" else args.language)
        used = f"faster-whisper:{args.model}"
    except Exception as exc:
        if "energy-only" not in str(exc):
            print(f"Whisper unavailable ({exc}). Falling back to energy guess.", file=sys.stderr)
        cues = energy_cues(args.audio, lines)
    write_srt(out, cues)
    print(f"Wrote {out} ({len(cues)} cues, method={used})")


if __name__ == "__main__":
    main()
