import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import * as crypto from "crypto";
import { AddressInfo } from "net";
import {
  initialize,
  type ArrangementSelection,
  DataModelObject,
  AudioTrack,
  type ActivationContext,
} from "@ableton-extensions/sdk";

interface DialogResult {
  sampleRate: number;
}

// Lazily resolved once — the dialog tree sits alongside dist/extension.js in
// the installed .ablx, so __dirname/dialog/index.html is stable.
let _dialogTemplate: string | null = null;
function getDialogTemplate(): { html: string; dir: string } {
  const dir = path.join(__dirname, "dialog");
  if (_dialogTemplate === null) {
    _dialogTemplate = fsSync.readFileSync(
      path.join(dir, "index.html"),
      "utf-8",
    );
  }
  return { html: _dialogTemplate, dir };
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
};

interface ResultSink {
  token: string;
  outPath: string;
}

interface DialogServer {
  url: string;
  uploadUrl: string;
  logUrl: string;
  setIndexHtml: (html: string) => void;
  close: () => Promise<void>;
}

// Bridge from the WebView dialog → Node console.* → ExtensionHost.txt.
// Edge WebView2 / WebKit don't expose devtools inside Live, so without this
// bridge any error in the dialog is effectively invisible.
function logFromDialog(level: string, parts: string[]): void {
  const msg = `[dialog ${level}] ${parts.join(" ")}`;
  if (level === "error") console.error(msg);
  else if (level === "warn") console.warn(msg);
  else console.log(msg);
}

