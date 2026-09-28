# OnePath — Daily Path Puzzle (MVP)

Draw **one** continuous path. Visit the numbered tiles **in order**. Fill **every** tile.

A hyper-casual daily puzzle game in the Wordle / LinkedIn-Zip tradition:
- **Daily puzzle** — one procedurally generated grid per day (date-seeded, same for everyone)
- **Streaks** — consecutive daily solves tracked on-device
- **Spoiler-free sharing** — emoji grid you can paste anywhere
- **Practice mode** — unlimited random puzzles

## Tech

- Single codebase: HTML5 canvas + vanilla JS (`www/`)
- Wrapped with [Capacitor](https://capacitorjs.com/) for native Android & iOS builds
- No build step, no assets, no backend — the daily puzzle is generated on-device from the date seed

## Local dev

```bash
npm install
npx cap sync
# then open in a browser:
npx serve www   # or: python3 -m http.server -d www
```

## Mobile builds

Native projects are generated at build time (`npx cap add android` / `npx cap add ios`)
and built on [Codemagic](https://codemagic.io) — see `codemagic.yaml`.

- Android: debug APK (installable directly)
- iOS: simulator/dev build — installing on a real iPhone needs an Apple Developer
  account + code signing (see Codemagic docs for iOS code signing setup)

## Game design

- 6×6 grid, random walls (connectivity-checked), 5 numbered checkpoints
- Hidden Hamiltonian path guarantees every puzzle is solvable
- Rules: start on ①, drag orthogonally, never revisit a tile, hit numbers in ascending order, cover all free tiles
- Juice: gradient path with glow, particle confetti, rising-pitch WebAudio blips
