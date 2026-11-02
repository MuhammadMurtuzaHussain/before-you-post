// A small, dependency-free JPEG metadata reader and stripper.
// Runs the same in the browser and in Node, so the tests exercise the real code.

const TAGS_IFD0 = {
  0x010f: 'make',
  0x0110: 'model',
  0x0112: 'orientation',
  0x0131: 'software',
  0x0132: 'dateTime',
  0x013b: 'artist',
  0x8298: 'copyright',
  0x8769: 'exifPointer',
  0x8825: 'gpsPointer',
};

const TAGS_EXIF = {
  0x9003: 'dateTimeOriginal',
  0x9011: 'offsetTimeOriginal',
  0xa430: 'cameraOwnerName',
  0xa431: 'bodySerialNumber',
  0xa433: 'lensMake',
  0xa434: 'lensModel',
};

const TAGS_GPS = {
  0x0001: 'latRef',
  0x0002: 'lat',
  0x0003: 'lonRef',
  0x0004: 'lon',
  0x0005: 'altRef',
  0x0006: 'alt',
  0x0011: 'imgDirection',
  0x001d: 'dateStamp',
};

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

const XMP_ID = 'http://ns.adobe.com/xap/1.0/';

function ascii(bytes, start, len) {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Walks the JPEG marker segments up to the start of scan. */
export function readSegments(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG file');
  const segments = [];
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) throw new Error(`Bad marker at byte ${pos}`);
    const marker = bytes[pos + 1];
    if (marker === 0xff) { pos++; continue; } // fill byte
    if (marker === 0xda || marker === 0xd9) {
      segments.push({ marker, start: pos, end: bytes.length, rest: true });
      break;
    }
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
    segments.push({ marker, start: pos, end: pos + 2 + len, dataStart: pos + 4 });
    pos += 2 + len;
  }
  return { bytes, segments };
}

function readIfd(view, tiffStart, ifdOffset, little, names) {
  const out = {};
  const count = view.getUint16(tiffStart + ifdOffset, little);
  for (let i = 0; i < count; i++) {
    const entry = tiffStart + ifdOffset + 2 + i * 12;
    const tag = view.getUint16(entry, little);
    const name = names[tag];
    if (!name) continue;
    const type = view.getUint16(entry + 2, little);
    const n = view.getUint32(entry + 4, little);
    const size = (TYPE_SIZE[type] || 1) * n;
    const at = size > 4 ? tiffStart + view.getUint32(entry + 8, little) : entry + 8;
    if (at + size > view.byteLength) continue;
    out[name] = readValue(view, at, type, n, little);
  }
  return out;
}

function readValue(view, at, type, n, little) {
  const vals = [];
  for (let i = 0; i < n; i++) {
    switch (type) {
      case 2: {
        let s = '';
        for (let j = 0; j < n; j++) {
          const c = view.getUint8(at + j);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s.trim();
      }
      case 1: case 7: vals.push(view.getUint8(at + i)); break;
      case 3: vals.push(view.getUint16(at + i * 2, little)); break;
      case 4: vals.push(view.getUint32(at + i * 4, little)); break;
      case 9: vals.push(view.getInt32(at + i * 4, little)); break;
      case 5: case 10: {
        const get = type === 5 ? 'getUint32' : 'getInt32';
        const num = view[get](at + i * 8, little);
        const den = view[get](at + i * 8 + 4, little);
        vals.push(den ? num / den : 0);
        break;
      }
      default: return null;
    }
  }
  return n === 1 ? vals[0] : vals;
}

function toDegrees(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const deg = dms[0] + dms[1] / 60 + dms[2] / 3600;
  return ref === 'S' || ref === 'W' ? -deg : deg;
}

function parseTiff(bytes, tiffStart, tiffEnd) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, tiffEnd);
  const order = ascii(bytes, tiffStart, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const ifd0 = readIfd(view, tiffStart, view.getUint32(tiffStart + 4, little), little, TAGS_IFD0);
  const exif = ifd0.exifPointer ? readIfd(view, tiffStart, ifd0.exifPointer, little, TAGS_EXIF) : {};
  const gpsRaw = ifd0.gpsPointer ? readIfd(view, tiffStart, ifd0.gpsPointer, little, TAGS_GPS) : {};
  delete ifd0.exifPointer;
  delete ifd0.gpsPointer;

  let gps = null;
  const lat = toDegrees(gpsRaw.lat, gpsRaw.latRef);
  const lon = toDegrees(gpsRaw.lon, gpsRaw.lonRef);
  if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
    gps = { lat, lon };
    if (typeof gpsRaw.alt === 'number') gps.alt = gpsRaw.altRef === 1 ? -gpsRaw.alt : gpsRaw.alt;
    if (typeof gpsRaw.imgDirection === 'number') gps.direction = gpsRaw.imgDirection;
  }
  return { ...ifd0, ...exif, gps };
}

