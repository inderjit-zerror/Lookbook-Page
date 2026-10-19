/*
 * Fabric — one garment as a 2.5D Verlet cloth.
 *
 * Simulation happens in screen pixels (x right, y DOWN) with a third depth
 * axis z. The cloth is drawn with an oblique projection:
 *
 *     screenY = min(floor, y + z * OBLIQUE)
 *
 * so fabric lying on the floor with depth reads as a thin, crumpled band —
 * exactly the "pile of clothes on the ground" look. Depth also lets the
 * fabric fold over itself without stretching the artwork.
 *
 * Constraints: structural (neighbours), shear (diagonals) and very soft bend
 * links (two apart) so garments flop and crumple.
 */

export const OBLIQUE = 0.55;
const GRAVITY = 0.28; // px per frame² (fixed 60 Hz step)
const MAX_SPEED = 12; // px per frame
const K_STRUCT = 0.94;
const K_SHEAR = 0.52;
const K_BEND = 0.09;

export default class Fabric {
  /**
   * @param {object} o
   * @param {number} o.index    garment / project index
   * @param {number} o.width    garment width in px
   * @param {object} o.asset    { aspect, alpha (RGBA Uint8ClampedArray), maskW, maskH }
   * @param {number} o.viewW
   * @param {number} o.viewH
   * @param {boolean} [o.initial] spawn already on screen (reduced motion)
   */
  constructor({ index, width, asset, viewW, viewH, initial = false }) {
    this.index = index;
    this.w = width;
    this.h = width * asset.aspect;
    this.asset = asset;
    this.cols = viewW < 650 ? 20 : 28;
    this.rows = this.cols;
    this.sleeping = false;
    this.calm = 0;
    this.landedFrames = 0;
    this.entered = false;
    this.floor = Infinity;
    this.version = 0; // bumps whenever the shape changes (for GPU upload)

    const C = this.cols + 1;
    const R = this.rows + 1;
    const n = C * R;
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.solid = new Uint8Array(n);
    this.contact = new Uint8Array(n);

    const center = width * 0.65 + Math.random() * (viewW - width * 1.3);
    const top = initial ? viewH * 0.68 : -this.h - 25;
    const angle = (Math.random() - 0.5) * 0.7;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const { alpha, maskW, maskH } = asset;

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const i = r * C + c;
        const u = c / this.cols;
        const v = r / this.rows;
        const dx = (u - 0.5) * this.w;
        const dy = (v - 0.5) * this.h;
        const x = center + dx * cos - dy * sin;
        const y = top + dy * cos + dx * sin;
        // a soft initial ripple so the fabric starts folding as it falls
        const z = Math.sin(u * Math.PI * 2 + 0.4) * this.w * 0.075 + Math.sin(v * Math.PI * 2) * this.w * 0.045;
        this.x[i] = x;
        this.y[i] = y;
        this.z[i] = z;
        this.px[i] = x - (Math.random() - 0.5) * 0.2;
        this.py[i] = y;
        this.pz[i] = z;
        this.u[i] = u;
        this.v[i] = v;
        const mx = Math.min(maskW - 1, Math.round(u * (maskW - 1)));
        const my = Math.min(maskH - 1, Math.round(v * (maskH - 1)));
        // only opaque fabric collides / can be picked; clear corners just ride along
        this.solid[i] = alpha[(my * maskW + mx) * 4 + 3] > 50 ? 1 : 0;
      }
    }

    // constraints + triangles
    const la = [], lb = [], lk = [], tris = [];
    const at = (c, r) => r * C + c;
    const link = (a, b, k) => { la.push(a); lb.push(b); lk.push(k); };
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const a = at(c, r);
        if (c < this.cols) link(a, at(c + 1, r), K_STRUCT);
        if (r < this.rows) link(a, at(c, r + 1), K_STRUCT);
        if (c < this.cols && r < this.rows) {
          link(a, at(c + 1, r + 1), K_SHEAR);
          link(at(c + 1, r), at(c, r + 1), K_SHEAR);
          tris.push(a, at(c + 1, r), at(c, r + 1), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1));
        }
        if (c < this.cols - 1) link(a, at(c + 2, r), K_BEND);
        if (r < this.rows - 1) link(a, at(c, r + 2), K_BEND);
      }
    }
    this.la = Int32Array.from(la);
    this.lb = Int32Array.from(lb);
    this.lk = Float32Array.from(lk);
    this.rest = new Float32Array(la.length);
    for (let j = 0; j < la.length; j++) {
      const a = la[j], b = lb[j];
      this.rest[j] = Math.hypot(this.x[b] - this.x[a], this.y[b] - this.y[a], this.z[b] - this.z[a]);
    }
    this.triangles = Uint32Array.from(tris);

  }

  /* --------------------------------------------------------------- utils */

  projectedY(i) {
    return Math.min(this.floor, this.y[i] + this.z[i] * OBLIQUE);
  }

  bounds() {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (!this.solid[i]) continue;
      const y = this.projectedY(i);
      if (this.x[i] < left) left = this.x[i];
      if (this.x[i] > right) right = this.x[i];
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
    return { left, right, top, bottom };
  }

  shift(dy) {
    for (let i = 0; i < this.n; i++) { this.y[i] += dy; this.py[i] += dy; }
  }

  wake() {
    this.sleeping = false;
    this.calm = 0;
    this.landedFrames = 0;
  }

  /* ----------------------------------------------------------- dynamics */

  integrate(time, reduced) {
    if (this.sleeping) return;
    const { x, y, z, px, py, pz, u, v, contact } = this;
    const calmAir = reduced || this.landedFrames > 0;
    for (let i = 0; i < this.n; i++) {
      let vx = (x[i] - px[i]) * 0.985;
      let vy = (y[i] - py[i]) * 0.986;
      let vz = (z[i] - pz[i]) * 0.978;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > MAX_SPEED) {
        const s = MAX_SPEED / speed;
        vx *= s; vy *= s; vz *= s;
      }
      px[i] = x[i]; py[i] = y[i]; pz[i] = z[i];
      // a light breeze while airborne makes each piece drift and flutter
      const airborne = !calmAir && !contact[i];
      x[i] += vx + (airborne ? Math.sin(time * 1.1 + this.index * 1.7 + v[i] * 3) * 0.022 : 0);
      y[i] += vy + GRAVITY;
      z[i] += vz + (airborne ? Math.sin(time * 2.2 + u[i] * 4.8 + v[i] * 2 + this.index) * 0.038 : 0);
      contact[i] = 0;
    }
    this.version++;
  }

  createGrip(node) {
    const pins = new Map();
    const r = Math.max(10, this.w * 0.055);
    const cu = this.u[node], cv = this.v[node];
    const ox = this.x[node], oy = this.projectedY(node), oz = this.z[node];
    const limits = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const d = Math.hypot((this.u[i] - cu) * this.w, (this.v[i] - cv) * this.h);
      limits[i] = d * 1.12;
      if ((this.solid[i] || i === node) && d <= r) {
        pins.set(i, { x: this.x[i] - ox, y: this.projectedY(i) - oy, z: this.z[i] - oz });
      }
    }
    return { pins, limits };
  }

  pinGrip(grab) {
    for (const [i, o] of grab.grip.pins) {
      this.x[i] = grab.x + o.x;
      this.z[i] = o.z;
      this.y[i] = grab.y + o.y - o.z * OBLIQUE;
      this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.pz[i] = this.z[i];
    }
  }

  solve(surface, viewW, grab) {
    if (this.sleeping) return;
    const { x, y, z, px, py, pz, la, lb, lk, rest } = this;
    const held = grab?.fabric === this;
    const pins = held ? grab.grip.pins : null;
    if (held) this.pinGrip(grab);

    for (let j = 0; j < la.length; j++) {
      const a = la[j], b = lb[j];
      const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      const wa = pins && pins.has(a) ? 0 : 1;
      const wb = pins && pins.has(b) ? 0 : 1;
      const f = ((d - rest[j]) / d) * lk[j] / (wa + wb || 1);
      x[a] += dx * f * wa; y[a] += dy * f * wa; z[a] += dz * f * wa;
      x[b] -= dx * f * wb; y[b] -= dy * f * wb; z[b] -= dz * f * wb;
    }

    // stop the hand from stretching the garment; folding is still free
    if (held) {
      const { limits } = grab.grip;
      for (let i = 0; i < this.n; i++) {
        if (pins.has(i)) continue;
        const dx = x[i] - grab.x, dy = y[i] - grab.y, dz = z[i];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > limits[i]) {
          const f = limits[i] / d;
          x[i] = grab.x + dx * f; y[i] = grab.y + dy * f; z[i] = dz * f;
        }
      }
    }

    this.floor = surface - 1.5;
    const floor = this.floor;
    const zMax = this.w * 0.8;
    if (!this.entered) {
      let inside = true;
      for (let i = 0; i < this.n; i++) if (y[i] + z[i] * OBLIQUE < 2) { inside = false; break; }
      this.entered = inside;
    }
    for (let i = 0; i < this.n; i++) {
      if (x[i] < 2) { x[i] = 2; px[i] = x[i]; }
      else if (x[i] > viewW - 2) { x[i] = viewW - 2; px[i] = x[i]; }
      if (z[i] < -zMax) z[i] = -zMax; else if (z[i] > zMax) z[i] = zMax;
      if (this.entered && y[i] + z[i] * OBLIQUE < 2) { y[i] = 2 - z[i] * OBLIQUE; py[i] = y[i]; }
      if (y[i] > floor) {
        y[i] = floor;
        py[i] = floor;
        px[i] = x[i] + (px[i] - x[i]) * 0.5; // floor friction
        pz[i] = z[i] + (pz[i] - z[i]) * 0.6;
        this.contact[i] = 1;
      }
    }
    if (held) this.pinGrip(grab);
  }

  settle(grab) {
    if (this.sleeping || grab?.fabric === this) return;
    let motion = 0, touching = 0;
    for (let i = 0; i < this.n; i++) {
      motion += Math.abs(this.x[i] - this.px[i]) + Math.abs(this.y[i] - this.py[i]) + Math.abs(this.z[i] - this.pz[i]);
      if (this.contact[i] && this.solid[i]) touching++;
    }
    if (touching) this.landedFrames++;
    if (this.landedFrames && motion / this.n < 0.12) this.calm++;
    else this.calm = 0;
    // garments on the floor freeze once settled; picking one up wakes it
    if (this.calm > 25 || this.landedFrames > 100) {
      this.sleeping = true;
      this.px.set(this.x); this.py.set(this.y); this.pz.set(this.z);
    }
  }

  /** Softens the throw so a flick never launches the garment off screen. */
  limitRelease() {
    for (let i = 0; i < this.n; i++) {
      const vx = (this.x[i] - this.px[i]) * 0.5;
      const vy = (this.y[i] - this.py[i]) * 0.5;
      const vz = (this.z[i] - this.pz[i]) * 0.5;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const f = speed > 3 ? 3 / speed : 1;
      this.px[i] = this.x[i] - vx * f;
      this.py[i] = this.y[i] - vy * f;
      this.pz[i] = this.z[i] - vz * f;
    }
  }

  /** Rescales the garment around its centre after a viewport resize. */
  rescale(sx, sy, scale) {
    let cx = 0, cy = 0;
    for (let i = 0; i < this.n; i++) { cx += this.x[i]; cy += this.y[i]; }
    cx /= this.n; cy /= this.n;
    for (let i = 0; i < this.n; i++) {
      this.x[i] = cx * sx + (this.x[i] - cx) * scale;
      this.y[i] = cy * sy + (this.y[i] - cy) * scale;
      this.z[i] *= scale;
      this.px[i] = this.x[i]; this.py[i] = this.y[i]; this.pz[i] = this.z[i];
    }
    this.w *= scale;
    this.h *= scale;
    for (let j = 0; j < this.rest.length; j++) this.rest[j] *= scale;
    this.wake();
    this.version++;
  }

  /* -------------------------------------------------------------- picking */

  /** Returns the grabbed node under (x, y) if it lands on opaque fabric. */
  hit(qx, qy) {
    const { triangles: t, x, u, v } = this;
    const { alpha, maskW, maskH } = this.asset;
    for (let k = t.length - 3; k >= 0; k -= 3) {
      const i0 = t[k], i1 = t[k + 1], i2 = t[k + 2];
      const x0 = x[i0], x1 = x[i1], x2 = x[i2];
      const y0 = this.projectedY(i0), y1 = this.projectedY(i1), y2 = this.projectedY(i2);
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 0.05) continue;
      const a = ((y1 - y2) * (qx - x2) + (x2 - x1) * (qy - y2)) / den;
      const b = ((y2 - y0) * (qx - x2) + (x0 - x2) * (qy - y2)) / den;
      const c = 1 - a - b;
      if (a < 0 || b < 0 || c < 0) continue;
      const tu = u[i0] * a + u[i1] * b + u[i2] * c;
      const tv = v[i0] * a + v[i1] * b + v[i2] * c;
      const ix = Math.min(maskW - 1, Math.max(0, Math.floor(tu * maskW)));
      const iy = Math.min(maskH - 1, Math.max(0, Math.floor(tv * maskH)));
      if (alpha[(iy * maskW + ix) * 4 + 3] < 70) continue;
      return a >= b && a >= c ? i0 : b >= c ? i1 : i2;
    }
    return -1;
  }

  /* ------------------------------------------------------------- drawing */

  /** Writes (screenX, screenY, depth) per node for the GPU. */
  writeVertices(out) {
    const s = 1 / (this.w * 4);
    for (let i = 0, k = 0; i < this.n; i++, k += 3) {
      out[k] = this.x[i];
      out[k + 1] = this.projectedY(i);
      out[k + 2] = -this.z[i] * s;
    }
  }
}
