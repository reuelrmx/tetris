import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The engine must stay independent of the DOM, Canvas, storage and network APIs: it is a pure
 * state machine that hosts drive. This test reads the engine sources and fails if any of those
 * APIs appear *in code* (comments are stripped first, because prose may legitimately mention
 * e.g. `requestAnimationFrame` when explaining how a host should drive the update loop).
 */
const ENGINE_DIR = fileURLToPath(new URL('../../src/engine', import.meta.url));

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bdocument\b/, reason: 'DOM access' },
  { pattern: /\bwindow\b/, reason: 'browser global' },
  { pattern: /\bnavigator\b/, reason: 'browser global' },
  { pattern: /\blocalStorage\b/, reason: 'storage' },
  { pattern: /\bsessionStorage\b/, reason: 'storage' },
  { pattern: /\bindexedDB\b/, reason: 'storage' },
  { pattern: /\bCanvasRenderingContext2D\b/, reason: 'canvas' },
  { pattern: /\bHTMLCanvasElement\b/, reason: 'canvas' },
  { pattern: /\bHTMLElement\b/, reason: 'DOM' },
  { pattern: /\brequestAnimationFrame\b/, reason: 'browser timing' },
  { pattern: /\bWebSocket\b/, reason: 'networking' },
  { pattern: /\bfetch\s*\(/, reason: 'networking' },
  { pattern: /\bAudioContext\b/, reason: 'audio' },
  { pattern: /\bMath\.random\b/, reason: 'non-deterministic randomness' },
];

/**
 * Removes line comments, block comments and the contents of string literals, so that the scan
 * sees only executable code. String contents are blanked rather than dropped to keep offsets sane.
 */
export function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const char = source[i] as string;
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      out += `${quote}${quote}`;
      continue;
    }
    out += char;
    i++;
  }
  return out;
}

function engineSources(): Array<{ file: string; code: string; raw: string }> {
  return readdirSync(ENGINE_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => {
      const raw = readFileSync(join(ENGINE_DIR, name), 'utf8');
      return { file: name, code: stripCommentsAndStrings(raw), raw };
    });
}

describe('engine boundary', () => {
  it('contains no references to browser-only APIs in executable code', () => {
    const offences: string[] = [];
    for (const { file, code } of engineSources()) {
      for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
        if (pattern.test(code)) offences.push(`${file}: ${reason} (${String(pattern)})`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('imports nothing from the DOM-facing layers', () => {
    const offences: string[] = [];
    for (const { file, raw } of engineSources()) {
      for (const match of raw.matchAll(/from\s+'([^']+)'/g)) {
        const target = match[1] ?? '';
        if (target.startsWith('..') && !target.includes('engine')) offences.push(`${file} -> ${target}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('covers every engine module', () => {
    const files = engineSources().map((entry) => entry.file).sort();
    expect(files).toContain('game.ts');
    expect(files).toContain('scoring.ts');
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('strips comments but keeps code, so the scan cannot be fooled', () => {
    const sample = `
      // window is mentioned in a comment
      /* document too */
      const label = 'window'; // and a string
      const real = requestAnimationFrame(() => {});
    `;
    const stripped = stripCommentsAndStrings(sample);
    expect(stripped).not.toContain('//');
    expect(stripped).not.toContain('document too');
    expect(stripped).toContain('requestAnimationFrame');
    expect(stripped).not.toContain("'window'");
  });
});
