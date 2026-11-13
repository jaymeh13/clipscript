import { useRef, useState } from 'react';
import {
  BACKGROUNDS,
  DEFAULT_LOGO,
  DEFAULT_STYLE,
  beatLabel,
  type LogoLayout,
  type Row,
  type SceneStyle,
  type TimingOverride,
} from './engine/types';
import { uploadImage } from './files';

type Props = {
  tab: 'style' | 'scene';
  onTab: (tab: 'style' | 'scene') => void;
  style: SceneStyle;
  onStyle: (style: SceneStyle) => void;
  row: Row | null;
  fps: number;
  contact: string;
  onTiming: (row: Row, timing: TimingOverride) => void;
  /** The camera in effect at the selected row; `own` is true when a move starts with this row. */
  camera: { zoom: number; focus: number; explicitFocus?: number; own: boolean };
  onCamera: (row: Row, move: { zoom: number; focus?: number } | null) => void;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Commits on blur or Enter, so half-typed numbers never reach the timeline. */
function SecondsField(props: { label: string; hint: string; value: number; onCommit: (v: number) => void }) {
  const commit = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 30 && round2(v) !== props.value) {
      props.onCommit(round2(v));
    }
  };
  return (
    <label className="field">
      <span>
        {props.label}
        <small>{props.hint}</small>
      </span>
      <input
        key={props.value}
        type="number"
        min={0}
        max={30}
        step={0.1}
        defaultValue={props.value}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output>
        {props.value}
        {props.unit}
      </output>
    </label>
  );
}

