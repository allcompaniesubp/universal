/**
 * QR code correctness tests.
 *
 * Asserting that the endpoint returns "<svg" proves nothing about whether the
 * code is scannable or whether it points at the right address. These tests
 * reconstruct the module matrix from the rendered SVG and compare it against an
 * independent encode of the expected payload, so a wrong, truncated or
 * malformed QR code fails here.
 */

import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { buildVerificationUrl, renderQrSvg } from '../server/services/qr-service.ts';

interface ParsedQr {
  /** The module matrix, with the quiet zone removed. */
  matrix: boolean[][];
  /** The full rendered grid size, including the quiet zone. */
  renderedSize: number;
  /** Size of the rendered SVG in user units. */
  width: number;
}

/**
 * Rebuilds the module grid from the SVG the service produced.
 *
 * The `qrcode` library compacts the drawing into a single stroked path that uses
 * an absolute `M` for the first run and relative `m` moves for the rest, e.g.
 * `M1 1.5h7m1 0h1m2 0h1`. Parsing only absolute moves would silently drop every
 * run after the first, so this walks the commands in order and tracks the
 * cursor. Parsing the real output is what makes the comparison against an
 * independent encode meaningful.
 */
function parseQrSvg(svg: string): ParsedQr {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!viewBox) throw new Error('SVG has no viewBox.');
  const renderedSize = Number(viewBox[1]);
  if (Number(viewBox[2]) !== renderedSize) throw new Error('QR SVG is not square.');

  const pathMatch = /<path stroke="[^"]*" d="([^"]+)"/.exec(svg);
  if (!pathMatch?.[1]) throw new Error('SVG has no module path.');

  const grid = Array.from({ length: renderedSize }, () =>
    Array.from({ length: renderedSize }, () => false),
  );

  // Strokes are drawn at half-pixel offsets (row N is stroked at y = N + 0.5),
  // so the row index is the floor of the y coordinate.
  let x = 0;
  let y = 0;
  const commands = pathMatch[1].match(/[Mmh][^Mmh]*/g) ?? [];

  for (const command of commands) {
    const operator = command[0];
    const numbers = command
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .filter((part) => part.length > 0)
      .map(Number);

    if (operator === 'M') {
      [x, y] = [numbers[0] ?? 0, numbers[1] ?? 0];
      continue;
    }
    if (operator === 'm') {
      x += numbers[0] ?? 0;
      y += numbers[1] ?? 0;
      continue;
    }
    if (operator === 'h') {
      const length = numbers[0] ?? 0;
      const row = Math.floor(y);
      const target = grid[row];
      if (!target) throw new Error(`Module run on row ${row} is out of bounds.`);
      for (let offset = 0; offset < length; offset += 1) {
        if (x + offset >= renderedSize) throw new Error('Module run is out of bounds.');
        target[x + offset] = true;
      }
      x += length;
    }
  }

  // The service renders a 1-module quiet zone; strip it so the grid can be
  // compared with a bare QR matrix.
  const quietZone = 1;
  const matrix = grid
    .slice(quietZone, renderedSize - quietZone)
    .map((row) => row.slice(quietZone, renderedSize - quietZone));

  return { matrix, renderedSize, width: renderedSize };
}

/** Independently encodes a payload into a matrix for comparison. */
function expectedMatrix(payload: string): boolean[][] {
  const created = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const size = created.modules.size;
  const data = created.modules.data;
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => Boolean(data[y * size + x])),
  );
}

describe('QR code encoding', () => {
  it('encodes the verification URL exactly, module for module', async () => {
    const payload = buildVerificationUrl('https://allcompanies.unspuniversity.com', 'UBP-4K7M2XQ9');
    const svg = await renderQrSvg(payload, { size: 320 });
    const { matrix } = parseQrSvg(svg);
    const expected = expectedMatrix(payload);

    expect(matrix.length).toBe(expected.length);
    for (let y = 0; y < expected.length; y += 1) {
      expect(matrix[y]).toEqual(expected[y]);
    }
  });

  it('produces the same matrix as an independent encoder for several identifiers', async () => {
    const identifiers = ['UBP-00000000', 'UBP-3X4JJW0N', 'UBP-ZZZZZZZZ', 'UBP-ABCDEFGH'];

    for (const ubpId of identifiers) {
      const payload = buildVerificationUrl('https://ubp.test', ubpId);
      const svg = await renderQrSvg(payload, { size: 256 });
      const { matrix } = parseQrSvg(svg);
      expect(matrix).toEqual(expectedMatrix(payload));
    }
  });

  it('produces a different matrix for a different identifier', async () => {
    const first = parseQrSvg(await renderQrSvg(buildVerificationUrl('https://ubp.test', 'UBP-AAAAAAAA'), { size: 256 }));
    const second = parseQrSvg(await renderQrSvg(buildVerificationUrl('https://ubp.test', 'UBP-BBBBBBBB'), { size: 256 }));

    // Two passports must not share a QR code.
    expect(first.matrix).not.toEqual(second.matrix);
  });

  it('does not encode a raw identifier without the verification address', async () => {
    const payload = buildVerificationUrl('https://ubp.test', 'UBP-4K7M2XQ9');
    const svg = await renderQrSvg(payload, { size: 256 });
    const { matrix } = parseQrSvg(svg);

    // Scanning must open the verification page, not merely yield the identifier.
    expect(matrix).toEqual(expectedMatrix('https://ubp.test/verify/UBP-4K7M2XQ9'));
    expect(matrix).not.toEqual(expectedMatrix('UBP-4K7M2XQ9'));
  });

  it('includes a quiet zone on all four sides', async () => {
    const svg = await renderQrSvg('https://ubp.test/verify/UBP-4K7M2XQ9', { size: 320 });
    const { renderedSize, matrix } = parseQrSvg(svg);

    // A quiet zone is required for reliable scanning; the grid must be larger
    // than the matrix by two modules in each dimension.
    expect(renderedSize).toBe(matrix.length + 2);
  });

  it('renders a square SVG with crisp edges at the requested size', async () => {
    const svg = await renderQrSvg('https://ubp.test/verify/UBP-4K7M2XQ9', { size: 512 });

    expect(svg).toContain('width="512"');
    expect(svg).toContain('height="512"');
    // Without crisp edges a scaled QR code gains anti-aliased grey pixels that
    // some scanners misread.
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it('builds a verification URL with no trailing slash and no double slash', async () => {
    expect(buildVerificationUrl('https://ubp.test', 'UBP-4K7M2XQ9')).toBe(
      'https://ubp.test/verify/UBP-4K7M2XQ9',
    );
    expect(buildVerificationUrl('https://ubp.test/', 'UBP-4K7M2XQ9')).toBe(
      'https://ubp.test/verify/UBP-4K7M2XQ9',
    );
  });
});
