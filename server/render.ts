import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { FORMATS, SIZES, renderVideo, type Format } from './renderer';

type Job = {
  status: 'preparing' | 'rendering' | 'done' | 'error';
  progress: number;
  file: string;
  error?: string;
};

const jobs = new Map<string, Job>();

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function run(job: Job, root: string, format: Format, size: number, inputProps: Record<string, unknown>) {
  try {
    await renderVideo({
      root,
      inputProps,
      format,
      size,
      output: job.file,
      onStart: () => {
        job.status = 'rendering';
      },
      onProgress: (progress) => {
        job.progress = progress;
      },
    });
    job.progress = 1;
    job.status = 'done';
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
  }
}

/** Adds /api/render to the dev server: start a job, poll it, fetch the file. */
export function renderApi(): Plugin {
  return {
    name: 'render-api',
    configureServer(server) {
      const root = server.config.root;
      const outDir = path.join(root, 'out');

      server.middlewares.use('/api/render', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const [id, tail] = url.pathname.split('/').filter(Boolean);

        if (req.method === 'POST' && !id) {
          let body: { format?: unknown; size?: unknown; timeline?: unknown; style?: unknown };
          try {
            body = (await readJson(req)) as typeof body;
          } catch {
            return send(res, 400, { error: 'Body must be JSON' });
          }
          const format = body.format as Format;
          const size = body.size as number;
          const timeline = body.timeline as { durationInFrames?: unknown; rows?: unknown } | undefined;
          if (!FORMATS.includes(format) || !SIZES.includes(size)) {
            return send(res, 400, { error: 'Unsupported format or size' });
          }
          if (!timeline || !Array.isArray(timeline.rows) || !Number.isInteger(timeline.durationInFrames)) {
            return send(res, 400, { error: 'Missing timeline' });
          }
          if (!body.style || typeof body.style !== 'object') {
            return send(res, 400, { error: 'Missing style' });
          }

          fs.mkdirSync(outDir, { recursive: true });
          const jobId = randomUUID();
          const job: Job = {
            status: 'preparing',
            progress: 0,
            file: path.join(outDir, `video-${stamp()}-${size}.${format}`),
          };
          jobs.set(jobId, job);
          void run(job, root, format, size, { timeline, style: body.style });
          return send(res, 202, { id: jobId });
        }

        const job = id ? jobs.get(id) : undefined;
        if (req.method !== 'GET' || !job) return send(res, 404, { error: 'Not found' });

        if (!tail) {
          return send(res, 200, {
            status: job.status,
            progress: job.progress,
            error: job.error,
            path: path.relative(root, job.file),
            bytes: job.status === 'done' ? fs.statSync(job.file).size : undefined,
          });
        }

        if (tail === 'file' && job.status === 'done') {
          res.statusCode = 200;
          res.setHeader('Content-Type', job.file.endsWith('.gif') ? 'image/gif' : 'video/mp4');
          res.setHeader('Content-Length', fs.statSync(job.file).size);
          res.setHeader('Content-Disposition', `attachment; filename="${path.basename(job.file)}"`);
          fs.createReadStream(job.file).pipe(res);
          return;
        }
        return send(res, 404, { error: 'Not found' });
      });
    },
  };
}
