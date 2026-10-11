import type { DrawTarget } from './draw.ts';

/**
 * A software `DrawTarget` over an RGBA pixel buffer.
 *
 * This is what lets the project review its own art without a browser: `tools/render-preview.ts`
 * feeds the exact same scene-drawing code through this target and writes PNGs. It is also used
 * by the unit tests to assert that rendering does not touch out-of-board pixels.
 *
 * Supports the subset the game uses: axis-aligned rectangles, convex polygons, rectangular
 * clipping, translation and alpha multiplication. Colours are `#rgb`, `#rrggbb`, `rgb()` and
 * `rgba()`.
 */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export class RasterDrawTarget implements DrawTarget {
  readonly image: RasterImage;
  private readonly stack: Array<{ clip: Rect; alpha: number; tx: number; ty: number }> = [];
  private clip: Rect;
  private alphaValue = 1;
  private tx = 0;
  private ty = 0;

  constructor(width: number, height: number, background?: string) {
    const data = new Uint8ClampedArray(Math.max(1, width * height * 4));
    this.image = { width, height, data };
    if (background) {
      this.clip = { x0: 0, y0: 0, x1: width, y1: height };
      this.fillRect(0, 0, width, height, background);
    }
    this.clip = { x0: 0, y0: 0, x1: width, y1: height };
  }

  save(): void {
    this.stack.push({ clip: this.clip, alpha: this.alphaValue, tx: this.tx, ty: this.ty });
  }

  restore(): void {
    const state = this.stack.pop();
    if (!state) return;
    this.clip = state.clip;
    this.alphaValue = state.alpha;
    this.tx = state.tx;
    this.ty = state.ty;
  }

  translate(x: number, y: number): void {
    this.tx += x;
    this.ty += y;
  }

  alpha(value: number): void {
    this.alphaValue = clamp01(this.alphaValue * value);
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    if (w <= 0 || h <= 0) return;
    const rgba = parseColor(color);
    if (!rgba) return;
    const rect: Rect = {
      x0: x + this.tx,
      y0: y + this.ty,
      x1: x + this.tx + w,
      y1: y + this.ty + h,
    };
    const blend = rgba[3] * this.alphaValue;
    if (blend <= 0) return;
    const from = { x0: Math.max(this.clip.x0, Math.floor(rect.x0)), y0: Math.max(this.clip.y0, Math.floor(rect.y0)) };
    const to = { x1: Math.min(this.clip.x1, Math.ceil(rect.x1)), y1: Math.min(this.clip.y1, Math.ceil(rect.y1)) };
    for (let py = from.y0; py < to.y1; py++) {
      for (let px = from.x0; px < to.x1; px++) {
        this.blendPixel(px, py, rgba, blend);
      }
    }
  }

  fillPolygon(points: readonly number[], color: string): void {
    if (points.length < 6) return;
    const rgba = parseColor(color);
    if (!rgba) return;
    const blend = rgba[3] * this.alphaValue;
    if (blend <= 0) return;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < points.length; i += 2) {
      xs.push((points[i] as number) + this.tx);
      ys.push((points[i + 1] as number) + this.ty);
    }
    const count = xs.length;
    const minY = Math.max(this.clip.y0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.clip.y1, Math.ceil(Math.max(...ys)));
    const minX = Math.max(this.clip.x0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(this.clip.x1, Math.ceil(Math.max(...xs)));
    const crossings: number[] = [];
    for (let py = minY; py < maxY; py++) {
      const sample = py + 0.5;
      crossings.length = 0;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const y0 = ys[i] as number;
        const y1 = ys[j] as number;
        if (y0 === y1) continue;
        const low = Math.min(y0, y1);
        const high = Math.max(y0, y1);
        // Half-open rule keeps shared edges from being drawn twice.
        if (sample < low || sample >= high) continue;
        const t = (sample - y0) / (y1 - y0);
        crossings.push((xs[i] as number) + t * ((xs[j] as number) - (xs[i] as number)));
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);
      for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
        const spanStart = Math.max(minX, Math.ceil((crossings[pair] as number) - 0.5));
        const spanEnd = Math.min(maxX, Math.floor((crossings[pair + 1] as number) - 0.5) + 1);
        for (let px = spanStart; px < spanEnd; px++) {
          this.blendPixel(px, py, rgba, blend);
        }
      }
    }
  }

  clipRect(x: number, y: number, w: number, h: number): void {
    const next: Rect = {
      x0: Math.max(this.clip.x0, Math.floor(x + this.tx)),
      y0: Math.max(this.clip.y0, Math.floor(y + this.ty)),
      x1: Math.min(this.clip.x1, Math.ceil(x + this.tx + w)),
      y1: Math.min(this.clip.y1, Math.ceil(y + this.ty + h)),
    };
    this.clip = next.x1 > next.x0 && next.y1 > next.y0 ? next : { x0: 0, y0: 0, x1: 0, y1: 0 };
  }

  /** Reads a pixel as [r, g, b, a]; used by tests and the PNG encoder. */
  pixelAt(x: number, y: number): [number, number, number, number] {
    const offset = (y * this.image.width + x) * 4;
    const data = this.image.data;
    return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0];
  }

  private blendPixel(x: number, y: number, color: readonly number[], alpha: number): void {
    if (x < this.clip.x0 || x >= this.clip.x1 || y < this.clip.y0 || y >= this.clip.y1) return;
    if (x < 0 || y < 0 || x >= this.image.width || y >= this.image.height) return;
    const offset = (y * this.image.width + x) * 4;
    const data = this.image.data;
    const dstA = (data[offset + 3] ?? 0) / 255;
    const outA = alpha + dstA * (1 - alpha);
    if (outA <= 0) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
      return;
    }
    const src = color;
    for (let channel = 0; channel < 3; channel++) {
      const srcC = (src[channel] as number) / 255;
      const dstC = (data[offset + channel] as number) / 255;
      const outC = (srcC * alpha + dstC * dstA * (1 - alpha)) / outA;
      data[offset + channel] = Math.round(clamp01(outC) * 255);
    }
    data[offset + 3] = Math.round(clamp01(outA) * 255);
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Parses `#rgb`, `#rrggbb`, `rgb(r,g,b)` and `rgba(r,g,b,a)` into [r, g, b, a 0..1]. */
export function parseColor(color: string): [number, number, number, number] | null {
  const value = color.trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex[0] as string, 16);
      const g = Number.parseInt(hex[1] as string, 16);
      const b = Number.parseInt(hex[2] as string, 16);
      const a = hex.length === 4 ? Number.parseInt(hex[3] as string, 16) / 15 : 1;
      return [r * 17, g * 17, b * 17, a];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [r, g, b, a];
    }
    return null;
  }
  const match = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (!match) return null;
  const parts = (match[1] as string).split(/[,\s/]+/).filter((part) => part.length > 0);
  if (parts.length < 3) return null;
  const r = parseChannel(parts[0] as string);
  const g = parseChannel(parts[1] as string);
  const b = parseChannel(parts[2] as string);
  const a = parts.length >= 4 ? Number.parseFloat(parts[3] as string) : 1;
  if (r === null || g === null || b === null || Number.isNaN(a)) return null;
  return [r, g, b, clamp01(a)];
}

function parseChannel(value: string): number | null {
  if (value.endsWith('%')) {
    const percent = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(percent) ? clamp01(percent / 100) * 255 : null;
  }
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? clamp01(number / 255) * 255 : null;
}

/** Encodes an RGBA image as a PNG: two filters, then one zlib stream. Node-only callers. */
export function encodePng(image: RasterImage, deflate: (data: Uint8Array) => Uint8Array): Uint8Array {
  const { width, height, data } = image;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const idat = deflate(raw);
  const chunks: Uint8Array[] = [signature()];
  chunks.push(chunk('IHDR', ihdr(width, height)));
  chunks.push(chunk('IDAT', idat));
  chunks.push(chunk('IEND', new Uint8Array(0)));
  return concat(chunks);
}

function signature(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function ihdr(width: number, height: number): Uint8Array {
  const out = new Uint8Array(13);
  const view = new DataView(out.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  out[8] = 8;
  out[9] = 6;
  out[10] = 0;
  out[11] = 0;
  out[12] = 0;
  return out;
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)));
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC_TABLE[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
