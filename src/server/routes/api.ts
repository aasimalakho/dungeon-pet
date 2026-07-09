import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  DecrementResponse,
  IncrementResponse,
  InitResponse,
  VoteResponse,
  LeaderboardEntry,
} from '../../shared/api';

import {
  ROOM_TYPES,
  EVOLUTION_THRESHOLD,
  EVOLUTION_THRESHOLD_2,
  CHAOS_SABOTAGE_STEP,
  type RoomType,
} from '../../shared/types';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

async function getRoomCounts(postId: string): Promise<Record<string, number>> {
  const roomCounts: Record<string, number> = {};
  for (const type of ROOM_TYPES) {
    const val = await redis.get(`roomCount:${postId}:${type}`);
    roomCounts[type] = val ? parseInt(val) : 0;
  }
  return roomCounts;
}

async function getDayNumber(postId: string): Promise<number> {
  const key = `startTime:${postId}`;
  let startTime = await redis.get(key);
  if (!startTime) {
    startTime = Date.now().toString();
    await redis.set(key, startTime);
  }
  const elapsedMs = Date.now() - parseInt(startTime);
  return Math.floor(elapsedMs / (24 * 60 * 60 * 1000)) + 1;
}

async function getLeaderboard(postId: string): Promise<LeaderboardEntry[]> {
  const raw = await redis.get(`leaderboard:${postId}`);
  const scores: Record<string, number> = raw ? JSON.parse(raw) : {};
  return Object.entries(scores)
    .map(([username, votes]) => ({ username, votes }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 5);
}

async function addToLeaderboard(postId: string, username: string) {
  const key = `leaderboard:${postId}`;
  const raw = await redis.get(key);
  const scores: Record<string, number> = raw ? JSON.parse(raw) : {};
  scores[username] = (scores[username] ?? 0) + 1;
  await redis.set(key, JSON.stringify(scores));
}

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId is required but missing from context' },
      400
    );
  }

  try {
    const [count, username] = await Promise.all([
      redis.get('count'),
      reddit.getCurrentUsername(),
    ]);

    return c.json<InitResponse>({
      type: 'init',
      postId: postId,
      count: count ? parseInt(count) : 0,
      username: username ?? 'anonymous',
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    let errorMessage = 'Unknown error during initialization';
    if (error instanceof Error) {
      errorMessage = `Initialization failed: ${error.message}`;
    }
    return c.json<ErrorResponse>({ status: 'error', message: errorMessage }, 400);
  }
});

api.get('/state', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }

  const roomCounts = await getRoomCounts(postId);
  const petStage = (await redis.get(`petStage:${postId}`)) ?? 'baseline';

  const evolutionLevel =
    petStage !== 'baseline' && (roomCounts[petStage as RoomType] ?? 0) >= EVOLUTION_THRESHOLD_2
      ? 2
      : petStage !== 'baseline'
        ? 1
        : 0;

  const feedKey = `voteFeed:${postId}`;
  const rawFeed = await redis.get(feedKey);
  const recentVotes: { username: string; roomType: string }[] = rawFeed ? JSON.parse(rawFeed) : [];

  const roomsKey = `rooms:${postId}`;
  const rawRooms = await redis.get(roomsKey);
  const rooms: { type: RoomType; dayPicked: number }[] = rawRooms ? JSON.parse(rawRooms) : [];

  const dayNumber = await getDayNumber(postId);
  const leaderboard = await getLeaderboard(postId);

  return c.json<VoteResponse>({
    type: 'vote',
    postId,
    roomCounts,
    petStage,
    evolutionLevel,
    justEvolved: false,
    sabotaged: false,
    dayNumber,
    recentVotes,
    rooms,
    leaderboard,
  });
});

api.post('/increment', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const count = await redis.incrBy('count', 1);
  return c.json<IncrementResponse>({ count, postId, type: 'increment' });
});

api.post('/decrement', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const count = await redis.incrBy('count', -1);
  return c.json<DecrementResponse>({ count, postId, type: 'decrement' });
});

api.post('/vote', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }

  const body = await c.req.json<{ roomType: RoomType }>();
  const { roomType } = body;

  if (!ROOM_TYPES.includes(roomType)) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Invalid room type' }, 400);
  }

  const key = `roomCount:${postId}:${roomType}`;
  await redis.incrBy(key, 1);

  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';

  const feedKey = `voteFeed:${postId}`;
  const rawFeedBefore = await redis.get(feedKey);
  const feedBefore: { username: string; roomType: string }[] = rawFeedBefore
    ? JSON.parse(rawFeedBefore)
    : [];
  feedBefore.unshift({ username, roomType });
  const trimmedFeed = feedBefore.slice(0, 5);
  await redis.set(feedKey, JSON.stringify(trimmedFeed));

  const roomsKey = `rooms:${postId}`;
  const rawRooms = await redis.get(roomsKey);
  const rooms: { type: RoomType; dayPicked: number }[] = rawRooms ? JSON.parse(rawRooms) : [];
  const dayNumber = await getDayNumber(postId);
  rooms.push({ type: roomType, dayPicked: dayNumber });
  await redis.set(roomsKey, JSON.stringify(rooms));

  await addToLeaderboard(postId, username);

  const roomCounts = await getRoomCounts(postId);

  let petStage = (await redis.get(`petStage:${postId}`)) ?? 'baseline';
  let justEvolved = false;
  let sabotaged = false;

  if (petStage === 'baseline' && (roomCounts[roomType] ?? 0) >= EVOLUTION_THRESHOLD) {
    const chaosCount = roomCounts['chaos'] ?? 0;
    const sabotageChance = Math.min(0.5, chaosCount * CHAOS_SABOTAGE_STEP);
    const roll = Math.random();

    if (roomType !== 'chaos' && roll < sabotageChance) {
      petStage = 'chaos';
      sabotaged = true;
    } else {
      petStage = roomType;
    }

    justEvolved = true;
    await redis.set(`petStage:${postId}`, petStage);

    try {
      const commentText = sabotaged
        ? `⚡ CHAOS SABOTAGE! The dungeon voted for ${roomType}, but chaos energy twisted the outcome. The creature is now **${petStage}**!`
        : `The creature has evolved into **${petStage}**! Keep voting to push it further.`;
      await reddit.submitComment({ id: postId, text: commentText });
    } catch (err) {
      console.error('Failed to post evolution comment:', err);
    }
  }

  const evolutionLevel =
    petStage !== 'baseline' && (roomCounts[petStage as RoomType] ?? 0) >= EVOLUTION_THRESHOLD_2
      ? 2
      : petStage !== 'baseline'
        ? 1
        : 0;

  const recentVotes = trimmedFeed;
  const leaderboard = await getLeaderboard(postId);

  return c.json<VoteResponse>({
    type: 'vote',
    postId,
    roomCounts,
    petStage,
    evolutionLevel,
    justEvolved,
    sabotaged,
    dayNumber,
    recentVotes,
    rooms,
    leaderboard,
  });
});
