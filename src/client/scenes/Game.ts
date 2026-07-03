import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { VoteResponse } from '../../shared/api';

type RoomType = 'fire' | 'water' | 'trap' | 'treasure' | 'chaos';

const ROOM_CONFIG: { type: RoomType; label: string; color: string }[] = [
  { type: 'fire', label: '🔥 Fire', color: '#ff5533' },
  { type: 'water', label: '💧 Water', color: '#33aaff' },
  { type: 'trap', label: '⚠️ Trap', color: '#aaaaaa' },
  { type: 'treasure', label: '💰 Treasure', color: '#ffd700' },
  { type: 'chaos', label: '🌀 Chaos', color: '#cc55ff' },
];

export class Game extends Scene {
  camera: Phaser.Cameras.Scene2D.Camera;
  background: Phaser.GameObjects.Image;
  petStageText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  countTexts: Partial<Record<RoomType, Phaser.GameObjects.Text>> = {};
  voteButtons: Phaser.GameObjects.Text[] = [];
  roomCounts: Record<string, number> = {};
  petStage: string = 'baseline';
  voting: boolean = false;

  constructor() {
    super('Game');
  }

  create() {
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor(0x1a1a2e);

    this.background = this.add.image(512, 384, 'background').setAlpha(0.15);

    this.petStageText = this.add
      .text(512, 120, 'Creature: baseline', {
        fontFamily: 'Arial Black',
        fontSize: 40,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(512, 180, 'Vote for a room to build the dungeon!', {
        fontFamily: 'Arial',
        fontSize: 22,
        color: '#cccccc',
      })
      .setOrigin(0.5);

    ROOM_CONFIG.forEach((room, i) => {
      const y = 260 + i * 80;

      const countText = this.add
        .text(300, y, `${room.label}: 0`, {
          fontFamily: 'Arial Black',
          fontSize: 28,
          color: room.color,
        })
        .setOrigin(0, 0.5);
      this.countTexts[room.type] = countText;

      const button = this.add
        .text(750, y, 'Vote', {
          fontFamily: 'Arial Black',
          fontSize: 28,
          color: '#ffffff',
          backgroundColor: '#333333',
          padding: { x: 20, y: 10 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => button.setStyle({ backgroundColor: '#555555' }))
        .on('pointerout', () => button.setStyle({ backgroundColor: '#333333' }))
        .on('pointerdown', () => this.castVote(room.type));
      this.voteButtons.push(button);
    });

    void this.loadState();
  }

  async loadState() {
    try {
      const response = await fetch('/api/state');
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = (await response.json()) as VoteResponse;
      this.roomCounts = data.roomCounts;
      this.petStage = data.petStage;
      this.refreshDisplay();
    } catch (error) {
      console.error('Failed to load game state:', error);
      this.statusText.setText('Failed to load — try refreshing.');
    }
  }

  async castVote(roomType: RoomType) {
    if (this.voting) return;
    this.voting = true;
    this.statusText.setText('Voting...');

    try {
      const response = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomType }),
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const data = (await response.json()) as VoteResponse;
      this.roomCounts = data.roomCounts;
      this.petStage = data.petStage;
      this.refreshDisplay();

      if (data.justEvolved) {
        this.statusText.setText(`The creature evolved into ${data.petStage}!`);
      } else {
        this.statusText.setText(`Vote counted for ${roomType}!`);
      }
    } catch (error) {
      console.error('Failed to cast vote:', error);
      this.statusText.setText('Vote failed — try again.');
    } finally {
      this.voting = false;
    }
  }

  refreshDisplay() {
    this.petStageText.setText(`Creature: ${this.petStage}`);

    ROOM_CONFIG.forEach((room) => {
      const count = this.roomCounts[room.type] ?? 0;
      const text = this.countTexts[room.type];
      if (text) {
        text.setText(`${room.label}: ${count}`);
      }
    });
  }
  }
