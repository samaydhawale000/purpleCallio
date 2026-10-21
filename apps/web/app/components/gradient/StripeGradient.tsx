"use client";

import { useEffect, useRef } from "react";

/**
 * Stripe-style animated wave gradient for the hero background (WebGL).
 *
 * Kept deliberately cheap:
 * - one vertex-displaced mesh, rendered at CSS-pixel size (no DPR scaling)
 * - capped at FPS frames per second
 * - paused while off screen or while the tab is hidden
 * - GPU resources released on unmount (route change)
 * - never started for prefers-reduced-motion or when WebGL is unavailable;
 *   the canvas then stays hidden and the hero shows its plain background
 */

const FPS = 30;
const HEIGHT = 600; // mesh height in px; the canvas is stretched to the hero by CSS
const DENSITY_X = 0.06; // mesh segments per px
const DENSITY_Y = 0.16;
const SEED = 5;

/** Base colour first, then the wave layers blended over it. */
const DEFAULT_COLORS = ["#FFFFFF", "#d9d7ff", "#c4b5fd", "#ede9fe"];

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const f = (n: number) => n.toFixed(5);

function vertexShader(layerCount: number) {
  let layers = "";
  for (let i = 1; i <= layerCount; i++) {
    const total = layerCount + 1;
    layers += `
  {
    float n = smoothstep(0.1, ${f(0.63 + 0.07 * i)}, snoise(vec3(
      noiseCoord.x * 0.6 + time * ${f(3 + 0.15 * i)},
      noiseCoord.y * ${f(1 + i / total)},
      time * ${f(5 + 0.15 * i)} + ${f(SEED + 10 * i)}
    )) / 2.0 + 0.5);
    v_color = mix(v_color, u_layerColors[${i - 1}], pow(n, 4.0));
  }`;
  }

  return `
precision highp float;
attribute vec2 uvNorm;
uniform vec2 resolution;
uniform float u_time;
uniform vec3 u_baseColor;
uniform vec3 u_layerColors[${layerCount}];
varying vec3 v_color;

// Simplex noise: Ian McEwan, Ashima Arts (MIT) https://github.com/ashima/webgl-noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  float time = u_time * 1.5e-5;
  vec2 noiseCoord = resolution * uvNorm * vec2(3e-4, 5.5e-4);

  // Displace the plane vertically with noise, faded out towards the edges.
  float tilt = resolution.y / 2.0 * uvNorm.y;
  float noise = snoise(vec3(
    noiseCoord.x + time * 2.0,
    noiseCoord.y * 1.5,
    time * 6.0 + ${f(SEED)}
  )) * 420.0;
  noise *= 1.0 - pow(abs(uvNorm.y), 2.0);
  noise = max(0.0, noise);

  v_color = u_baseColor;
${layers}

  vec2 pos = vec2(uvNorm.x * resolution.x / 2.0, tilt + noise);
  gl_Position = vec4(pos * 2.0 / resolution, 0.0, 1.0);
}`;
}

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 v_color;
void main() { gl_FragColor = vec4(v_color, 1.0); }`;

class WaveGradient {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private shaders: WebGLShader[] = [];
  private buffers: WebGLBuffer[] = [];
  private uniforms: { resolution: WebGLUniformLocation | null; time: WebGLUniformLocation | null };
  private indexCount = 0;
  private segX = 0;
  private width = 0;
  private time = 0;
  private last = 0;
  private lastDraw = 0;
  private raf = 0;
  playing = false;

  constructor(private canvas: HTMLCanvasElement, gl: WebGLRenderingContext, colors: string[]) {
    this.gl = gl;
    const program = gl.createProgram()!;
    this.program = program;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertexShader(colors.length - 1)],
      [gl.FRAGMENT_SHADER, FRAGMENT_SHADER],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
      gl.attachShader(program, shader);
      this.shaders.push(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
    gl.useProgram(program);

    const [base, ...layers] = colors.map(hexToRgb);
    gl.uniform3fv(gl.getUniformLocation(program, "u_baseColor"), base);
    gl.uniform3fv(gl.getUniformLocation(program, "u_layerColors"), layers.flat());
    this.uniforms = {
      resolution: gl.getUniformLocation(program, "resolution"),
      time: gl.getUniformLocation(program, "u_time"),
    };
    this.buffers = [gl.createBuffer()!, gl.createBuffer()!];
  }

  /** Match the mesh to the canvas's container width. */
  resize(width: number) {
    width = Math.max(1, Math.round(width));
    if (width === this.width) return;
    this.width = width;
    const { gl, canvas } = this;
    canvas.width = width;
    canvas.height = HEIGHT;
    gl.viewport(0, 0, width, HEIGHT);
    gl.uniform2f(this.uniforms.resolution, width, HEIGHT);

    const segX = Math.ceil(width * DENSITY_X);
    if (segX !== this.segX) {
      this.segX = segX;
      this.buildMesh(segX, Math.ceil(HEIGHT * DENSITY_Y));
    }
    this.draw(); // resizing clears the canvas; repaint straight away
  }

  private buildMesh(segX: number, segY: number) {
    const { gl } = this;
    const uv = new Float32Array((segX + 1) * (segY + 1) * 2);
    const index = new Uint16Array(segX * segY * 6);
    for (let y = 0, k = 0; y <= segY; y++) {
      for (let x = 0; x <= segX; x++) {
        const i = y * (segX + 1) + x;
        uv[2 * i] = (x / segX) * 2 - 1;
        uv[2 * i + 1] = 1 - (y / segY) * 2;
        if (x < segX && y < segY) {
          index.set([i, i + 1 + segX, i + 1, i + 1, i + 1 + segX, i + 2 + segX], k);
          k += 6;
        }
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[0]);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, "uvNorm");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers[1]);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
    this.indexCount = index.length;
  }

  draw() {
    const { gl } = this;
    gl.uniform1f(this.uniforms.time, this.time);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  private frame = (now: number) => {
    if (!this.playing) return;
    this.raf = requestAnimationFrame(this.frame);
    if (now - this.lastDraw < 1000 / FPS - 2) return;
    // Clamp the step so resuming after a pause doesn't jump the animation.
    this.time += Math.min(now - (this.last || now), 1000 / 8);
    this.last = now;
    this.lastDraw = now;
    this.draw();
  };

  play() {
    if (this.playing) return;
    this.playing = true;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.pause();
    const { gl } = this;
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    this.shaders.forEach((s) => gl.deleteShader(s));
    gl.deleteProgram(this.program);
    // Drop the drawing buffer now rather than waiting for GC. (Not loseContext():
    // React dev remounts and Fast Refresh reuse this canvas.)
    this.canvas.width = this.canvas.height = 1;
  }
}

export default function StripeGradient({ colors = DEFAULT_COLORS }: { colors?: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorKey = colors.join(",");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let gradient: WaveGradient | null = null;
    let onScreen = true;
    let resizeObserver: ResizeObserver | undefined;
    let intersectionObserver: IntersectionObserver | undefined;

    const sync = () => {
      if (!gradient) return;
      if (onScreen && !document.hidden) gradient.play();
      else gradient.pause();
    };

    const start = () => {
      const gl = canvas.getContext("webgl", {
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power",
      });
      if (!gl) return;
      try {
        gradient = new WaveGradient(canvas, gl, colorKey.split(","));
      } catch (err) {
        console.error("StripeGradient: WebGL setup failed", err);
        return;
      }
      const parent = canvas.parentElement ?? canvas;
      gradient.resize(parent.clientWidth);
      resizeObserver = new ResizeObserver(([entry]) => gradient?.resize(entry.contentRect.width));
      resizeObserver.observe(parent);
      intersectionObserver = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      });
      intersectionObserver.observe(canvas);
      document.addEventListener("visibilitychange", sync);
      sync();
      canvas.classList.add("isLoaded");
    };

    // Start once the browser is idle so the gradient never delays first paint.
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(start, { timeout: 1500 })
      : window.setTimeout(start, 200);

    const onContextLost = () => gradient?.pause();
    canvas.addEventListener("webglcontextlost", onContextLost);

    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", sync);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      gradient?.destroy();
      canvas.classList.remove("isLoaded");
    };
  }, [colorKey]);

  return <canvas ref={canvasRef} className="stripe-gradient-canvas" aria-hidden="true" />;
}
