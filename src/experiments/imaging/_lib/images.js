// Shared raster utilities for the imaging subject: every experiment here
// produces at least one image observable, and they all cross the same
// worker/Node boundary the same way — one encoder, not five.
//
// PURE, stateless, no DOM. Importable from compute.js AND check.js.
//
// The encoder is the same technique ml/_lib/images.js already uses for its
// Shepp-Logan phantom, duplicated here rather than imported across
// subjects: promoting it to core/ is a real, separate decision (raised in
// issue #94, unresolved as of writing) that would also mean editing
// ml/svd-compression's existing, already-shipped files — out of scope for
// this experiment. Revisit once that's settled.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 written here rather than through btoa or Buffer: the same code
 *  must run inside a worker AND inside Node, with no branch on the host. */
function base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

/**
 * An n × n image of [0, 1] values as `data:image/bmp;base64,…`. An 8-bit
 * greyscale BMP, encoded by hand: PNG needs a deflate and a CRC, some
 * hundred lines that would have to be verified, where BMP is a header
 * followed by raw bytes. Not a canvas: the worker has no DOM and the
 * harness runs in Node — a `data:` string crosses both boundaries assuming
 * nothing. Read from the BOTTOM up, failing which the image appears
 * upside down.
 */
export function toBmpDataUri(img, n) {
  const rowSize = (n + 3) & ~3;
  const pixOffset = 14 + 40 + 256 * 4;
  const size = pixOffset + rowSize * n;
  const b = new Uint8Array(size);
  const u16 = (o, v) => {
    b[o] = v & 255;
    b[o + 1] = (v >> 8) & 255;
  };
  const u32 = (o, v) => {
    b[o] = v & 255;
    b[o + 1] = (v >> 8) & 255;
    b[o + 2] = (v >> 16) & 255;
    b[o + 3] = (v >>> 24) & 255;
  };
  b[0] = 66; // 'B'
  b[1] = 77; // 'M'
  u32(2, size);
  u32(10, pixOffset);
  u32(14, 40); // size of the DIB header
  u32(18, n);
  u32(22, n);
  u16(26, 1); // planes
  u16(28, 8); // bits per pixel
  u32(34, rowSize * n);
  u32(46, 256); // palette colours
  for (let k = 0; k < 256; k++) {
    const o = 54 + k * 4;
    b[o] = k;
    b[o + 1] = k;
    b[o + 2] = k;
  }
  for (let i = 0; i < n; i++) {
    const src = (n - 1 - i) * n; // bottom to top
    const dst = pixOffset + i * rowSize;
    for (let j = 0; j < n; j++) {
      const v = img[src + j];
      b[dst + j] = Math.max(0, Math.min(255, Math.round(255 * v)));
    }
  }
  return 'data:image/bmp;base64,' + base64(b);
}

/** Maps an array into [0, 1] by a shift and a scale — needed for any
 *  observable whose natural range isn't already [0, 1] (an edge detector's
 *  output, for instance) before it can be encoded as an 8-bit greyscale
 *  image. */
export function normalize01(a) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of a) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const d = hi - lo || 1;
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] - lo) / d;
  return out;
}
