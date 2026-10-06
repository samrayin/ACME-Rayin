import { describe, expect, it } from "vitest";
import {
  ACME_LOGO_LIMITS,
  checkLogo,
  sniffImage,
} from "@/src/features/acme-enhancements/server/acmeCustomerLogoCheck";

// CHG-2026-124 (ADR-0025): the checks a customer logo must pass. The sniffer
// reads only the file header, so synthetic headers stand in for real images.

function png(width: number, height: number, totalBytes = 64): Uint8Array {
  const b = new Uint8Array(totalBytes);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0xff, 0xd8], 0); // SOI
  // APP0 segment of length 16, skipped by the scanner.
  b.set([0xff, 0xe0, 0x00, 0x10], 2);
  // SOF0 at 20: length, precision, height, width.
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  new DataView(b.buffer).setUint16(25, height);
  new DataView(b.buffer).setUint16(27, width);
  return b;
}

function webp(chunk: "VP8 " | "VP8L" | "VP8X", w: number, h: number) {
  const b = new Uint8Array(64);
  const dv = new DataView(b.buffer);
  b.set([...Buffer.from("RIFF")], 0);
  b.set([...Buffer.from("WEBP")], 8);
  b.set([...Buffer.from(chunk)], 12);
  if (chunk === "VP8 ") {
    b.set([0x9d, 0x01, 0x2a], 23);
    dv.setUint16(26, w, true);
    dv.setUint16(28, h, true);
  } else if (chunk === "VP8L") {
    b[20] = 0x2f;
    // width-1 in the low 14 bits, height-1 in the next 14.
    dv.setUint32(21, w - 1 + (h - 1) * 0x4000, true);
  } else {
    // width-1 and height-1 as 24-bit little-endian integers.
    dv.setUint16(24, (w - 1) % 0x10000, true);
    dv.setUint8(26, Math.floor((w - 1) / 0x10000));
    dv.setUint16(27, (h - 1) % 0x10000, true);
    dv.setUint8(29, Math.floor((h - 1) / 0x10000));
  }
  return b;
}

describe("customer logo: reading the file's own header", () => {
  it("reads PNG, JPEG and the three WebP encodings", () => {
    expect(sniffImage(png(240, 64))).toEqual({
      contentType: "image/png",
      width: 240,
      height: 64,
    });
    expect(sniffImage(jpeg(300, 100))).toEqual({
      contentType: "image/jpeg",
      width: 300,
      height: 100,
    });
    for (const chunk of ["VP8 ", "VP8L", "VP8X"] as const) {
      expect(sniffImage(webp(chunk, 180, 60))).toEqual({
        contentType: "image/webp",
        width: 180,
        height: 60,
      });
    }
  });

  it("refuses an SVG, a GIF and anything else", () => {
    const svg = new Uint8Array(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    );
    const gif = new Uint8Array(Buffer.from("GIF89a\x10\x00\x10\x00"));
    expect(sniffImage(svg)).toBeNull();
    expect(sniffImage(gif)).toBeNull();
    expect(sniffImage(new Uint8Array(40))).toBeNull();
  });
});

describe("customer logo: the checks before storing", () => {
  it("accepts a logo within every limit", () => {
    expect(checkLogo(png(240, 64), "image/png")).toEqual({
      ok: true,
      sizeBytes: 64,
      contentType: "image/png",
      width: 240,
      height: 64,
    });
  });

  it("refuses a file whose bytes do not match its declared type", () => {
    const result = checkLogo(png(240, 64), "image/jpeg");
    expect(result.ok).toBe(false);
  });

  it("refuses a file over the size limit", () => {
    const big = png(240, 64, ACME_LOGO_LIMITS.maxBytes + 1);
    const result = checkLogo(big, "image/png");
    expect(result).toEqual({
      ok: false,
      reason: "The file is 101 KB; the limit is 100 KB.",
    });
    expect(
      checkLogo(png(240, 64, ACME_LOGO_LIMITS.maxBytes), "image/png").ok,
    ).toBe(true);
  });

  it("refuses a logo too short to stay sharp, and one too large", () => {
    expect(checkLogo(png(120, 31), "image/png").ok).toBe(false);
    expect(checkLogo(png(120, 32), "image/png").ok).toBe(true);
    expect(checkLogo(png(120, 1025), "image/png").ok).toBe(false);
    expect(checkLogo(png(4097, 64), "image/png").ok).toBe(false);
    expect(checkLogo(png(15, 64), "image/png").ok).toBe(false);
  });

  it("refuses an empty file and an unreadable one", () => {
    expect(checkLogo(new Uint8Array(0), "image/png").ok).toBe(false);
    expect(checkLogo(new Uint8Array(64), "image/png")).toEqual({
      ok: false,
      reason: "Use a PNG, JPEG or WebP image.",
    });
  });
});
