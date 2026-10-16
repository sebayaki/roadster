**Play:** [https://roadster.sebayaki.com](https://roadster.sebayaki.com)

# RDSTR Stunts

![The new Roadster mid-backflip beside the Curl](public/og.jpg)

An unofficial fan game for the wait until the new Roadster ships. Fly the car through the two
stunts from its October 2026 unveil, right in the browser on desktop or phone:

- **BACKFLIP — The Curl.** Build speed down the runway, ride a 24 m ramp that curls past
  vertical, leave the lip upside down, keep the rotation going and land it on the cold-gas
  thrusters.
- **KICKFLIP — The Lineup.** Pick your speed, thrust off the ground before five parked
  vehicles, barrel-roll a full 360° over them and land soft past the last one.

Landings are graded (perfect / great / good) on angle and impact speed, and scored on the trick,
air time, height and the cold gas you save. Best scores stay in your browser.

> Fan-made. Not affiliated with or endorsed by Tesla, Inc. Vehicle names are used only to
> describe what the stunts recreate. All models, textures and sounds are generated in code; the
> game uses no Tesla images, logos or assets.

## Controls

| Action                           | Keyboard     | Touch                | Gamepad            |
| -------------------------------- | ------------ | -------------------- | ------------------ |
| Gas                              | ↑ / W        | GAS                  | RT                 |
| Brake / reverse                  | ↓ / S        | BRAKE                | LT                 |
| Cold-gas thrusters (hold)        | Space        | THRUST               | A                  |
| Rotate in the air (screen ◀ / ▶) | ← / A, → / D | ◀ ▶                  | Left stick / D-pad |
| Restart                          | R            | Pause menu           | Y                  |
| Pause                            | Esc / P      | ❚❚                   | Start              |
| Camera framing                   | C            | —                    | —                  |
| Mute / units (km/h ↔ mph)        | M / U        | Menu / pause toggles | —                  |

Rotation is screen-relative: in the backflip the camera watches from the side, so ◀ flips the
car backwards; in the kickflip the camera stays behind it, so ◀ / ▶ roll it.

## Stack

[Vite](https://vite.dev/) + TypeScript + [three.js](https://threejs.org/), Vitest, ESLint,
Prettier. No backend and no runtime network requests: the build is a static site.

## Scripts

```bash
npm install
npm run dev        # local dev server on http://localhost:5173
npm run build      # typecheck + production bundle → dist/
npm run preview    # serve dist locally
npm test           # physics, scoring, input and formatting tests
npm run typecheck
npm run lint
npm run format     # Prettier
npm run social     # regenerate public/og.jpg + icons (needs `npm run dev` running)
npm run snap -- "<url>" snaps/name.png   # headless screenshot (needs a local Chrome)
```

## Project layout

| Path                    | Role                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/app/`              | Game director: run state machine, event routing, attract demo, debug hooks                                         |
| `src/physics/`          | Stunt physics (ramp riding, flight, landings, wreck rigid body), scoring, autopilot                                |
| `src/levels/`           | The two stunts: the Curl's curvature profile, the lineup obstacles, tuning                                         |
| `src/render/`           | Renderer and bloom, camera rig, the Roadster, venue, Curl, lineup vehicles, particle FX                            |
| `src/audio/`            | Procedural WebAudio: motor whine, wind, thruster hiss, cues                                                        |
| `src/ui/`, `src/input/` | HUD, menus and result cards; keyboard, touch and gamepad input                                                     |
| `src/core/`             | Shared types, car dimensions, math, settings storage                                                               |
| `src/tests/`            | Vitest specs, including autopilot and simulated-player runs of both stunts                                         |
| `dev/`                  | Preview pages for each module (`/dev/roadster.html`, `/dev/scenery.html`, …) plus the link-preview and icon scenes |
| `scripts/`              | Headless screenshot and social-asset tools                                                                         |

Useful URL switches while developing: `?level=backflip|kickflip` jumps into a run,
`?autopilot=1|double` lets the autopilot fly it, `?demo=0` turns off the menu demo,
`?quality=low|high` forces a render tier, `?debug=1` draws the car's collision box.
`window.__game` exposes `play`, `advance`, `state` and `car` for scripted checks.

## Deploying to GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests, builds and deploys on every
push to `main`. One-time setup for `roadster.sebayaki.com`:

1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions** (before the
   first push, so the raw sources are never published).
2. DNS: a `CNAME` record `roadster` → `sebayaki.github.io`.
3. **Settings → Pages → Custom domain:** `roadster.sebayaki.com`, then **Enforce HTTPS** once the
   certificate is issued.

Assets use relative paths (`base: "./"`), so the same build also works under
`https://sebayaki.github.io/roadster/`. Link previews point at absolute
`https://roadster.sebayaki.com/og.jpg`; after replacing the image, X and other apps may keep the
old preview cached for a while.

## License

[MIT](LICENSE). Made by [sebayaki.eth](https://sebayaki.com).
