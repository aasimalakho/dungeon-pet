import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { VoteResponse } from '../../shared/api';

type RoomType = 'fire' | 'water' | 'trap' | 'treasure' | 'chaos';
type PetStage = RoomType | 'baseline';

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
  petSprite: Phaser.GameObjects.Image;
  petStageText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  countTexts: Partial<Record<RoomType, Phaser.GameObjects.Text>> = {};
  voteButtons: Phaser.GameObjects.Text[] = [];
  feedTexts: Phaser.GameObjects.Text[] = [];
  roomCounts: Record<string, number> = {};
  petStage: PetStage = 'baseline';
  voting: boolean = false;

  constructor() {
    super('Game');
  }

  create() {
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor(0x1a1a2e);

    this.background = this.add.image(512, 384, 'background').setAlpha(0.15);

    this.petSprite = this.add.image(512, 210, 'pet-baseline').setScale(0.35);

    this.petStageText = this.add
      .text(512, 340, 'Creature: baseline', {
        fontFamily: 'Arial Black',
        fontSize: 32,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(512, 380, 'Vote for a room to build the dungeon!', {
        fontFamily: 'Arial',
        fontSize: 20,
        color: '#cccccc',
      })
      .setOrigin(0.5);

    // Recent votes feed
    for (let i = 0; i < 5; i++) {
      const feedLine = this.add
        .text(512, 410 + i * 22, '', {
          fontFamily: 'Arial',
          fontSize: 15,
          color: '#888888',
        })
        .setOrigin(0.5);
      this.feedTexts.push(feedLine);
    }

    ROOM_CONFIG.forEach((room, i) => {
      const y = 540 + i * 70;

      const countText = this.add
        .text(300, y, `${room.label}: 0`, {
          fontFamily: 'Arial Black',
          fontSize: 24,
          color: room.color,
        })
        .setOrigin(0, 0.5);
      this.countTexts[room.type] = countText;

      const button = this.add
        .text(750, y, 'Vote', {
          fontFamily: 'Arial Black',
          fontSize: 24,
          color: '#ffffff',
          backgroundColor: '#333333',
          padding: { x: 18, y: 8 },
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
      this.petStage = data.petStage as PetStage;
      this.petSprite.setTexture(`pet-${this.petStage}`);
      this.refreshDisplay();
      this.updateFeed(data.recentVotes);
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
      this.petStage = data.petStage as PetStage;
      this.refreshDisplay();
      this.updateFeed(data.recentVotes);

      if (data.justEvolved) {
        this.statusText.setText(`The creature evolved into ${data.petStage}!`);
        this.playEvolutionEffect();
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

  playEvolutionEffect() {
    const newTexture = `pet-${this.petStage}`;

    this.tweens.add({
      targets: this.petSprite,
      scaleX: 0.05,
      scaleY: 0.45,
      duration: 150,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.petSprite.setTexture(newTexture);
        this.tweens.add({
          targets: this.petSprite,
          scaleX: 0.4,
          scaleY: 0.3,
          duration: 150,
          ease: 'Cubic.easeOut',
          onComplete: () => {
            this.tweens.add({
              targets: this.petSprite,
              scaleX: 0.35,
              scaleY: 0.35,
              duration: 150,
              ease: 'Bounce.easeOut',
            });
          },
        });
      },
    });

    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const particle = this.add.circle(512, 210, 6, 0xffffff);
      const distance = 80 + Math.random() * 40;
      this.tweens.add({
        targets: particle,
        x: 512 + Math.cos(angle) * distance,
        y: 210 + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0,
        duration: 600,
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy(),
      });
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

  updateFeed(recentVotes: { username: string; roomType: string }[]) {
    this.feedTexts.forEach((text, i) => {
      const vote = recentVotes[i];
      if (vote) {
        text.setText(`u/${vote.username} voted ${vote.roomType}`);
      } else {
        text.setText('');
      }
    });
  }
  }
