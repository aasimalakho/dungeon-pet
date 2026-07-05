import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  DecrementResponse,
  IncrementResponse,
  InitResponse,
  VoteResponse,
} from '../../shared/api';

import { ROOM_TYPES, EVOLUTION_THRESHOLD, type RoomType } from '../../shared/types';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required but missing from context',
      },
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
    return c.json<ErrorResponse>(
      { status: 'error', message: errorMessage },
      400
    );
  }
});

api.get('/state', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }

  const roomCounts: Record<string, number> = {};
  for (const type of ROOM_TYPES) {
    const val = await redis.get(`roomCount:${postId}:${type}`);
    roomCounts[type] = val ? parseInt(val) : 0;
  }

  const petStage = (await redis.get(`petStage:${postId}`)) ?? 'baseline';

  const feedKey = `voteFeed:${postId}`;
  const rawFeed = await redis.get(feedKey);
  const recentVotes: { username: string; roomType: string }[] = rawFeed ? JSON.parse(rawFeed) : [];

  const roomsKey = `rooms:${postId}`;
  const rawRooms = await redis.get(roomsKey);
  const rooms: { type: RoomType; dayPicked: number }[] = rawRooms ? JSON.parse(rawRooms) : [];

  return c.json<VoteResponse>({
    type: 'vote',
    postId,
    roomCounts,
    petStage,
    justEvolved: false,
    recentVotes,
    rooms,
  });
});

api.post('/increment', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', 1);
  return c.json<IncrementResponse>({
    count,
    postId,
    type: 'increment',
  });
});

api.post('/decrement', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', -1);
  return c.json<DecrementResponse>({
    count,
    postId,
    type: 'decrement',
  });
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
  rooms.push({ type: roomType, dayPicked: rooms.length + 1 });
  await redis.set(roomsKey, JSON.stringify(rooms));

  const roomCounts: Record<string, number> = {};
  for (const type of ROOM_TYPES) {
    const val = await redis.get(`roomCount:${postId}:${type}`);
    roomCounts[type] = val ? parseInt(val) : 0;
  }

  let petStage = (await redis.get(`petStage:${postId}`)) ?? 'baseline';
  let justEvolved = false;

  if (petStage === 'baseline' && (roomCounts[roomType] ?? 0) >= EVOLUTION_THRESHOLD) {
    petStage = roomType;
    justEvolved = true;
    await redis.set(`petStage:${postId}`, petStage);
  }

  const recentVotes = trimmedFeed;

  return c.json<VoteResponse>({
    type: 'vote',
    postId,
    roomCounts,
    petStage,
    justEvolved,
    recentVotes,
    rooms,
  });
});
