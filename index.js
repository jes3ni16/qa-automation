import express from 'express';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

const builtInDevices = puppeteer.devices;

// ES modules dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load config
const sites = JSON.parse(fs.readFileSync(path.join(__dirname, 'sites.json'), 'utf-8'));
const devices = JSON.parse(fs.readFileSync(path.join(__dirname, 'devices.json'), 'utf-8'));

// Custom devices if needed
const customDevices = {
  "iPhone 13": {
    name: "iPhone 13",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  },
  "iPad": {
    name: "iPad",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  },
  "Desktop": {
    name: "Desktop",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
  }
};

// Helpers
function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// Fetch URLs from sitemap
async function fetchSitemapUrls(sitemapUrl) {
  try {
    const res = await fetch(sitemapUrl);
    const xml = await res.text();
    const parsed = await parseStringPromise(xml);
    let urls = [];

    if (parsed.urlset?.url) {
      urls = parsed.urlset.url.map(u => u.loc[0]);
    }

    if (parsed.sitemapindex?.sitemap) {
      for (const sm of parsed.sitemapindex.sitemap) {
        const nested = await fetchSitemapUrls(sm.loc[0]);
        urls.push(...nested);
      }
    }
    return urls;
  } catch (err) {
    console.error("Sitemap fetch failed:", err.message);
    return [];
  }
}

// Automate a single page
async function automatePage(url, browser, folderPath) {
  const page = await browser.newPage();
  const allHeadings = [];

  try {
    for (const device of devices) {
      // Determine emulated device
      let emulatedDevice = customDevices[device.name] || builtInDevices[device.name];

  if (emulatedDevice) {
    await page.emulate(emulatedDevice);
    const ua = await page.evaluate(() => navigator.userAgent);
    sendLog(`✅ Emulating device: ${device.name}`);
    sendLog(`User Agent after emulation: ${ua}`);
} else if (device.width && device.height) {
    sendLog(`⚠ Using viewport fallback for: ${device.name}`);
} else {
    sendLog(`❌ Device not found: ${device.name}, skipping emulation.`);
}

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      await delay(1500);

      // Collect headings
      const headings = await page.evaluate(() => {
        return [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(el => ({
          level: el.tagName.toLowerCase(),
          text: el.textContent.trim()
        }));
      });
      allHeadings.push({ device: device.name, headings });

      // Screenshot
      const screenshotPath = path.join(folderPath, `${device.name.replace(/\s+/g, '_')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
    }

    saveJson(path.join(folderPath, 'headings.json'), allHeadings);

  } catch (err) {
    console.error("Page automation error:", err.message);
  } finally {
    await page.close();
  }
}

// POST endpoint
app.post('/run', async (req, res) => {
  const { siteKey } = req.body;
  if (!sites[siteKey]) return res.status(400).json({ message: 'Invalid site selected' });

  // Batch folder named after siteKey
  const batchFolder = path.join('automation_outputs', siteKey);
  if (!fs.existsSync(batchFolder)) fs.mkdirSync(batchFolder, { recursive: true });

  const browser = await puppeteer.launch({ headless: false });

  try {
    const { sitemaps } = sites[siteKey];
    let allUrls = [];

    for (const sm of sitemaps) {
      const urls = await fetchSitemapUrls(sm);
      allUrls.push(...urls);
    }

    for (const url of allUrls) {
      const safeName = url.replace(/https?:\/\//, '').replace(/\//g, '_');
      const pageFolder = path.join(batchFolder, safeName);
      if (!fs.existsSync(pageFolder)) fs.mkdirSync(pageFolder, { recursive: true });

      await automatePage(url, browser, pageFolder);
    }

    await browser.close();
    res.json({ message: `✔ OUTPUT SAVED IN: ${batchFolder}` });

  } catch (err) {
    await browser.close();
    res.status(500).json({ message: err.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


let clients = [];

app.get('/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push(res);

    req.on('close', () => {
        clients = clients.filter(c => c !== res);
    });
});

// Helper to send log to all clients
function sendLog(message) {
    clients.forEach(client => client.write(`data: ${message}\n\n`));
}

app.listen(3000, () => console.log("🌍 Web app running at http://localhost:3000"));


