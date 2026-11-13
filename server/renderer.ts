import path from 'node:path';

export type Format = 'mp4' | 'gif';
export const FORMATS: Format[] = ['mp4', 'gif'];
export const SIZES = [540, 720, 1080];

const BASE_SIZE = 1080;
const VIDEO_ID = 'Chat';
const SHEET_ID = 'Sheet';

type InputProps = Record<string, unknown>;

/** Bundles the scene code. Takes a few seconds, so callers doing several renders should do it once and pass the result on. */
export async function bundleScene(root: string): Promise<string> {
  const { bundle } = await import('@remotion/bundler');
  return bundle({
    entryPoint: path.join(root, 'src/remotion/index.ts'),
    publicDir: path.join(root, 'public'),
  });
}

type Source = { root: string; serveUrl?: string };

async function prepare(source: Source, id: string, inputProps: InputProps) {
  const { selectComposition } = await import('@remotion/renderer');
  // Without a ready bundle, build one so output always matches the current code.
  const serveUrl = source.serveUrl ?? (await bundleScene(source.root));
  const composition = await selectComposition({ serveUrl, id, inputProps });
  return { serveUrl, composition };
}

export async function renderVideo(
  opts: Source & {
    inputProps: InputProps;
    format: Format;
    size: number;
    output: string;
    onStart?: () => void;
    onProgress?: (progress: number) => void;
  },
): Promise<void> {
  const { renderMedia } = await import('@remotion/renderer');
  const { serveUrl, composition } = await prepare(opts, VIDEO_ID, opts.inputProps);
  opts.onStart?.();
  await renderMedia({
    composition,
    serveUrl,
    inputProps: opts.inputProps,
    outputLocation: opts.output,
    codec: opts.format === 'gif' ? 'gif' : 'h264',
    scale: opts.size / BASE_SIZE,
    // GIFs at half the frame rate: much smaller files, still smooth enough.
    everyNthFrame: opts.format === 'gif' ? 2 : 1,
    onProgress: ({ progress }) => opts.onProgress?.(progress),
  });
}

/** Renders single frames to PNG files. One bundle serves every frame. */
export async function renderStills(
  opts: Source & { inputProps: InputProps; size: number; shots: { frame: number; output: string }[] },
): Promise<void> {
  const { renderStill } = await import('@remotion/renderer');
  const { serveUrl, composition } = await prepare(opts, VIDEO_ID, opts.inputProps);
  for (const shot of opts.shots) {
    await renderStill({
      composition,
      serveUrl,
      inputProps: opts.inputProps,
      frame: Math.min(Math.max(0, shot.frame), composition.durationInFrames - 1),
      output: shot.output,
      scale: opts.size / BASE_SIZE,
    });
  }
}

/** Renders one image tiling the scene at each of `frames`, for checking a whole video at a glance. */
export async function renderSheet(
  opts: Source & { inputProps: InputProps & { frames: number[] }; output: string },
): Promise<void> {
  const { renderStill } = await import('@remotion/renderer');
  const { serveUrl, composition } = await prepare(opts, SHEET_ID, opts.inputProps);
  await renderStill({ composition, serveUrl, inputProps: opts.inputProps, output: opts.output });
}
