const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.send("Missing ?url parameter");

    try {
        const browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

        const page = await browser.newPage();
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

        // Wait for potential Cloudflare challenge
        await page.waitForTimeout(8000);

        const html = await page.content();
        await browser.close();

        res.set("Content-Type", "text/html");
        res.send(html);

    } catch (error) {
        res.status(500).send(error.toString());
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
