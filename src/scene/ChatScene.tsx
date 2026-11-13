import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  domainOf,
  type BrowserKey,
  type CardBeat,
  type LinkBeat,
  type NotifyKey,
  type ReactionKey,
  type Row,
  type SceneStyle,
  type Timeline,
} from '../engine/types';
import { focusAt, scrollAt, SWIPE_SECONDS, zoomAt } from '../engine/timing';

export type ChatSceneProps = {
  timeline: Timeline;
  style: SceneStyle;
  /** Draw this frame instead of the current one. Used by the contact sheet. */
  at?: number;
};

/**
 * Device metrics, in points. Measured from iOS 26 screenshots of a 393 x 852 pt iPhone Pro
 * (Messages and Safari). Change sizes here, not in the components.
 */
const M = {
  screen: { w: 393, h: 852, radius: 55 },
  // Black display border and the metal band around it, as seen from the front.
  bezel: 9,
  band: 4,
  // Whole phone is scaled to fit the 1080 square.
  scale: 1.15,
  island: { w: 126, h: 37, top: 11 },
  status: { timeLeft: 45, timeTop: 18, iconsLeft: 281, iconsTop: 22 },
  header: { top: 59.6, button: 44, side: 16, avatar: 60, nameTop: 117, nameH: 26 },
  bubble: { font: 17, line: 20, padV: 8, padH: 14, radius: 18, side: 16, maxWidth: 271, gapSame: 6, gapOther: 12 },
  tapback: { size: 34, rise: 28.5, overhang: 15 },
  composer: { bottom: 29, plus: 40, plusLeft: 28, gap: 12, right: 28.5, field: 40, threadGap: 20 },
  safari: { pageTop: 62, bottom: 34, button: 48, side: 34, gap: 8.5 },
  banner: { top: 56, side: 8, radius: 24, icon: 38 },
} as const;

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

type Palette = {
  accent: string;
  screen: string;
  screenRGB: string;
  text: string;
  incoming: string;
  hairline: string;
  placeholder: string;
  card: string;
  secondary: string;
  glass: string;
  glassShadow: string;
  pill: string;
};

function palette(style: SceneStyle): Palette {
  return style.theme === 'dark'
    ? {
        accent: style.accent,
        screen: '#000000',
        screenRGB: '0,0,0',
        text: '#FFFFFF',
        incoming: '#26262A',
        hairline: 'rgba(255,255,255,0.10)',
        placeholder: '#6A6A70',
        card: '#1C1C1E',
        secondary: '#A0A0A8',
        glass: 'rgba(46,46,50,0.92)',
        glassShadow: '0 0 0 0.5px rgba(255,255,255,0.10), 0 3px 14px rgba(0,0,0,0.5)',
        pill: 'rgba(58,58,62,0.94)',
      }
    : {
        accent: style.accent,
        screen: '#FFFFFF',
        screenRGB: '255,255,255',
        text: '#000000',
        incoming: '#E9E9EB',
        hairline: 'rgba(0,0,0,0.08)',
        placeholder: '#C5C5C7',
        card: '#FFFFFF',
        secondary: '#6B6B70',
        glass: 'rgba(255,255,255,0.94)',
        glassShadow: '0 0 0 0.5px rgba(0,0,0,0.04), 0 3px 14px rgba(0,0,0,0.09)',
        pill: 'rgba(241,241,241,0.94)',
      };
}

/** Script and style refer to images by a path under public/ or by full URL. */
const asset = (src: string) => (/^(https?:)?\/\//.test(src) ? src : staticFile(src.replace(/^\/+/, '')));

/** "Ada Lovelace" -> "AL", "Juniper" -> "J" */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

const clampOpts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Animates height from 0 to auto using a numeric progress, so layout stays frame-exact. */
const Grow: React.FC<{ p: number; children: React.ReactNode }> = ({ p, children }) => (
  <div style={{ display: 'grid', gridTemplateRows: `${p}fr`, flexShrink: 0 }}>
    <div style={{ minHeight: 0, overflow: p < 0.999 ? 'hidden' : 'visible' }}>{children}</div>
  </div>
);

/** Round floating control, the basic building block of the iOS 26 chrome. */
const Glass: React.FC<{ c: Palette; size: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  c,
  size,
  style,
  children,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      background: c.glass,
      boxShadow: c.glassShadow,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      ...style,
    }}
  >
    {children}
  </div>
);

