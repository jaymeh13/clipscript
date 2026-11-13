export type Side = 'me' | 'them';

/** Optional per-beat timing overrides, in seconds. Written in the script as {lead 1.2, hold 0.8}. */
export type TimingOverride = { lead?: number; hold?: number };

export type MessageBeat = { kind: 'message'; side: Side; text: string; line: number } & TimingOverride;
export type CardBeat = {
  kind: 'card';
  side: Side;
  title: string;
  price?: string;
  image?: string;
  line: number;
} & TimingOverride;
export type LinkBeat = {
  kind: 'link';
  side: Side;
  url: string;
  title: string;
  image?: string;
  line: number;
} & TimingOverride;
/** Taps the most recent link and opens it in a browser view. */
export type OpenBeat = { kind: 'open'; url: string; image: string; background?: string; line: number };
/** A tapback: an emoji badge on the other person's most recent message. */
export type ReactBeat = { kind: 'react'; emoji: string; by: Side; line: number };
/** Scrolls the open page: to a distance from the top in points, or to the bottom. */
export type ScrollBeat = { kind: 'scroll'; to: number | 'bottom'; seconds?: number; line: number };
/** Taps the open page at x,y (percent of the screen) and shows photos full screen. */
export type PhotosBeat = { kind: 'photos'; images: string[]; x: number; y: number; first: number; total: number; line: number };
/** Swipes to the next photo. */
export type SwipeBeat = { kind: 'swipe'; line: number };
/** A message from them that arrives as a banner over the browser. */
/** `hold` is how long the banner stays before the next beat, in seconds. */
export type NotifyBeat = { kind: 'notify'; text: string; hold?: number; line: number };
/** Leaves the browser for the chat, by tapping the banner if one is showing. */
export type BackBeat = { kind: 'back'; line: number };
/** `focus` is the height the zoom holds still, as a percentage down the canvas; a reset keeps the last one. */
export type CameraBeat = { kind: 'camera'; zoom: number; focus?: number; line: number };
export type PauseBeat = { kind: 'pause'; seconds: number; line: number };

export type Beat =
  | MessageBeat
  | CardBeat
  | LinkBeat
  | OpenBeat
  | ScrollBeat
  | PhotosBeat
  | SwipeBeat
  | NotifyBeat
  | BackBeat
  | ReactBeat
  | CameraBeat
  | PauseBeat;
export type RowBeat = MessageBeat | CardBeat | LinkBeat;

/** One-line description of a row, for lists and tooltips. */
export function beatLabel(beat: RowBeat): string {
  if (beat.kind === 'card') return `Card: ${beat.title}`;
  if (beat.kind === 'link') return `Link: ${beat.title}`;
  return beat.text;
}

/** "https://www.example.com/list" -> "example.com" */
export function domainOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
}

export type ScriptError = { line: number; message: string };

export type Script = {
  contact: string;
  /** Image for the contact's avatar; initials are shown without one. */
  avatar?: string;
  /** Style set by directives in the script; these win over a project's saved style. */
  style: Partial<SceneStyle>;
  beats: Beat[];
  errors: ScriptError[];
};

/** A chat row placed on the timeline. */
export type Row = {
  id: number;
  beat: RowBeat;
  /** Frame where typing (them) or composing (me) begins. */
  start: number;
  /** Frame where the bubble lands in the thread. */
  appear: number;
  /** Frame where this row's hold ends and the next beat may begin. */
  end: number;
};

export type CameraKey = { frame: number; zoom: number; focus: number };

export type ReactionKey = { frame: number; rowId: number; emoji: string; by: Side };

export type BrowserKey = {
  /** Frame of the tap on the link. */
  tap: number;
  /** Frame the browser starts sliding in. */
  open: number;
  url: string;
  /** Screenshot of the page, phone-sized. */
  image: string;
  background: string;
  /** Row that gets tapped, if there is a link above. */
  rowId: number | null;
  /** Page scrolls, in order. Each eases from wherever the page was. */
  scrolls: ScrollKey[];
  /** Full-screen photo viewer opened from the page. */
  photos?: PhotosKey;
  /** Frame the browser starts sliding away again. */
  close?: number;
};

export type ScrollKey = { frame: number; frames: number; to: number | 'bottom' };

export type PhotosKey = {
  /** Frame of the tap on the page, and where it lands (percent of the screen). */
  tap: number;
  x: number;
  y: number;
  /** Frame the viewer starts to appear. */
  open: number;
  images: string[];
  /** The counter reads "first / total" on the first image. */
  first: number;
  total: number;
  /** Frames where a swipe to the next photo begins. */
  swipes: number[];
};

/** A banner for an incoming message, shown over the browser. */
export type NotifyKey = {
  frame: number;
  rowId: number;
  text: string;
  /** Frame the banner is tapped; it leaves just after. Without one it leaves by itself. */
  tap?: number;
  leave: number;
};

export type Timeline = {
  fps: number;
  durationInFrames: number;
  contact: string;
  avatar?: string;
  rows: Row[];
  camera: CameraKey[];
  browser: BrowserKey[];
  reactions: ReactionKey[];
  notifications: NotifyKey[];
};

export type SceneStyle = {
  theme: 'light' | 'dark';
  /** Any CSS background value. */
  background: string;
  /** Colour of outgoing bubbles and controls. */
  accent: string;
  /** Show the phone bezel and status bar. */
  frame: boolean;
  /** Phone size as a percentage of its normal size (default 100). */
  size?: number;
  /** Optional logo drawn over the scene. */
  logo?: LogoLayout;
};

export type LogoLayout = {
  /** Path under public/ or a full URL. */
  src: string;
  /** Centre of the logo, as a percentage of the canvas. */
  x: number;
  y: number;
  /** Width as a percentage of the canvas. */
  size: number;
  opacity: number;
};

export const DEFAULT_LOGO: Omit<LogoLayout, 'src'> = { x: 13, y: 7, size: 17, opacity: 1 };

export const BACKGROUNDS: { name: string; css: string }[] = [
  { name: 'Sand', css: 'radial-gradient(120% 120% at 30% 20%, #F3F0EB 0%, #E7E3DD 60%, #DDD8D1 100%)' },
  { name: 'White', css: '#FFFFFF' },
  { name: 'Sky', css: 'linear-gradient(160deg, #DCEBFA 0%, #C9DAF2 55%, #D9D3EE 100%)' },
  { name: 'Mint', css: 'linear-gradient(160deg, #E3F2E6 0%, #CFE6DC 100%)' },
  { name: 'Graphite', css: 'radial-gradient(120% 120% at 30% 20%, #2B2B30 0%, #1A1A1D 70%, #121214 100%)' },
];

export const DEFAULT_STYLE: SceneStyle = {
  theme: 'light',
  background: BACKGROUNDS[0].css,
  accent: '#1C99FE',
  frame: true,
};
