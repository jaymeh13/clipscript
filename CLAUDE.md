# ClipScript

Turns a plain-text chat script into a square (1080×1080) animated iMessage-style video, exported as MP4 or GIF. Built on Remotion; every frame is a pure function of the script and the frame number.

## Making a video from the terminal

No browser or dev server is needed. The cheap path is one text file, one command, one image to look at:

1. Write the script as `projects/<Name>.txt`, with style set by directives at the top (see below).
2. `npm run make -- "<Name>"` — checks the script, then renders a contact sheet, an MP4 and a GIF from a single build (about 10 seconds).
3. Look at `out/<slug>-sheet.png`. It tiles the scene just after each message, reaction and browser step has settled, four cells per row, each labelled with its number and time. The command's output lists the same cells.
4. If something is wrong, fix the script and run `make` again. Use `npm run sheet` to iterate without rendering video, or `npm run still` for a full-size look at one moment.

| Command | Options | Output |
|---|---|---|
| `npm run check -- <project>` | none | JSON on stdout; exit 1 if the script has errors |
| `npm run still -- <project> --at <s>[,<s>…]` | `--size 540\|720\|1080` (default 540), `--out-dir` | `out/<slug>-<s>s.png` per timestamp |
| `npm run render -- <project>` | `--format mp4\|gif` (default mp4), `--size` (default 1080 for mp4, 540 for gif), `--out <file>` | `out/<slug>-<size>.<ext>` |
| `npm run sheet -- <project>` | `--out-dir` | `out/<slug>-sheet.png`; JSON listing each cell's time |
| `npm run make -- <project>` | `--formats mp4,gif` (default both), `--out-dir` | the sheet plus `out/<slug>-1080.mp4` and `out/<slug>-540.gif` |

`<project>` is a saved project name (`projects/<name>.json` or `.txt`), a path to a project `.json`, or a path to a plain script file. Re-running a command overwrites its previous output file. GIFs render at half the frame rate.

`check` also lists `browser` events: `tap` is the press on the link and the page is fully open about half a second after `open`.

In `check` output, `start` is when typing begins, `appear` is when the bubble lands, and `end` is when the next beat may start. To see a message on screen, take a still shortly after its `appear` time.

## Showing a website

`npm run capture -- <url> [--name <folder>] [--full]` gathers what a link preview and browser view need and saves it in `public/assets/<folder>/` (default folder: the domain without its ending):

- `og.*` — the page's link-preview image
- `icon.*` — the site icon, for the contact avatar
- `page.png` (or `page-<path>.png`) — a phone-sized screenshot, 393×790 pt at 3×

Add `--full` to screenshot the whole page from top to bottom, for `@scroll`.

It prints JSON whose `script` array holds ready-to-paste `@contact`, `[link …]` and `@open` lines, with the page's background colour filled in. `notes` lists anything it could not get. The screenshot needs Chrome, Chromium, Edge or Brave installed (or `CHROME_PATH` set); it is a still image taken at capture time. Running it again for the same folder replaces the earlier files.

## Script format

One beat per line. Blank lines and lines starting with `#` are ignored.

```
@contact Juniper
me: need a rain jacket for a trip next week
them: On it. What's the budget?
them: [card "Arc Packable Shell" $180 assets/sample-jacket.svg]
@camera zoom 1.18
@pause 0.6
them: a slower line {lead 1.2, hold 2}
@camera reset
```

