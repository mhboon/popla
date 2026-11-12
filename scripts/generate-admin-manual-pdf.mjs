#!/usr/bin/env node
// Renders docs/admin-manual-en.pdf and docs/admin-manual-nl.pdf from the
// same content the in-app Manual page uses (web/src/content/adminManual.json)
// — one source of truth for both, so the PDF can't drift from what admins
// see in the app. Re-run this (`node scripts/generate-admin-manual-pdf.mjs`)
// and commit the result whenever that JSON file changes.
//
// Uses Playwright (see scripts/smoke-test.mjs for the same pattern) to print
// a plain, static HTML rendering to PDF — no browser-side JS, no network
// fetches (fonts are system fonts), so it works offline and in CI alike.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const manual = JSON.parse(
  readFileSync(path.join(repoRoot, 'web/src/content/adminManual.json'), 'utf8')
);

const GENERATED_LABEL = { en: 'Generated', nl: 'Gegenereerd op' };
const PAGE_LABEL = { en: 'Page', nl: 'Pagina' };

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderBlock(block, lang) {
  switch (block.type) {
    case 'h3':
      return `<h3>${escapeHtml(block[lang])}</h3>`;
    case 'p':
      return `<p>${escapeHtml(block[lang])}</p>`;
    case 'note':
      return `<p class="note">${escapeHtml(block[lang])}</p>`;
    case 'ul':
      return `<ul>${block[lang].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    case 'ol':
      return `<ol>${block[lang].map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
    default:
      return '';
  }
}

function renderHtml(lang) {
  const today = new Date().toISOString().slice(0, 10);
  const sections = manual.sections
    .map(
      (section) => `
        <section>
          <h2>${escapeHtml(section.title[lang])}</h2>
          ${section.blocks.map((block) => renderBlock(block, lang)).join('\n')}
        </section>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<style>
  :root {
    --ink: #1c1f22;
    --slate: #5b6269;
    --border: #d7dbd8;
    --ball-deep: #8fae1f;
  }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: var(--ink);
    margin: 0;
    padding: 0 8mm;
    font-size: 11.5pt;
    line-height: 1.5;
  }
  h1, h2, h3 {
    font-family: Helvetica, Arial, sans-serif;
    font-weight: 700;
    color: var(--ink);
  }
  h1 { font-size: 22pt; margin-bottom: 2mm; }
  h2 {
    font-size: 15pt;
    margin-top: 10mm;
    padding-bottom: 1.5mm;
    border-bottom: 2px solid var(--ball-deep);
  }
  h3 { font-size: 12.5pt; margin-top: 6mm; margin-bottom: 1mm; }
  p { margin: 2.5mm 0; }
  ul, ol { margin: 2mm 0 3mm; padding-left: 5mm; }
  li { margin-bottom: 1.5mm; }
  .cover-meta { color: var(--slate); font-size: 10pt; margin-top: 1mm; }
  .intro { color: var(--slate); font-style: italic; }
  .note {
    border-left: 3px solid var(--ball-deep);
    padding: 1.5mm 0 1.5mm 4mm;
    color: var(--slate);
    font-size: 10.5pt;
  }
  section:first-of-type { page-break-before: auto; }
  section { page-break-inside: avoid; }
</style>
</head>
<body>
  <h1>${escapeHtml(manual.title[lang])}</h1>
  <p class="cover-meta">${GENERATED_LABEL[lang]}: ${today}</p>
  <p class="intro">${escapeHtml(manual.intro[lang])}</p>
  ${sections}
</body>
</html>`;
}

async function renderPdf(lang, outFile) {
  // Some sandboxed build environments ship their own Chromium at a fixed
  // path, pinned to a different Playwright version than this repo's own —
  // fall back to it only when present; a normal dev machine or CI runner
  // (after `npx playwright install`) resolves the browser Playwright
  // itself manages.
  const sandboxChromium = '/opt/pw-browsers/chromium';
  const launchOptions = existsSync(sandboxChromium)
    ? { executablePath: sandboxChromium, args: ['--no-sandbox'] }
    : {};
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(renderHtml(lang), { waitUntil: 'load' });
    await page.pdf({
      path: outFile,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '16mm', left: '14mm', right: '14mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="font-family: Helvetica, Arial, sans-serif; font-size: 8pt; color: #5b6269; width: 100%; text-align: center;">
          Popla Cup · ${PAGE_LABEL[lang]} <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    });
  } finally {
    await browser.close();
  }
}

const outputs = [
  ['en', path.join(repoRoot, 'docs/admin-manual-en.pdf')],
  ['nl', path.join(repoRoot, 'docs/admin-manual-nl.pdf')],
];

for (const [lang, outFile] of outputs) {
  await renderPdf(lang, outFile);
  console.log(`Wrote ${path.relative(repoRoot, outFile)}`);
}
