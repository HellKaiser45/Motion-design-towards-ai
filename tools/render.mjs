#!/usr/bin/env node
// Headless verification/render tool for agent-stage examples.
// Usage: node tools/render.mjs <exampleDir> [--chrome <path>] [--frames N]
//        [--at 1.2,3.4] [--size 1280x720] [--out <dir>] [--check]

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function parseArgs(argv) {
  const args = { frames: null, at: null, size: null, chrome: null, out: null, check: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chrome') args.chrome = argv[++i];
    else if (a === '--frames') args.frames = parseInt(argv[++i], 10);
    else if (a === '--at') args.at = argv[++i];
    else if (a === '--size') args.size = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--check') args.check = true;
    else rest.push(a);
  }
  return { args, exampleRel: rest[0] };
}

async function startStaticServer(root) {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const { createServer } = req('node:http');
  const { readFile } = req('node:fs/promises');
  const { join, extname } = req('node:path');

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = join(root, p);
      if (!file.startsWith(root)) { res.writeHead(404); res.end('not found'); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'text/plain' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

async function main() {
  const { args, exampleRel } = parseArgs(process.argv.slice(2));
  if (!exampleRel) throw new Error('usage: node tools/render.mjs <exampleDir> [--chrome <path>] [--frames N] [--at t1,t2] [--size WxH] [--out <dir>] [--check]');
  const exampleName = exampleRel.split('/').filter(Boolean).pop();

  const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

  const { chromium } = await import('playwright-core');
  const executablePath = args.chrome || process.env.CHROME_PATH;
  if (!executablePath) {
    throw new Error('no Chrome executable: pass --chrome <path> or set CHROME_PATH');
  }

  const [{ server, port }, outDir] = await Promise.all([
    startStaticServer(repoRoot),
    (async () => {
      const dir = args.out || `${repoRoot}/out/${exampleName}`;
      const { mkdirSync } = await import('node:fs');
      mkdirSync(dir, { recursive: true });
      return dir;
    })(),
  ]);
  const serverUrl = `http://127.0.0.1:${port}`;

  let browser;
  const consoleLog = [];
  const report = {
    ok: false, error: null, duration: null, size: null, frames: 0,
    outDir: null, contactSheet: null, mp4: null, warnings: [], issues: [], console: consoleLog,
  };
  try {
    const fs = await import('node:fs');
    const hasLocalThree = fs.existsSync(`${repoRoot}/node_modules/three`);

    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    const ctx = await browser.newContext({ viewport: args.size ? {
      width: parseInt(args.size.split('x')[0], 10),
      height: parseInt(args.size.split('x')[1], 10),
    } : { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/GPU stall/i.test(m.text())) consoleLog.push(m.text());
    });
    page.on('pageerror', (e) => {
      if (!/GPU stall/i.test(String(e))) consoleLog.push(`pageerror: ${e}`);
    });

    if (hasLocalThree) {
      await page.route(/^https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/three@0\.160\.0\/.*/, (route) => {
        const url = new URL(route.request().url());
        let sub = null;
        const buildM = url.pathname.match(/\/npm\/three@0\.160\.0\/(build\/three\.module\.js)$/);
        const jsmM = url.pathname.match(/\/npm\/three@0\.160\.0\/(examples\/jsm\/.+)$/);
        if (buildM) sub = buildM[1];
        else if (jsmM) sub = jsmM[1];
        else {
          const unM = url.pathname.match(/^\/three@0\.160\.0\/(.+)$/);
          if (unM) sub = unM[1];
        }
        if (!sub) return route.continue();
        const local = `${repoRoot}/node_modules/three/${sub}`;
        if (!fs.existsSync(local)) return route.abort();
        return route.fulfill({ body: fs.readFileSync(local, 'utf8'), contentType: 'text/javascript' });
      });
    }

    let navUrl = `${serverUrl}/${exampleRel}/?capture`;
    if (args.size) navUrl += `&size=${args.size}`;
    await page.goto(navUrl, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForFunction(() => Boolean(window.__agentStageMotion), null, { timeout: 15000 });
    } catch {
      report.error = 'motion never initialized (page did not expose window.__agentStageMotion)';
      report.console = consoleLog;
      report.outDir = outDir;
      console.log(JSON.stringify(report));
      process.exit(1);
    }

    const info = await page.evaluate(() => ({
      duration: window.__agentStageMotion.duration,
      size: window.__agentStageMotion.size,
      warnings: window.__agentStageMotion.warnings || [],
    }));
    report.duration = info.duration;
    report.size = info.size;
    report.warnings = info.warnings;

    const times = args.at
      ? args.at.split(',').map((s) => parseFloat(s.trim())).filter((n) => Number.isFinite(n))
      : (() => {
          const n = args.frames || (args.check ? 4 : 8);
          return Array.from({ length: n }, (_, i) => (i * info.duration) / n);
        })();

    const luminanceScript = () => {
      const c = document.querySelector('#agent-stage-root canvas');
      if (!c) return -1;
      const w = c.width, h = c.height;
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const g = off.getContext('2d');
      g.drawImage(c, 0, 0);
      const d = g.getImageData(0, 0, w, h).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 64) {
        sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        n++;
      }
      return n ? sum / n : 0;
    };

    let darkFrames = 0;
    const written = [];
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      await page.evaluate((tt) => window.__agentStageMotion.render(tt), t);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      const l = await page.evaluate(luminanceScript);
      if (l >= 0 && l < 2) darkFrames++;
      if (!args.check) {
        const shot = `${outDir}/frame-${String(i + 1).padStart(3, '0')}.png`;
        await page.screenshot({ path: shot, fullPage: true });
        written.push(shot);
      }
    }
    report.frames = times.length;

    if (times.length > 0 && darkFrames === times.length) {
      report.issues.push('every sampled 3D frame is almost black — check lights, camera distance, exposure, or that objects have a visible material');
    }

    if (!args.check && written.length > 0) {
      const cols = Math.ceil(Math.sqrt(written.length));
      const rows = Math.ceil(written.length / cols);
      const sheet = await ctx.newPage();
      const rel = outDir.startsWith(repoRoot) ? outDir.slice(repoRoot.length + 1) : outDir.replace(/^\//, '');
      const imgs = written
        .map((p) => `<img src="${serverUrl}/${rel}/${p.split('/').pop()}" style="width:100%;display:block">`)
        .join('');
      await sheet.setContent(
        `<body style="display:grid;grid-template-columns:repeat(${cols},1fr);align-content:start;gap:6px;padding:6px;margin:0">${imgs}</body>`,
        { waitUntil: 'load' }
      );
      await sheet.setViewportSize({ width: cols * 480, height: rows * 270 + 40 });
      const shot = `${outDir}/contact.png`;
      await sheet.screenshot({ path: shot, fullPage: true });
      report.contactSheet = shot;
    }

    report.outDir = outDir;
    report.ok = !report.error && report.issues.length === 0 && consoleLog.length === 0;
    console.log(JSON.stringify(report));
    process.exit(report.ok ? 0 : 1);
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
    process.exit(1);
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    server.close();
  }
}

await main();
