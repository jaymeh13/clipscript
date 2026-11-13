import { describe, expect, it } from 'vitest';
import { cameraLineBefore, parseScript, setCameraBefore, setLineTiming } from './parser';
import { focusAt, keyFrames, resolveTimeline, scrollAt, zoomAt } from './timing';

describe('parseScript', () => {
  it('parses messages, cards, commands and comments', () => {
    const s = parseScript(
      [
        '# intro',
        '@contact Juniper',
        'me: hello there',
        'them: [card "Arc Shell" $180 jacket.png]',
        '@camera zoom 1.3',
        '@pause 0.5',
        '@camera reset',
      ].join('\n'),
    );
    expect(s.errors).toEqual([]);
    expect(s.contact).toBe('Juniper');
    expect(s.beats.map((b) => b.kind)).toEqual(['message', 'card', 'camera', 'pause', 'camera']);
    expect(s.beats[1]).toMatchObject({ title: 'Arc Shell', price: '$180', image: 'jacket.png' });
    expect(s.beats[4]).toMatchObject({ zoom: 1 });
  });

  it('keeps a decimal price as a price, not an image', () => {
    const s = parseScript('them: [card "Mug" $12.50]');
    expect(s.beats[0]).toMatchObject({ price: '$12.50', image: undefined });
  });

  it('reports bad lines with their line number', () => {
    const s = parseScript('hello\n@zoom 2\nme:\n@pause x');
    expect(s.errors.map((e) => e.line)).toEqual([1, 2, 3, 4]);
    expect(s.beats).toEqual([]);
  });
});

describe('resolveTimeline', () => {
  it('orders rows in time and ends after the last one', () => {
    const t = resolveTimeline(parseScript('me: hi\nthem: hello\n@pause 1\nme: bye'));
    expect(t.rows).toHaveLength(3);
    for (const [i, r] of t.rows.entries()) {
      expect(r.appear).toBeGreaterThan(r.start);
      if (i > 0) expect(r.start).toBeGreaterThan(t.rows[i - 1].appear);
    }
    expect(t.durationInFrames).toBeGreaterThan(t.rows[2].appear);
    expect(t.rows[2].start - t.rows[1].appear).toBeGreaterThanOrEqual(30);
  });

  it('gives an empty script a valid duration', () => {
    expect(resolveTimeline(parseScript('')).durationInFrames).toBeGreaterThan(0);
  });

  it('eases the camera to its target', () => {
    const t = resolveTimeline(parseScript('me: hi\n@camera zoom 1.5\nthem: yo'));
    const key = t.camera[0];
    expect(zoomAt(t.camera, key.frame - 1)).toBe(1);
    expect(zoomAt(t.camera, key.frame + 10)).toBeGreaterThan(1);
    expect(zoomAt(t.camera, key.frame + 100)).toBeCloseTo(1.5);
  });
});

describe('timing overrides', () => {
  it('reads {lead, hold} off the end of a line and applies them', () => {
    const s = parseScript('them: hello {lead 2, hold 3}\nme: [card "Mug" $5] {hold 1}');
    expect(s.errors).toEqual([]);
    expect(s.beats[0]).toMatchObject({ text: 'hello', lead: 2, hold: 3 });
    expect(s.beats[1]).toMatchObject({ title: 'Mug', hold: 1 });
    const [a] = resolveTimeline(s).rows;
    expect(a.appear - a.start).toBe(60);
    expect(a.end - a.appear).toBe(90);
  });

  it('leaves other braces in the message text', () => {
    const s = parseScript('me: use {curly} braces {like this}');
    expect(s.beats[0]).toMatchObject({ text: 'use {curly} braces {like this}' });
  });

  it('rewrites and removes overrides on a line', () => {
    const src = '# c\nme: hi\nthem: yo {hold 2}';
    const set = setLineTiming(src, 2, { lead: 1.5 });
    expect(set.split('\n')[1]).toBe('me: hi {lead 1.5}');
    expect(setLineTiming(set, 2, { lead: 1, hold: 0.5 }).split('\n')[1]).toBe('me: hi {lead 1, hold 0.5}');
    expect(setLineTiming(src, 3, {}).split('\n')[2]).toBe('them: yo');
  });
});

describe('style directives', () => {
  it('reads style from the script', () => {
    const s = parseScript('@theme dark\n@accent #ff8800\n@background sky\n@frame off\n@logo assets/l.svg 10 20\nme: hi');
    expect(s.errors).toEqual([]);
    expect(s.style).toMatchObject({ theme: 'dark', accent: '#ff8800', frame: false });
    expect(s.style.background).toContain('linear-gradient');
    expect(s.style.logo).toMatchObject({ src: 'assets/l.svg', x: 10, y: 20, size: 17, opacity: 1 });
  });

  it('keeps a raw CSS background and rejects bad values', () => {
    expect(parseScript('@background #112233').style.background).toBe('#112233');
    expect(parseScript('@theme blue\n@accent red\n@frame maybe').errors.map((e) => e.line)).toEqual([1, 2, 3]);
  });
});

