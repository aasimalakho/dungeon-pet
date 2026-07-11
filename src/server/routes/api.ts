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

type PetStage = RoomType | 'baseline';

export const api = new Hono();

async function getRoomCounts(postId: string): Promise<Record<string, number>> {
  const roomCounts: Record<string, number> = {};
  for (const type of ROOM_TYPES) {
    const val = await redis.get(`roomCount:${postId}:${type}`);
    roomCounts[type] = val ? parseInt(val) : 0;
  }
  return roomCounts;
}

function determineStage(roomCounts: Record<string, number>): {
  stage: PetStage;
  level: number;
} {
  const qualifying = ROOM_TYPES.filter((t) => (roomCounts[t] ?? 0) >= EVOLUTION_THRESHOLD);

  if (qualifying.length === 0) {
    return { stage: 'baseline', level: 0 };
  }

  const dominant = qualifying.reduce((best, t) =>
    (roomCounts[t] ?? 0) > (roomCounts[best] ?? 0) ? t : best
  );

  const level = (roomCounts[dominant] ?? 0) >= EVOLUTION_THRESHOLD_2 ? 2 : 1;
  return { stage: dominant, level };
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

async function hasVotedToday(postId: string, username: string, dayNumber: number): Promise<boolean> {
  const key = `votedDay:${postId}:${username}`;
  const lastVotedDay = await redis.get(key);
  return lastVotedDay !== null && parseInt(lastVotedDay) === dayNumber;
}

async function markVotedToday(postId: string, username: string, dayNumber: number) {
  const key = `votedDay:${postId}:${username}`;
  await redis.set(key, dayNumber.toString());
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
  const { stage, level } = determineStage(roomCounts);

  const feedKey = `voteFeed:${postId}`;
  const rawFeed = await redis.get(feedKey);
  const recentVotes: { username: string; roomType: string }[] = rawFeed ? JSON.parse(rawFeed) : [];

  const roomsKey = `rooms:${postId}`;
  const rawRooms = await redis.get(roomsKey);
  const rooms: { type: RoomType; dayPicked: number }[] = rawRooms ? JSON.parse(rawRooms) : [];

  const dayNumber = await getDayNumber(postId);
  const leaderboard = await getLeaderboard(postId);

  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  const alreadyVotedToday = await hasVotedToday(postId, username, dayNumber);

  return c.json<VoteResponse>({
    type: 'vote',
    postId,
    roomCounts,
    petStage: stage,
    evolutionLevel: level,
    justEvolved: false,
    sabotaged: false,
    dayNumber,
    recentVotes,
    rooms,
    leaderboard,
    alreadyVotedToday,
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

  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  const dayNumber = await getDayNumber(postId);

  const alreadyVoted = await hasVotedToday(postId, username, dayNumber);
  if (alreadyVoted) {
    // Blocked — return current state unchanged, flagged so the client shows
    // a friendly "come back tomorrow" message instead of counting the vote.
    const roomCounts = await getRoomCounts(postId);
    const { stage, level } = determineStage(roomCounts);
    const feedKey = `voteFeed:${postId}`;
    const rawFeed = await redis.get(feedKey);
    const recentVotes: { username: string; roomType: string }[] = rawFeed
      ? JSON.parse(rawFeed)
      : [];
    const roomsKey = `rooms:${postId}`;
    const rawRooms = await redis.get(roomsKey);
    const rooms: { type: RoomType; dayPicked: number }[] = rawRooms ? JSON.parse(rawRooms) : [];
    const leaderboard = await getLeaderboard(postId);

    return c.json<VoteResponse>({
      type: 'vote',
      postId,
      roomCounts,
      petStage: stage,
      evolutionLevel: level,
      justEvolved: false,
      sabotaged: false,
      dayNumber,
      recentVotes,
      rooms,
      leaderboard,
      alreadyVotedToday: true,
    });
  }

  const countsBefore = await getRoomCounts(postId);
  const { stage: stageBefore } = determineStage(countsBefore);

  const key = `roomCount:${postId}:${roomType}`;
  await redis.incrBy(key, 1);
  await markVotedToday(postId, username, dayNumber);

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
  rooms.push({ type: roomType, dayPicked: dayNumber });
  await redis.set(roomsKey, JSON.stringify(rooms));

  await addToLeaderboard(postId, username);

  const roomCounts = await getRoomCounts(postId);
  const { stage: naturalStage, level: naturalLevel } = determineStage(roomCounts);

  let finalStage: PetStage = naturalStage;
  let sabotaged = false;

  if (naturalStage !== stageBefore && naturalStage !== 'chaos') {
    const chaosCount = roomCounts['chaos'] ?? 0;
    if (chaosCount > 0) {
      const sabotageChance = Math.min(0.5, chaosCount * CHAOS_SABOTAGE_STEP);
      if (Math.random() < sabotageChance) {
        finalStage = 'chaos';
        sabotaged = true;
      }
    }
  }

  const evolutionLevel =
    finalStage === 'baseline'
      ? 0
      : (roomCounts[finalStage] ?? 0) >= EVOLUTION_THRESHOLD_2
        ? 2
        : naturalLevel;

  const justEvolved = finalStage !== stageBefore;

  if (justEvolved) {
    try {
      const commentText = sabotaged
        ? `⚡ CHAOS SABOTAGE! The dungeon voted for ${roomType}, but chaos energy twisted the outcome. The creature is now **${finalStage}**!`
        : `The creature has evolved into **${finalStage}**! Keep voting to push it further.`;
      await reddit.submitComment({ id: postId, text: commentText });
    } catch (err) {
      console.error('Failed to post evolution comment:', err);
    }
  }

 // Daily summary comment — posts once per day, summarizing the day before
  try {
    const dayVotesKey = `dayVotes:${postId}:${dayNumber}`;
    await redis.incrBy(dayVotesKey, 1);

    const lastSummaryDayRaw = await redis.get(`lastSummaryDay:${postId}`);
    const lastSummaryDay = lastSummaryDayRaw ? parseInt(lastSummaryDayRaw) : dayNumber;

    if (dayNumber > lastSummaryDay) {
      const prevDayVotesRaw = await redis.get(`dayVotes:${postId}:${lastSummaryDay}`);
      const prevDayVotes = prevDayVotesRaw ? parseInt(prevDayVotesRaw) : 0;

      const leadingType = ROOM_TYPES.reduce((best, t) =>
        (roomCounts[t] ?? 0) > (roomCounts[best] ?? 0) ? t : best
      );

      const summaryText = `📜 Day ${lastSummaryDay} summary: ${prevDayVotes} vote${prevDayVotes === 1 ? '' : 's'} cast, ${leadingType} leading, ${rooms.length} room${rooms.length === 1 ? '' : 's'} in the dungeon so far.`;
      await reddit.submitComment({ id: postId, text: summaryText });
      await redis.set(`lastSummaryDay:${postId}`, dayNumber.toString());
    }
  } catch (err) {
    console.error('Failed to post daily summary comment:', err);
  }                                                                     

  const recentVotes = trimmedFeed;
  const leaderboard = await getLeaderboard(postId);

  return c.json<VoteResponse>({
    type: 'vote',
    postId,
    roomCounts,
    petStage: finalStage,
    evolutionLevel,
    justEvolved,
    sabotaged,
    dayNumber,
    recentVotes,
    rooms,
    leaderboard,
    alreadyVotedToday: false,
  });
});
