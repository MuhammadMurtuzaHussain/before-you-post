// Builds a minimal little-endian TIFF IFD. Values larger than 4 bytes go in a data area after it.
const SIZE = { 2: 1, 3: 2, 4: 4, 5: 8 };

function ifdSize(entries) {
  let data = 0;
  for (const e of entries) {
    const n = SIZE[e.type] * e.values.length;
    if (n > 4) data += n;
  }
  return 2 + entries.length * 12 + 4 + data;
}

function writeIfd(view, offset, entries) {
  let dataAt = offset + 2 + entries.length * 12 + 4;
  view.setUint16(offset, entries.length, true);
  entries.forEach((e, i) => {
    const at = offset + 2 + i * 12;
    const n = SIZE[e.type] * e.values.length;
    view.setUint16(at, e.tag, true);
    view.setUint16(at + 2, e.type, true);
    view.setUint32(at + 4, e.values.length, true);
    let p = at + 8;
    if (n > 4) { view.setUint32(at + 8, dataAt, true); p = dataAt; dataAt += n; }
    for (const v of e.values) {
      if (e.type === 2) { view.setUint8(p, v); p += 1; }
      else if (e.type === 3) { view.setUint16(p, v, true); p += 2; }
      else if (e.type === 4) { view.setUint32(p, v, true); p += 4; }
      else if (e.type === 5) { view.setUint32(p, v[0], true); view.setUint32(p + 4, v[1], true); p += 8; }
    }
  });
}

const str = (s) => [...s].map((c) => c.charCodeAt(0)).concat(0);

export function segment(marker, payload) {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

export function makeJpeg({ withGps = true, orientation = 1 } = {}) {
  const exifEntries = [
    { tag: 0x9003, type: 2, values: str('2026:10:14 18:42:07') },
    { tag: 0xa431, type: 2, values: str('F2LXK9Q3PL') },
  ];
  // Galway: 53.2707 N, 9.0568 W
  const gpsEntries = [
    { tag: 0x0001, type: 2, values: str('N') },
    { tag: 0x0002, type: 5, values: [[53, 1], [16, 1], [1452, 100]] },
    { tag: 0x0003, type: 2, values: str('W') },
    { tag: 0x0004, type: 5, values: [[9, 1], [3, 1], [2448, 100]] },
  ];
  const ifd0 = [
    { tag: 0x010f, type: 2, values: str('Apple') },
    { tag: 0x0110, type: 2, values: str('iPhone 15 Pro') },
    { tag: 0x0112, type: 3, values: [orientation] },
    { tag: 0x8769, type: 4, values: [0] },
  ];
  if (withGps) ifd0.push({ tag: 0x8825, type: 4, values: [0] });

  const exifOffset = 8 + ifdSize(ifd0);
  const gpsOffset = exifOffset + ifdSize(exifEntries);
  ifd0[3].values = [exifOffset];
  if (withGps) ifd0[4].values = [gpsOffset];

  const total = gpsOffset + (withGps ? ifdSize(gpsEntries) : 0);
  const tiff = new Uint8Array(total);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  view.setUint32(4, 8, true);
  writeIfd(view, 8, ifd0);
  writeIfd(view, exifOffset, exifEntries);
  if (withGps) writeIfd(view, gpsOffset, gpsEntries);

  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe0, str('JFIF')),
    ...segment(0xe1, [...str('Exif'), 0, ...tiff]),
    ...segment(0xe2, [...str('ICC_PROFILE'), 1, 1]),
    ...segment(0xfe, [...'shot from the balcony'].map((c) => c.charCodeAt(0))),
    ...segment(0xda, [0, 1, 2]), 0x12, 0x34, 0x56,
    0xff, 0xd9,
  ]);
}
