const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;
const TARGET_CALENDAR = process.env.TARGET_CALENDAR || 'ABR';

const DATA_DIR = '/app/data';
const OUTPUT_FILE = path.join(DATA_DIR, 'abr-latest.png');
const STATUS_FILE = path.join(DATA_DIR, 'abr-status.json');
const PROFILE_DIR = path.join(DATA_DIR, 'chrome-profile');

const INTERVAL_MS = 10000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

async function showOnlyCalendar(page, targetName) {
  return await page.evaluate((name) => {
    const rows = Array.from(
      document.querySelectorAll('li[data-test-id="expanded-calendar-list-item"]')
    );

    const row = rows.find(r => {
      const h2 = r.querySelector('h2');
      return h2 && h2.innerText.trim() === name;
    });

    if (!row) {
      return {
        ok: false,
        reason: `Row not found for ${name}`,
        availableCalendars: Array.from(
          document.querySelectorAll('li[data-test-id="expanded-calendar-list-item"] h2')
        ).map(el => el.innerText.trim()),
        currentUrl: location.href
      };
    }

    const button = row.querySelector(
      'button[data-test-id="calendar-list-item-single-select-button"]'
    );

    if (!button) {
      return { ok: false, reason: 'Single-select button not found' };
    }

    button.click();
    return { ok: true };
  }, targetName);
}

async function captureCalendar(page) {
  const calendar = await page.$('[data-test-id="monthly-calendar"]');
  if (!calendar) return null;
  return await calendar.screenshot({ type: 'png' });
}

async function writeStatus(obj) {
  ensureDataDir();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 2));
}

async function monitorLoop() {
  ensureDataDir();

  let browser;
  let page;
  let lastHash = null;

  while (true) {
    try {
      if (!browser) {
        browser = await puppeteer.launch({
          headless: true,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
          userDataDir: PROFILE_DIR,
          defaultViewport: { width: 1600, height: 2200 },
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1600,2200'
          ]
        });
        page = await browser.newPage();
      }

      await page.goto('https://timetreeapp.com/', {
        waitUntil: 'networkidle2'
      });

      await page.waitForSelector('body');
      await sleep(3000);

      const selectResult = await showOnlyCalendar(page, TARGET_CALENDAR);

      if (!selectResult.ok) {
        await writeStatus({
          ok: false,
          calendar: TARGET_CALENDAR,
          last_checked: new Date().toISOString(),
          reason: selectResult.reason,
          debug: selectResult
        });
        await sleep(INTERVAL_MS);
        continue;
      }

      await sleep(3000);

      const imageBuffer = await captureCalendar(page);

      if (!imageBuffer) {
        await writeStatus({
          ok: false,
          calendar: TARGET_CALENDAR,
          last_checked: new Date().toISOString(),
          reason: 'Monthly calendar not found'
        });
        await sleep(INTERVAL_MS);
        continue;
      }

      const currentHash = hashBuffer(imageBuffer);
      let changed = false;

      if (currentHash !== lastHash) {
        fs.writeFileSync(OUTPUT_FILE, imageBuffer);
        lastHash = currentHash;
        changed = true;
      }

      await writeStatus({
        ok: true,
        calendar: TARGET_CALENDAR,
        last_checked: new Date().toISOString(),
        changed,
        image_file: '/latest.png'
      });
    } catch (err) {
      await writeStatus({
        ok: false,
        calendar: TARGET_CALENDAR,
        last_checked: new Date().toISOString(),
        reason: err.message
      });

      try {
        if (browser) await browser.close();
      } catch {}

      browser = null;
      page = null;
    }

    await sleep(INTERVAL_MS);
  }
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <meta http-equiv="refresh" content="10">
        <title>TimeTree Monitor</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; margin: 20px; }
          img { max-width: 100%; height: auto; border: 1px solid #ccc; }
        </style>
      </head>
      <body>
        <h1>${TARGET_CALENDAR} Monitor</h1>
        <p><a href="/status.json">status.json</a></p>
        <img src="/latest.png?t=${Date.now()}" alt="Latest calendar screenshot" />
      </body>
    </html>
  `);
});

app.get('/latest.png', (req, res) => {
  if (!fs.existsSync(OUTPUT_FILE)) {
    return res.status(404).send('No screenshot yet');
  }
  res.sendFile(OUTPUT_FILE);
});

app.get('/status.json', (req, res) => {
  if (!fs.existsSync(STATUS_FILE)) {
    return res.json({ ok: false, reason: 'No status yet' });
  }
  res.sendFile(STATUS_FILE);
});

app.listen(PORT, async () => {
  ensureDataDir();
  console.log(`Server listening on port ${PORT}`);
  monitorLoop();
});
