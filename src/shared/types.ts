// Room types users can vote for each day
export type RoomType = 'fire' | 'water' | 'trap' | 'treasure' | 'chaos';

export const ROOM_TYPES: RoomType[] = ['fire', 'water', 'trap', 'treasure', 'chaos'];

// How many picks of a room type are needed to trigger that evolution
export const EVOLUTION_THRESHOLD = 3;
export const EVOLUTION_THRESHOLD_2 = 8;

// The pet's possible evolution stages
export type PetStage = 'baseline' | 'fire' | 'water' | 'trap' | 'treasure' | 'chaos';

// One room in the built dungeon sequence
export interface DungeonRoom {
 type: RoomType;
 dayPicked: number;
}

// The full game state stored server-side
export interface GameState {
 rooms: DungeonRoom[];
 petStage: PetStage;
 currentDay: number;
 roomCounts: Record<RoomType, number>;
}

// Helper: create a fresh game state
export function createInitialGameState(): GameState {
 return {
  rooms: [],
  petStage: 'baseline',
  currentDay: 1,
  roomCounts: {
   fire: 0,
   water: 0,
   trap: 0,
   treasure: 0,
   chaos: 0,
  },
 };
}