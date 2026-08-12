import { describe, expect, it } from 'vitest';
import { extractStackFrames } from '../src/stack-frames.js';

const STACK = `TypeError: boom
    at render (https://cdn.example.com/assets/app.8f3a1.js:12:34)
    at https://cdn.example.com/assets/app.8f3a1.js:40:7
    at async load (https://cdn.example.com/assets/vendor.js:3:9)
    at Array.forEach (<anonymous>:1:1)`;

describe('extractStackFrames', () => {
  it('parses frames with and without function names and async prefixes', () => {
    const frames = extractStackFrames(STACK);
    expect(frames.map((f) => f.file)).toEqual([
      'https://cdn.example.com/assets/app.8f3a1.js',
      'https://cdn.example.com/assets/app.8f3a1.js',
      'https://cdn.example.com/assets/vendor.js',
      '<anonymous>',
    ]);
    expect(frames[0]).toMatchObject({ line: 12, column: 34, functionName: 'render' });
    expect(frames[1]).toMatchObject({ line: 40, column: 7, functionName: null });
    expect(frames[2]).toMatchObject({ functionName: 'load' }); // "async " stripped
    expect(frames[3]).toMatchObject({ file: '<anonymous>', functionName: 'Array.forEach' });
  });

  it('skips non-frame lines and returns [] for garbage', () => {
    expect(extractStackFrames('Error: x\n  not a frame\n  at alone')).toHaveLength(0);
    expect(extractStackFrames('')).toHaveLength(0);
  });
});
