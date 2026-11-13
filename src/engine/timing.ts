import type { BrowserKey, CameraKey, NotifyKey, ReactionKey, Row, Script, Timeline } from './types';

export const FPS = 30;
export const CAMERA_MOVE_FRAMES = 20;
/** Default height the camera zooms around, as a percentage down the canvas. */
export const CAMERA_FOCUS = 68;
/** Seconds from tapping a link to the browser starting to open, and how long the page then stays up. */
export const TAP_SECONDS = 0.45;
export const BROWSER_HOLD_SECONDS = 2.6;
/** How long a swipe between photos takes. */
export const SWIPE_SECONDS = 0.4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Turn a parsed script into absolute frame positions. Pure and deterministic. */
export function resolveTimeline(script: Script, fps: number = FPS): Timeline {
  const f = (seconds: number) => Math.round(seconds * fps);
  const rows: Row[] = [];
  const camera: CameraKey[] = [];
  const browser: BrowserKey[] = [];
  const reactions: ReactionKey[] = [];
  const notifications: NotifyKey[] = [];
  /** The browser view currently up, if any. */
  const page = () => {
    const b = browser[browser.length - 1];
    return b && b.close === undefined ? b : undefined;
  };
  let cursor = f(0.6);
  let begun = false;

  for (const beat of script.beats) {
    if (beat.kind !== 'camera') begun = true;
    if (beat.kind === 'pause') {
      cursor += f(beat.seconds);
      continue;
    }
    if (beat.kind === 'camera') {
      // A zoom names its own anchor or uses the default; a reset zooms back out around the anchor it zoomed in on.
      const focus = beat.focus ?? (beat.zoom === 1 ? camera[camera.length - 1]?.focus : undefined) ?? CAMERA_FOCUS;
      // A zoom set before anything has happened is the opening view: the video starts already there.
      camera.push({ frame: begun ? cursor : -CAMERA_MOVE_FRAMES, zoom: beat.zoom, focus });
      continue;
    }

    if (beat.kind === 'react') {
      // A reaction lands on the latest message from the other person, after a beat of "thinking".
      const target = [...rows].reverse().find((r) => r.beat.side !== beat.by);
      if (target) {
        const frame = cursor + f(0.5);
        reactions.push({ frame, rowId: target.id, emoji: beat.emoji, by: beat.by });
        cursor = frame + f(1.2);
      }
      continue;
    }
    if (beat.kind === 'open') {
      const link = [...rows].reverse().find((r) => r.beat.kind === 'link');
      const open = cursor + f(TAP_SECONDS);
      browser.push({
        tap: cursor,
        open,
        url: beat.url,
        image: beat.image,
        background: beat.background ?? '#FFFFFF',
        rowId: link ? link.id : null,
        scrolls: [],
      });
      cursor = open + f(BROWSER_HOLD_SECONDS);
      continue;
    }
    if (beat.kind === 'scroll') {
      const frames = f(beat.seconds ?? 1.2);
      page()?.scrolls.push({ frame: cursor, frames, to: beat.to });
      cursor += frames + f(0.5);
      continue;
    }
    if (beat.kind === 'photos') {
      const b = page();
      if (b) {
        const open = cursor + f(0.3);
        b.photos = { tap: cursor, x: beat.x, y: beat.y, open, images: beat.images, first: beat.first, total: beat.total, swipes: [] };
        cursor = open + f(1.5);
      }
      continue;
    }
    if (beat.kind === 'swipe') {
      const photos = page()?.photos;
      if (photos && photos.swipes.length < photos.images.length - 1) {
        photos.swipes.push(cursor);
        cursor += f(SWIPE_SECONDS + 1.1);
      }
      continue;
    }
    if (beat.kind === 'notify') {
      // The message is already in the thread when the chat comes back, so it gets no typing dots.
      const row: Row = { id: rows.length, beat: { kind: 'message', side: 'them', text: beat.text, line: beat.line }, start: cursor, appear: cursor, end: cursor };
      const read = f(clamp(beat.hold ?? 1.2 + clamp(beat.text.length * 0.02, 0.6, 3), 0.5, 30));
      rows.push(row);
      notifications.push({ frame: cursor, rowId: row.id, text: beat.text, leave: cursor + read + f(1.5) });
      cursor += read;
      row.end = cursor;
      continue;
    }
    if (beat.kind === 'back') {
      const b = page();
      if (b) {
        const note = notifications[notifications.length - 1];
        const showing = note && note.tap === undefined && note.frame >= b.open && cursor < note.leave;
        if (showing) {
          note.tap = cursor;
          note.leave = cursor + f(0.3);
        }
        b.close = cursor + (showing ? f(0.3) : 0);
        cursor = b.close + f(0.8);
      }
      continue;
    }

    const chars = beat.kind === 'message' ? beat.text.length : beat.title.length;
    // How long the lead-in lasts: composing in the input bar (me) or the typing dots (them).
    const lead =
      beat.side === 'me'
        ? beat.kind === 'message'
          ? clamp(chars * 0.035, 0.4, 1.8) + 0.2
          : 0.3
        : clamp(0.6 + chars * 0.015, 0.7, 1.6);
    const hold = 0.45 + clamp(chars * 0.02, 0.1, 1.4) + (beat.kind === 'message' ? 0 : 0.6);

    const start = cursor;
    const appear = start + f(clamp(beat.lead ?? lead, 0, 30));
    const end = appear + f(clamp(beat.hold ?? hold, 0, 30));
    rows.push({ id: rows.length, beat, start, appear, end });
    cursor = end;
  }

  return {
    fps,
    durationInFrames: Math.max(cursor + f(1), fps),
    contact: script.contact,
    avatar: script.avatar,
    rows,
    camera,
    browser,
    reactions,
    notifications,
  };
}

