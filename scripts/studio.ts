/**
 * Command-line access to the studio, for scripted and agent use. No browser or dev server needed.
 *
 *   npm run check  -- <project>
 *   npm run still  -- <project> --at 2,6.5,11 [--size 540] [--out-dir out]
 *   npm run render -- <project> [--format mp4|gif] [--size 540|720|1080] [--out file]
 *   npm run sheet  -- <project>          one image tiling the key moments
 *   npm run make   -- <project>          sheet + MP4 + GIF in one run
 *
 * <project> is a saved project name ("Rain jacket demo"), a project .json file,
 * or a plain script file (any other extension), which renders with the default style.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseScript } from '../src/engine/parser';
import { keyFrames, resolveTimeline } from '../src/engine/timing';
import { DEFAULT_STYLE, beatLabel, type SceneStyle } from '../src/engine/types';
import { FORMATS, SIZES, bundleScene, renderSheet, renderStills, renderVideo, type Format } from '../server/renderer';

const root = path.resolve(import.meta.dirname, '..');

const USAGE = `Usage:
  npm run check  -- <project>
  npm run still  -- <project> --at 2,6.5,11 [--size 540] [--out-dir out]
  npm run render -- <project> [--format mp4|gif] [--size 540|720|1080] [--out file]
  npm run sheet  -- <project>
  npm run make   -- <project> [--formats mp4,gif]

<project> is a saved project name (projects/<name>.json or .txt), a project .json file, or a plain script file.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function load(ref: string): { name: string; source: string; style: SceneStyle } {
  const saved = ['json', 'txt'].map((ext) => path.join(root, 'projects', `${ref}.${ext}`)).find((f) => fs.existsSync(f));
  const file = fs.existsSync(ref) && fs.statSync(ref).isFile() ? ref : (saved ?? null);
  if (!file) {
    const names = fs.existsSync(path.join(root, 'projects'))
      ? fs.readdirSync(path.join(root, 'projects')).filter((f) => /\.(json|txt)$/.test(f)).map((f) => f.replace(/\.(json|txt)$/, ''))
      : [];
    fail(`No project or file "${ref}". Saved projects: ${names.length ? names.join(', ') : '(none)'}`);
  }
  const text = fs.readFileSync(file, 'utf8');
  const name = path.basename(file, path.extname(file));
  if (!file.endsWith('.json')) return { name, source: text, style: DEFAULT_STYLE };

  let data: { source?: unknown; style?: unknown };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    fail(`${file} is not valid JSON`);
  }
  if (typeof data.source !== 'string') fail(`${file} has no "source" script`);
  return { name, source: data.source, style: { ...DEFAULT_STYLE, ...((data.style as Partial<SceneStyle>) ?? {}) } };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'video';

function sizeOf(raw: string | undefined, fallback: number): number {
  const size = Number(raw ?? fallback);
  if (!SIZES.includes(size)) fail(`--size must be one of ${SIZES.join(', ')}`);
  return size;
}

/** Short path when the file is under the current directory, absolute otherwise. */
function show(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith('..') ? file : rel;
}

