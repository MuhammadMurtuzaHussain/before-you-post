import { inspectJpeg, stripJpeg, assess } from './exif.js';

const $ = (id) => document.getElementById(id);
const drop = $('drop');
const picker = $('picker');
const results = $('results');
const toolbar = $('toolbar');
const summary = $('summary');
const template = $('card');

const items = [];

const LEVEL_LABEL = { high: 'Gives a lot away', medium: 'Some exposure', low: 'Minor details', clean: 'Clean' };

function isJpeg(bytes) {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

function cleanName(name, ext) {
  return name.replace(/\.[^.]+$/, '') + '-clean.' + ext;
}

// Non-JPEG files: draw to a canvas and export. A canvas carries no metadata at all.
async function redraw(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const keepPng = file.type === 'image/png';
  const blob = await new Promise((r) => canvas.toBlob(r, keepPng ? 'image/png' : 'image/jpeg', 0.95));
  return { blob, name: cleanName(file.name, keepPng ? 'png' : 'jpg') };
}

async function analyse(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isJpeg(bytes)) {
    const report = inspectJpeg(bytes);
    return {
      file,
      report,
      findings: assess(report),
      clean: async () => ({ blob: new Blob([stripJpeg(bytes)], { type: 'image/jpeg' }), name: cleanName(file.name, 'jpg') }),
    };
  }
  return {
    file,
    report: null,
    findings: [{ level: 'low', title: 'Not read', detail: `${file.type || 'This format'} isn't parsed here, so assume it may carry metadata. The clean copy is redrawn from pixels and carries none.` }],
    clean: () => redraw(file),
  };
}

function worst(findings) {
  for (const level of ['high', 'medium', 'low']) if (findings.some((f) => f.level === level)) return level;
  return 'clean';
}

function download({ blob, name }) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function render(item) {
  const node = template.content.firstElementChild.cloneNode(true);
  const level = worst(item.findings);
  node.dataset.level = level;
  node.querySelector('.thumb').src = URL.createObjectURL(item.file);
  node.querySelector('.name').textContent = item.file.name;
  node.querySelector('.badge').textContent = LEVEL_LABEL[level];

  const list = node.querySelector('.findings');
  if (!item.findings.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'No metadata found. This one is safe to post as it is.';
    list.append(li);
  }
  for (const f of item.findings) {
    const li = document.createElement('li');
    li.dataset.level = f.level;
    const strong = document.createElement('strong');
    strong.textContent = f.title;
    li.append(strong, ' ', f.detail);
    list.append(li);
  }

  const gps = item.report?.exif?.gps;
  if (gps) {
    const map = node.querySelector('.map');
    map.href = `https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=17/${gps.lat}/${gps.lon}`;
    map.title = 'Opens OpenStreetMap, which will receive these coordinates';
    map.hidden = false;
  }

  node.querySelector('.clean').addEventListener('click', async () => download(await item.clean()));
  results.append(node);
}

function updateSummary() {
  const risky = items.filter((i) => ['high', 'medium'].includes(worst(i.findings))).length;
  const located = items.filter((i) => i.report?.exif?.gps).length;
  const parts = [`${items.length} photo${items.length === 1 ? '' : 's'} checked`];
  if (located) parts.push(`${located} with an exact location`);
  else if (risky) parts.push(`${risky} worth cleaning`);
  else parts.push('nothing sensitive found');
  summary.textContent = parts.join(', ') + '.';
  toolbar.hidden = false;
}

async function handle(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/') && !/\.(jpe?g|heic|png|webp)$/i.test(file.name)) continue;
    try {
      const item = await analyse(file);
      items.push(item);
      render(item);
    } catch (err) {
      const li = document.createElement('li');
      li.className = 'card error';
      li.textContent = `${file.name}: ${err.message}`;
      results.append(li);
    }
  }
  if (items.length) updateSummary();
}

picker.addEventListener('change', () => { handle([...picker.files]); picker.value = ''; });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  handle([...e.dataTransfer.files]);
});

$('clean-all').addEventListener('click', async () => {
  for (const item of items) {
    try { download(await item.clean()); } catch { /* the card already shows why */ }
    await new Promise((r) => setTimeout(r, 250)); // browsers drop rapid-fire downloads
  }
});
