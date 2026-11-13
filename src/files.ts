import type { SceneStyle } from './engine/types';

export type ProjectFile = { name: string; source: string; style: Partial<SceneStyle> };

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export async function listProjects(): Promise<string[]> {
  const { projects } = await json<{ projects: { name: string }[] }>(await fetch('/api/projects'));
  return projects.map((p) => p.name);
}

export async function loadProject(name: string): Promise<ProjectFile> {
  return json<ProjectFile>(await fetch(`/api/projects/${encodeURIComponent(name)}`));
}

export async function saveProject(name: string, source: string, style: SceneStyle): Promise<void> {
  await json(
    await fetch(`/api/projects/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, style }),
    }),
  );
}

/** Stores an image in public/assets and returns the path to use in the script. */
export async function uploadImage(file: File): Promise<string> {
  const res = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  return (await json<{ path: string }>(res)).path;
}