/** The little hook on the last bubble of a run. Drawn for the left side; mirrored for the right. */
const Tail: React.FC<{ color: string; mine: boolean }> = ({ color, mine }) => (
  <svg
    width="12"
    height="15"
    viewBox="0 0 12 15"
    style={{
      position: 'absolute',
      bottom: -0.5,
      [mine ? 'right' : 'left']: -5,
      transform: mine ? 'scaleX(-1)' : undefined,
    }}
  >
    <path d="M5 0V6.5C5 10.5 3 13.5 0 14.6C5 15.2 9.6 13.6 12 10V0Z" fill={color} />
  </svg>
);

const TypingDots: React.FC<{ frame: number; c: Palette }> = ({ frame, c }) => (
  <div
    style={{
      position: 'relative',
      background: c.incoming,
      borderRadius: M.bubble.radius,
      height: M.bubble.line + M.bubble.padV * 2,
      boxSizing: 'border-box',
      padding: '0 14px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
    }}
  >
    <Tail color={c.incoming} mine={false} />
    {[0, 1, 2].map((i) => {
      const wave = (Math.sin((frame - i * 5) / 4.5) + 1) / 2;
      return (
        <div
          key={i}
          style={{ width: 9, height: 9, borderRadius: 4.5, background: '#8E8E93', opacity: 0.35 + wave * 0.55, position: 'relative' }}
        />
      );
    })}
  </div>
);

