import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Adds /api/projects (JSON files in projects/) and /api/assets (images in public/assets/). */
export function filesApi(): Plugin {
  return {
    name: 'files-api',
    configureServer(server) {
      const root = server.config.root;
      const projectsDir = path.join(root, 'projects');
      const assetsDir = path.join(root, 'public', 'assets');

      server.middlewares.use('/api/projects', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const [rawName, extra] = url.pathname.split('/').filter(Boolean);
        if (extra) return send(res, 404, { error: 'Not found' });

        if (!rawName) {
          if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
          const files = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
          const projects = files
            .filter((f) => f.endsWith('.json'))
            .map((f) => ({ name: f.slice(0, -5), updatedAt: fs.statSync(path.join(projectsDir, f)).mtimeMs }))
            .filter((p) => NAME_RE.test(p.name))
            .sort((a, b) => b.updatedAt - a.updatedAt);
          return send(res, 200, { projects });
        }

        let name: string;
        try {
          name = decodeURIComponent(rawName);
        } catch {
          return send(res, 400, { error: 'Bad project name' });
        }
        if (!NAME_RE.test(name)) {
          return send(res, 400, { error: 'Use letters, numbers, spaces, dashes or underscores in the name' });
        }
        const file = path.join(projectsDir, `${name}.json`);

        if (req.method === 'GET') {
          if (!fs.existsSync(file)) return send(res, 404, { error: 'No such project' });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          return res.end(fs.readFileSync(file));
        }

        if (req.method === 'PUT') {
          let body: { source?: unknown; style?: unknown };
          try {
            body = JSON.parse((await readBody(req, MAX_PROJECT_BYTES)).toString('utf8')) as typeof body;
          } catch {
            return send(res, 400, { error: 'Body must be JSON under 2 MB' });
          }
          if (typeof body.source !== 'string' || !body.style || typeof body.style !== 'object') {
            return send(res, 400, { error: 'Project needs a script and a style' });
          }
          fs.mkdirSync(projectsDir, { recursive: true });
          fs.writeFileSync(file, JSON.stringify({ name, source: body.source, style: body.style }, null, 2) + '\n');
          return send(res, 200, { path: path.relative(root, file) });
        }

        return send(res, 405, { error: 'Method not allowed' });
      });

      server.middlewares.use('/api/assets', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const url = new URL(req.url ?? '/', 'http://localhost');
        const requested = path.basename(url.searchParams.get('name') ?? '');
        if (!IMAGE_EXT_RE.test(requested)) {
          return send(res, 400, { error: 'Use a PNG, JPG, WebP, GIF, SVG or AVIF image' });
        }
        const ext = path.extname(requested).toLowerCase();
        const stem =
          path
            .basename(requested, path.extname(requested))
            .replace(/[^A-Za-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'image';

        let data: Buffer;
        try {
          data = await readBody(req, MAX_IMAGE_BYTES);
        } catch {
          return send(res, 413, { error: 'Image is larger than 10 MB' });
        }
        if (data.length === 0) return send(res, 400, { error: 'Image is empty' });

        // Never overwrite an existing asset: other projects may point at it.
        fs.mkdirSync(assetsDir, { recursive: true });
        let fileName = `${stem}${ext}`;
        for (let n = 2; fs.existsSync(path.join(assetsDir, fileName)); n++) fileName = `${stem}-${n}${ext}`;
        fs.writeFileSync(path.join(assetsDir, fileName), data);
        return send(res, 201, { path: `assets/${fileName}` });
      });
    },
  };
}
