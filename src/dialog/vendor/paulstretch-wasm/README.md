# @olilarkin/paulstretch-wasm

[Paulstretch](https://github.com/paulnasca/paulstretch_cpp) extreme time-stretching, compiled to WebAssembly. Works in Node, modern browsers, and Web Workers.

Includes an offline renderer, a realtime streaming primitive, optional spectral processing (pitch shift, octave mixer, frequency shift, compressor, filter, harmonics, spread, tonal-noise preservation, arbitrary filter), and a binaural-beats post-processor.

## Install

This package is published to [GitHub Packages](https://github.com/olilarkin/libpaulstretch/pkgs/npm/paulstretch-wasm). Consumers need to authenticate to GitHub, even for read access while the repo is private.

1. Create a [personal access token (classic)](https://github.com/settings/tokens/new) with the `read:packages` scope.
2. Add this to your project's `.npmrc` (or `~/.npmrc` for global use):

   ```ini
   @olilarkin:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
   ```

3. Export the token in your environment, then install:

   ```bash
   export GITHUB_TOKEN=ghp_xxx
   npm install @olilarkin/paulstretch-wasm
   ```

## Offline rendering

```js
import PaulstretchModule from '@olilarkin/paulstretch-wasm';

const Module = await PaulstretchModule();

const stretch = 8;
const fftSize = 4096;
const sampleRate = 44100;
const renderer = new Module.OfflineRenderer(
  stretch,
  fftSize,
  sampleRate,
  Module.Window.Hann,
  0, // onset detection sensitivity, 0..1
);

const input = new Float32Array(/* your audio, [-1, 1] floats */);
const output = renderer.renderMono(input);

// Always free embind objects — they don't get GC'd automatically.
renderer.delete();
```

### Stereo

```js
const { left, right } = renderer.renderStereo(leftIn, rightIn);
```

### Very long outputs (chunked rendering)

`renderMono` returns the whole result in one `Float32Array`, which has to live in
WebAssembly memory twice over (the internal buffer plus the returned copy). A large
stretch — e.g. a few seconds stretched several hundred times into an hour-plus of
audio — can exceed the WASM heap and abort. For those cases use `renderMonoChunked`
(or `renderStereoChunked`): same algorithm, but the output is delivered one chunk at
a time so peak WASM memory stays bounded regardless of length. Accumulate the chunks
on the JS heap, or stream them straight to disk / an encoder.

```js
const chunks = [];
const totalFrames = renderer.renderMonoChunked(input, (chunk) => {
  // `chunk` is a fresh Float32Array you may keep (~fftSize frames).
  chunks.push(chunk);
});

// Stereo: callback receives (left, right) per chunk.
// const totalFrames = renderer.renderStereoChunked(leftIn, rightIn, (l, r) => { ... });

renderer.delete();
```

### Time-varying stretch (breakpoint envelope)

Positions are normalized `0..1` over the input. Values multiply the `stretch` you passed to the constructor.

```js
renderer.setStretchEnvelope(
  new Float32Array([0.0, 0.5, 1.0]),
  new Float32Array([1.0, 4.0, 1.0]), // 1× → 4× → 1× over the input
);
const out = renderer.renderMono(input);
```

## Realtime streaming

`StreamingStretcher` is a block-based push/pull primitive designed for AudioWorklets or Web Workers driving an audio thread via a ring buffer. The host gathers exactly the number of input frames the stretcher asks for, calls `step()` to produce one output chunk of `bufsize()` frames, then advances its input cursor by an additional `skipAfterStep()` frames:

```js
const s = new Module.StreamingStretcher(8, 4096, 44100, Module.Window.Hann, 0);

// First call returns maxInputChunk() (= 3 * bufsize) for the initial fill.
// Subsequent calls return either 0 or bufsize() depending on stretch factor
// and onset detection.
while (running) {
  const want = s.nextInputSize();
  const input = readFrames(want); // Float32Array; zero-pad if source ran out
  const positionPct = 100 * cursor / totalInputFrames; // for envelope
  const { output, onset } = s.step(input, positionPct);
  writeFrames(output);
  cursor += want + s.skipAfterStep();
}
s.delete();
```

`setStretchFactor(newRatio)` hot-swaps the base stretch without resetting DSP state. `reset()` clears state for seek/loop while preserving configuration.

### Multichannel onset coordination

To keep two streaming stretchers (one per channel) phase-aligned, use `stepWithoutOnsetFeedback()` on each, take the max of the returned onsets, then call `applyOnset(maxOnset)` on each before the next iteration.

## Spectral processing

`setProcessOptions` accepts a plain JS object with camelCase keys; unspecified fields keep their defaults:

```js
renderer.setProcessOptions({
  pitchShiftEnabled: true,
  pitchShiftCents: 700,        // up a perfect fifth

  filterEnabled: true,
  filterLowHz: 200,
  filterHighHz: 4000,

  harmonicsEnabled: true,
  harmonicsFrequencyHz: 110,
  harmonicsCount: 8,
});
```

Available effects (each gated by a `*Enabled` flag): pitch shift, octave mixer (`octaveMinus2`/`Minus1`/`0`/`Plus1`/`Plus15`/`Plus2`), frequency shift, compressor, bandpass/notch filter, harmonics generator, stereo spread, tonal-noise preservation, and an arbitrary breakpoint-shaped filter (`setArbitraryFilter(positions, values)` + `arbitraryFilterEnabled`). See `index.d.ts` for the full `ProcessOptions` shape.

Process options apply to both `OfflineRenderer` and `StreamingStretcher`.

## Binaural beats

Post-process stretched stereo output to add a sub-audio beat between L/R channels:

```js
const bb = new Module.BinauralBeatsProcessor(44100);
bb.setOptions({
  enabled: true,
  stereoMode: Module.BinauralStereoMode.LeftRight,
  mono: 0.5,             // mix toward mono before applying the beat
  beatFrequencyHz: 8,    // alpha range
});
const { left, right } = bb.process(leftIn, rightIn, positionPct);
bb.delete();
```

The beat frequency can be automated with `setFrequencyEnvelope(positions, values)`.

## Browser bundlers

When bundling with Vite/Webpack/esbuild, the runtime may need help finding `paulstretch.wasm`:

```js
import wasmUrl from '@olilarkin/paulstretch-wasm/paulstretch.wasm?url';
import PaulstretchModule from '@olilarkin/paulstretch-wasm';

const Module = await PaulstretchModule({
  locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path),
});
```

## Building from source

```bash
emcmake cmake -S . -B build-wasm
cmake --build build-wasm
# outputs land in npm/dist/
cd npm && npm pack
```

## License

GPL-2.0 — same as the upstream Paulstretch algorithm.