const Card: React.FC<{ beat: CardBeat; c: Palette }> = ({ beat, c }) => (
  <div
    style={{
      width: 240,
      borderRadius: M.bubble.radius,
      overflow: 'hidden',
      background: c.card,
      border: `1px solid ${c.hairline}`,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}
  >
    <div style={{ height: 156, background: 'linear-gradient(135deg, #DAD7CF 0%, #C9CED6 55%, #B9C4CE 100%)' }}>
      {beat.image ? (
        <Img src={asset(beat.image)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : null}
    </div>
    <div style={{ padding: '9px 12px 11px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: c.text, lineHeight: '20px', letterSpacing: -0.23 }}>{beat.title}</div>
      {beat.price ? <div style={{ fontSize: 13, color: c.secondary, lineHeight: '18px' }}>{beat.price}</div> : null}
    </div>
  </div>
);

/** iMessage-style rich link: preview image over a title and domain. */
const LinkPreview: React.FC<{ beat: LinkBeat; c: Palette }> = ({ beat, c }) => (
  <div style={{ width: 262, borderRadius: M.bubble.radius, overflow: 'hidden', background: c.incoming }}>
    {beat.image ? (
      <Img src={asset(beat.image)} style={{ width: '100%', aspectRatio: '1200 / 630', objectFit: 'cover', display: 'block' }} />
    ) : null}
    <div style={{ padding: '9px 12px 10px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: c.text, lineHeight: '20px', letterSpacing: -0.23 }}>{beat.title}</div>
      <div style={{ fontSize: 13, color: c.secondary, lineHeight: '18px', letterSpacing: -0.08 }}>{domainOf(beat.url)}</div>
    </div>
  </div>
);

/** Signal, Wi-Fi and battery, drawn to the sizes in the status bar. */
const StatusIcons: React.FC<{ color: string }> = ({ color }) => (
  <svg width="80" height="14" viewBox="0 0 80 14" style={{ position: 'absolute', left: M.status.iconsLeft, top: M.status.iconsTop }}>
    {[0, 1, 2, 3].map((i) => (
      <rect key={i} x={i * 5.3} y={9 - i * 2.6} width="3.3" height={4 + i * 2.6} rx="1" fill={color} opacity={i === 3 ? 0.35 : 1} />
    ))}
    <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <path d="M28.6 5.2a10.5 10.5 0 0 1 14.8 0" />
      <path d="M31.6 8.3a6.2 6.2 0 0 1 8.8 0" />
    </g>
    <circle cx="36" cy="11.4" r="1.7" fill={color} />
    <rect x="52.5" y="0.9" width="24" height="12.2" rx="3.8" fill="none" stroke={color} strokeWidth="1" opacity="0.4" />
    <rect x="54.3" y="2.7" width="16" height="8.6" rx="2.2" fill={color} />
    <path d="M78 5v4a2.1 2.1 0 0 0 0-4Z" fill={color} opacity="0.45" />
  </svg>
);

/** The page a tapped link opens: slides up over the chat, with Safari's floating controls. */
const Browser: React.FC<{ b: BrowserKey; frame: number; fps: number; framed: boolean }> = ({ b, frame, fps, framed }) => {
  if (frame < b.open) return null;
  const closing = b.close === undefined ? 0 : spring({ frame: frame - b.close, fps, config: { damping: 200 }, durationInFrames: 16 });
  if (closing > 0.999) return null;
  const p = spring({ frame: frame - b.open, fps, config: { damping: 200 }, durationInFrames: 16 }) * (1 - closing);
  const s = M.safari;
  const top = framed ? s.pageTop : 0;
  const scroll = scrollAt(b.scrolls, frame);
  const ph = b.photos;
  const sinceTap = ph ? frame - ph.tap : -1;
  const ring = ph ? interpolate(sinceTap, [0, 3, 14], [0, 0.32, 0], clampOpts) : 0;
  const viewer = ph ? spring({ frame: frame - ph.open, fps, config: { damping: 200 }, durationInFrames: 10 }) : 0;
  // Which photo is centred; fractional while a swipe is under way.
  const shown = ph
    ? ph.swipes.reduce((n, at) => n + spring({ frame: frame - at, fps, config: { damping: 200 }, durationInFrames: Math.round(SWIPE_SECONDS * fps) }), 0)
    : 0;
  const glass = { background: 'rgba(255,255,255,0.93)', boxShadow: '0 0 0 0.5px rgba(0,0,0,0.05), 0 4px 18px rgba(0,0,0,0.12)' };
  const ink = { fill: 'none', stroke: '#1C1C1E', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        // Once the viewer covers the page, match it so no light edge shows around it.
        background: viewer > 0.99 ? '#0D0F0D' : b.background,
        color: '#000',
        transform: `translateY(${(1 - p) * 100}%)`,
        boxShadow: '0 -10px 30px rgba(0,0,0,0.18)',
      }}
    >
      {/* Full width, natural height: the page runs under the controls to the bottom of the screen. */}
      {viewer > 0 && top > 0 ? (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: top + 1, background: `rgba(13,15,13,${viewer})` }} />
      ) : null}
      <div style={{ position: 'absolute', left: 0, right: 0, top, bottom: 0, overflow: 'hidden' }}>
        {/* The image is the whole page; scrolling slides it up, at most until its end meets the screen's. */}
        <Img
          src={asset(b.image)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: 'auto',
            display: 'block',
            transform: `translateY(calc(${-scroll.px}px - ${scroll.bottom} * (100% - ${M.screen.h - top}px)))`,
          }}
        />
        {ph && ring > 0 ? (
          <div
            style={{
              position: 'absolute',
              left: `${ph.x}%`,
              top: (M.screen.h * ph.y) / 100 - top,
              width: 56,
              height: 56,
              margin: -28,
              borderRadius: 28,
              background: `rgba(120,120,128,${ring})`,
              border: `2px solid rgba(255,255,255,${ring * 2})`,
              transform: `scale(${interpolate(sinceTap, [0, 14], [0.6, 1.5], clampOpts)})`,
            }}
          />
        ) : null}
        {ph && viewer > 0 ? (
          <div style={{ position: 'absolute', inset: 0, background: `rgba(13,15,13,${viewer})`, overflow: 'hidden' }}>
            {ph.images.map((src, i) =>
              Math.abs(i - shown) < 1.5 ? (
                <Img
                  key={i}
                  src={asset(src)}
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: 0,
                    width: M.screen.w - 16,
                    height: '100%',
                    objectFit: 'contain',
                    opacity: viewer,
                    transform: `translateX(${(i - shown) * M.screen.w}px) scale(${0.9 + 0.1 * viewer})`,
                  }}
                />
              ) : null,
            )}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 20,
                textAlign: 'center',
                color: '#F2F2EC',
                fontSize: 14,
                lineHeight: '20px',
                opacity: viewer,
              }}
            >
              {ph.first + Math.round(shown)} / {ph.total}
            </div>
            <div
              style={{
                position: 'absolute',
                left: 12,
                top: 8,
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: viewer,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24">
                <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="#F2F2EC" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: 'absolute',
          left: s.side,
          right: s.side,
          bottom: framed ? s.bottom : 16,
          height: s.button,
          display: 'flex',
          gap: s.gap,
        }}
      >
        <div style={{ ...glass, width: s.button, borderRadius: s.button / 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="12" height="20" viewBox="0 0 12 20" {...ink} stroke="#B9B9BD" strokeWidth={2.2}>
            <path d="M9.5 2.5 2.5 10l7 7.5" />
          </svg>
        </div>
        <div
          style={{
            ...glass,
            flex: 1,
            borderRadius: s.button / 2,
            display: 'flex',
            alignItems: 'center',
            padding: '0 13px',
            gap: 7,
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: -0.3,
          }}
        >
          <svg width="16" height="18" viewBox="0 0 16 18" {...ink}>
            <rect x="1.5" y="1.5" width="13" height="8.5" rx="2.2" />
            <path d="M1.5 13.5h13M1.5 16.5h8" />
          </svg>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {domainOf(b.url)}
          </div>
          <svg width="16" height="18" viewBox="0 0 16 18" {...ink}>
            <path d="M14 10.5a6 6 0 1 1-2.2-4.65M8.2 1.5l3.8 4.3-4.6 2.2" />
          </svg>
        </div>
        <div style={{ ...glass, width: s.button, borderRadius: s.button / 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4.6, flexShrink: 0 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 3.4, height: 3.4, borderRadius: 2, background: '#1C1C1E' }} />
          ))}
        </div>
      </div>
    </div>
  );
};

