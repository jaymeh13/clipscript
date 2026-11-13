import { useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { cameraLineBefore, parseScript, setCameraBefore, setLineTiming } from './engine/parser';
import { DEFAULT_STYLE, beatLabel, type SceneStyle } from './engine/types';
import { Timeline } from './Timeline';
import { Inspector } from './Inspector';
import { CAMERA_FOCUS, CAMERA_MOVE_FRAMES, formatTime, resolveTimeline } from './engine/timing';
import { ChatScene } from './scene/ChatScene';
import { SAMPLE_SCRIPT } from './sample';
import { listProjects, loadProject, saveProject, uploadImage } from './files';
import { exportVideo, formatBytes, type ExportFormat, type ExportSize, type ExportState } from './exporter';

const STORAGE_KEY = 'video-studio.script';
const STYLE_KEY = 'video-studio.style';
const NAME_KEY = 'video-studio.project';
const SIZE = 1080;

function loadStyle(): SceneStyle {
  try {
    const saved = JSON.parse(localStorage.getItem(STYLE_KEY) ?? 'null') as Partial<SceneStyle> | null;
    return { ...DEFAULT_STYLE, ...(saved ?? {}) };
  } catch {
    return DEFAULT_STYLE;
  }
}

function loadScript(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? SAMPLE_SCRIPT;
  } catch {
    return SAMPLE_SCRIPT;
  }
}

