import type { DrawTarget } from './draw.ts';

/**
 * `DrawTarget` on top of a real Canvas 2D context.
 *
 * The adapter exists so every drawing routine is written against the same narrow interface the
 * headless preview renderer implements. All coordinates are CSS pixels: the caller sizes the
 * backing store with the device pixel ratio and applies a matching transform once per frame.
 */
export class CanvasDrawTarget implements DrawTarget {
  private readonly context: CanvasRenderingContext2D;
  private alphaStack: number[] = [1];

  constructor(context: CanvasRenderingContext2D) {
    this.context = context;
    this.context.globalAlpha = 1;
  }

  save(): void {
    this.context.save();
    this.alphaStack.push(this.currentAlpha);
  }

  restore(): void {
    this.context.restore();
    if (this.alphaStack.length > 1) this.alphaStack.pop();
    this.context.globalAlpha = this.currentAlpha;
  }

  translate(x: number, y: number): void {
    this.context.translate(x, y);
  }

  /** Multiplies the current alpha; nested calls compose, matching the rasterizer. */
  alpha(value: number): void {
    const next = clamp01(this.currentAlpha * value);
    this.alphaStack[this.alphaStack.length - 1] = next;
    this.context.globalAlpha = next;
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    if (w <= 0 || h <= 0) return;
    this.context.fillStyle = color;
    this.context.fillRect(x, y, w, h);
  }

  fillPolygon(points: readonly number[], color: string): void {
    if (points.length < 6) return;
    const ctx = this.context;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0] as number, points[1] as number);
    for (let i = 2; i < points.length; i += 2) {
      ctx.lineTo(points[i] as number, points[i + 1] as number);
    }
    ctx.closePath();
    ctx.fill();
  }

  clipRect(x: number, y: number, w: number, h: number): void {
    const ctx = this.context;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  }

  private get currentAlpha(): number {
    return this.alphaStack[this.alphaStack.length - 1] as number;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