- `me:` / `them:` — a message. `me` messages type into the input bar and then send; `them` messages show typing dots first.
- `[card "Title" price image]` — a product card. Price and image are optional. The image is a path under `public/` (normally `assets/<file>`) or a full URL.
- `[link url "Title" image]` — a rich link preview: the image (ideally the page's 1200×630 preview image) over the title and the URL's domain. The image is optional.
- `@open url screenshot [#background]` — taps the most recent link, then slides a browser view up over the chat showing the screenshot, with the domain in the address bar. It stays up for 2.6 seconds; add `@pause` after it to hold longer. The screenshot should be phone-sized (393×790 pt, e.g. captured at 3×); `#background` fills behind the status bar and defaults to white.
- `@scroll <points|bottom> [seconds]` — scrolls the open page to that distance from the top, or to its end (default 1.2 seconds). The `@open` screenshot must be the whole page: capture it with `--full`.
- `@photos [x,y] [n/total] <image> [<image>…]` — taps the open page at x,y (percent of the screen, default 50,50) and shows the images in a full-screen viewer. `4/14` makes the counter start at "4 / 14". `@swipe` moves to the next one.
- `@notify <text>` — their message arrives as a banner over the browser and is added to the thread. Add `{hold N}` to set how many seconds the banner stays before the next beat (automatic from text length otherwise). `@back` then taps the banner and returns to the chat (without a banner it just closes the browser).
- A written `\n` in a message or `@notify` text is a line break.
- `@react <emoji>` — a tapback from `me` on their most recent message, shown as a small badge on the bubble. `@react <emoji> them` is their reaction to my last message.
- `{lead N, hold N}` at the end of a message, card or link line overrides timing, in seconds. `lead` is the typing time before the bubble appears; `hold` is the wait after it. Either may be given alone. Without them, timing is automatic from text length.
- `@contact Name [image]` — the name in the chat header (default `Assistant`). An optional trailing image path becomes the round avatar; without it the first initial is shown.
- `@camera zoom N [top|center|bottom|0-100]` / `@camera reset` — eased zoom starting at that point in the script. It takes no time itself. A zoom placed before the first message is the opening view: the video starts already zoomed. The optional anchor is the height that holds still: `bottom` lifts the phone and keeps the gap under it in view (use it when the action is in the input bar), `center` suits the browser. Default is 68.
- `@pause N` — wait N seconds.

Style directives, usually at the top of the script. They override a project file's saved style and the studio inspector:

- `@theme light` or `@theme dark`
- `@background <name or CSS>` — a preset (`Sand`, `White`, `Sky`, `Mint`, `Graphite`) or any CSS background value
- `@accent #RRGGBB` — outgoing bubble colour
- `@frame on` or `@frame off` — the phone bezel and status bar
- `@size <percent>` — how big the phone is for the whole video (default 100, range 30–200)
- `@logo <image> [x y size opacity]` — a logo over the video; x, y and size are percentages of the canvas

## Project file

A `.txt` script with style directives is the simplest project and is all the terminal commands need. The studio UI saves and opens the JSON form below; it does not list `.txt` projects.

```json
{
  "name": "Rain jacket demo",
  "source": "<the script, newlines as \\n>",
  "style": {
    "theme": "light",
    "background": "#FFFFFF",
    "accent": "#1C99FE",
    "frame": true,
    "logo": { "src": "assets/sample-logo.svg", "x": 13, "y": 7, "size": 17, "opacity": 1 }
  }
}
```

- `theme`: `light` or `dark`. `background`: any CSS background value. `accent`: outgoing bubble colour. `frame`: show the phone bezel and status bar. `size`: phone size in percent (default 100).
- `logo` is optional. `x`/`y` are the logo centre and `size` its width, all as percentages of the canvas; `opacity` is 0–1. The logo is not affected by camera zoom.
- Omitted style fields fall back to `DEFAULT_STYLE` in `src/engine/types.ts`.
- Project names may use letters, numbers, spaces, dashes and underscores.

Images go in `public/assets/`. Write files there directly; the studio's upload buttons do the same thing.

## The studio UI

`npm run dev` serves the studio at http://localhost:5173 (script editor, storyboard, timeline, inspector, Export button). It keeps its working script and style in browser storage, so edits made to a project file on disk only appear there after choosing the project from the Open menu. The inspector's Style tab has a phone-size slider; its Scene tab, for the selected message, has timing fields and camera Zoom/Anchor sliders that write an `@camera` line above that message.

## Code map

- `src/engine/` — parser, timing resolver and types. Pure functions, covered by `npm test`.
- `src/scene/ChatScene.tsx` — the Remotion component that draws a frame.
- `src/remotion/` — composition entry used by the renderer.
- `server/renderer.ts` — shared render code, used by both the CLI and the dev server's `/api/render`.
- `server/files.ts` — dev-server endpoints for projects and image uploads.
- `scripts/studio.ts` — the `check`, `still` and `render` commands.
- `scripts/capture.ts` — the `capture` command.
- `src/App.tsx`, `src/Timeline.tsx`, `src/Inspector.tsx` — the studio UI.

The phone mimics iOS 26 on a 393×852 pt iPhone Pro (floating glass header and input bar in Messages, floating controls in Safari). Every size comes from the `M` metrics object at the top of `src/scene/ChatScene.tsx`, measured from real screenshots; adjust sizes there.

Animation must stay frame-driven: derive all motion from `useCurrentFrame()`, never from CSS transitions or timers, or exports will not match the preview.

Run `npm run typecheck` and `npm test` after changing code.
