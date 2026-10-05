#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../src/spec/validate.js';
import { reportSpec } from '../src/report/report.js';
import { frameTimes, filmstripTimes, pngFileName, ffmpegPipeArgs, ffmpegDirArgs } from '../src/export/renderSchedule.js';

const USAGE = `Usage: node scripts/export-video.mjs <spec.json> [options]

Options:
  --out <file>       Output mp4 path (default: out.mp4)
  --fps <n>          Frames per second (default: 30)
  --width <n>        Render width (default: 1280)
  --height <n>       Render height (default: 720)
  --filmstrip <n>    Instead of video, export N PNG stills to <specDir>/filmstrip/
  --help             Show this help
`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help') args.help = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--fps') args.fps = Number(argv[++i]);
    else if (a === '--width') args.width = Number(argv[++i]);
    else if (a === '--height') args.height = Number(argv[++i]);
    else if (a === '--filmstrip') args.filmstrip = Number(argv[++i]);
    else if (!args.spec) args.spec = a;
    else {
      process.stderr.write(`Unexpected argument: ${a}\n${USAGE}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.spec) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const fps = Number.isFinite(args.fps) && args.fps > 0 ? args.fps : 30;
const width = Number.isFinite(args.width) && args.width > 0 ? args.width : 1280;
const height = Number.isFinite(args.height) && args.height > 0 ? args.height : 720;
const out = args.out ?? 'out.mp4';

// --- Load + validate spec -------------------------------------------------
let spec;
try {
  spec = JSON.parse(fs.readFileSync(args.spec, 'utf8'));
} catch (err) {
  process.stderr.write(`Failed to parse spec JSON: ${err.message}\n`);
  process.exit(1);
}

const validation = validateSpec(spec);
if (!validation.ok) {
  process.stderr.write(`${validation.errors.map((e) => JSON.stringify(e)).join('\n')}\n`);
  process.exit(1);
}

// --- Headless verdict -----------------------------------------------------
const report = reportSpec(spec, { samples: 8 });
process.stdout.write(`duration: ${report.duration}\n`);
process.stdout.write(`ok: ${report.ok}\n`);
for (const issue of report.issues) {
  process.stdout.write(`issue [${issue.kind}]: ${issue.message}\n`);
}

// --- Puppeteer detection (no dependency added) -----------------------------
const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch {
  process.stderr.write(
    'puppeteer is not installed. Run "npm i -D puppeteer" to enable video/still export.\n' +
      'Alternatively, a manual headless browser can drive stage.captureFrame directly.\n',
  );
  process.exit(2);
}

// --- Static server over the repo root -------------------------------------
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.png': 'image/png',
};

function resolveSafe(relPath) {
  const abs = path.normalize(path.join(REPO_ROOT, relPath));
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + path.sep)) return null;
  return abs;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const file = resolveSafe(decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (!file) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

// --- Browser ---------------------------------------------------------------
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

let exitCode = 0;
let page;
try {
  page = await browser.newPage();
  const shell = `<!doctype html><html><body>
<script type="importmap">
{
  "imports": {
    "three": "${base}/node_modules/three/build/three.module.js",
    "gsap": "${base}/node_modules/gsap/index.js"
  }
}
</script>
<script type="module">
  import('${base}/src/index.js').then((m) => { window.agentStage = m; });
</script>
</body></html>`;
  await page.setContent(shell, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.agentStage !== undefined', { timeout: 30000 });

  const clone = { ...spec, display: { ...(spec.display ?? {}), mount: 'none' } };
  await page.evaluate(
    (specJson, w, h) => {
      const s = JSON.parse(specJson);
      window.__stage = window.agentStage.createStage(s, { width: w, height: h, webgl: true });
    },
    JSON.stringify(clone),
    width,
    height,
  );
  await page.evaluate(() => window.__stage.whenReady());

  const duration = await page.evaluate(() => window.__stage.timeline.duration());

  if (Number.isFinite(args.filmstrip) && args.filmstrip >= 1) {
    const specDir = path.dirname(path.resolve(args.spec));
    const dir = path.join(specDir, 'filmstrip');
    fs.mkdirSync(dir, { recursive: true });
    const times = filmstripTimes({ duration, count: args.filmstrip });
    for (let i = 0; i < times.length; i++) {
      const dataURL = await page.evaluate((t) => window.__stage.captureFrame(t), times[i]);
      const b64 = String(dataURL).replace(/^data:image\/png;base64,/, '');
      const file = path.join(dir, `film-${i}.png`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      process.stdout.write(`${file}\n`);
    }
    process.stdout.write(`filmstrip: ${times.length} stills in ${dir}\n`);
  } else {
    const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
    if (!hasFfmpeg) {
      const dir = `${out}.frames`;
      fs.mkdirSync(dir, { recursive: true });
      const times = frameTimes({ duration, fps });
      for (let i = 0; i < times.length; i++) {
        const dataURL = await page.evaluate((t) => window.__stage.captureFrame(t), times[i]);
        const b64 = String(dataURL).replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(path.join(dir, pngFileName(i)), Buffer.from(b64, 'base64'));
      }
      process.stdout.write(`ffmpeg not found; wrote ${times.length} frames to ${dir}\n`);
      process.stdout.write(`Assemble with:\n  ffmpeg ${ffmpegDirArgs({ fps, dir, output: out }).join(' ')}\n`);
    } else {
      const child = spawn('ffmpeg', ffmpegPipeArgs({ fps, output: out }), { stdio: ['pipe', 'ignore', 'inherit'] });
      const times = frameTimes({ duration, fps });
      for (let i = 0; i < times.length; i++) {
        const dataURL = await page.evaluate((t) => window.__stage.captureFrame(t), times[i]);
        const buf = Buffer.from(String(dataURL).replace(/^data:image\/png;base64,/, ''), 'base64');
        if (!child.stdin.write(buf)) {
          await new Promise((r) => child.stdin.once('drain', r));
        }
      }
      child.stdin.end();
      await new Promise((resolve, reject) => {
        child.on('close', resolve);
        child.on('error', reject);
      });
      process.stdout.write(`wrote ${times.length} frames over ${duration}s to ${out}\n`);
    }
  }
} catch (err) {
  process.stderr.write(`Export failed: ${err.message}\n`);
  exitCode = 1;
} finally {
  if (page) await page.evaluate(() => window.__stage?.dispose()).catch(() => {});
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
process.exit(exitCode);
