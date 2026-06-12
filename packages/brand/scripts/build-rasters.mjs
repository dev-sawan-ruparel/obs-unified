#!/usr/bin/env node
/*
 * Render raster fallbacks (PNG, ICO) from the SVG sources.
 *
 * SVGs are the source of truth — this script only produces the
 * formats that legacy targets still require: favicon.ico for old
 * browsers, apple-touch-icon.png for iOS home-screen, PWA manifest
 * icons (192/512), and the social-card og.jpg fallbacks.
 *
 * Run: pnpm --filter @obsunified/brand build:rasters
 * Requires: sharp (devDependency of this package).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let sharp;
try {
	sharp = (await import("sharp")).default;
} catch {
	console.error(
		"\n[brand] sharp is not installed. Run `pnpm install` in packages/brand first.\n",
	);
	process.exit(1);
}

async function svgToPng(svgPath, outPath, width, height = width) {
	const svg = await readFile(svgPath);
	const buf = await sharp(svg, { density: 384 })
		.resize(width, height, {
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png({ compressionLevel: 9 })
		.toBuffer();
	await writeFile(outPath, buf);
	console.log(`  → ${outPath.replace(`${ROOT}/`, "")} (${width}×${height})`);
}

async function svgToJpg(svgPath, outPath, width, height) {
	const svg = await readFile(svgPath);
	const buf = await sharp(svg, { density: 192 })
		.resize(width, height, { fit: "contain", background: "#FFFFFF" })
		.jpeg({ quality: 88, mozjpeg: true })
		.toBuffer();
	await writeFile(outPath, buf);
	console.log(`  → ${outPath.replace(`${ROOT}/`, "")} (${width}×${height})`);
}

/*
 * .ico from a PNG — we hand-pack a single-image ICO container since
 * we don't want a transitive dep on png-to-ico for one file.
 * Multi-frame ICOs are not worth the complexity in 2026 — every
 * modern browser uses favicon.svg, .ico is bookmark-toolbar only.
 */
async function pngBufferToIco(svgPath, outPath, size = 32) {
	const svg = await readFile(svgPath);
	const png = await sharp(svg, { density: 384 })
		.resize(size, size)
		.png()
		.toBuffer();

	const ICONDIR = Buffer.alloc(6);
	ICONDIR.writeUInt16LE(0, 0);
	ICONDIR.writeUInt16LE(1, 2);
	ICONDIR.writeUInt16LE(1, 4);

	const ICONDIRENTRY = Buffer.alloc(16);
	ICONDIRENTRY.writeUInt8(size === 256 ? 0 : size, 0);
	ICONDIRENTRY.writeUInt8(size === 256 ? 0 : size, 1);
	ICONDIRENTRY.writeUInt8(0, 2);
	ICONDIRENTRY.writeUInt8(0, 3);
	ICONDIRENTRY.writeUInt16LE(1, 4);
	ICONDIRENTRY.writeUInt16LE(32, 6);
	ICONDIRENTRY.writeUInt32LE(png.length, 8);
	ICONDIRENTRY.writeUInt32LE(22, 12);

	await writeFile(outPath, Buffer.concat([ICONDIR, ICONDIRENTRY, png]));
	console.log(`  → ${outPath.replace(`${ROOT}/`, "")} (${size}×${size}, ICO)`);
}

async function main() {
	await mkdir(resolve(ROOT, "favicons"), { recursive: true });
	await mkdir(resolve(ROOT, "og"), { recursive: true });

	console.log("\n[brand] rendering favicons…");
	const favicon = resolve(ROOT, "favicons/favicon.svg");
	const appleSrc = resolve(ROOT, "favicons/apple-touch-icon.svg");
	const maskableSrc = resolve(ROOT, "favicons/icon-maskable.svg");
	await svgToPng(appleSrc, resolve(ROOT, "favicons/apple-touch-icon.png"), 180);
	await svgToPng(appleSrc, resolve(ROOT, "favicons/icon-192.png"), 192);
	await svgToPng(appleSrc, resolve(ROOT, "favicons/icon-512.png"), 512);
	await svgToPng(
		maskableSrc,
		resolve(ROOT, "favicons/icon-maskable-512.png"),
		512,
	);
	await pngBufferToIco(favicon, resolve(ROOT, "favicons/favicon.ico"), 32);

	console.log("\n[brand] rendering OG cards…");
	for (const name of ["obs-unified", "docs", "presence"]) {
		const src = resolve(ROOT, `og/${name}.svg`);
		const out = resolve(ROOT, `og/${name}.jpg`);
		try {
			await svgToJpg(src, out, 1200, 630);
		} catch (err) {
			console.warn(`  skipped og/${name}.jpg — ${err.message}`);
		}
	}

	console.log("\n[brand] rendering profile banners…");
	// 1280×320 (4:1) — GitHub renders org-profile READMEs at ~900px wide,
	// so 1280 gives a clean 1.4× pixel ratio without ballooning the file.
	for (const name of ["profile", "profile-dark"]) {
		const src = resolve(ROOT, `og/${name}.svg`);
		const out = resolve(ROOT, `og/${name}.png`);
		try {
			await svgToPng(src, out, 1280, 320);
		} catch (err) {
			console.warn(`  skipped og/${name}.png — ${err.message}`);
		}
	}

	console.log("\n[brand] done.\n");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
