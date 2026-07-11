import type { DungeonRoom } from './types';

export type InitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};

export type LeaderboardEntry = { username: string; votes: number };

export type VoteResponse = {
  type: 'vote';
  postId: string;
  roomCounts: Record<string, number>;
  petStage: string;
  evolutionLevel: number;
  justEvolved: boolean;
  sabotaged: boolean;
  dayNumber: number;
  recentVotes: { username: string; roomType: string }[];
  rooms: DungeonRoom[];
  leaderboard: LeaderboardEntry[];
  alreadyVotedToday: boolean;
};