/** An incoming message shown as a banner at the top of the screen, over whatever is open. */
const Banner: React.FC<{ n: NotifyKey; frame: number; fps: number; name: string; avatar?: string }> = ({ n, frame, fps, name, avatar }) => {
  const smooth = { damping: 200 };
  const drop = spring({ frame: frame - n.frame, fps, config: { damping: 18, mass: 0.7, stiffness: 160 } });
  const leave = spring({ frame: frame - n.leave, fps, config: smooth, durationInFrames: 10 });
  if (frame < n.frame || leave > 0.999) return null;
  const press = n.tap === undefined ? 0 : interpolate(frame - n.tap, [0, 4, 9], [0, 1, 0.4], clampOpts);
  const k = M.banner;
  return (
    <div
      style={{
        position: 'absolute',
        left: k.side,
        right: k.side,
        top: k.top,
        transform: `translateY(${(drop - 1) * 190 - leave * 190}px) scale(${1 - 0.035 * press})`,
        borderRadius: k.radius,
        background: 'rgba(250,250,250,0.96)',
        boxShadow: '0 0 0 0.5px rgba(0,0,0,0.06), 0 10px 34px rgba(0,0,0,0.22)',
        color: '#000',
        padding: '12px 14px 13px 12px',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: k.icon,
          height: k.icon,
          borderRadius: k.icon / 2,
          overflow: 'hidden',
          flexShrink: 0,
          background: 'linear-gradient(180deg, #A5ABB8, #858A96)',
          color: '#fff',
          fontSize: 16,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {avatar ? <Img src={asset(avatar)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : initials(name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: '20px', letterSpacing: -0.23 }}>{name}</div>
          <div style={{ fontSize: 13, color: '#8A8A8E', letterSpacing: -0.08 }}>now</div>
        </div>
        <div
          style={{
            fontSize: 15,
            lineHeight: '20px',
            letterSpacing: -0.23,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {n.text}
        </div>
      </div>
    </div>
  );
};

const RowView: React.FC<{
  row: Row;
  frame: number;
  fps: number;
  gap: number;
  c: Palette;
  /** Last bubble of a run from one sender gets the tail. */
  last: boolean;
  tap?: number;
  reaction?: ReactionKey;
}> = ({ row, frame, fps, gap, c, last, tap, reaction }) => {
  const { beat } = row;
  const mine = beat.side === 'me';
  const since = frame - row.appear;
  const smooth = { damping: 200 };
  const b = M.bubble;

  const height = spring({ frame: since, fps, config: smooth, durationInFrames: 9 });
  const pop = spring({ frame: since, fps, config: { damping: 15, mass: 0.6, stiffness: 180 } });
  const opacity = interpolate(since, [0, 4], [0, 1], clampOpts);

  // The typing indicator only shows for incoming rows; it shrinks away as the bubble grows in.
  const dots =
    mine || row.appear === row.start
      ? 0
      : spring({ frame: frame - row.start, fps, config: smooth, durationInFrames: 8 }) * (1 - height);

  // A tap on this row: the bubble dips and a touch ring expands over it.
  const sinceTap = tap === undefined ? -1 : frame - tap;
  const press = tap === undefined ? 0 : interpolate(sinceTap, [0, 4, 11], [0, 1, 0], clampOpts);
  const ring = tap === undefined ? 0 : interpolate(sinceTap, [0, 3, 14], [0, 0.32, 0], clampOpts);

  // Tapback badge: pops onto the bubble's outer top corner and opens room above the row.
  const reacted = reaction !== undefined && frame >= reaction.frame;
  const badge = reacted ? spring({ frame: frame - reaction.frame, fps, config: { damping: 13, mass: 0.5, stiffness: 190 } }) : 0;
  const badgeRoom = reacted ? spring({ frame: frame - reaction.frame, fps, config: smooth, durationInFrames: 8 }) * 20 : 0;

  const align: React.CSSProperties = {
    display: 'flex',
    justifyContent: mine ? 'flex-end' : 'flex-start',
    paddingTop: gap + badgeRoom,
  };
  const fill = mine ? c.accent : c.incoming;
  const t = M.tapback;

  return (
    <>
      {dots > 0.001 ? (
        <Grow p={dots}>
          <div style={{ ...align, opacity: dots }}>
            <TypingDots frame={frame} c={c} />
          </div>
        </Grow>
      ) : null}
      {since >= 0 ? (
        <Grow p={height}>
          <div style={align}>
            <div
              style={{
                opacity,
                position: 'relative',
                transform: `scale(${(0.7 + 0.3 * pop) * (1 - 0.04 * press)})`,
                transformOrigin: mine ? '100% 100%' : '0% 100%',
                maxWidth: b.maxWidth,
              }}
            >
              {reaction && badge > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    top: -t.rise,
                    [mine ? 'left' : 'right']: -t.overhang,
                    width: t.size,
                    height: t.size,
                    transform: `scale(${badge})`,
                    transformOrigin: mine ? '80% 90%' : '20% 90%',
                    zIndex: 2,
                  }}
                >
                  <div
                    style={{
                      width: t.size,
                      height: t.size,
                      borderRadius: t.size / 2,
                      background: reaction.by === 'me' ? c.accent : c.incoming,
                      boxShadow: `0 0 0 1.5px ${c.screen}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      lineHeight: 1,
                    }}
                  >
                    {reaction.emoji}
                  </div>
                  {/* The small trailing dot of a tapback, on the outer lower side. */}
                  <div
                    style={{
                      position: 'absolute',
                      top: t.size + 1,
                      [mine ? 'left' : 'right']: -2,
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      background: reaction.by === 'me' ? c.accent : c.incoming,
                    }}
                  />
                </div>
              ) : null}
              {ring > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: 56,
                    height: 56,
                    margin: -28,
                    borderRadius: 28,
                    background: `rgba(120,120,128,${ring})`,
                    border: `2px solid rgba(255,255,255,${ring * 2})`,
                    transform: `scale(${interpolate(sinceTap, [0, 14], [0.6, 1.5], clampOpts)})`,
                    zIndex: 1,
                  }}
                />
              ) : null}
              {beat.kind === 'card' ? (
                <Card beat={beat} c={c} />
              ) : beat.kind === 'link' ? (
                <LinkPreview beat={beat} c={c} />
              ) : (
                <div
                  style={{
                    position: 'relative',
                    background: fill,
                    color: mine ? '#fff' : c.text,
                    borderRadius: b.radius,
                    padding: `${b.padV}px ${b.padH}px`,
                    fontSize: b.font,
                    lineHeight: `${b.line}px`,
                    letterSpacing: -0.43,
                    overflowWrap: 'anywhere',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {last ? <Tail color={fill} mine={mine} /> : null}
                  <span style={{ position: 'relative' }}>{beat.text}</span>
                </div>
              )}
            </div>
          </div>
        </Grow>
      ) : null}
    </>
  );
};

/** Text currently being typed into the input bar by "me", if any. */
function composing(rows: Row[], frame: number): string {
  for (const row of rows) {
    if (row.beat.side !== 'me' || row.beat.kind !== 'message') continue;
    if (frame < row.start || frame >= row.appear) continue;
    const text = row.beat.text;
    const typingEnd = Math.max(row.start + 1, row.appear - 6);
    const n = Math.floor(interpolate(frame, [row.start, typingEnd], [0, text.length], clampOpts));
    return text.slice(0, n);
  }
  return '';
}

export const ChatScene: React.FC<ChatSceneProps> = ({ timeline, style, at }) => {
  const current = useCurrentFrame();
  const frame = at ?? current;
  const { fps } = useVideoConfig();
  const c = palette(style);
  const zoom = zoomAt(timeline.camera, frame);
  const draft = composing(timeline.rows, frame);
  const visible = timeline.rows.filter((r) => frame >= r.start);
  const landed = visible.filter((r) => frame >= r.appear);
  const browsers = timeline.browser ?? [];
  const browser = [...browsers].reverse().find((b) => frame >= b.tap);
  // True once the (light) browser page is far enough up to sit behind the status bar.
  const covered = browser !== undefined && frame >= browser.open + 8 && (browser.close === undefined || frame < browser.close + 6);
  // The photo viewer is dark right up to the top of the screen, so the clock and icons turn white.
  const viewing = covered && browser.photos !== undefined && frame >= browser.photos.open + 4;
  const statusInk = viewing ? '#FFFFFF' : covered ? '#000' : c.text;

  const framed = style.frame;
  const edge = framed ? M.bezel + M.band : 0;
  // Without the frame there is no status bar, so the header moves up.
  const lift = framed ? 0 : M.header.top - 14;
  const h = M.header;
  const k = M.composer;
  const composerBottom = framed ? k.bottom : 16;
  const metal =
    style.theme === 'dark'
      ? 'linear-gradient(145deg, #5B5B60, #2E2E31 45%, #4A4A4F)'
      : 'linear-gradient(145deg, #D9D7D2, #A9A7A2 45%, #C9C7C2)';
  const sideButton = (side: 'left' | 'right', top: number, height: number): React.CSSProperties => ({
    position: 'absolute',
    [side]: -2.6,
    top,
    width: 4,
    height,
    borderRadius: 2,
    background: style.theme === 'dark' ? '#3E3E42' : '#B4B2AD',
  });

  return (
    <AbsoluteFill style={{ background: style.background, fontFamily: FONT }}>
      {/* Camera */}
      <AbsoluteFill
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: `50% ${focusAt(timeline.camera, frame)}%`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Phone body: metal band, black bezel, then the screen. */}
        <div
          style={{
            position: 'relative',
            width: M.screen.w + edge * 2,
            height: M.screen.h + edge * 2,
            transform: `scale(${(M.scale * (style.size ?? 100)) / 100})`,
            flexShrink: 0,
            borderRadius: framed ? M.screen.radius + edge : 30,
            background: framed ? metal : 'transparent',
            boxShadow: '0 34px 70px rgba(40,30,20,0.20), 0 10px 22px rgba(40,30,20,0.12)',
          }}
        >
          {framed ? (
            <>
              <div style={sideButton('left', 150, 30)} />
              <div style={sideButton('left', 208, 56)} />
              <div style={sideButton('left', 276, 56)} />
              <div style={sideButton('right', 238, 92)} />
              <div style={{ position: 'absolute', inset: M.band, borderRadius: M.screen.radius + M.bezel, background: '#050506' }} />
            </>
          ) : null}

          {/* Screen */}
          <div
            style={{
              position: 'absolute',
              left: edge,
              top: edge,
              width: M.screen.w,
              height: M.screen.h,
              borderRadius: framed ? M.screen.radius : 30,
              background: viewing ? '#0D0F0D' : c.screen,
              color: c.text,
              overflow: 'hidden',
            }}
          >
            {/* Thread: anchored above the input bar so new rows push older ones up, under the header. */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                // The input bar is measured invisibly here so a draft that wraps pushes the thread up.
                bottom: composerBottom,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                padding: `0 ${M.bubble.side}px`,
              }}
            >
              {visible.map((row, i) => {
                const prev = visible[i - 1];
                const gap = prev && prev.beat.side === row.beat.side ? M.bubble.gapSame : M.bubble.gapOther;
                const next = landed[landed.indexOf(row) + 1];
                const last = !next || next.beat.side !== row.beat.side;
                const tap = browsers.find((b) => b.rowId === row.id)?.tap;
                const reaction = (timeline.reactions ?? []).find((r) => r.rowId === row.id);
                return (
                  <RowView key={row.id} row={row} frame={frame} fps={fps} gap={gap} c={c} last={last} tap={tap} reaction={reaction} />
                );
              })}
            </div>
              <div
                style={{
                  flexShrink: 0,
                  visibility: 'hidden',
                  margin: `${k.threadGap}px ${k.right}px 0 ${k.plusLeft + k.plus + k.gap}px`,
                  minHeight: k.field,
                  boxSizing: 'border-box',
                  padding: '10px 41px 10px 16px',
                  fontSize: 17,
                  lineHeight: '20px',
                  letterSpacing: -0.43,
                  overflowWrap: 'anywhere',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {draft || ' '}
              </div>
            </div>

            {/* Messages fade out as they scroll up behind the floating header. */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                height: 200 - lift,
                background: `linear-gradient(rgba(${c.screenRGB},0.97) 0%, rgba(${c.screenRGB},0.92) 45%, rgba(${c.screenRGB},0.6) 72%, rgba(${c.screenRGB},0) 100%)`,
              }}
            />

            {/* Header: floating back and video buttons, avatar, name pill. */}
            <Glass c={c} size={h.button} style={{ position: 'absolute', left: h.side, top: h.top - lift }}>
              <svg width="11" height="19" viewBox="0 0 11 19" style={{ marginRight: 2 }}>
                <path d="M9.2 1.5 1.8 9.5l7.4 8" fill="none" stroke={c.text} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Glass>
            <Glass c={c} size={h.button} style={{ position: 'absolute', right: h.side + 0.6, top: h.top - lift }}>
              <svg width="27" height="18" viewBox="0 0 27 18" fill="none" stroke={c.text} strokeWidth="1.9" strokeLinejoin="round">
                <rect x="1" y="1.5" width="17" height="15" rx="4.2" />
                <path d="M18 7.2 24.5 3a.9.9 0 0 1 1.4.75v10.5a.9.9 0 0 1-1.4.75L18 10.8" />
              </svg>
            </Glass>
            <div
              style={{
                position: 'absolute',
                left: (M.screen.w - h.avatar) / 2,
                top: h.top - lift,
                width: h.avatar,
                height: h.avatar,
                borderRadius: h.avatar / 2,
                overflow: 'hidden',
                boxShadow: c.glassShadow,
                background: 'linear-gradient(180deg, #A5ABB8, #858A96)',
                color: '#fff',
                fontSize: 25,
                fontWeight: 500,
                letterSpacing: 0.3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {timeline.avatar ? (
                <Img src={asset(timeline.avatar)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                initials(timeline.contact)
              )}
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, top: h.nameTop - lift, display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  height: h.nameH,
                  borderRadius: h.nameH / 2,
                  padding: '0 9px 0 12px',
                  background: c.pill,
                  boxShadow: c.glassShadow,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: -0.4,
                }}
              >
                {timeline.contact}
                <svg width="7" height="12" viewBox="0 0 7 12">
                  <path d="m1.5 1.5 4 4.5-4 4.5" fill="none" stroke={c.secondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            {/* Composer: round plus button and a pill field, both floating. */}
            <div
              style={{
                position: 'absolute',
                left: k.plusLeft,
                right: k.right,
                bottom: composerBottom,
                display: 'flex',
                alignItems: 'flex-end',
                gap: k.gap,
              }}
            >
              <Glass c={c} size={k.plus}>
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <path d="M8 1v14M1 8h14" fill="none" stroke={c.text} strokeWidth="2" strokeLinecap="round" />
                </svg>
              </Glass>
              <div
                style={{
                  flex: 1,
                  minHeight: k.field,
                  boxSizing: 'border-box',
                  borderRadius: k.field / 2,
                  background: c.glass,
                  boxShadow: c.glassShadow,
                  padding: '10px 5px 10px 16px',
                  fontSize: 17,
                  lineHeight: '20px',
                  letterSpacing: -0.43,
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 6,
                }}
              >
                <div style={{ flex: 1, color: draft ? c.text : c.placeholder, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{draft || 'iMessage'}</div>
                {draft ? (
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      margin: '-5px 0',
                      borderRadius: 15,
                      background: c.accent,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <svg width="15" height="16" viewBox="0 0 15 16">
                      <path d="M7.5 14V2.5M2.8 7 7.5 2.3 12.2 7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                ) : (
                  <svg
                    width="13"
                    height="19"
                    viewBox="0 0 13 19"
                    style={{ flexShrink: 0, margin: '0 10px 0.5px 0' }}
                    fill="none"
                    stroke={c.placeholder}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <rect x="3.5" y="0.8" width="6" height="11" rx="3" />
                    <path d="M0.8 8.5a5.7 5.7 0 0 0 11.4 0M6.5 14.3V18M3.5 18h6" />
                  </svg>
                )}
              </div>
            </div>

            {browser ? <Browser b={browser} frame={frame} fps={fps} framed={framed} /> : null}
            {(timeline.notifications ?? []).map((n, i) => (
              <Banner key={i} n={n} frame={frame} fps={fps} name={timeline.contact} avatar={timeline.avatar} />
            ))}

            {/* Clock, status icons and Dynamic Island stay put while the browser slides underneath. */}
            {framed ? (
              <>
                <div
                  style={{
                    position: 'absolute',
                    left: M.status.timeLeft,
                    top: M.status.timeTop,
                    fontSize: 17,
                    lineHeight: '21px',
                    fontWeight: 600,
                    letterSpacing: -0.4,
                    color: statusInk,
                  }}
                >
                  9:41
                </div>
                <StatusIcons color={statusInk} />
                <div
                  style={{
                    position: 'absolute',
                    left: (M.screen.w - M.island.w) / 2,
                    top: M.island.top,
                    width: M.island.w,
                    height: M.island.h,
                    borderRadius: M.island.h / 2,
                    background: style.theme === 'dark' && !covered ? '#1C1C1E' : '#000',
                  }}
                />
              </>
            ) : null}
          </div>
        </div>
      </AbsoluteFill>

      {/* Logo sits outside the camera so zooms never move it. */}
      {style.logo ? (
        <Img
          src={asset(style.logo.src)}
          style={{
            position: 'absolute',
            left: `${style.logo.x}%`,
            top: `${style.logo.y}%`,
            width: `${style.logo.size}%`,
            transform: 'translate(-50%, -50%)',
            opacity: style.logo.opacity,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

