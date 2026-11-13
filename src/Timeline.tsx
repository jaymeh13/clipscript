import { useRef } from 'react';
import { beatLabel, type Row, type Timeline as TimelineData } from './engine/types';
import { formatTime } from './engine/timing';

type Props = {
  timeline: TimelineData;
  frame: number;
  playing: boolean;
  selectedId: number | null;
  onToggle: () => void;
  onSeek: (frame: number) => void;
  onSelect: (id: number | null) => void;
};

/** Seconds between ruler labels, chosen so labels never crowd. */
function rulerStep(seconds: number): number {
  for (const step of [1, 2, 5, 10, 30, 60]) if (seconds / step <= 14) return step;
  return 120;
}

export function Timeline({ timeline, frame, playing, selectedId, onToggle, onSeek, onSelect }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const { durationInFrames: total, fps, rows, camera, browser, reactions } = timeline;
  const pct = (f: number) => `${(f / total) * 100}%`;

  const frameAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(total - 1, Math.round(t * total));
  };

  const step = rulerStep(total / fps);
  const ticks: number[] = [];
  for (let s = 0; s * fps < total; s += step) ticks.push(s);

  const lane = (side: Row['beat']['side']) =>
    rows
      .filter((r) => r.beat.side === side)
      .map((r) => (
        <div
          key={r.id}
          className={`block ${side}${r.id === selectedId ? ' selected' : ''}`}
          style={{ left: pct(r.start), width: pct(r.end - r.start) }}
          title={beatLabel(r.beat)}
        >
          <div className="lead" style={{ width: `${((r.appear - r.start) / Math.max(1, r.end - r.start)) * 100}%` }} />
          <span>{beatLabel(r.beat)}</span>
        </div>
      ));

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="transport">
        <button className="play" onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1.5" y="1" width="3.2" height="10" rx="1" fill="currentColor" />
              <rect x="7.3" y="1" width="3.2" height="10" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 1.2v9.6a.6.6 0 0 0 .9.5l8-4.8a.6.6 0 0 0 0-1l-8-4.8a.6.6 0 0 0-.9.5Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className="clock">
          {formatTime(frame, fps)} <i>/ {formatTime(total, fps)}</i>
        </span>
      </div>

      <div className="lanes-labels" aria-hidden="true">
        <span />
        <span>Me</span>
        <span>{timeline.contact}</span>
        <span>Events</span>
      </div>

      <div
        className="track"
        ref={track}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const f = frameAt(e.clientX);
          onSeek(f);
          const hit = rows.find((r) => f >= r.start && f < r.end);
          onSelect(hit ? hit.id : null);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(frameAt(e.clientX));
        }}
      >
        <div className="ruler">
          {ticks.map((s) => (
            <span key={s} style={{ left: pct(s * fps) }}>
              {s}s
            </span>
          ))}
        </div>
        <div className="lane">{lane('me')}</div>
        <div className="lane">{lane('them')}</div>
        <div className="lane">
          {camera.map((k, i) => (
            <div key={i} className="camkey" style={{ left: pct(k.frame) }}>
              {k.zoom === 1 ? 'reset' : `${k.zoom}×`}
            </div>
          ))}
          {reactions.map((r, i) => (
            <div key={`react-${i}`} className="camkey" style={{ left: pct(r.frame) }}>
              {r.emoji}
            </div>
          ))}
          {browser.map((b, i) => (
            <div key={`open-${i}`} className="camkey" style={{ left: pct(b.tap) }}>
              open link
            </div>
          ))}
        </div>
        <div className="playhead" style={{ left: pct(frame) }} />
      </div>
    </section>
  );
}
