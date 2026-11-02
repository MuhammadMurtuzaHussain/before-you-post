# Before You Post

See what a photo gives away before you post it, then strip it. Runs entirely in your browser: the file never leaves the tab.

Your phone writes more into a photo than the picture. A travel vlog still or a "just got home" snap can carry:

| What | Why it matters |
| --- | --- |
| **GPS coordinates** | Accurate to a few metres. Taken at home, that is your address. |
| **Camera serial number / owner name** | Ties every photo from one device together, across accounts. |
| **Exact time and timezone** | Paired with a location, it shows a routine. |
| **Make, model, lens, editing app** | Narrows down who you are. |
| **XMP, IPTC, comments** | Edit history, original file names, captions, contact details. |

Before You Post reads all of it, explains it in plain language ranked worst first, and gives you a clean copy.

## How cleaning works

- **JPEG** is cleaned byte for byte. Metadata segments are cut out and the image data is copied untouched, so there is no re-compression and no quality loss. The colour profile and the orientation flag are kept so the photo looks identical.
- **PNG, WebP, HEIC and others** are not parsed. They are redrawn from pixels through a canvas, which carries no metadata at all.

It does not cover what is *in* the picture. A street sign, a house number or a reflection still gives you away.

## Run it

No build step and no dependencies. Serve the folder with anything static:

```bash
npm start
```

or `python3 -m http.server`, then open the printed address. It can also be dropped onto GitHub Pages as is.

## Tests

The metadata reader is a small hand-written JPEG/TIFF parser in [`src/exif.js`](src/exif.js), shared by the browser and Node. The tests build JPEGs with known EXIF and GPS blocks and check that reading, ranking and stripping all behave.

```bash
npm test
```

## Privacy

No server, no analytics, no network requests. The only outbound link is the optional "Show the location on a map" button, which opens OpenStreetMap with the coordinates, and only when you click it.

## License

MIT
