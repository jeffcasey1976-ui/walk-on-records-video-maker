# Walk On Records Video Maker

Turn a **WAV** (or other audio your browser can play) plus a **lyrics text file** into a timed **SRT** subtitle file.

Works on a **Chromebook** and a **phone** because it is a web app. Audio and lyrics stay on the device. Nothing is uploaded to a server.

## What you get

- Upload audio + paste or upload lyrics
- **Guess timings** from loudness and line length (fast, offline)
- **Tap sync** while the track plays (most accurate on a phone)
- Optional **AI align** in the browser (downloads a small Whisper model once)
- Preview against a waveform, edit any line, export `.srt` and `.lrc`
- Build a **9:16 or 16:9 lyric video** from photos (crossfade) or a looping clip, with a reusable watermark

Your lyric text is kept. Alignment only adds timestamps.

## Use it on a Chromebook

### Fastest: open in Chrome

1. Copy the `wav2srt` folder to Downloads (or Linux files).
2. In that folder run:

```bash
python3 serve.py
```

3. Open the URL it prints (usually `http://127.0.0.1:8765`).
4. Optional: Chrome menu → **Install Walk On Records Video Maker** / **Add to shelf** so it behaves like an app.

You can also use Linux Crostini:

```bash
cd wav2srt
python3 serve.py
```

### Stronger auto-align on Chromebook Linux (optional)

If Guess / AI is not tight enough on sung vocals, use the local script. It needs `ffmpeg`.

```bash
sudo apt update && sudo apt install -y ffmpeg python3-pip
pip3 install -r requirements.txt
python3 align.py song.wav lyrics.txt -o song.srt
```

`align.py` uses faster-whisper when installed; otherwise it falls back to energy + line-length timing.

## Use it on a phone

Same app in Chrome or Safari:

1. Run `python3 serve.py` on the Chromebook (or any computer on the same Wi-Fi).
2. Note the LAN address printed, e.g. `http://192.168.1.20:8765`.
3. Open that address on the phone.
4. Add to Home Screen for a full-screen PWA.

Tap sync is built for thumbs: big **Mark start** / **Mark end** buttons, optional vibration.

## Deploy on Netlify

The site is static. No build command.

1. Open [app.netlify.com/drop](https://app.netlify.com/drop) and drop the `wav2srt` folder.
2. Or: New site from Git → publish directory `.` (use `wav2srt` if that folder is not the repo root).
3. Open the `https://….netlify.app` URL on Chromebook and phone.
4. Phone browser menu → Add to Home Screen.

HTTPS is required for AI align and the PWA. The first AI run still downloads Whisper in that browser. Audio and lyrics are not uploaded to Netlify; they stay in the browser.

## Lyrics file format

Plain `.txt`, one subtitle line per line:

```
I been driving all night
Just to see your face
Don't you disappear

We can start again
```

Blank lines are ignored. Section labels are skipped unless you turn on **Keep section labels** — with or without brackets: `verse`, `Verse 2`, `[Chorus]`, `(Bridge)`, `outro`.

Repeats must be written out if they are sung more than once.

## Modes

| Mode | Best for | Notes |
|---|---|---|
| Guess | Quick draft | Uses silence / energy + character counts. Edit after. |
| Tap sync | Final SRT on phone | Tap when a line starts and ends. |
| AI align | Speech and clear singing | Runs Whisper in the browser, then matches *your* lyrics to word times. First run downloads ~75 MB. |

## SRT timing notes

- Times are `HH:MM:SS,mmm`
- A 80 ms gap is left between consecutive cues so players do not overlap
- Minimum cue length is 0.4 s unless you edit it

## Lyric video (section 6)

After timings exist (SRT / Guess / AI / tap):

1. Choose **9:16** (Shorts, Reels, TikTok) or **16:9** (YouTube).
2. Drop several photos *or* one video that should loop. Photo duration and crossfade are separate fields. **Photo motion** adds a Ken Burns auto pan/zoom (alternating directions, ease-in/out). Use Subtle if a photo looks soft when pushed in.
3. Optional: drop a logo. Check **Save logo in this app** to keep it in this browser (IndexedDB). **Use saved logo** brings it back next time.
4. Play the song — the preview canvas follows the playhead. Place lyrics with **Position** (bottom half, lower third, center, top, or custom top % + height %). Width and Align pin the words; Shade tints only that band. Lines still scroll **bottom → top** inside the band.
5. **Render in background**. Encoding is silent and takes about as long as the song. Keep the tab open. When it finishes, **Download video** turns on. Save the project to keep that file with the song.

## Projects

The top bar is a local project folder in this browser (nothing is uploaded).

- **Save** stores audio, lyrics, SRT, cues, photos or loop clip, logo, layout, and the rendered video if one is ready.
- **Save as** / **Duplicate** copy everything under a new name. The original project is left untouched.
- **Open** lists saved projects. The last one reopens the next time you load the app.

Use 720p on a phone or a small Chromebook; 1080p is heavier.

The watermark sits in the picture half by default (top-right) so it does not cover the lyric band unless you pick a bottom corner.

## Privacy

Audio, photos, and the logo are decoded in the browser (or in local Python). No cloud API key is required. The saved logo never leaves this device.
