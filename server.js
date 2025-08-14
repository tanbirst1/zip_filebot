/**
 * server.js
 *
 * Playwright-based captcha-aware fetcher.
 * Route: /api/fetch.js?url=<target>
 *
 * IMPORTANT: This does NOT bypass CAPTCHAs. If a protection/challenge is detected,
 * the server returns a screenshot + an instruction to open the site in a real browser.
 *
 * Deploy notes: install dependencies, then run `npm run install-playwright-browsers`
 * to download browser binaries (or run with an environment where Playwright is preinstalled).
 */

import express from "express";
import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const app = express();
app.use(express.static("public"));

// Basic CORS for convenience (modify for production)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

const DEFAULT_TIMEOUT = 20000; // ms

function normalizeTarget(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Detect verification / challenge pages heuristically by:
 *  - HTTP status codes
 *  - page text patterns: "checking your browser", "verify", "cf-browser-verification", "captcha"
 *  - presence of common Cloudflare-ish elements
 */
function isVerificationText(text, status, headers) {
  const sample = (text || "").toLowerCase();
  const patterns = [
    "attention required",
    "checking your browser",
    "verify you are human",
    "cf-browser-verification",
    "please enable javascript and cookies",
    "captcha",
    "are you a human",
    "hcaptcha",
    "recaptcha",
    "cloudflare"
  ];

  if (status === 403 || status === 503) return true;
  for (const p of patterns) {
    if (sample.includes(p)) return true;
  }

  // headers hint
  const server = (headers["server"] || "").toLowerCase();
  if (server.includes("cloudflare")) return true;
  if (headers["cf-ray"] || headers["cf-chl-bypass"]) return true;

  return false;
}

async function fetchWithPlaywright(target, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const headless = opts.headless ?? true; // run headless by default on servers
  const browser = await chromium.launch({ headless, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const context = await browser.newContext({
    // Minimal, but you can set viewport, userAgent etc here:
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });

  const page = await context.newPage();
  let response = null;
  let status = null;
  let headers = {};

  try {
    response = await page.goto(target, { waitUntil: "networkidle", timeout });
    if (response) {
      status = response.status();
      const rawHeaders = response.headers();
      headers = rawHeaders;
    }

    // Give the page a short extra time in case it runs JS checks
    await page.waitForTimeout(800);

    // grab full HTML
    const html = await page.content();

    // Also collect some text sample
    const textSample = await page.evaluate(() => {
      // Try to get visible text limited to first X chars
      const bodyText = document.body ? document.body.innerText || "" : "";
      return bodyText.slice(0, 10000);
    });

    // Detect verification
    const isVerification = isVerificationText(textSample, status, headers);

    // Capture screenshot (in case of verification or for user debug)
    const screenshotBuffer = await page.screenshot({ fullPage: false }); // smaller than fullPage
    await browser.close();

    return {
      ok: !isVerification,
      verification_required: !!isVerification,
      status,
      headers,
      html,
      textSample,
      screenshot: screenshotBuffer.toString("base64"),
    };
  } catch (err) {
    try { await browser.close(); } catch {}
    throw err;
  }
}

/**
 * API route - use same pattern: /api/fetch.js?url=...
 */
app.get("/api/fetch.js", async (req, res) => {
  const raw = req.query.url;
  const target = normalizeTarget(raw);
  if (!target) return res.status(400).json({ ok: false, error: "Invalid or missing url" });

  // Lightweight rate-limit placeholder (for public deployments you must add real rate-limiting)
  // You can check req.ip to limit requests

  try {
    // Use Playwright to render the page
    const result = await fetchWithPlaywright(target, { headless: true, timeout: 25000 });

    if (result.verification_required) {
      return res.json({
        ok: false,
        verification_required: true,
        message:
          "This site appears to require a browser verification (e.g., CAPTCHA/human check). Open the site in a normal browser and complete verification, then try again.",
        url: target,
        screenshot_base64: result.screenshot // client can render this
      });
    }

    // Normal success: return the rendered HTML and a small text sample
    return res.json({
      ok: true,
      status: result.status,
      headers: result.headers,
      html: result.html,
      textSample: result.textSample
      // NOTE: screenshot omitted on success to keep response small
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * Simple homepage UI that shows preview + screenshot if verification detected.
 * This HTML is served from / and calls /api/fetch.js
 */
app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Playwright Fetcher (Captcha-Aware)</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;background:#0f1724;color:#e6eef8;padding:20px}
  .card{max-width:980px;margin:0 auto;background:#0b1220;padding:18px;border-radius:12px;border:1px solid #1f2a44}
  input[type=url]{width:100%;padding:12px;border-radius:10px;border:1px solid #233046;background:#071026;color:#e6eef8}
  button{padding:10px 14px;border-radius:10px;border:none;background:#2b72ff;color:white;cursor:pointer}
  pre{background:#071226;padding:12px;border-radius:8px;overflow:auto}
  img.sshot{max-width:100%;border-radius:8px;border:1px solid #24324a}
</style>
</head>
<body>
  <div class="card">
    <h2>Playwright Fetcher (Captcha-Aware)</h2>
    <p>Enter a URL. The server will render it with Playwright. If a verification is found, you'll get a screenshot and instructions. This does not bypass protections.</p>

    <form id="f">
      <input id="u" type="url" placeholder="https://example.com" required />
      <div style="margin-top:10px"><button id="go" type="submit">Fetch</button></div>
    </form>

    <hr style="margin:16px 0;border:none;border-top:1px solid #122033" />

    <div id="result">Result will appear here.</div>
  </div>

<script>
const form = document.getElementById('f');
const u = document.getElementById('u');
const out = document.getElementById('result');
const go = document.getElementById('go');

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const url = u.value.trim();
  if (!url) return;
  go.disabled = true;
  out.innerHTML = "<p>Rendering with Playwright… (this may take a few seconds)</p>";

  try {
    const resp = await fetch('/api/fetch.js?url=' + encodeURIComponent(url));
    const data = await resp.json();
    if (!data.ok && data.verification_required) {
      const sshot = data.screenshot_base64 ? '<img class="sshot" src="data:image/png;base64,' + data.screenshot_base64 + '" alt="screenshot"/>' : '';
      out.innerHTML = \`
        <p><strong>Verification required</strong></p>
        <p>\${data.message}</p>
        <p><a href="\${data.url}" target="_blank" rel="noopener">Open the page in your browser to complete verification</a></p>
        \${sshot}
      \`;
      return;
    }

    if (data.ok) {
      // Show small preview of HTML
      const snippet = data.html.slice(0, 8000);
      out.innerHTML = '<p><strong>Rendered HTML (preview):</strong></p><pre></pre>';
      out.querySelector('pre').textContent = snippet + (data.html.length > 8000 ? "\\n…(truncated)" : "");
    } else {
      out.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
    }
  } catch (err) {
    out.innerHTML = '<pre>' + String(err) + '</pre>';
  } finally {
    go.disabled = false;
  }
});
</script>
</body>
</html>`);
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on port", PORT));
