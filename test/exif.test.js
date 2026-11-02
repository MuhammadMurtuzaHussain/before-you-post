import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectJpeg, stripJpeg, assess } from '../src/exif.js';
import { makeJpeg } from './fixture.js';

test('reads camera, time, serial and GPS', () => {
  const r = inspectJpeg(makeJpeg());
  assert.equal(r.exif.make, 'Apple');
  assert.equal(r.exif.model, 'iPhone 15 Pro');
  assert.equal(r.exif.dateTimeOriginal, '2026:10:14 18:42:07');
  assert.equal(r.exif.bodySerialNumber, 'F2LXK9Q3PL');
  assert.ok(Math.abs(r.exif.gps.lat - 53.2707) < 1e-3);
  assert.ok(Math.abs(r.exif.gps.lon + 9.0568) < 1e-3);
  assert.deepEqual(r.comments, ['shot from the balcony']);
});

test('ranks location as the worst finding', () => {
  const findings = assess(inspectJpeg(makeJpeg()));
  assert.equal(findings[0].title, 'Exact location');
  assert.equal(findings[0].level, 'high');
  assert.ok(findings.some((f) => f.title === 'Links back to your device'));
});

test('no GPS means no location finding', () => {
  const findings = assess(inspectJpeg(makeJpeg({ withGps: false })));
  assert.ok(!findings.some((f) => f.title === 'Exact location'));
});

test('strip removes metadata but keeps image data and colour profile', () => {
  const original = makeJpeg();
  const clean = stripJpeg(original);
  const r = inspectJpeg(clean);
  assert.equal(r.exif, null);
  assert.deepEqual(r.comments, []);
  assert.deepEqual(assess(r), []);
  const tail = (b) => Array.from(b.slice(-7));
  assert.deepEqual(tail(clean), tail(original));
  const text = String.fromCharCode(...clean);
  assert.ok(text.includes('ICC_PROFILE'));
  assert.ok(text.includes('JFIF'));
});

test('strip keeps orientation so phone photos stay upright, and nothing else', () => {
  const r = inspectJpeg(stripJpeg(makeJpeg({ orientation: 6 })));
  assert.equal(r.exif.orientation, 6);
  assert.equal(r.exif.make, undefined);
  assert.equal(r.exif.gps, null);
  assert.deepEqual(assess(r), []);
});

test('rejects files that are not JPEGs', () => {
  assert.throws(() => inspectJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), /Not a JPEG/);
});