describe('keyFrames', () => {
  it('picks a frame after each bubble, reaction and browser event, ending on the last frame', () => {
    const t = resolveTimeline(parseScript('me: hi\nthem: [link https://a.b "A" x.png]\n@react 👍\n@open https://a.b p.png'));
    const frames = keyFrames(t);
    expect(frames[frames.length - 1]).toBe(t.durationInFrames - 1);
    expect(frames.length).toBeGreaterThanOrEqual(5);
    expect([...frames].sort((a, b) => a - b)).toEqual(frames);
    for (const r of t.rows) expect(frames.some((f) => f > r.appear)).toBe(true);
  });

  it('caps the count', () => {
    const t = resolveTimeline(parseScript(Array.from({ length: 30 }, (_, i) => `me: line ${i}`).join('\n')));
    const frames = keyFrames(t, 8);
    expect(frames).toHaveLength(8);
    expect(frames[7]).toBe(t.durationInFrames - 1);
  });
});

describe('browsing a page', () => {
  const src = [
    'them: [link https://a.b "A" x.png]',
    '@open https://a.b p.png',
    '@scroll bottom 1',
    '@photos 40,60 1.jpg 2.jpg',
    '@swipe',
    '@swipe',
    '@notify Hi there\\nSecond line',
    '@back',
    'me: yes',
  ].join('\n');

  it('places scrolls, photos, the banner and the return to the chat in order', () => {
    const s = parseScript(src);
    expect(s.errors).toEqual([]);
    const t = resolveTimeline(s);
    const [b] = t.browser;
    const [n] = t.notifications;
    expect(b.scrolls).toEqual([{ frame: b.open + 78, frames: 30, to: 'bottom' }]);
    expect(b.photos).toMatchObject({ x: 40, y: 60, images: ['1.jpg', '2.jpg'] });
    // Only one swipe fits between two photos.
    expect(b.photos!.swipes).toHaveLength(1);
    expect(n.text).toBe('Hi there\nSecond line');
    expect(t.rows[n.rowId].beat).toMatchObject({ side: 'them', text: n.text });
    expect(n.tap).toBeGreaterThan(n.frame);
    expect(b.close).toBe(n.leave);
    expect(t.rows[2].start).toBeGreaterThan(b.close!);
  });

  it('lets a banner say how long it stays', () => {
    const s = parseScript('@open https://a.b p.png\n@notify Hello {hold 2}\n@back');
    expect(s.errors).toEqual([]);
    const [n] = resolveTimeline(s).notifications;
    expect(n.text).toBe('Hello');
    expect(n.tap! - n.frame).toBe(60);
  });

  it('eases the page between scroll positions', () => {
    const scrolls = [{ frame: 10, frames: 20, to: 300 }, { frame: 60, frames: 20, to: 'bottom' as const }];
    expect(scrollAt(scrolls, 0)).toEqual({ px: 0, bottom: 0 });
    expect(scrollAt(scrolls, 30)).toEqual({ px: 300, bottom: 0 });
    expect(scrollAt(scrolls, 70)).toEqual({ px: 150, bottom: 0.5 });
    expect(scrollAt(scrolls, 90)).toEqual({ px: 0, bottom: 1 });
  });

  it('rejects malformed page commands', () => {
    expect(parseScript('@scroll up\n@photos\n@notify').errors.map((e) => e.line)).toEqual([1, 2, 3]);
  });
});

describe('camera anchor', () => {
  it('zooms around the named height and resets around the same one', () => {
    const s = parseScript('@camera zoom 1.2 bottom\nme: hi\n@camera reset\nme: yo\n@camera zoom 1.1');
    expect(s.errors).toEqual([]);
    const { camera } = resolveTimeline(s);
    expect(camera.map((k) => k.focus)).toEqual([100, 100, 68]);
    expect(focusAt(camera, camera[0].frame + 20)).toBe(100);
    expect(focusAt(camera, camera[2].frame + 20)).toBe(68);
    expect(parseScript('@camera zoom 1.2 sideways').errors).toHaveLength(1);
  });
});

describe('camera editing', () => {
  const src = 'me: hi\n\nthem: yo\nme: bye';
  it('inserts, rewrites and removes the move above a line', () => {
    const added = setCameraBefore(src, 3, { zoom: 1.3 });
    expect(added).toBe('me: hi\n\n@camera zoom 1.3\nthem: yo\nme: bye');
    expect(cameraLineBefore(added, 4)).toBe(3);
    const changed = setCameraBefore(added, 4, { zoom: 1.5, focus: 40 });
    expect(changed.split('\n')[2]).toBe('@camera zoom 1.5 40');
    expect(parseScript(changed).errors).toEqual([]);
    expect(setCameraBefore(changed, 4, null)).toBe(src);
  });
  it('reads @size as a style directive', () => {
    expect(parseScript('@size 80\nme: hi').style.size).toBe(80);
    expect(parseScript('@size 500\nme: hi').errors).toHaveLength(1);
  });
});

describe('opening view', () => {
  it('starts already zoomed when the camera is set before the first beat', () => {
    const { camera } = resolveTimeline(parseScript('@camera zoom 1.5 bottom\nme: hi\n@camera reset'));
    expect(zoomAt(camera, 0)).toBe(1.5);
    expect(focusAt(camera, 0)).toBe(100);
    expect(camera[1].frame).toBeGreaterThan(0);
  });
});
