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

 return c.json<VoteResponse>({
  type: 'vote',
  postId,
  roomCounts,
  petStage,
  justEvolved,
 });
});