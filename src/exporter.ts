import type { SceneStyle, Timeline } from './engine/types';

export type ExportFormat = 'mp4' | 'gif';
export type ExportSize = 540 | 720 | 1080;

export type ExportState =
  | { phase: 'idle' }
  | { phase: 'working'; label: string; progress: number }
  | { phase: 'done'; url: string; path: string; bytes: number }
  | { phase: 'error'; message: string };

type Status = {
  status: 'preparing' | 'rendering' | 'done' | 'error';
  progress: number;
  error?: string;
  path: string;
  bytes?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts a render on the local server and reports progress until the file is ready. */
export async function exportVideo(
  timeline: Timeline,
  style: SceneStyle,
  format: ExportFormat,
  size: ExportSize,
  onState: (state: ExportState) => void,
): Promise<void> {
  try {
    onState({ phase: 'working', label: 'Preparing', progress: 0 });
    const start = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, size, timeline, style }),
    });
    const started = (await start.json()) as { id?: string; error?: string };
    if (!start.ok || !started.id) throw new Error(started.error ?? 'Could not start the export');

    for (;;) {
      await sleep(400);
      const res = await fetch(`/api/render/${started.id}`);
      if (!res.ok) throw new Error('The export was lost. Is the dev server still running?');
      const s = (await res.json()) as Status;
      if (s.status === 'error') throw new Error(s.error ?? 'Export failed');
      if (s.status === 'done') {
        onState({ phase: 'done', url: `/api/render/${started.id}/file`, path: s.path, bytes: s.bytes ?? 0 });
        return;
      }
      onState({
        phase: 'working',
        label: s.status === 'preparing' ? 'Preparing' : 'Rendering',
        progress: s.progress,
      });
    }
  } catch (err) {
    onState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
