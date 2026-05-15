# Architecture

This document explains how Paulstretch For Live is put together, from the
moment you right-click a clip in Live down to the WASM DSP that does the actual
stretching. It's aimed at a curious reader who wants the whole picture, not just
the wiring of one piece.

## The big picture

Paulstretch For Live is two programs that talk to each other:

- **The host** (`src/extension.ts`) — a small Node.js extension that runs inside
  Live's **Extension Host**. It owns everything on the Live side: the
  right-click menu item, rendering the selected audio out of Live, and importing
  the result back in. It contains no DSP and no UI of its own.
- **The dialog** (`src/dialog/`) — a self-contained **React + WebAssembly web
  app** (a fork of the web port of paulstretch). It owns everything the user
  sees and hears: the parameter UI, real-time preview playback, and the final
  offline render. It knows nothing about Live.

The host opens the dialog in a **WebView** (Live's embedded browser) and hands
it the selected audio. The user auditions and tweaks; when they hit **Apply**,
the dialog renders the stretched audio and ships it back to the host, which
drops it into the Live timeline.

```
┌─────────────────────────── Ableton Live ───────────────────────────┐
│                                                                     │
│   Live application  ──right-click "Stretch"──►  Extension Host      │
│        ▲                                        (Node.js)           │
│        │                                     src/extension.ts       │
│        │ import clip                                │               │
│        │                          render audio,     │ opens         │
│        │                          serve dialog,     ▼               │
│        │                          receive result   WebView ────┐    │
│        └────────────────────────────────────────  (dialog)    │    │
│                                                                │    │
└────────────────────────────────────────────────────────────────────┘
                                                                 │
                        src/dialog/  (React UI + paulstretch WASM DSP)
```

Why split it this way? The paulstretch DSP already exists as a high-quality
C++/WASM library with a web UI. Rather than reimplement it for Node, the
extension reuses that web app wholesale and treats it as a black box that takes
audio in and gives audio out. The host's only job is to bridge it to Live.

## The host (`src/extension.ts`)

On `activate()` the host:

1. `initialize(...)` against API version `1.0.0` and registers a command,
   `paulstretch.process`.
2. Wires that command into Live's context menu via
   `registerContextMenuAction("AudioTrack.ArrangementSelection", "Stretch", …)`,
   so it appears when you right-click a time selection on an audio track in the
   Arrangement.

When the command fires it validates the selection (exactly one audio track, a
non-empty time range), renders the selected audio to a temp WAV with
`context.resources.renderPreFxAudio(...)`, opens the dialog, and — on a
successful result — imports the returned WAV back onto the track inside a
`withinProgressDialog(...)`. See [the Apply flow](#audio-flow-on-apply) below
for the step-by-step.

A few host details worth knowing:

- **It serves the dialog over a localhost HTTP server, not `file://`.** This is
  the single most important design decision and is explained in
  [its own section](#why-a-localhost-server).
- **`importIntoProject` has a fallback.** On macOS it can reject (with a bare
  `undefined`) for symlinked `/tmp` paths — a Live-side path-validation quirk —
  so the host falls back to handing the temp WAV path straight to
  `createAudioClip` and leaving the file on disk for Live to read.
- **Windows path fix-up.** The SDK returns extended-length paths (`\\?\C:\…`)
  that `fs.*` can't read through the host's allow-list, so `stripWin32ExtPrefix`
  removes the prefix before any filesystem call.

## The dialog (`src/dialog/`)

The dialog is an ordinary Vite-built React app. `App.tsx` is the shell;
[Zustand](https://github.com/pmndrs/zustand) (`state/store.ts`) holds all
parameter state, and the panels (`ParametersPanel`, `ProcessPanel`,
`BinauralPanel`, `EnvelopeEditor`, …) are thin editors over that store.

It runs in one of two modes, decided once at startup:

- **Host mode** — launched by the extension. `getInjectedData()` finds real
  values in `window.__INITIAL_DATA__`, so `HOST_MODE` is `true`: the audio is
  pre-loaded, the file menu / drag-and-drop are hidden, and the **Apply bar** is
  shown.
- **Standalone mode** — `npm run dev:ui` in plain Vite. The placeholders in
  `index.html` are still literal markers, so `getInjectedData()` returns `null`.
  The file menu, drag-and-drop, and the "Write to file" panel are active; the
  Apply bar is hidden. This is the UI-iteration harness.

### The DSP: paulstretch as WebAssembly

The actual time-stretching is `@olilarkin/paulstretch-wasm`, an
Emscripten-compiled WebAssembly build of
[**libpaulstretch**](https://github.com/olilarkin/libpaulstretch) — a modern
C++ rewrite of Nasca Octavian Paul's original
[paulstretch](https://hypermammut.sourceforge.net/paulstretch/) algorithm. The
compiled module is vendored in-tree at `src/dialog/vendor/paulstretch-wasm/`,
and its TypeScript surface (`paulstretch.d.ts`) exposes three of libpaulstretch's
C++ classes through WASM:

- **`StreamingStretcher`** — incremental, block-at-a-time stretching for live
  preview.
- **`OfflineRenderer`** — one-shot, whole-buffer stretching for the final
  high-quality render.
- **`BinauralBeatsProcessor`** — the optional binaural-beats post-effect.

Both stretchers take the same core parameters (stretch factor, FFT/window size,
window type, onset sensitivity) plus a large bag of `ProcessOptions` (pitch
shift, octave mixing, frequency shift, harmonics, filtering, spread, tonal-noise
preservation, …). The UI's slider values are mapped to these via
`state/mappings.ts`.

### Two audio paths

The dialog deliberately has **two separate DSP paths**, because previewing and
final rendering have opposite priorities (latency vs quality):

**1. Streaming preview** (`audio/streaming/`) — what you hear when you press
Play. The goal is that parameter tweaks are audible almost immediately, so it's
built as a real-time producer/consumer pipeline:

```
Worker (stream-worker.ts)            AudioWorklet (stream-worklet.ts)
  runs StreamingStretcher (WASM)       'paulstretch-processor'
  = producer                           = consumer
        │                                     │
        │  writes stretched frames            │ reads frames
        ▼                                     ▼
        └──────►  SharedArrayBuffer ring  ◄───┘
                  (ring-buffer.ts, ~2 s, 2ch)
                                              │
                                              ▼
                                      GainNode ──► AudioContext.destination
                                   (instant mute on pause/stop,
                                    independent of ring drain)
```

`StreamingEngine` (`engine.ts`) owns this: it spins up the worker and the
worklet, shares one `SharedArrayBuffer` ring between them, and forwards
parameter changes to the worker's hot setters. Because it uses
`SharedArrayBuffer` + `AudioWorklet`, **the page must be cross-origin isolated** —
`StreamingEngine.create()` throws if `crossOriginIsolated` is false. The
`GainNode` after the worklet exists so pause/stop can mute instantly with a 10 ms
ramp without waiting for the ~2 s ring to drain.

**2. Offline render** (`audio/render/`) — what produces the actual output on
Apply or "Write to file". `runRender()` posts the source audio to a persistent
`render-worker.ts`, which runs `OfflineRenderer` over the whole buffer in one
go, then `wav.ts`'s `encodeWavPcm16` turns the result into a 16-bit WAV `Blob`.
The worker is kept warm across renders because compiling the WASM module is the
slow part.

## Audio flow on Apply

Putting the two halves together, here is the full round-trip when the user hits
**Apply**:

1. **Host:** `context.resources.renderPreFxAudio(track, start, end)` → temp WAV
   path; read the bytes and base64-encode them.
2. **Host:** reserve an output path + upload token, then inject the base64 audio
   + metadata into the **in-memory** `index.html` via its `window.__INITIAL_DATA__`
   placeholders (`__AUDIO_BASE64__`, `__SAMPLE_RATE__`, `__UPLOAD_URL__`, …).
   Nothing is written to a temp HTML file.
3. **Host:** `context.ui.showModalDialog("http://127.0.0.1:<port>/", …)` →
   blocks until the dialog closes.
4. **Dialog:** read `window.__INITIAL_DATA__` → `AudioContext.decodeAudioData()`
   → feed the streaming engine for live preview.
5. **Dialog (Apply):** `OfflineRenderer` in the render-worker → `encodeWavPcm16`
   → WAV `Blob`, `POST`ed to `/result/<token>`, which the host streams directly
   to the reserved path (avoids shuttling a multi-hundred-MB base64 blob through
   the IPC bridge).
6. **Dialog:** `closeWithResult({ sampleRate })` → `close_and_send` resolves the
   host's `showModalDialog` promise. The result carries only the sample rate; the
   audio already arrived via the upload.
7. **Host:** `importIntoProject(outWavPath)` (falls back to using the temp path
   directly if Live rejects it) → `clearClipsInRange` + `createAudioClip`, all
   inside a `context.ui.withinProgressDialog(...)`.

## Why a localhost server

The dialog is served to Live's WebView over a short-lived **localhost HTTP
server** (`startDialogServer` in `src/extension.ts`), not `file://`, for two
reasons:

- **The WebView blocks ES modules and `AudioWorklet` from `file://` origins.**
  The Vite-built dialog is ES modules, and the preview pipeline needs an
  AudioWorklet, so it has to come from an `http://` origin.
- **`SharedArrayBuffer` requires cross-origin isolation.** The server sends
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (plus CORP) so the ring buffer
  shared between worker and worklet is allowed.

The same server does double duty:

- **`GET /…`** serves the static Vite-built dialog tree (`dist/dialog/`), except
  `index.html`, which is served from memory with the per-session data injected.
- **`POST /result/<token>`** receives the rendered WAV and streams it straight to
  the host's reserved temp path — the token is a single-use, random secret so the
  upload endpoint can't be hit blindly.
- **`POST /log`** bridges the dialog's `console.*` into the host's
  `ExtensionHost.txt`. There are no devtools inside Live's WebView, so without
  this any error in the dialog would be invisible.

## File map

| Path | Role |
|---|---|
| `src/extension.ts` | Host: context menu, render, localhost server, import |
| `src/dialog/src/App.tsx` | Dialog shell; host-mode detection; engine boot |
| `src/dialog/src/state/` | Zustand store + slider→DSP parameter mappings |
| `src/dialog/src/audio/loadInjected.ts` | Decodes the audio the host injected |
| `src/dialog/src/audio/streaming/` | SAB-driven preview (worker ↔ AudioWorklet) |
| `src/dialog/src/audio/render/` | Offline `OfflineRenderer` + WAV encoder |
| `src/dialog/src/ipc.ts` | `close_and_send` bridge dialog → host |
| `src/dialog/src/components/ApplyBar.tsx` | Apply / Cancel (host mode only) |
| `src/dialog/vendor/paulstretch-wasm/` | Vendored Emscripten DSP module |
