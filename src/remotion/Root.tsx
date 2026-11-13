import React from 'react';
import { Composition } from 'remotion';
import { ChatScene } from '../scene/ChatScene';
import { Sheet, sheetSize } from './Sheet';
import { FPS } from '../engine/timing';
import { DEFAULT_STYLE, type Timeline } from '../engine/types';

export const COMPOSITION_ID = 'Chat';
export const SIZE = 1080;

const EMPTY: Timeline = { fps: FPS, durationInFrames: FPS, contact: '', rows: [], camera: [], browser: [], reactions: [], notifications: [] };

/** Entry for the export renderer. The studio passes the real timeline as input props. */
export const Root: React.FC = () => (
  <>
  <Composition
    id={COMPOSITION_ID}
    component={ChatScene}
    width={SIZE}
    height={SIZE}
    fps={FPS}
    durationInFrames={FPS}
    defaultProps={{ timeline: EMPTY, style: DEFAULT_STYLE }}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.timeline.durationInFrames,
      fps: props.timeline.fps,
    })}
  />
  <Composition
    id="Sheet"
    component={Sheet}
    width={400}
    height={434}
    fps={FPS}
    durationInFrames={1}
    defaultProps={{ timeline: EMPTY, style: DEFAULT_STYLE, frames: [0] }}
    calculateMetadata={({ props }) => ({ ...sheetSize(props.frames.length), fps: props.timeline.fps })}
  />
  </>
);