/** Reads everything privacy-relevant from a JPEG. */
export function inspectJpeg(input) {
  const { bytes, segments } = readSegments(input);
  const report = { exif: null, hasXmp: false, hasIptc: false, comments: [], metadataBytes: 0 };
  for (const seg of segments) {
    if (seg.rest) continue;
    const { marker, dataStart, end } = seg;
    if (marker === 0xe1 && ascii(bytes, dataStart, 6) === 'Exif\0\0') {
      report.exif = parseTiff(bytes, dataStart + 6, end);
      report.metadataBytes += end - seg.start;
    } else if (marker === 0xe1 && ascii(bytes, dataStart, XMP_ID.length) === XMP_ID) {
      report.hasXmp = true;
      report.metadataBytes += end - seg.start;
    } else if (marker === 0xed) {
      report.hasIptc = true;
      report.metadataBytes += end - seg.start;
    } else if (marker === 0xfe) {
      report.comments.push(ascii(bytes, dataStart, end - dataStart));
      report.metadataBytes += end - seg.start;
    }
  }
  return report;
}

// A bare EXIF block holding only the orientation tag, so phone photos don't turn sideways.
function orientationSegment(orientation) {
  const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, ...payload]);
}

/**
 * Losslessly removes metadata segments (APP1-APP15 except the ICC colour profile,
 * plus comments). Image data is copied byte for byte, so there is no re-compression.
 * The orientation tag is the one thing put back, since it only says which way is up.
 */
export function stripJpeg(input) {
  const { bytes, segments } = readSegments(input);
  const orientation = inspectJpeg(bytes).exif?.orientation;
  const keep = [bytes.subarray(0, 2)];
  if (orientation > 1 && orientation <= 8) keep.push(orientationSegment(orientation));
  for (const seg of segments) {
    const { marker, start, end } = seg;
    const isApp = marker >= 0xe1 && marker <= 0xef;
    const isIcc = marker === 0xe2 && ascii(bytes, seg.dataStart, 11) === 'ICC_PROFILE';
    if ((isApp && !isIcc) || marker === 0xfe) continue;
    keep.push(bytes.subarray(start, end));
  }
  const out = new Uint8Array(keep.reduce((n, b) => n + b.length, 0));
  let off = 0;
  for (const b of keep) { out.set(b, off); off += b.length; }
  return out;
}

/** Turns raw metadata into plain-language findings, worst first. */
export function assess(report) {
  const e = report.exif || {};
  const findings = [];
  if (e.gps) {
    findings.push({
      level: 'high',
      title: 'Exact location',
      detail: `This photo carries GPS coordinates (${e.gps.lat.toFixed(5)}, ${e.gps.lon.toFixed(5)}). Anyone who saves the original can see where it was taken, accurate to a few metres. If it was taken at home, that is your address.`,
    });
  }
  if (e.bodySerialNumber || e.cameraOwnerName) {
    findings.push({
      level: 'high',
      title: 'Links back to your device',
      detail: [
        e.cameraOwnerName && `Owner name "${e.cameraOwnerName}"`,
        e.bodySerialNumber && `camera serial number ${e.bodySerialNumber}`,
      ].filter(Boolean).join(' and ') + '. This ties every photo from this camera together, even across accounts.',
    });
  }
  const when = e.dateTimeOriginal || e.dateTime;
  if (when) {
    findings.push({
      level: 'medium',
      title: 'When it was taken',
      detail: `Taken ${when}${e.offsetTimeOriginal ? ` (UTC${e.offsetTimeOriginal})` : ''}. Paired with a location, this shows a routine: where you are, and when.`,
    });
  }
  if (e.artist || e.copyright) {
    findings.push({
      level: 'medium',
      title: 'Your name',
      detail: `Embedded credit: ${[e.artist, e.copyright].filter(Boolean).join(' / ')}.`,
    });
  }
  if (e.make || e.model || e.lensModel || e.software) {
    findings.push({
      level: 'low',
      title: 'What you shot it on',
      detail: [e.make, e.model, e.lensModel, e.software && `edited with ${e.software}`].filter(Boolean).join(', ') + '. Mostly harmless, but it narrows down who you are.',
    });
  }
  if (report.hasXmp) findings.push({ level: 'low', title: 'Editing history (XMP)', detail: 'Adobe-style metadata can include edit history, original file names and keywords.' });
  if (report.hasIptc) findings.push({ level: 'low', title: 'Caption block (IPTC)', detail: 'A press-style caption block can hold names, places and contact details.' });
  if (report.comments.length) findings.push({ level: 'low', title: 'Hidden comment', detail: `"${report.comments.join(' ').slice(0, 120)}"` });
  return findings;
}
