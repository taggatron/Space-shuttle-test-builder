# Space Shuttle Materials Game (demo)

Run locally:

1. Install dependencies:

```bash
cd "${PWD:-.}"
cd "$(dirname "$0")/.." || true
npm install
```

2. Start server:

```bash
npm start
```

3. Open http://localhost:3000 in multiple browser windows to simulate multiple teams.

How it works:
- Each user enters a team name and joins. The first connected client can click "Start Game".
- Game runs for 10 minutes (T-minus displayed). When the timer ends the summary is shown to all players.
- Summary shows each team's selected materials, mass, cost and a simple success/fail result.

This is a demo scaffold; you can extend assets, improve synchronization, rooms, and visual polish.
