import { describe, it, expect } from 'vitest';
import { describeWasmError } from './wasmError';

describe('describeWasmError', () => {
  it('maps Emscripten abort to an out-of-memory hint', () => {
    const err = new WebAssembly.RuntimeError('Aborted(). Build with -sASSERTIONS for more info.');
    expect(describeWasmError(err)).toMatch(/too large to render/i);
  });

  it('maps an empty-message RuntimeError to the OOM hint', () => {
    expect(describeWasmError(new WebAssembly.RuntimeError(''))).toMatch(/too large to render/i);
  });

  it('maps explicit OOM / memory-growth failures', () => {
    expect(describeWasmError(new Error('Cannot enlarge memory arrays'))).toMatch(/too large/i);
    expect(describeWasmError(new Error('out of memory'))).toMatch(/too large/i);
    expect(describeWasmError(new RangeError('Array buffer allocation failed'))).toMatch(/too large/i);
  });

  it('maps a WASM compile failure (issue #6) to a load-error hint', () => {
    const err = new WebAssembly.CompileError(
      "WebAssembly.Module doesn't parse at byte 7: can't get function local's type in group 2",
    );
    expect(describeWasmError(err)).toMatch(/failed to compile/i);
  });

  it('passes ordinary errors through unchanged', () => {
    expect(describeWasmError(new Error('upload failed: 500'))).toBe('upload failed: 500');
    expect(describeWasmError('plain string')).toBe('plain string');
  });
});
