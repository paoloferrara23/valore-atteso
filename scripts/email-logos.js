// scripts/email-logos.js — PNG @2x dei loghi email dagli SVG in docs/brand/ (Chromium, senza deformare).
// Uso: node scripts/email-logos.js   → email/brand/va-monogramma-crema@2x.png (128×88, trasparente)
//                                       email/brand/va-orizzontale-crema-su-ink@2x.png (360×120, fondo #1C1914)
// Gli SVG sono ricostruzioni: quando arrivano i master si sostituiscono con lo stesso nome e si rilancia.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const jobs = [
  { svg: 'monogramma-crema.svg', out: 'va-monogramma-crema@2x.png', w: 128, h: 88, bg: 'transparent' },
  { svg: 'orizzontale-crema.svg', out: 'va-orizzontale-crema-su-ink@2x.png', w: 360, h: 120, bg: '#1C1914' },
];

(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync(path.join(root, 'email', 'brand'), { recursive: true });
  for (const j of jobs) {
    const svg = fs.readFileSync(path.join(root, 'docs', 'brand', j.svg));
    const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
    await page.route('**/*', r => r.abort());
    await page.setContent(`<html><body style="margin:0;background:${j.bg};"><img src="data:image/svg+xml;base64,${svg.toString('base64')}" style="display:block;width:${j.w}px;height:${j.h}px;object-fit:contain;"></body></html>`);
    await page.screenshot({ path: path.join(root, 'email', 'brand', j.out), omitBackground: j.bg === 'transparent', clip: { x: 0, y: 0, width: j.w, height: j.h } });
    await page.close();
    console.log(`${j.out} ${j.w}×${j.h}`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