export function App() {
  const [source, setSource] = useState(loadScript);
  const [tab, setTab] = useState<'script' | 'storyboard'>('script');
  const player = useRef<PlayerRef>(null);
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [size, setSize] = useState<ExportSize>(1080);
  const [exporting, setExporting] = useState<ExportState>({ phase: 'idle' });
  const busy = exporting.phase === 'working';
  const [style, setStyle] = useState(loadStyle);
  const [inspectorTab, setInspectorTab] = useState<'style' | 'scene'>('style');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? 'Untitled';
    } catch {
      return 'Untitled';
    }
  });
  const [projects, setProjects] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const imagePicker = useRef<HTMLInputElement>(null);

  const fail = (err: unknown) => setNotice(err instanceof Error ? err.message : String(err));
  const refreshProjects = () => listProjects().then(setProjects).catch(fail);

  const save = async () => {
    setSaveState('saving');
    try {
      await saveProject(name.trim(), source, style);
      setNotice(null);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
      void refreshProjects();
    } catch (err) {
      setSaveState('idle');
      fail(err);
    }
  };

  const open = async (project: string) => {
    try {
      const p = await loadProject(project);
      player.current?.pause();
      player.current?.seekTo(0);
      setSource(p.source);
      setStyle({ ...DEFAULT_STYLE, ...p.style });
      setName(p.name);
      setSelectedId(null);
      setNotice(null);
    } catch (err) {
      fail(err);
    }
  };

  const addImage = async (file: File) => {
    try {
      const path = await uploadImage(file);
      setSource((src) => `${src.replace(/\n*$/, '')}\nthem: [card "Product name" $0 ${path}]\n`);
      setTab('script');
      setNotice(null);
    } catch (err) {
      fail(err);
    }
  };

  useEffect(() => {
    void refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Storage is a convenience only.
    }
  }, [name]);

  const script = useMemo(() => parseScript(source), [source]);
  const timeline = useMemo(() => resolveTimeline(script), [script]);
  // Style directives in the script win over the inspector's settings.
  const sceneStyle = useMemo(() => ({ ...style, ...script.style }), [style, script]);
  const inputProps = useMemo(() => ({ timeline, style: sceneStyle }), [timeline, sceneStyle]);
  const selected = timeline.rows.find((r) => r.id === selectedId) ?? null;

  // The camera at the selected row: its own move if an @camera line sits right above it, else whatever carried over.
  const camera = useMemo(() => {
    const cameraLine = selected ? cameraLineBefore(source, selected.beat.line) : null;
    const beat = script.beats.find((b) => b.kind === 'camera' && b.line === cameraLine);
    const key = selected ? [...timeline.camera].reverse().find((k) => k.frame <= selected.start) : undefined;
    return {
      zoom: key?.zoom ?? 1,
      focus: key?.focus ?? CAMERA_FOCUS,
      explicitFocus: beat?.kind === 'camera' ? beat.focus : undefined,
      own: beat !== undefined,
    };
  }, [source, script, timeline, selected]);

  const select = (id: number | null) => {
    setSelectedId(id);
    if (id !== null) setInspectorTab('scene');
  };
  const seek = (f: number) => {
    player.current?.pause();
    player.current?.seekTo(f);
  };
  const toggle = () => player.current?.toggle();

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
    };
  }, []);

  // Space plays and pauses unless the user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== 'Space' || /^(TEXTAREA|INPUT|SELECT|BUTTON|A)$/.test(el.tagName)) return;
      e.preventDefault();
      player.current?.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STYLE_KEY, JSON.stringify(style));
    } catch {
      // Storage is a convenience only.
    }
  }, [style]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, source);
    } catch {
      // Storage is a convenience only.
    }
  }, [source]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="project">
          <input
            aria-label="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            spellCheck={false}
          />
          <button onClick={() => void save()} disabled={saveState === 'saving' || name.trim() === ''}>
            {saveState === 'saved' ? 'Saved' : 'Save'}
          </button>
          <select
            aria-label="Open project"
            value=""
            disabled={projects.length === 0}
            onChange={(e) => {
              if (e.target.value) void open(e.target.value);
            }}
          >
            <option value="">{projects.length === 0 ? 'No saved projects' : 'Open…'}</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="export">
          <span className="export-status" role="status">
            {exporting.phase === 'working' ? `${exporting.label} ${Math.round(exporting.progress * 100)}%` : null}
            {exporting.phase === 'error' ? <span className="export-error">{exporting.message}</span> : null}
            {exporting.phase === 'done' ? `Saved ${exporting.path} (${formatBytes(exporting.bytes)})` : null}
          </span>
          {exporting.phase === 'done' ? (
            <a className="download" href={exporting.url} download>
              Download
            </a>
          ) : null}
          <select
            aria-label="Format"
            value={format}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value as ExportFormat;
              setFormat(next);
              // Full-size GIFs are huge, so default them smaller.
              setSize(next === 'gif' ? 540 : 1080);
            }}
          >
            <option value="mp4">MP4</option>
            <option value="gif">GIF</option>
          </select>
          <select
            aria-label="Size"
            value={size}
            disabled={busy}
            onChange={(e) => setSize(Number(e.target.value) as ExportSize)}
          >
            <option value={540}>540 px</option>
            <option value={720}>720 px</option>
            <option value={1080}>1080 px</option>
          </select>
          <button
            className="primary"
            disabled={busy || timeline.rows.length === 0}
            onClick={() => void exportVideo(timeline, sceneStyle, format, size, setExporting)}
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </header>

      <aside className="side">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'script'} onClick={() => setTab('script')}>
            Script
          </button>
          <button role="tab" aria-selected={tab === 'storyboard'} onClick={() => setTab('storyboard')}>
            Storyboard
          </button>
          <input
            ref={imagePicker}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void addImage(file);
            }}
          />
          <button className="reset" onClick={() => imagePicker.current?.click()} title="Add an image as a product card">
            + Image
          </button>
          <button onClick={() => setSource(SAMPLE_SCRIPT)} title="Replace the script with the sample">
            Sample
          </button>
        </div>

        {tab === 'script' ? (
          <textarea
            className="editor"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            aria-label="Script"
          />
        ) : (
          <ol className="beats">
            {timeline.rows.length === 0 ? <li className="empty">No messages yet.</li> : null}
            {timeline.rows.map((row) => (
              <li key={row.id}>
                <button
                  aria-current={row.id === selectedId}
                  onClick={() => {
                    seek(Math.min(row.appear + 10, timeline.durationInFrames - 1));
                    select(row.id);
                  }}
                >
                  <span className={`who ${row.beat.side}`}>{row.beat.side === 'me' ? 'Me' : timeline.contact}</span>
                  <span className="time">{formatTime(row.appear, timeline.fps)}</span>
                  <span className="text">{beatLabel(row.beat)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}

        {notice ? (
          <ul className="errors">
            <li>
              {notice}{' '}
              <button className="link" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </li>
          </ul>
        ) : null}

        {script.errors.length > 0 ? (
          <ul className="errors">
            {script.errors.map((e) => (
              <li key={e.line}>
                <b>Line {e.line}</b> {e.message}
              </li>
            ))}
          </ul>
        ) : null}
      </aside>

      <main className="stage">
        <div className="canvas">
          <Player
            ref={player}
            component={ChatScene}
            inputProps={inputProps}
            durationInFrames={timeline.durationInFrames}
            fps={timeline.fps}
            compositionWidth={SIZE}
            compositionHeight={SIZE}
            style={{ width: '100%', height: '100%' }}
            loop
            acknowledgeRemotionLicense
          />
        </div>
      </main>

      <Inspector
        tab={inspectorTab}
        onTab={setInspectorTab}
        style={style}
        onStyle={setStyle}
        row={selected}
        fps={timeline.fps}
        contact={timeline.contact}
        onTiming={(row, timing) => setSource((src) => setLineTiming(src, row.beat.line, timing))}
        camera={camera}
        onCamera={(row, move) => {
          setSource((src) => setCameraBefore(src, row.beat.line, move));
          // Show the frame where the move has finished, so the change is visible while dragging.
          const settled = Math.min(row.start + CAMERA_MOVE_FRAMES, timeline.durationInFrames - 1);
          if (frame < settled || frame >= Math.max(row.end, settled + 1)) seek(settled);
        }}
      />

      <Timeline
        timeline={timeline}
        frame={Math.min(frame, timeline.durationInFrames - 1)}
        playing={playing}
        selectedId={selectedId}
        onToggle={toggle}
        onSeek={seek}
        onSelect={select}
      />
    </div>
  );
}
