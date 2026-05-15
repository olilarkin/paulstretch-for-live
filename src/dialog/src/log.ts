// Bridges WebView console output + uncaught errors back to the extension host
// over the loopback HTTP server, so they land in `ExtensionHost.txt`. Live's
// embedded WebView (WebKit on macOS, WebView2 on Windows) doesn't expose any
// devtools, so without this bridge there is no way to see *why* the dialog
// is stuck — only that it's stuck. Import this module *first* in main.tsx so
// failures during React mount itself are captured.

import { getLogUrl } from './audio/loadInjected';

const LOG_URL = getLogUrl();

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function post(level: string, parts: unknown[]): void {
  if (!LOG_URL) return;
  const payload = JSON.stringify({
    level,
    parts: parts.map(safeStringify),
  });
  try {
    fetch(LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => { /* swallow — logger must never throw */ });
  } catch {
    /* swallow */
  }
}

function installConsoleBridge(): void {
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug?.bind(console) ?? console.log.bind(console),
  };
  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
    console[level] = ((...args: unknown[]) => {
      orig[level](...(args as []));
      post(level, args);
    }) as Console[typeof level];
  });
}

function installErrorHandlers(): void {
  window.addEventListener('error', (ev) => {
    const details = ev.error instanceof Error
      ? `${ev.error.name}: ${ev.error.message}\n${ev.error.stack ?? ''}`
      : ev.message;
    post('error', [`window.onerror at ${ev.filename}:${ev.lineno}:${ev.colno} — ${details}`]);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    post('error', [`unhandledrejection — ${safeStringify(ev.reason)}`]);
  });
}

function logEnvironment(): void {
  // Useful one-shot context dump so we know what we're dealing with on the
  // remote machine. SAB / crossOriginIsolated tell us whether the engine's
  // AudioWorklet path is even viable.
  post('info', [
    'dialog boot:',
    `ua=${navigator.userAgent}`,
    `crossOriginIsolated=${(self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false}`,
    `SharedArrayBuffer=${typeof (globalThis as unknown as { SharedArrayBuffer?: unknown }).SharedArrayBuffer !== 'undefined'}`,
    `AudioWorklet=${typeof AudioWorkletNode !== 'undefined'}`,
  ]);
}

if (LOG_URL) {
  installConsoleBridge();
  installErrorHandlers();
  logEnvironment();
}
