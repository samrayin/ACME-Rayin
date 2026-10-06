/**
 * ACME (CHG-2026-124, ADR-0025): the checks a customer logo must pass before
 * it is stored. Pure functions, so every limit is tested without a database.
 *
 * The type and the dimensions are read from the file's own header, never
 * taken from the browser: a renamed file, or one whose declared type does not
 * match its bytes, is refused. Raster formats only. An SVG can carry script,
 * and a regulated customer's reviewer would rather not have to reason about
 * where it is rendered (ADR-0025).
 */

export const ACME_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type AcmeLogoType = (typeof ACME_LOGO_TYPES)[number];

export const ACME_LOGO_LIMITS = {
  /** The stored file, in bytes. */
  maxBytes: 100 * 1024,
  /** Below this the sidebar would have to enlarge it, and it would blur. */
  minHeight: 32,
  maxHeight: 1024,
  minWidth: 16,
  maxWidth: 4096,
} as const;

/**
 * How the sidebar shows it: on a white tile, at most this high and this wide,
 * keeping its proportions. Shared with the page's size note.
 */
export const ACME_LOGO_DISPLAY = { heightPx: 24, maxWidthPx: 72 } as const;

export type SniffedImage = {
  contentType: AcmeLogoType;
  width: number;
  height: number;
};

// Multi-byte integers, read with plain arithmetic: the byte order is
// spelled out by the place values.
function be16(b: Uint8Array, i: number): number {
  return b[i]! * 0x100 + b[i + 1]!;
}

function be32(b: Uint8Array, i: number): number {
  return be16(b, i) * 0x10000 + be16(b, i + 2);
}

function le16(b: Uint8Array, i: number): number {
  return b[i]! + b[i + 1]! * 0x100;
}

function le24(b: Uint8Array, i: number): number {
  return le16(b, i) + b[i + 2]! * 0x10000;
}

function le32(b: Uint8Array, i: number): number {
  return le16(b, i) + le16(b, i + 2) * 0x10000;
}

/** The low 14 bits of a non-negative integer. */
const FOURTEEN_BITS = 0x4000;
function low14(n: number): number {
  return n % FOURTEEN_BITS;
}

function ascii(b: Uint8Array, i: number, n: number): string {
  return String.fromCharCode(...b.subarray(i, i + n));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sniffPng(b: Uint8Array): SniffedImage | null {
  if (b.length < 24) return null;
  if (!PNG_SIGNATURE.every((v, i) => b[i] === v)) return null;
  if (ascii(b, 12, 4) !== "IHDR") return null;
  return { contentType: "image/png", width: be32(b, 16), height: be32(b, 20) };
}

/** Start-of-frame markers, which carry the dimensions. */
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function sniffJpeg(b: Uint8Array): SniffedImage | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) {
    return null;
  }
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1]!;
    // Fill bytes: any number of 0xFF before a marker.
    while (marker === 0xff && i + 2 < b.length) {
      i += 1;
      marker = b[i + 1]!;
    }
    // Markers with no length: TEM, RST0-7, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      if (marker === 0xd9) return null;
      i += 2;
      continue;
    }
    if (JPEG_SOF.has(marker)) {
      if (i + 8 >= b.length) return null;
      return {
        contentType: "image/jpeg",
        height: be16(b, i + 5),
        width: be16(b, i + 7),
      };
    }
    const length = be16(b, i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function sniffWebp(b: Uint8Array): SniffedImage | null {
  if (b.length < 30) return null;
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    // Lossy: a key frame's start code, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return {
      contentType: "image/webp",
      width: low14(le16(b, 26)),
      height: low14(le16(b, 28)),
    };
  }
  if (chunk === "VP8L") {
    // Lossless: a signature byte, then width-1 and height-1 in 14 bits each.
    if (b[20] !== 0x2f) return null;
    const bits = le32(b, 21);
    return {
      contentType: "image/webp",
      width: low14(bits) + 1,
      height: low14(Math.floor(bits / FOURTEEN_BITS)) + 1,
    };
  }
  if (chunk === "VP8X") {
    // Extended: canvas width-1 and height-1 in 24 bits each.
    return {
      contentType: "image/webp",
      width: le24(b, 24) + 1,
      height: le24(b, 27) + 1,
    };
  }
  return null;
}

/** The image's real type and dimensions, or null if it is none we accept. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffWebp(bytes);
}

export type LogoCheck =
  | ({ ok: true; sizeBytes: number } & SniffedImage)
  | { ok: false; reason: string };

/** Every check a logo must pass, with the reason shown to the user if not. */
export function checkLogo(bytes: Uint8Array, declaredType: string): LogoCheck {
  const l = ACME_LOGO_LIMITS;
  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };
  if (bytes.length > l.maxBytes) {
    return {
      ok: false,
      reason: `The file is ${Math.ceil(bytes.length / 1024)} KB; the limit is ${l.maxBytes / 1024} KB.`,
    };
  }
  const image = sniffImage(bytes);
  if (!image) {
    return { ok: false, reason: "Use a PNG, JPEG or WebP image." };
  }
  if (image.contentType !== declaredType) {
    return {
      ok: false,
      reason:
        "The file's contents do not match its type. Export it again as PNG, JPEG or WebP.",
    };
  }
  if (image.height < l.minHeight) {
    return {
      ok: false,
      reason: `The image is ${image.height} px high; it must be at least ${l.minHeight} px.`,
    };
  }
  if (
    image.height > l.maxHeight ||
    image.width > l.maxWidth ||
    image.width < l.minWidth
  ) {
    return {
      ok: false,
      reason: `The image is ${image.width} × ${image.height} px; it must be ${l.minWidth} to ${l.maxWidth} px wide and ${l.minHeight} to ${l.maxHeight} px high.`,
    };
  }
  return { ok: true, sizeBytes: bytes.length, ...image };
}
