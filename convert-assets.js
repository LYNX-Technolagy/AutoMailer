#!/usr/bin/env node
/**
 * Convert AutoMailer SVG assets into raster favicons and social images.
 *
 * Usage:
 *   npm install sharp
 *   node convert-assets.js
 *
 * Inputs:
 *   public/favicon.svg        (100x100)
 *   public/social-preview.svg (1200x630)
 *
 * Outputs:
 *   public/favicon-32x32.png      32x32
 *   public/apple-touch-icon.png   180x180
 *   public/social-preview.png     1200x630 PNG
 *   public/social-preview.jpg     1200x630 JPEG (q=88)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PUBLIC = path.join(__dirname, 'public');

async function ensureInput(file) {
  const p = path.join(PUBLIC, file);
  if (!fs.existsSync(p)) {
    throw new Error(`Missing input: ${p}`);
  }
  return p;
}

async function report(outPath, label) {
  const stat = fs.statSync(outPath);
  const sizeKb = (stat.size / 1024).toFixed(1);
  console.log(`  ✓ ${label.padEnd(28)} ${path.basename(outPath).padEnd(28)} ${sizeKb} KB`);
}

async function main() {
  console.log('AutoMailer asset conversion\n');

  const faviconSvg = await ensureInput('favicon.svg');
  const socialSvg = await ensureInput('social-preview.svg');

  const faviconPng32 = path.join(PUBLIC, 'favicon-32x32.png');
  const appleTouch = path.join(PUBLIC, 'apple-touch-icon.png');
  const socialPng = path.join(PUBLIC, 'social-preview.png');
  const socialJpg = path.join(PUBLIC, 'social-preview.jpg');

  // --- Favicon ---
  console.log('Favicon');
  await sharp(faviconSvg)
    .resize(32, 32, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(faviconPng32);
  await report(faviconPng32, 'favicon-32x32.png');

  await sharp(faviconSvg)
    .resize(180, 180, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(appleTouch);
  await report(appleTouch, 'apple-touch-icon.png');

  // --- Social preview ---
  console.log('\nSocial preview');
  await sharp(socialSvg, { density: 144 })
    .resize(1200, 630)
    .png({ compressionLevel: 9 })
    .toFile(socialPng);
  await report(socialPng, 'social-preview.png');

  await sharp(socialSvg, { density: 144 })
    .resize(1200, 630)
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(socialJpg);
  await report(socialJpg, 'social-preview.jpg');

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nAsset conversion failed:');
  console.error(err.message);
  process.exit(1);
});