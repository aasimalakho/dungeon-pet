# Dungeon Pet: The Community Creature

### A Living Dungeon Built by Reddit, One Vote at a Time

Built for Reddit's Games with a Hook Hackathon 2026

## Demo

- **App Listing:** https://developers.reddit.com/apps/dungeon-pet
- **Demo Post:** https://www.reddit.com/r/dungeon_pet_dev/?playtest=dungeon-pet
- **Demo Video:** [add your video link here]

---

# Project Description

Every Reddit community has a creature, and that creature is theirs to shape.

**Dungeon Pet** is a Devvit game where redditors collectively vote on which room to add next to a shared dungeon map. As the dungeon grows, room by room, a resident creature explores it, and its final form is determined entirely by what the community chose to build. Fire rooms hatch a fire-breathing companion. Water rooms raise something aquatic. And if enough chaos energy builds up, the outcome can be sabotaged into something nobody voted for at all.

No two communities will grow the same dungeon, or raise the same creature.

---

# The Problem

Reddit's feed rewards content that's easy to glance at once and scroll past. Most community games either require a login-and-forget daily puzzle, or they're single-player experiences dressed up with a leaderboard bolted on.

What's harder to build is a game where:

- Every visitor's action visibly changes something the whole community shares
- Progress is permanent and cumulative, not reset every session
- There's a real reason to come back and see what happened since you left

---

# Our Solution

Dungeon Pet turns every vote into a piece of shared, permanent world-state.

For every visit, the game:

- Shows the current dungeon map, built entirely from past community votes
- Displays a live feed of who voted for what, in real time
- Tracks a leaderboard of the community's most active dungeon-builders
- Evolves a shared creature through two stages, with a distinct sprite for each element the dungeon leans into
- Introduces genuine unpredictability through a Chaos mechanic that can sabotage the community's expected outcome
- Automatically posts a comment to the subreddit whenever the creature evolves, turning gameplay moments into visible community history

The creature is never something one person controls. It's a running record of collective choice.

---

# Devvit Components Used

Dungeon Pet is built entirely on Reddit's Developer Platform:

- **Devvit Web** — client/server app architecture running natively in a Reddit post
- **Phaser 3** — all game rendering, animation, and interaction
- **Redis (via Devvit)** — persistent shared game state across all visitors to a post
- **Reddit API (via Devvit)** — live username attribution for votes, and automatic comment posting on evolution events
- **Hono** — backend API routing

---

# How It Works

1. **Vote** — Tap a room type (Fire, Water, Trap, Treasure, or Chaos) to add it to the dungeon
2. **Watch it build** — The new room appears on the dungeon map with a build animation, connected to the path already explored
3. **Evolution** — Once a room type reaches enough votes, the creature evolves to reflect it, with a full transformation animation and particle burst
4. **Ancient Form** — Enough continued votes push the creature into a second, more powerful evolution stage
5. **Chaos Sabotage** — At the moment of any evolution, accumulated Chaos votes carry a chance to override the outcome entirely, keeping the result genuinely uncertain even for the community that voted
6. **Return tomorrow** — The dungeon persists. Nothing resets. Every session builds on the last.

---

# Tech Stack

- **Frontend:** Phaser 3, TypeScript, Vite
- **Backend:** Devvit Web, Hono, Node.js
- **Persistence:** Redis (via `@devvit/web/server`)
- **Platform:** Reddit Developer Platform (Devvit)

---

# What Makes This Reddit-y

- **Community-authored outcomes** — no single player determines the creature's fate
- **Live usernames** — every vote is attributed, turning the feed into a visible record of who shaped the dungeon
- **Comments as gameplay** — evolutions are posted directly to the subreddit, folding game milestones into the actual discussion thread
- **Persistent shared state** — the dungeon belongs to the subreddit, not to any one visitor's session

---

# Credits

Built solo for Reddit's Games with a Hook Hackathon, using the official Devvit Phaser template as a starting scaffold.