function kb(file: string): string {
  const bytes = fs.statSync(file).size;
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      format: { type: 'string' },
      size: { type: 'string' },
      out: { type: 'string' },
      'out-dir': { type: 'string' },
      formats: { type: 'string' },
      at: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ref] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  if (!['check', 'still', 'render', 'sheet', 'make'].includes(command)) fail(`Unknown command "${command}".\n\n${USAGE}`);
  if (!ref) fail(`Missing <project>.\n\n${USAGE}`);

  const loaded = load(ref);
  const script = parseScript(loaded.source);
  // Style directives in the script win over the project file's saved style.
  const project = { ...loaded, style: { ...loaded.style, ...script.style } };
  const timeline = resolveTimeline(script);
  const { fps } = timeline;
  const sec = (frame: number) => Math.round((frame / fps) * 100) / 100;

  if (command === 'check') {
    console.log(
      JSON.stringify(
        {
          project: project.name,
          ok: script.errors.length === 0,
          errors: script.errors,
          contact: timeline.contact,
          fps,
          durationSeconds: sec(timeline.durationInFrames),
          // Times in seconds. A message is on screen from "appear"; "start" is when typing begins.
          rows: timeline.rows.map((r) => ({
            line: r.beat.line,
            side: r.beat.side,
            kind: r.beat.kind,
            text: beatLabel(r.beat),
            start: sec(r.start),
            appear: sec(r.appear),
            end: sec(r.end),
          })),
          camera: timeline.camera.map((k) => ({ at: sec(k.frame), zoom: k.zoom })),
          reactions: timeline.reactions.map((r) => ({ at: sec(r.frame), emoji: r.emoji, by: r.by, onLine: timeline.rows[r.rowId]?.beat.line })),
          // "tap" is the press on the link; the page is fully open about 0.5s after "open".
          browser: timeline.browser.map((b) => ({
            tap: sec(b.tap),
            open: sec(b.open),
            url: b.url,
            scrolls: b.scrolls.map((s) => ({ from: sec(s.frame), to: sec(s.frame + s.frames) })),
            photos: b.photos ? { tap: sec(b.photos.tap), open: sec(b.photos.open), swipes: b.photos.swipes.map(sec) } : undefined,
            close: b.close === undefined ? undefined : sec(b.close),
          })),
          notifications: timeline.notifications.map((n) => ({ at: sec(n.frame), tap: n.tap === undefined ? undefined : sec(n.tap) })),
          style: project.style,
        },
        null,
        2,
      ),
    );
    process.exit(script.errors.length ? 1 : 0);
  }

  if (script.errors.length) {
    fail(`Script has errors; fix them first:\n${script.errors.map((e) => `  line ${e.line}: ${e.message}`).join('\n')}`);
  }
  const inputProps = { timeline, style: project.style };

  if (command === 'sheet' || command === 'make') {
    const outDir = path.resolve(values['out-dir'] ?? path.join(root, 'out'));
    fs.mkdirSync(outDir, { recursive: true });
    const base = path.join(outDir, slug(project.name));
    const formats = command === 'sheet' ? [] : (values.formats ?? 'mp4,gif').split(',').map((f) => f.trim()).filter(Boolean);
    const bad = formats.find((f) => !FORMATS.includes(f as Format));
    if (bad) fail(`--formats takes ${FORMATS.join(',')}; got "${bad}"`);

    // One bundle serves the sheet and every video.
    const serveUrl = await bundleScene(root);
    const frames = keyFrames(timeline);
    const sheet = `${base}-sheet.png`;
    await renderSheet({ root, serveUrl, inputProps: { ...inputProps, frames }, output: sheet });

    const videos: Record<string, string> = {};
    for (const format of formats as Format[]) {
      const size = format === 'gif' ? 540 : 1080;
      const output = `${base}-${size}.${format}`;
      await renderVideo({ root, serveUrl, inputProps, format, size, output });
      videos[format] = `${show(output)} (${kb(output)})`;
    }
    console.log(
      JSON.stringify(
        {
          project: project.name,
          durationSeconds: sec(timeline.durationInFrames),
          // Cells run left to right, top to bottom, four per row.
          sheet: show(sheet),
          cells: frames.map((f, i) => `${i + 1}: ${sec(f)}s`),
          ...videos,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'still') {
    if (!values.at) fail('still needs --at <seconds>, e.g. --at 11 or --at 2,6.5,11');
    const times = values.at.split(',').map((t) => Number(t.trim()));
    if (times.some((t) => !Number.isFinite(t) || t < 0)) fail('--at takes seconds, e.g. --at 2,6.5,11');
    const size = sizeOf(values.size, 540);
    const outDir = path.resolve(values['out-dir'] ?? path.join(root, 'out'));
    fs.mkdirSync(outDir, { recursive: true });
    const shots = times.map((t) => ({
      frame: Math.round(t * fps),
      output: path.join(outDir, `${slug(project.name)}-${t}s.png`),
    }));
    await renderStills({ root, inputProps, size, shots });
    for (const s of shots) console.log(show(s.output));
    return;
  }

  const format = (values.format ?? 'mp4') as Format;
  if (!FORMATS.includes(format)) fail(`--format must be one of ${FORMATS.join(', ')}`);
  const size = sizeOf(values.size, format === 'gif' ? 540 : 1080);
  const output = path.resolve(values.out ?? path.join(root, 'out', `${slug(project.name)}-${size}.${format}`));
  fs.mkdirSync(path.dirname(output), { recursive: true });

  let last = -1;
  await renderVideo({
    root,
    inputProps,
    format,
    size,
    output,
    onProgress: (p) => {
      const step = Math.floor(p * 4);
      if (step > last && step < 4) console.error(`rendering ${step * 25}%`);
      last = Math.max(last, step);
    },
  });
  console.log(`${show(output)} (${kb(output)}, ${sec(timeline.durationInFrames)}s, ${size}x${size})`);
}

main().then(
  () => process.exit(0),
  (err) => fail(err instanceof Error ? err.message : String(err)),
);
