#!/usr/bin/env node
// Post-deploy gate for the Deploy workflow (see .github/workflows/deploy.yml).
//
// A 200 response for index.html and its JS bundle proves nothing about
// whether the app actually runs — that's exactly what stayed green while
// the site was a blank white page (a duplicate React copy threw
// `Cannot read properties of null (reading 'useRef')` on load; see #28).
// This loads the real page in a real browser and checks the login form
// actually renders, with no uncaught JS errors along the way.
//
// Retries for a bit: BucketDeployment kicks off a CloudFront invalidation
// but doesn't wait for it, so the edge can serve the previous build for a
// short window right after `cdk deploy` returns.

import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/smoke-test.mjs <url>');
  process.exit(1);
}

const RETRY_FOR_MS = 90_000;
const RETRY_INTERVAL_MS = 5_000;

const browser = await chromium.launch();
const page = await browser.newPage();

let lastFailure = 'unknown error';
const deadline = Date.now() + RETRY_FOR_MS;

while (Date.now() < deadline) {
  const pageErrors = [];
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 15_000 });
    await page.waitForSelector('.auth-form h1', { timeout: 5_000 });
    const heading = await page.textContent('.auth-form h1');
    if (heading?.trim() !== 'Sign in') {
      lastFailure = `expected the "Sign in" form, got heading "${heading}"`;
    } else if (pageErrors.length > 0) {
      lastFailure = `page rendered but logged console errors: ${pageErrors.join('; ')}`;
    } else {
      console.log(`Smoke test passed: ${url} rendered the login form with no console errors.`);
      await browser.close();
      process.exit(0);
    }
  } catch (err) {
    lastFailure = err instanceof Error ? err.message : String(err);
  }

  await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
}

console.error(`Smoke test failed for ${url} after ${RETRY_FOR_MS / 1000}s: ${lastFailure}`);
await browser.close();
process.exit(1);