/**
 * Frames worth looking at to check a video: just after each bubble, reaction and
 * browser view has settled, plus the last frame. Thinned evenly if there are too many.
 */
export function keyFrames(timeline: Timeline, max = 12): number[] {
  const last = timeline.durationInFrames - 1;
  const settle = Math.round(timeline.fps * 0.5);
  const wanted = [
    ...timeline.rows.map((r) => r.appear + settle),
    ...timeline.reactions.map((r) => r.frame + settle),
    ...timeline.browser.flatMap((b) => [
      b.tap + 3,
      b.open + Math.round(timeline.fps * 0.8),
      ...b.scrolls.map((s) => s.frame + s.frames + 3),
      ...(b.photos ? [b.photos.open + settle, ...b.photos.swipes.map((s) => s + Math.round(timeline.fps * SWIPE_SECONDS) + 6)] : []),
    ]),
    ...(timeline.notifications ?? []).map((n) => n.frame + settle),
    last,
  ]
    .map((f) => Math.min(last, Math.max(0, f)))
    .sort((a, b) => a - b);
  // Drop frames that would show almost the same thing as the one before.
  const frames = wanted.filter((f, i) => i === 0 || f - wanted[i - 1] >= 3);
  if (frames.length <= max) return frames;
  return Array.from({ length: max }, (_, i) => frames[Math.round((i * (frames.length - 1)) / (max - 1))]);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Where the open page is scrolled to at a frame: `px` points from the top plus `bottom`,
 * a 0-1 share of the way to the page's end (whose height only the renderer knows).
 */
export function scrollAt(scrolls: BrowserKey['scrolls'], frame: number): { px: number; bottom: number } {
  let px = 0;
  let bottom = 0;
  for (const key of scrolls) {
    if (frame < key.frame) break;
    const t = easeInOut(clamp((frame - key.frame) / key.frames, 0, 1));
    const target = key.to === 'bottom' ? { px: 0, bottom: 1 } : { px: key.to, bottom: 0 };
    px += (target.px - px) * t;
    bottom += (target.bottom - bottom) * t;
  }
  return { px, bottom };
}

/** Camera zoom at a frame, easing between keys. */
export function zoomAt(camera: CameraKey[], frame: number): number {
  let zoom = 1;
  for (const key of camera) {
    if (frame < key.frame) break;
    const t = clamp((frame - key.frame) / CAMERA_MOVE_FRAMES, 0, 1);
    zoom += (key.zoom - zoom) * easeInOut(t);
  }
  return zoom;
}

/** Height the zoom is anchored at for a frame, as a percentage down the canvas, easing between keys. */
export function focusAt(camera: CameraKey[], frame: number): number {
  let focus = camera[0]?.focus ?? CAMERA_FOCUS;
  for (const key of camera) {
    if (frame < key.frame) break;
    const t = clamp((frame - key.frame) / CAMERA_MOVE_FRAMES, 0, 1);
    focus += (key.focus - focus) * easeInOut(t);
  }
  return focus;
}

export function formatTime(frame: number, fps: number): string {
  const s = frame / fps;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
