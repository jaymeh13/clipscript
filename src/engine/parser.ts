import { BACKGROUNDS, DEFAULT_LOGO, type Beat, type SceneStyle, type Script, type ScriptError, type Side, type TimingOverride } from './types';

const IMAGE_RE = /^(https?:\/\/|\/)|\.(png|jpe?g|webp|gif|svg|avif)$/i;
const CARD_RE = /^\[card\s+"([^"]+)"\s*(.*)\]$/i;

const LINK_RE = /^\[link\s+(\S+)\s+"([^"]+)"(?:\s+(\S+))?\]$/i;

const TIMING_RE = /\s*\{([^{}]*)\}\s*$/;
const TIMING_PART_RE = /^(lead|hold)\s+(\d+(?:\.\d+)?)$/i;

/** A written \\n in a message is a line break. */
const lineBreaks = (s: string) => s.replace(/\\n/g, '\n');

/** Splits a trailing {lead 1.2, hold 0.8} off a message. Anything else in braces stays as text. */
function splitTiming(body: string): { body: string; timing: TimingOverride } {
  const m = TIMING_RE.exec(body);
  if (!m) return { body, timing: {} };
  const timing: TimingOverride = {};
  const parts = m[1].split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { body, timing: {} };
  for (const part of parts) {
    const kv = TIMING_PART_RE.exec(part);
    if (!kv) return { body, timing: {} };
    timing[kv[1].toLowerCase() as 'lead' | 'hold'] = Number(kv[2]);
  }
  return { body: body.slice(0, m.index).trim(), timing };
}

/** Rewrites one script line (1-based) with new timing overrides; an empty override removes them. */
export function setLineTiming(source: string, line: number, timing: TimingOverride): string {
  const lines = source.split('\n');
  const raw = lines[line - 1];
  if (raw === undefined) return source;
  const { body } = splitTiming(raw.trimEnd());
  const parts: string[] = [];
  if (timing.lead !== undefined) parts.push(`lead ${timing.lead}`);
  if (timing.hold !== undefined) parts.push(`hold ${timing.hold}`);
  lines[line - 1] = parts.length ? `${body} {${parts.join(', ')}}` : body;
  return lines.join('\n');
}

/** Line number (1-based) of an @camera line sitting directly above a line, skipping blank lines. */
export function cameraLineBefore(source: string, line: number): number | null {
  const lines = source.split('\n');
  for (let i = line - 2; i >= 0; i--) {
    const text = lines[i].trim();
    if (!text) continue;
    return /^@camera\b/i.test(text) ? i + 1 : null;
  }
  return null;
}

/**
 * Sets the camera move that starts with the beat on a line (1-based): rewrites the @camera
 * line above it or inserts one. Passing null removes the move.
 */
export function setCameraBefore(source: string, line: number, move: { zoom: number; focus?: number } | null): string {
  const lines = source.split('\n');
  if (line < 1 || line > lines.length) return source;
  const existing = cameraLineBefore(source, line);
  const text = move ? `@camera zoom ${move.zoom}${move.focus === undefined ? '' : ` ${move.focus}`}` : null;
  if (existing !== null) {
    if (text === null) lines.splice(existing - 1, 1);
    else lines[existing - 1] = text;
  } else if (text !== null) lines.splice(line - 1, 0, text);
  return lines.join('\n');
}

/**
 * Script format, one beat per line:
 *
 *   @contact Juniper            (optionally followed by an avatar image path)
 *   me: any text
 *   them: any text
 *   them: [card "Title" $180 jacket.png]
 *   them: [link https://example.com "Title" preview.png]
 *   @react 👊                   (tapback on their last message; add "them" for the reverse)
 *   @open https://example.com page.png #FFFFFF   (tap the last link, show the page)
 *   @scroll bottom 1.5          (scroll the open page; or a distance in points)
 *   @photos 50,60 4/14 a.jpg b.jpg   (tap the page there, show photos full screen, counting from 4 of 14)
 *   @swipe                      (next photo)
 *   @notify any text            (their message arrives as a banner over the page)
 *   @back                       (tap the banner, return to the chat)
 *   them: slower line {lead 1.2, hold 2}   (optional timing in seconds)
 *   @theme dark | @accent #1C99FE | @background Sky | @frame off | @size 90 | @logo logo.svg 13 7 17
 *   @camera zoom 1.3 bottom     (anchor is optional: top, center, bottom or 0-100; or: @camera reset)
 *   @pause 0.8
 *   # comment
 */
