/**
 * @module agent-stage/export/backends/png-sequence
 * PngSequence: deterministic offline export via FrameRenderer; every frame
 * canvas is encoded to PNG and packaged into a ZIP (STORE, no compression —
 * PNGs are already compressed) with a `sequence.json` manifest. The ZIP
 * writer is a minimal, dependency-free implementation (local file headers +
 * central directory + EOCD, table-based CRC32).
 */

import { FrameRenderer } from '../frame-renderer.js';

export class PngSequence {
  /**
   * @param {{stage:object, timeline:object, svgLayer:object, engines?:object,
   *          driver?:object, compositor:object,
   *          duration:number, fps?:number, width:number, height:number,
   *          background?:string|null, schedule?:(t:number)=>void,
   *          onProgress?:(p:number)=>void, signal?:{cancelled:boolean}}} opts
   * @returns {Promise<{blob:Blob, filename:string, mimeType:string,
   *                    frames:number, duration:number, fps:number}>}
   */
  async render(opts) {
    const { stage, timeline, svgLayer, engines, driver, compositor } = opts;
    const { duration, fps = 30, width, height, background = null,
      schedule, onProgress, signal } = opts;

    const renderer = new FrameRenderer({ stage, timeline, driver, svgLayer, engines, compositor });
    const blobs = [];
    const summary = await renderer.render({
      duration, fps, width, height, background, schedule, signal,
      onFrame: async (canvas) => {
        blobs.push(await canvasToBlob(canvas));
      },
      onProgress,
    });

    const manifest = JSON.stringify({
      fps, width, height, frames: summary.frames, background,
    }, null, 2);

    const files = blobs.map((b, i) => ({
      name: `frame_${String(i + 1).padStart(5, '0')}.png`,
      data: b,
    }));
    files.push({ name: 'sequence.json', data: new TextEncoder().encode(manifest) });

    const zip = await buildZip(files);
    return {
      blob: zip, filename: 'agent-stage-png-seq.zip', mimeType: 'application/zip',
      frames: summary.frames, duration: summary.duration, fps: summary.fps,
    };
  }
}

/** @private */
function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('[agent-stage.pngSequence] toBlob failed'))), 'image/png');
  });
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (STORE method, no compression, no zip64).
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {{name:string, data:Uint8Array|Blob}[]} files
 * @returns {Promise<Blob>}
 */
async function buildZip(files) {
  const enc = new TextEncoder();
  const parts = []; // Blob parts
  const central = [];
  let offset = 0;

  const u16 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

  for (const file of files) {
    const data = file.data instanceof Blob ? new Uint8Array(await file.data.arrayBuffer()) : file.data;
    const nameBytes = enc.encode(file.name);
    const crc = crc32(data);

    const local = new Blob([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), nameBytes,
    ]);
    parts.push(local, data);
    central.push({
      nameBytes, crc, size: data.length, offset,
    });
    offset += local.size + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const e of central) {
    const rec = new Blob([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(e.crc), u32(e.size), u32(e.size),
      u16(e.nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(e.offset), e.nameBytes,
    ]);
    parts.push(rec);
    centralSize += rec.size;
  }

  parts.push(new Blob([
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(centralSize), u32(centralStart), u16(0),
  ]));

  return new Blob(parts, { type: 'application/zip' });
}