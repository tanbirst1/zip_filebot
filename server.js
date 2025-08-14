import express from "express";
import { chromium } from "playwright";

const app = express();

app.get("/index", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send("Missing ?url parameter");
  }

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait if Cloudflare challenge appears
    await page.waitForTimeout(8000);

    const html = await page.content();
    await browser.close();

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