export function parseScript(source: string): Script {
  const beats: Beat[] = [];
  const errors: ScriptError[] = [];
  let contact = 'Assistant';
  let avatar: string | undefined;
  const style: Partial<SceneStyle> = {};

  source.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const text = raw.trim();
    if (!text || text.startsWith('#')) return;

    if (text.startsWith('@')) {
      const [cmd, ...args] = text.slice(1).split(/\s+/);
      switch (cmd.toLowerCase()) {
        case 'contact': {
          if (args.length === 0) errors.push({ line, message: '@contact needs a name' });
          else {
            // A trailing image path is the avatar: @contact Juniper assets/logo.png
            const last = args[args.length - 1];
            if (args.length > 1 && IMAGE_RE.test(last)) avatar = args.pop();
            contact = args.join(' ');
          }
          return;
        }
        case 'pause': {
          const seconds = Number(args[0]);
          if (!Number.isFinite(seconds) || seconds < 0) {
            errors.push({ line, message: '@pause needs a number of seconds, e.g. @pause 0.8' });
          } else beats.push({ kind: 'pause', seconds, line });
          return;
        }
        case 'camera': {
          if (args[0]?.toLowerCase() === 'reset') {
            beats.push({ kind: 'camera', zoom: 1, line });
            return;
          }
          const rest = args[0]?.toLowerCase() === 'zoom' ? args.slice(1) : args;
          const zoom = Number(rest[0]);
          // Where the zoom is anchored: bottom keeps the gap under the phone in view, top the gap above it.
          const where = rest[1]?.toLowerCase();
          const focus = where === undefined ? undefined : ({ top: 0, center: 50, bottom: 100 }[where] ?? Number(where));
          if (!Number.isFinite(zoom) || zoom <= 0 || (focus !== undefined && !(focus >= 0 && focus <= 100))) {
            errors.push({ line, message: 'Use @camera zoom 1.3 [top|center|bottom|0-100] or @camera reset' });
          } else beats.push({ kind: 'camera', zoom, focus, line });
          return;
        }
        case 'theme': {
          const theme = args[0]?.toLowerCase();
          if (theme !== 'light' && theme !== 'dark') errors.push({ line, message: 'Use @theme light or @theme dark' });
          else style.theme = theme;
          return;
        }
        case 'accent': {
          if (!/^#[0-9a-f]{6}$/i.test(args[0] ?? '')) errors.push({ line, message: 'Use @accent #RRGGBB' });
          else style.accent = args[0];
          return;
        }
        case 'background': {
          // A preset name (Sand, White, Sky, Mint, Graphite) or any CSS background value.
          const value = text.slice(1 + cmd.length).trim();
          if (!value) errors.push({ line, message: 'Use @background <preset name or CSS colour>' });
          else style.background = BACKGROUNDS.find((b) => b.name.toLowerCase() === value.toLowerCase())?.css ?? value;
          return;
        }
        case 'frame': {
          const value = args[0]?.toLowerCase();
          if (value !== 'on' && value !== 'off') errors.push({ line, message: 'Use @frame on or @frame off' });
          else style.frame = value === 'on';
          return;
        }
        case 'size': {
          const size = Number(args[0]);
          if (!(size >= 30 && size <= 200)) errors.push({ line, message: 'Use @size <percent>, from 30 to 200' });
          else style.size = size;
          return;
        }
        case 'logo': {
          const [src, ...rest] = args;
          const nums = rest.map(Number);
          if (!src || nums.some((n) => !Number.isFinite(n)) || nums.length > 4) {
            errors.push({ line, message: 'Use @logo <image> [x y size opacity], positions in percent' });
          } else {
            const [x = DEFAULT_LOGO.x, y = DEFAULT_LOGO.y, size = DEFAULT_LOGO.size, opacity = DEFAULT_LOGO.opacity] = nums;
            style.logo = { src, x, y, size, opacity };
          }
          return;
        }
        case 'react': {
          const [emoji, who] = args;
          const by = (who ?? 'me').toLowerCase();
          if (!emoji || (by !== 'me' && by !== 'them')) {
            errors.push({ line, message: 'Use @react <emoji> or @react <emoji> them' });
          } else beats.push({ kind: 'react', emoji, by, line });
          return;
        }
        case 'open': {
          const [url, image, background] = args;
          if (!url || !image) {
            errors.push({ line, message: 'Use @open <url> <page screenshot> [#background]' });
          } else beats.push({ kind: 'open', url, image, background, line });
          return;
        }
        case 'scroll': {
          const to = args[0]?.toLowerCase() === 'bottom' ? 'bottom' : Number(args[0]);
          const seconds = args[1] === undefined ? undefined : Number(args[1]);
          if ((to !== 'bottom' && (!Number.isFinite(to) || to < 0)) || (seconds !== undefined && !(seconds > 0))) {
            errors.push({ line, message: 'Use @scroll <points from the top | bottom> [seconds]' });
          } else beats.push({ kind: 'scroll', to, seconds, line });
          return;
        }
        case 'photos': {
          // An optional leading x,y (percent of the screen) says where the tap lands.
          const at = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(args[0] ?? '');
          const rest = at ? args.slice(1) : args;
          // An optional 4/14 says the first image is number 4 of 14, for the counter.
          const of = /^(\d+)\/(\d+)$/.exec(rest[0] ?? '');
          const images = of ? rest.slice(1) : rest;
          if (images.length === 0) errors.push({ line, message: 'Use @photos [x,y] [n/total] <image> [<image>…]' });
          else {
            const [x, y] = at ? [Number(at[1]), Number(at[2])] : [50, 50];
            beats.push({ kind: 'photos', images, x, y, first: of ? Number(of[1]) : 1, total: of ? Number(of[2]) : images.length, line });
          }
          return;
        }
        case 'swipe':
          beats.push({ kind: 'swipe', line });
          return;
        case 'notify': {
          const { body, timing } = splitTiming(text.slice(1 + cmd.length).trim());
          if (!body) errors.push({ line, message: 'Use @notify <message text> [{hold N}]' });
          else beats.push({ kind: 'notify', text: lineBreaks(body), hold: timing.hold, line });
          return;
        }
        case 'back':
          beats.push({ kind: 'back', line });
          return;
        default:
          errors.push({ line, message: `Unknown command @${cmd}` });
          return;
      }
    }

    const m = /^(me|them)\s*:\s*(.*)$/i.exec(text);
    if (!m) {
      errors.push({ line, message: 'Start the line with me:, them:, @command or #' });
      return;
    }
    const side = m[1].toLowerCase() as Side;
    const { body, timing } = splitTiming(m[2].trim());
    if (!body) {
      errors.push({ line, message: 'Message is empty' });
      return;
    }

    if (/^\[card\b/i.test(body)) {
      const card = CARD_RE.exec(body);
      if (!card) {
        errors.push({ line, message: 'Card format: [card "Title" $180 image.png]' });
        return;
      }
      let price: string | undefined;
      let image: string | undefined;
      for (const token of card[2].split(/\s+/).filter(Boolean)) {
        if (IMAGE_RE.test(token)) image = token;
        else price = price ? `${price} ${token}` : token;
      }
      beats.push({ kind: 'card', side, title: card[1], price, image, line, ...timing });
      return;
    }

    if (/^\[link\b/i.test(body)) {
      const link = LINK_RE.exec(body);
      if (!link) {
        errors.push({ line, message: 'Link format: [link https://example.com "Title" preview.png]' });
        return;
      }
      beats.push({ kind: 'link', side, url: link[1], title: link[2], image: link[3], line, ...timing });
      return;
    }

    beats.push({ kind: 'message', side, text: lineBreaks(body), line, ...timing });
  });

  return { contact, avatar, style, beats, errors };
}
