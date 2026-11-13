import React from 'react';
import { AbsoluteFill } from 'remotion';
import { ChatScene } from '../scene/ChatScene';
import type { SceneStyle, Timeline } from '../engine/types';

export type SheetProps = { timeline: Timeline; style: SceneStyle; frames: number[] };

const CELL = 400;
const LABEL = 34;
const MAX_COLS = 4;
const SCENE = 1080;

export function sheetSize(count: number): { width: number; height: number } {
  const n = Math.max(1, count);
  return { width: Math.min(n, MAX_COLS) * CELL, height: Math.ceil(n / MAX_COLS) * (CELL + LABEL) };
}

/** Contact sheet: the scene frozen at several frames, tiled into one image with a time label on each. */
export const Sheet: React.FC<SheetProps> = ({ timeline, style, frames }) => (
  <AbsoluteFill style={{ background: '#111', flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' }}>
    {frames.map((frame, i) => (
      <div key={i} style={{ width: CELL, height: CELL + LABEL }}>
        <div
          style={{
            height: LABEL,
            paddingLeft: 10,
            color: '#fff',
            font: `600 18px/${LABEL}px -apple-system, Helvetica, Arial, sans-serif`,
          }}
        >
          {i + 1} · {(frame / timeline.fps).toFixed(1)}s
        </div>
        <div style={{ width: CELL, height: CELL, position: 'relative', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              width: SCENE,
              height: SCENE,
              transform: `scale(${CELL / SCENE})`,
              transformOrigin: '0 0',
            }}
          >
            <ChatScene timeline={timeline} style={style} at={frame} />
          </div>
        </div>
      </div>
    ))}
  </AbsoluteFill>
);
