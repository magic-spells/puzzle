/**
 * make-icons.mjs — regenerate the placeholder toolbar/panel icons.
 *
 * Placeholders only: a solid rounded-ish square in Puzzle's accent violet. Run
 * `node scripts/make-icons.mjs` after changing ACCENT; the PNGs are committed so
 * the normal build never needs an image toolchain.
 *
 * Encodes PNG by hand (8-bit RGBA, one IDAT, zlib from node:zlib) — no deps.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'extension', 'icons');

const ACCENT = [124, 92, 246, 255]; // #7c5cf6
const SIZES = [16, 48, 128];

function crc32(buf) {
	let c;
	const table = crc32.table ?? (crc32.table = buildTable());
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = (crc ^ buf[i]) & 0xff;
		crc = (crc >>> 8) ^ table[c];
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function buildTable() {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([length, body, crc]);
}

/** Solid square with a 1px-ish transparent margin so it reads as an icon, not a block. */
function pixels(size) {
	const margin = size >= 48 ? Math.round(size * 0.1) : 1;
	const rows = [];
	for (let y = 0; y < size; y++) {
		const row = Buffer.alloc(1 + size * 4); // leading filter byte (0 = None)
		for (let x = 0; x < size; x++) {
			const inside = x >= margin && y >= margin && x < size - margin && y < size - margin;
			const off = 1 + x * 4;
			if (inside) {
				row[off] = ACCENT[0];
				row[off + 1] = ACCENT[1];
				row[off + 2] = ACCENT[2];
				row[off + 3] = ACCENT[3];
			}
		}
		rows.push(row);
	}
	return Buffer.concat(rows);
}

function png(size) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type: RGBA
	ihdr[10] = 0; // deflate
	ihdr[11] = 0; // adaptive filtering
	ihdr[12] = 0; // no interlace
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(pixels(size), { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
	const file = join(OUT_DIR, `icon${size}.png`);
	writeFileSync(file, png(size));
	console.log(`wrote ${file}`);
}
