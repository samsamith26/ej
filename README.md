# EJ

A two-player online rummy game. One player clicks **New game** and sends the invite link to the other player; opening the link connects them.

There is no backend. The host's browser is the authoritative game server, and the players talk peer-to-peer over WebRTC (PeerJS). The app is static and deploys to Vercel.

## Running locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine unit tests (Vitest)
npm run build    # typecheck + production build
```

## Testing with two tabs

Game ids that don't start with `ej-` use an in-browser transport (BroadcastChannel) instead of WebRTC. This lets you play both sides on one machine with no network:

1. Open `http://localhost:5173/host/x` in one tab.
2. Open `http://localhost:5173/join/x` in a second tab of the **same browser**.

Use a new id (`/host/y`, …) for a fresh game, or clear site data. The host's game is saved in localStorage under `ej:host:<id>`.

To test the real WebRTC path, click **New game** on `/` and open the `/join/ej-…` link in a *different* browser or a private window. Two tabs of the same browser share the guest's seat token, so the second tab reclaims the same seat.

You can also append `?local` to any `/host/…` or `/join/…` URL to force the local transport.

## Deploying to Vercel

1. Push the repo to GitHub, GitLab or Bitbucket.
2. In Vercel, **Add New → Project**, import the repo, and choose **Vite** as the framework preset. The build command (`npm run build`) and output directory (`dist`) are detected automatically.
3. Deploy. `vercel.json` rewrites every path to `index.html`, so `/host/:id` and `/join/:id` links work on refresh.

## Environment variables (optional)

Set these in Vercel → Project → Settings → Environment Variables, or in `.env.local` (see `.env.example`).

| Variable | Purpose | Default |
|---|---|---|
| `VITE_PEER_HOST` | Self-hosted PeerJS signaling server host | public PeerJS cloud (`0.peerjs.com`) |
| `VITE_PEER_PORT` | Its port | 443 |
| `VITE_PEER_PATH` | Its path | `/` |
| `VITE_TURN_URL` | TURN server URL, e.g. `turn:turn.example.com:3478` | none (Google STUN only) |
| `VITE_TURN_USERNAME` | TURN username | |
| `VITE_TURN_CREDENTIAL` | TURN credential | |

Without TURN, players behind strict NATs or corporate firewalls may fail to connect. Adding a TURN server fixes that.

## Project layout

- `src/engine/` is the pure rules engine: no React, no networking, and randomness only through a seeded RNG stored in the state. Its main functions are `createGame`, `applyAction`, `getPlayerView` and `runPlan` (atomic turn plans). The tests live next to it (`*.test.ts`).
- `src/net/` has the typed, versioned message protocol, the PeerJS and BroadcastChannel transports, `HostSession` (authoritative server and persistence) and `GuestSession` (reconnect with backoff, heartbeat).
- `src/ui/` holds the React screens: the lobby, the waiting room, joining, the game table, the book builder and the round summary.

### How a turn works

1. **Draw** is its own action: `drawStock`, or `drawDiscard` (the top two discards, or the only one if the pile has just one card; nothing from the stock). It is skipped on the non-dealer's first turn of each round.
2. **Play** is staged on the client as a list of steps (lay book, lay off, take 2, replace 2). The UI previews the result with the same engine code, and offers **Undo step** and **Reset turn**.
3. **Discard** sends the whole plan in a single `commitTurn` action. The host validates it step by step and atomically. If any step fails, nothing changes and the error is shown as a toast.

## Rule clarifications

These cases were left open in the original spec and were decided as follows:

- In round 1, the 3-of-a-kind cannot be Aces.
- In round 2, the two 3-of-a-kinds must be different ranks.
- In round 4, the two runs may share a suit.
- A set (including an all-wild set) represents a rank from 3 to K or Ace, never 2.
- On the turn you lay your book, you may lay off extra cards only if you go out that turn, and only onto your own melds. Taking or replacing 2s isn't allowed that turn. From your next turn on, you may lay off onto any meld and take 2s.
- A 2 taken from a meld may be the final discard.
- Any card drawn this turn, including either card taken from the discard pile, may be discarded again on the same turn.
- When the stock and the pile under the top discard are both empty at the start of a turn, the round ends at once with no points.
- Either player can deal the next round from the round summary.

## Known limitations

- **The host must keep their tab open.** The host's browser is the server. If the host closes the tab, the guest sees "Waiting for host…". Reopening the same `/host/:id` URL restores the game from localStorage and the guest reconnects automatically. The game only survives in that one browser.
- **The host could inspect the state.** The full game state, including the guest's hand and the stock order, lives in the host's browser memory and localStorage. The guest only ever receives a redacted view, but a technically minded host could peek. Only play with people you trust.
- The public PeerJS signaling server is a free shared service, so availability isn't guaranteed. Self-host one for reliability (`VITE_PEER_*`).
- After a host refresh, the signaling server can hold the old peer id for a few seconds. The host retries automatically.