// Tiny localhost HTTP server that serves the Vite-built dialog tree with the
// COOP/COEP headers SharedArrayBuffer requires. Ableton's webview blocks ES
// modules and AudioWorklet from file:// origins, so we serve over http://
// instead. The same server also accepts a single POST to
// `/result/<token>` that streams the rendered WAV directly to disk — this
// avoids shuttling a multi-hundred-MB base64 blob through the host IPC
// bridge when the dialog finishes rendering.
function startDialogServer(
  dialogDir: string,
  sink: ResultSink,
): Promise<DialogServer> {
  return new Promise((resolve, reject) => {
    let resultConsumed = false;
    let indexHtml = "";
    const server = http.createServer(async (req, res) => {
      // SharedArrayBuffer / AudioWorklet need cross-origin isolation.
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      // Don't cache; each dialog session has a fresh injected index.html.
      res.setHeader("Cache-Control", "no-store");

      const rawPath = (req.url || "/").split("?")[0];

      if (req.method === "POST" && rawPath === "/log") {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c as Buffer));
        req.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString("utf-8");
            const payload = JSON.parse(body) as { level?: string; parts?: unknown[] };
            const level = typeof payload.level === "string" ? payload.level : "log";
            const parts = Array.isArray(payload.parts)
              ? payload.parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
              : [];
            logFromDialog(level, parts);
          } catch (e) {
            console.warn("[paulstretch] malformed /log payload:", e);
          }
          res.writeHead(204);
          res.end();
        });
        req.on("error", () => {
          res.writeHead(400);
          res.end();
        });
        return;
      }

      if (req.method === "POST" && rawPath === `/result/${sink.token}`) {
        if (resultConsumed) {
          res.writeHead(409);
          res.end("already consumed");
          return;
        }
        resultConsumed = true;
        const ws = fsSync.createWriteStream(sink.outPath);
        const cleanup = (err: Error) => {
          ws.destroy();
          void safeUnlink(sink.outPath);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end(String(err.message ?? err));
          }
        };
        req.on("error", cleanup);
        ws.on("error", cleanup);
        ws.on("finish", () => {
          res.writeHead(204);
          res.end();
        });
        req.pipe(ws);
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end("method not allowed");
        return;
      }

      if (rawPath === "/" || rawPath === "/index.html") {
        res.setHeader("Content-Type", MIME_TYPES[".html"]);
        res.end(indexHtml);
        return;
      }
      // Reject anything that escapes the dialog tree.
      const normalized = path
        .normalize(decodeURIComponent(rawPath))
        .replace(/^[\\/]+/, "");
      const filePath = path.join(dialogDir, normalized);
      if (!filePath.startsWith(dialogDir + path.sep) && filePath !== dialogDir) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      try {
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        reject(new Error("failed to bind dialog server"));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}/`;
      resolve({
        url,
        uploadUrl: `${url}result/${sink.token}`,
        logUrl: `${url}log`,
        setIndexHtml: (html: string) => {
          indexHtml = html;
        },
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

async function showErrorDialog(
  context: ReturnType<typeof initialize>,
  message: string,
): Promise<void> {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background: #c0c0c0;
  color: #000;
  display: flex; align-items: center; justify-content: center;
  height: 100vh; margin: 0; padding: 20px; box-sizing: border-box;
}
.card { max-width: 460px; text-align: center; }
h1 { font-size: 18px; margin: 0 0 10px; }
p { font-size: 14px; margin: 0; line-height: 1.4; }
</style>
</head>
<body>
  <div class="card">
    <h1>Paulstretch For Live</h1>
    <p>${message.replace(/</g, "&lt;")}</p>
  </div>
</body>
</html>`;
  await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(html)}`,
    440,
    170,
  );
}

function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand(
    "paulstretch.process",
    async (arg: unknown) => {
      try {
        const selection = arg as ArrangementSelection;
        const tracks = selection.selected_lanes
          .map((handle) =>
            context.getObjectFromHandle(handle, DataModelObject),
          )
          .filter(
            (obj): obj is AudioTrack<"1.0.0"> => obj instanceof AudioTrack,
          );

        if (tracks.length !== 1) {
          await showErrorDialog(
            context,
            tracks.length === 0
              ? "Select exactly one audio track and a time range in Arrangement."
              : "Select exactly one audio track. Multi-track selections are not supported.",
          );
          return;
        }

        const track = tracks[0]!;
        const selectionStart = selection.time_selection_start;
        const selectionEnd = selection.time_selection_end;

        if (!(selectionEnd > selectionStart)) {
          await showErrorDialog(context, "Please select a non-empty time range.");
          return;
        }

        const tempDir = context.environment.tempDirectory ?? os.tmpdir();

        console.log(`[paulstretch] activate: track="${track.name}" `
          + `range=${selectionStart.toFixed(3)}..${selectionEnd.toFixed(3)} `
          + `platform=${process.platform} node=${process.version}`);

        // 1. Render source audio.
        const inWavPath = stripWin32ExtPrefix(
          await context.resources.renderPreFxAudio(
            track,
            selectionStart,
            selectionEnd,
          ),
        );
        const inWavBytes = await fs.readFile(inWavPath);
        const sampleRate = sniffWavSampleRate(inWavBytes) ?? 44100;
        const wavMeta = sniffWavMeta(inWavBytes);
        const durationSec = selectionEnd - selectionStart;
        const audioBase64 = inWavBytes.toString("base64");
        console.log(`[paulstretch] rendered WAV path=${inWavPath} `
          + `bytes=${inWavBytes.length} sampleRate=${sampleRate} `
          + `fmt=${wavMeta?.format ?? "?"} channels=${wavMeta?.channels ?? "?"} `
          + `bitsPerSample=${wavMeta?.bitsPerSample ?? "?"} `
          + `durationSec=${durationSec.toFixed(3)}`);

        // 2. Reserve the output path and an upload token. The dialog streams
        //    its rendered WAV straight to this path via the loopback server
        //    instead of shuttling a base64 blob through the host IPC bridge.
        const outWavPath = path.join(
          tempDir,
          `paulstretch_${process.pid}_${Date.now()}.wav`,
        );
        const uploadToken = crypto.randomBytes(16).toString("hex");

        // 3. Patch the index.html template with the per-invocation data.
        const { html: template, dir: dialogDir } = getDialogTemplate();
        const selectionLabel = `${track.name} [${selectionStart.toFixed(2)} – ${selectionEnd.toFixed(2)}]`;
        const inject = (hay: string, needle: string, value: string) =>
          hay.replace(needle, () => value);

        // jsonEsc: produces a JS string literal safe to drop into an inline
        // <script>. `JSON.stringify` doesn't escape `</script>` or U+2028/2029
        // line separators, so we patch those manually.
        const jsonEsc = (s: string) =>
          JSON.stringify(s)
            .replace(/<\//g, "<\\/")
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029");

        let html = template;
        html = inject(html, '"__AUDIO_BASE64__"', jsonEsc(audioBase64));
        html = inject(html, "__SAMPLE_RATE__", String(sampleRate));
        html = inject(html, '"__CLIP_NAME__"', jsonEsc(selectionLabel));
        html = inject(html, "__DURATION_SEC__", durationSec.toFixed(6));

        // 4. Serve the dialog over http://localhost so the webview accepts
        //    ES modules, workers, AudioWorklet, and SharedArrayBuffer. The
        //    same server also accepts a single POST to upload the rendered
        //    WAV directly to `outWavPath`.
        const server = await startDialogServer(dialogDir, {
          token: uploadToken,
          outPath: outWavPath,
        });
        html = inject(html, '"__UPLOAD_URL__"', jsonEsc(server.uploadUrl));
        html = inject(html, '"__LOG_URL__"', jsonEsc(server.logUrl));
        server.setIndexHtml(html);
        console.log(`[paulstretch] dialog server up: ${server.url} `
          + `(POST /log → ExtensionHost.txt, POST /result/<token> → ${outWavPath})`);

        let resultJson: string;
        try {
          resultJson = await context.ui.showModalDialog(
            server.url,
            840,
            540,
          );
        } finally {
          await server.close();
        }

        if (!resultJson) {
          await safeUnlink(outWavPath);
          return; // user cancelled
        }
        let result: DialogResult;
        try {
          result = JSON.parse(resultJson) as DialogResult;
        } catch {
          await safeUnlink(outWavPath);
          await showErrorDialog(context, "Dialog returned malformed result.");
          return;
        }
        if (!result || typeof result.sampleRate !== "number") {
          await safeUnlink(outWavPath);
          return;
        }

        const wavStat = await fs.stat(outWavPath).catch(() => null);
        if (!wavStat || wavStat.size === 0) {
          await safeUnlink(outWavPath);
          await showErrorDialog(context, "Dialog reported success but no WAV was uploaded.");
          return;
        }
        console.log(`[paulstretch] wrote WAV: ${outWavPath} size=${wavStat.size} `
          + `sampleRate=${result.sampleRate}`);

        // Wrap each SDK call so we can attribute which one rejects (the SDK
        // sometimes rejects with literal `undefined`, which is otherwise
        // impossible to diagnose).
        const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
          console.log(`[paulstretch] step: ${label}`);
          try {
            return await fn();
          } catch (e) {
            const detail = e === undefined ? "<undefined>"
              : e instanceof Error ? `${e.message}\n${e.stack ?? ""}`
                : typeof e === "object" ? JSON.stringify(e)
                  : String(e);
            throw new Error(`step "${label}" failed: ${detail}`);
          }
        };

        await context.ui.withinProgressDialog(
          "Paulstretch: Importing…",
          {},
          async (update, signal) => {
            update("Importing rendered audio…", 50);
            // importIntoProject rejects with `undefined` for macOS symlinked
            // /tmp paths (Live-side path validation bug — see paulstretch
            // commit f4f1902). Fall back to passing the temp WAV directly to
            // createAudioClip and keep the file on disk for Live to read.
            let clipPath: string;
            let imported: boolean;
            try {
              clipPath = stripWin32ExtPrefix(
                await context.resources.importIntoProject(outWavPath),
              );
              imported = true;
              console.log(`[paulstretch] importIntoProject → ${clipPath}`);
            } catch (e) {
              console.warn(`[paulstretch] importIntoProject failed (${e}), using temp path directly`);
              clipPath = outWavPath;
              imported = false;
            }
            signal.throwIfAborted();
            update("Clearing clips…", 80);
            await step("clearClipsInRange", () =>
              track.clearClipsInRange(selectionStart, selectionEnd),
            );
            signal.throwIfAborted();
            update("Creating clip…", 95);
            await step("createAudioClip", () =>
              track.createAudioClip({
                filePath: clipPath,
                startTime: selectionStart,
                isWarped: false,
              }),
            );
            if (imported) await safeUnlink(outWavPath);
            update("Done!", 100);
          },
        );
      } catch (err) {
        console.error("[paulstretch] command failed:", err);
        const message = err instanceof Error
          ? `${err.message}\n${err.stack ?? ""}`
          : err === undefined
            ? "(unknown error — caught undefined)"
            : typeof err === "object"
              ? JSON.stringify(err, null, 2)
              : String(err);
        try {
          await showErrorDialog(context, message);
        } catch {
          /* ignore */
        }
      }
    },
  );

  context.ui.registerContextMenuAction(
    "AudioTrack.ArrangementSelection",
    "Stretch",
    "paulstretch.process",
  );
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    /* ignore */
  }
}

// Windows' SDK returns paths in extended-length form (`\\?\C:\...`). The
// Extension Host's FileSystemRead allow-list is matched as a literal string
// against the un-prefixed path, so fs.readFile on a `\\?\…` path fails with
// ERR_ACCESS_DENIED even though the file is one the sandbox produced for us.
// Strip the prefix on win32 before handing the path to any fs.* call.
function stripWin32ExtPrefix(p: string): string {
  if (process.platform !== "win32") return p;
  if (p.startsWith("\\\\?\\UNC\\")) return "\\\\" + p.slice(8);
  if (p.startsWith("\\\\?\\")) return p.slice(4);
  return p;
}

function sniffWavSampleRate(buf: Buffer): number | null {
  return sniffWavMeta(buf)?.sampleRate ?? null;
}

interface WavMeta {
  format: number;        // 1 = PCM, 3 = IEEE float, 0xFFFE = WAVE_FORMAT_EXTENSIBLE
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function sniffWavMeta(buf: Buffer): WavMeta | null {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 16) {
      const base = offset + 8;
      return {
        format: buf.readUInt16LE(base + 0),
        channels: buf.readUInt16LE(base + 2),
        sampleRate: buf.readUInt32LE(base + 4),
        bitsPerSample: buf.readUInt16LE(base + 14),
      };
    }
    offset += 8 + size + (size & 1);
  }
  return null;
}

module.exports = { activate };