function LogoGroup({ style, onStyle }: { style: SceneStyle; onStyle: (style: SceneStyle) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const logo = style.logo;
  const set = (patch: Partial<LogoLayout>) => logo && onStyle({ ...style, logo: { ...logo, ...patch } });

  return (
    <div className="group">
      <h3>Logo</h3>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const src = await uploadImage(file);
            setError(null);
            onStyle({ ...style, logo: { ...DEFAULT_LOGO, ...logo, src } });
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      <div className="row">
        <button className="outline" onClick={() => picker.current?.click()}>
          {logo ? 'Replace' : 'Choose image'}
        </button>
        {logo ? (
          <button
            className="link"
            onClick={() => {
              const { logo: _removed, ...rest } = style;
              onStyle(rest);
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
      {error ? <p className="note error">{error}</p> : null}
      {logo ? (
        <div className="sliders">
          <Slider label="X" value={logo.x} min={0} max={100} unit="%" onChange={(x) => set({ x })} />
          <Slider label="Y" value={logo.y} min={0} max={100} unit="%" onChange={(y) => set({ y })} />
          <Slider label="Size" value={logo.size} min={4} max={80} unit="%" onChange={(size) => set({ size })} />
          <Slider
            label="Opacity"
            value={Math.round(logo.opacity * 100)}
            min={10}
            max={100}
            unit="%"
            onChange={(v) => set({ opacity: v / 100 })}
          />
        </div>
      ) : (
        <p className="note">Shown over the whole video. Position and size are adjustable.</p>
      )}
    </div>
  );
}

export function Inspector({ tab, onTab, style, onStyle, row, fps, contact, onTiming, camera, onCamera }: Props) {
  const isHex = /^#[0-9a-f]{6}$/i.test(style.background);

  return (
    <aside className="inspector">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'style'} onClick={() => onTab('style')}>
          Style
        </button>
        <button role="tab" aria-selected={tab === 'scene'} onClick={() => onTab('scene')}>
          Scene
        </button>
      </div>

      {tab === 'style' ? (
        <div className="panel">
          <div className="group">
            <h3>Theme</h3>
            <div className="segmented">
              {(['light', 'dark'] as const).map((t) => (
                <button key={t} aria-pressed={style.theme === t} onClick={() => onStyle({ ...style, theme: t })}>
                  {t === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>

          <div className="group">
            <h3>Background</h3>
            <div className="swatches">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.name}
                  title={b.name}
                  aria-label={`${b.name} background`}
                  aria-pressed={style.background === b.css}
                  style={{ background: b.css }}
                  onClick={() => onStyle({ ...style, background: b.css })}
                />
              ))}
              <label className="custom" title="Custom colour" data-active={isHex && !BACKGROUNDS.some((b) => b.css === style.background)}>
                <input
                  type="color"
                  aria-label="Custom background colour"
                  value={isHex ? style.background : '#e7e3dd'}
                  onChange={(e) => onStyle({ ...style, background: e.target.value })}
                />
              </label>
            </div>
          </div>

          <div className="group">
            <h3>Bubble colour</h3>
            <div className="row">
              <input
                type="color"
                aria-label="Bubble colour"
                value={style.accent}
                onChange={(e) => onStyle({ ...style, accent: e.target.value })}
              />
              <code>{style.accent.toUpperCase()}</code>
              {style.accent.toLowerCase() !== DEFAULT_STYLE.accent.toLowerCase() ? (
                <button className="link" onClick={() => onStyle({ ...style, accent: DEFAULT_STYLE.accent })}>
                  Reset
                </button>
              ) : null}
            </div>
          </div>

          <div className="group">
            <label className="check">
              <input
                type="checkbox"
                checked={style.frame}
                onChange={(e) => onStyle({ ...style, frame: e.target.checked })}
              />
              Phone frame
            </label>
          </div>

          <div className="group">
            <h3>Phone size</h3>
            <div className="sliders">
              <Slider
                label="Size"
                value={style.size ?? 100}
                min={50}
                max={130}
                unit="%"
                onChange={(size) => onStyle({ ...style, size })}
              />
            </div>
            {(style.size ?? 100) !== 100 ? (
              <button className="link" onClick={() => onStyle({ ...style, size: 100 })}>
                Reset
              </button>
            ) : (
              <p className="note">How big the phone is for the whole video.</p>
            )}
          </div>

          <LogoGroup style={style} onStyle={onStyle} />
        </div>
      ) : row ? (
        <div className="panel">
          <div className="group">
            <h3>{row.beat.side === 'me' ? 'Me' : contact} · line {row.beat.line}</h3>
            <p className="quote">{beatLabel(row.beat)}</p>
          </div>
          <div className="group">
            <h3>Timing</h3>
            <SecondsField
              label="Lead"
              hint={row.beat.side === 'me' ? 'typing in the input bar' : 'typing dots'}
              value={round2((row.appear - row.start) / fps)}
              onCommit={(lead) => onTiming(row, { lead, hold: row.beat.hold })}
            />
            <SecondsField
              label="Hold"
              hint="before the next beat"
              value={round2((row.end - row.appear) / fps)}
              onCommit={(hold) => onTiming(row, { lead: row.beat.lead, hold })}
            />
            {row.beat.lead !== undefined || row.beat.hold !== undefined ? (
              <button className="link" onClick={() => onTiming(row, {})}>
                Reset to automatic
              </button>
            ) : (
              <p className="note">Automatic, based on message length.</p>
            )}
          </div>
          <div className="group">
            <h3>Camera</h3>
            <div className="sliders">
              <Slider
                label="Zoom"
                value={Math.round(camera.zoom * 100)}
                min={60}
                max={250}
                step={5}
                unit="%"
                onChange={(v) => onCamera(row, { zoom: v / 100, focus: camera.explicitFocus })}
              />
              <Slider
                label="Anchor"
                value={Math.round(camera.focus)}
                min={0}
                max={100}
                unit="%"
                onChange={(focus) => onCamera(row, { zoom: camera.zoom, focus })}
              />
            </div>
            {camera.own ? (
              <>
                <p className="note">The camera eases to this as the message starts and stays until the next move.</p>
                <button className="link" onClick={() => onCamera(row, null)}>
                  Remove this move
                </button>
              </>
            ) : (
              <p className="note">
                No camera move starts here. Drag a slider to add one. Anchor is the height that holds still: 0 is the top, 100 the
                bottom.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="panel">
          <p className="note">Select a message in the timeline or storyboard to adjust its timing.</p>
        </div>
      )}
    </aside>
  );
}
