/**
 * Gathers what a video needs to show a website: its link-preview image, its icon,
 * and a phone-sized screenshot. Saves them under public/assets/<name>/ and prints
 * the script lines that use them.
 *
 *   npm run capture -- <url> [--name <folder>] [--full]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { domainOf } from '../src/engine/types';

const root = path.resolve(import.meta.dirname, '..');

const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
// The browser view's page area on the 393 x 852 pt phone (everything below the status bar), captured at 3x.
const PAGE_WIDTH = 393;
const PAGE_HEIGHT = 790;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SCREENSHOT_TIMEOUT_MS = 45_000;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  }
  return out;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Reads the title, preview image and best icon out of a page's <head>. */
function readMeta(html: string, pageUrl: string) {
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? '').toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = decode(a.content);
  }
  const icons: { href: string; rank: number }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel ?? '').toLowerCase();
    if (!a.href || !rel.includes('icon') || /\.ico(\?|$)/i.test(a.href)) continue;
    // Touch icons are the large, square, opaque ones; prefer them for an avatar.
    icons.push({ href: decode(a.href), rank: rel.includes('apple-touch-icon') ? 0 : /\.svg(\?|$)/i.test(a.href) ? 2 : 1 });
  }
  icons.sort((x, y) => x.rank - y.rank);
  const abs = (href?: string) => {
    try {
      return href ? new URL(href, pageUrl).toString() : undefined;
    } catch {
      return undefined;
    }
  };
  const docTitle = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  return {
    title: meta['og:title'] ?? meta['twitter:title'] ?? (docTitle ? decode(docTitle.trim()) : undefined),
    siteName: meta['og:site_name'],
    image: abs(meta['og:image'] ?? meta['twitter:image']),
    icon: abs(icons[0]?.href),
  };
}

/** Downloads an image into dir as <stem>.<ext>; returns the file name, or null if it isn't a usable image. */
async function saveImage(url: string, dir: string, stem: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = EXTENSIONS[type];
    if (!res.ok || !ext) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) return null;
    fs.writeFileSync(path.join(dir, `${stem}.${ext}`), data);
    return `${stem}.${ext}`;
  } catch {
    return null;
  }
}

/**
 * Takes a phone-sized screenshot with a locally installed Chromium-family browser.
 * Real mobile emulation matters: a plain headless window cannot go narrower than 500px,
 * so the page would lay out wider than a phone and come out cropped.
 */
async function screenshot(chrome: string, url: string, output: string, fullPage: boolean): Promise<boolean> {
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: PAGE_WIDTH, height: PAGE_HEIGHT, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: SCREENSHOT_TIMEOUT_MS });
    // Let entrance animations and web fonts settle.
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: output as `${string}.png`, fullPage });
    return fs.existsSync(output) && fs.statSync(output).size > 0;
  } catch {
    return false;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Colour of a PNG's top-left pixel, as #RRGGBB. Used as the page background behind the status bar. */
function topLeftColour(file: string): string | null {
  try {
    const png = fs.readFileSync(file);
    const colourType = png[25];
    if (png[24] !== 8 || (colourType !== 2 && colourType !== 6)) return null;
    const idat: Buffer[] = [];
    for (let at = 8; at < png.length; ) {
      const length = png.readUInt32BE(at);
      if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
      at += 12 + length;
    }
    // Byte 0 is the row filter; with no pixel to the left or above, every filter leaves pixel (0,0) unchanged.
    const raw = zlib.inflateSync(Buffer.concat(idat));
    return `#${raw.subarray(1, 4).toString('hex').toUpperCase()}`;
  } catch {
    return null;
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { name: { type: 'string' }, full: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help || positionals.length === 0) {
    console.log('Usage: npm run capture -- <url> [--name <folder>] [--full]\n\nSaves the preview image, icon and a phone screenshot to public/assets/<folder>/.\n--full captures the whole page, top to bottom, for @scroll.');
    return;
  }

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(positionals[0]) ? positionals[0] : `https://${positionals[0]}`);
  } catch {
    fail(`"${positionals[0]}" is not a URL`);
  }
  if (!/^https?:$/.test(url.protocol)) fail('Only http and https URLs can be captured');

  const domain = domainOf(url.toString());
  const folder = slug(values.name ?? domain.split('.').slice(0, -1).join('-')) || 'site';
  const dir = path.join(root, 'public', 'assets', folder);
  fs.mkdirSync(dir, { recursive: true });
  const ref = (file: string) => `assets/${folder}/${file}`;

  let html: string;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    if (!res.ok) fail(`${url} answered ${res.status}`);
    html = await res.text();
  } catch (err) {
    fail(`Could not load ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const meta = readMeta(html, url.toString());
  const title = (meta.title ?? meta.siteName ?? domain).replace(/"/g, "'");
  const contact = (meta.siteName ?? title).replace(/"/g, "'");

  const preview = meta.image ? await saveImage(meta.image, dir, 'og') : null;
  const icon = meta.icon ? await saveImage(meta.icon, dir, 'icon') : null;

  const pageSlug = slug(url.pathname);
  const pageFile = pageSlug ? `page-${pageSlug}.png` : 'page.png';
  const chrome = CHROME_PATHS.find((p) => p && fs.existsSync(p));
  const shot = chrome ? await screenshot(chrome, url.toString(), path.join(dir, pageFile), values.full ?? false) : false;
  const background = shot ? topLeftColour(path.join(dir, pageFile)) : null;

  const notes: string[] = [];
  if (!preview) notes.push(meta.image ? 'The preview image could not be downloaded.' : 'The page declares no preview image (og:image).');
  if (!icon) notes.push('No usable icon found; the contact will show its initial.');
  if (!chrome) notes.push('No Chrome, Chromium, Edge or Brave found for the screenshot. Install one or set CHROME_PATH.');
  else if (!shot) notes.push('The screenshot failed or timed out, so there is no @open line.');

  const lines = [
    `@contact ${contact}${icon ? ` ${ref(icon)}` : ''}`,
    `them: [link ${url} "${title}"${preview ? ` ${ref(preview)}` : ''}]`,
    ...(shot ? [`@open ${url} ${ref(pageFile)}${background ? ` ${background}` : ''}`] : []),
  ];

  console.log(
    JSON.stringify(
      {
        url: url.toString(),
        title,
        siteName: meta.siteName ?? null,
        files: {
          preview: preview ? `public/${ref(preview)}` : null,
          icon: icon ? `public/${ref(icon)}` : null,
          page: shot ? `public/${ref(pageFile)}` : null,
        },
        background,
        notes,
        // Paste these into a script.
        script: lines,
      },
      null,
      2,
    ),
  );
}

main().then(
  () => process.exit(0),
  (err) => fail(err instanceof Error ? err.message : String(err)),
);
