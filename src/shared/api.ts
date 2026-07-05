export type InitResponse = {
  type: "init";
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: "increment";
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: "decrement";
  postId: string;
  count: number;
};

export type VoteResponse = {
  type: 'vote';
  postId: string;
  roomCounts: Record<string, number>;
  petStage: string;
  justEvolved: boolean;
  recentVotes: { username: string; roomType: string }[];
};

export type StateResponse = {
  type: 'state';
  roomCounts: Record<string, number>;
  petStage: string;
};