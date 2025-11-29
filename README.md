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
- Lobby and rooms: users can create a room or join an existing room by name. Enter a `Team name` and a `Room name`, then click `Create Room` or `Join Room`.
- In the lobby: players in a room are listed with a ready check. The room host (the player who created the room, or the next player if host leaves) sees a `Start Game` button.
- Game runs for 10 minutes (T-minus displayed). When the timer ends the summary is shown to all players in that room.
- Summary shows each team's selected materials, mass, cost and a simple success/fail result.

This is a demo scaffold; you can extend assets, improve synchronization, rooms, and visual polish.
