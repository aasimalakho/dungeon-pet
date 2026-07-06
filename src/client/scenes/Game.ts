import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { VoteResponse } from '../../shared/api';

type RoomType = 'fire' | 'water' | 'trap' | 'treasure' | 'chaos';
type PetStage = RoomType | 'baseline';

const ROOM_CONFIG: {
  type: RoomType;
  label: string;
  color: string;
  hex: number;
  icon: string;
}[] = [
  { type: 'fire', label: '🔥 Fire', color: '#ff5533', hex: 0xff5533, icon: '🔥' },
  { type: 'water', label: '💧 Water', color: '#33aaff', hex: 0x33aaff, icon: '💧' },
  { type: 'trap', label: '⚠️ Trap', color: '#aaaaaa', hex: 0xaaaaaa, icon: '⚠️' },
  { type: 'treasure', label: '💰 Treasure', color: '#ffd700', hex: 0xffd700, icon: '💰' },
  { type: 'chaos', label: '🌀 Chaos', color: '#cc55ff', hex: 0xcc55ff, icon: '🌀' },
];

const CORRIDOR_Y = 470;
const ROOM_SPACING = 85;
const CORRIDOR_START_X = 130;
const CORRIDOR_WINDOW = 10;
const BASE_PET_SCALE = 0.2;
const LEVEL2_PET_SCALE = 0.32;

export class Game extends Scene {
  camera: Phaser.Cameras.Scene2D.Camera;
  background: Phaser.GameObjects.Image;
  petSprite: Phaser.GameObjects.Image;
  petStageText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  roomsBuiltText: Phaser.GameObjects.Text;
  countTexts: Partial<Record<RoomType, Phaser.GameObjects.Text>> = {};
  voteButtons: Phaser.GameObjects.Text[] = [];
  feedTexts: Phaser.GameObjects.Text[] = [];
  corridorTiles: Phaser.GameObjects.Container[] = [];
  roomCounts: Record<string, number> = {};
  petStage: PetStage = 'baseline';
  evolutionLevel: number = 0;
  voting: boolean = false;
  totalRoomsBuilt: number = 0;

  constructor() {
    super('Game');
  }

  create() {
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor(0x1a1a2e);

    this.background = this.add.image(512, 384, 'background').setAlpha(0.1);

    this.petStageText = this.add
      .text(512, 60, 'Creature: baseline', {
        fontFamily: 'Arial Black',
        fontSize: 32,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(512, 100, 'Vote for a room to build the dungeon!', {
        fontFamily: 'Arial',
        fontSize: 18,
        color: '#cccccc',
      })
      .setOrigin(0.5);

    for (let i = 0; i < 5; i++) {
      const feedLine = this.add
        .text(512, 130 + i * 20, '', {
          fontFamily: 'Arial',
          fontSize: 14,
          color: '#888888',
        })
        .setOrigin(0.5);
      this.feedTexts.push(feedLine);
    }

    // Corridor background strip
    this.add.rectangle(512, CORRIDOR_Y, 1024, 130, 0x0f1626).setAlpha(0.6);

    this.roomsBuiltText = this.add
      .text(512, CORRIDOR_Y - 80, 'Rooms built: 0', {
        fontFamily: 'Arial',
        fontSize: 16,
        color: '#888888',
      })
      .setOrigin(0.5);

    // Fixed slots for the rolling window — pre-create empty tile containers
    for (let i = 0; i < CORRIDOR_WINDOW; i++) {
      const x = CORRIDOR_START_X + i * ROOM_SPACING;
      const tile = this.add.container(x, CORRIDOR_Y);
      const bg = this.add
        .rectangle(0, 0, 60, 60, 0x333333, 0)
        .setStrokeStyle(2, 0x555555, 0.4);
      tile.add(bg);
      this.corridorTiles.push(tile);
    }

    this.petSprite = this.add
      .image(CORRIDOR_START_X, CORRIDOR_Y, 'pet-baseline')
      .setScale(BASE_PET_SCALE);

    ROOM_CONFIG.forEach((room, i) => {
      const y = 610 + i * 65;

      const countText = this.add
        .text(300, y, `${room.label}: 0`, {
          fontFamily: 'Arial Black',
          fontSize: 22,
          color: room.color,
        })
        .setOrigin(0, 0.5);
      this.countTexts[room.type] = countText;

      const button = this.add
        .text(750, y, 'Vote', {
          fontFamily: 'Arial Black',
          fontSize: 22,
          color: '#ffffff',
          backgroundColor: '#333333',
          padding: { x: 16, y: 6 },
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
      this.evolutionLevel = data.evolutionLevel;
      this.petSprite.setTexture(`pet-${this.petStage}`);
      if (this.evolutionLevel >= 2) {
        this.petSprite.setScale(LEVEL2_PET_SCALE);
      }
      this.refreshDisplay();
      this.updateFeed(data.recentVotes);
      this.renderCorridor(data.rooms);
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
      const previousLevel = this.evolutionLevel;

      this.roomCounts = data.roomCounts;
      this.petStage = data.petStage as PetStage;
      this.evolutionLevel = data.evolutionLevel;
      this.refreshDisplay();
      this.updateFeed(data.recentVotes);
      this.renderCorridor(data.rooms);

      if (data.justEvolved) {
        this.statusText.setText(`The creature evolved into ${data.petStage}!`);
        this.playEvolutionEffect(false);
      } else if (previousLevel < 2 && this.evolutionLevel >= 2) {
        this.statusText.setText(`The creature reached its Ancient form!`);
        this.playEvolutionEffect(true);
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

  renderCorridor(rooms: { type: string; dayPicked: number }[]) {
    this.totalRoomsBuilt = rooms.length;
    this.roomsBuiltText.setText(`Rooms built: ${this.totalRoomsBuilt}`);

    // Only show the most recent CORRIDOR_WINDOW rooms
    const visibleRooms = rooms.slice(-CORRIDOR_WINDOW);

    this.corridorTiles.forEach((tile, i) => {
      tile.removeAll(true);
      const bg = this.add
        .rectangle(0, 0, 60, 60, 0x333333, 0)
        .setStrokeStyle(2, 0x555555, 0.3);
      tile.add(bg);

      const room = visibleRooms[i];
      if (room) {
        const config = ROOM_CONFIG.find((r) => r.type === room.type);
        const color = config ? config.hex : 0xffffff;
        const icon = config ? config.icon : '?';

        const roomBg = this.add
          .rectangle(0, 0, 56, 56, color, 0.25)
          .setStrokeStyle(2, color, 0.9);
        const roomIcon = this.add
          .text(0, 0, icon, { fontSize: 26 })
          .setOrigin(0.5);
        tile.add([roomBg, roomIcon]);
      }
    });

    // Pet sits on the last filled slot
    const lastIndex = Math.min(visibleRooms.length, CORRIDOR_WINDOW) - 1;
    const targetX =
      lastIndex >= 0 ? CORRIDOR_START_X + lastIndex * ROOM_SPACING : CORRIDOR_START_X;

    this.tweens.add({
      targets: this.petSprite,
      x: targetX,
      duration: 350,
      ease: 'Cubic.easeOut',
    });
  }

  playEvolutionEffect(isLevel2: boolean) {
    const newTexture = `pet-${this.petStage}`;
    const targetScale = isLevel2 ? LEVEL2_PET_SCALE : BASE_PET_SCALE;
    const squashScaleX = isLevel2 ? 0.05 : 0.03;
    const squashScaleY = isLevel2 ? 0.4 : 0.25;
    const popScaleX = targetScale * 1.1;
    const popScaleY = targetScale * 0.75;

    this.tweens.add({
      targets: this.petSprite,
      scaleX: squashScaleX,
      scaleY: squashScaleY,
      duration: 150,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.petSprite.setTexture(newTexture);
        this.tweens.add({
          targets: this.petSprite,
          scaleX: popScaleX,
          scaleY: popScaleY,
          duration: 150,
          ease: 'Cubic.easeOut',
          onComplete: () => {
            this.tweens.add({
              targets: this.petSprite,
              scaleX: targetScale,
              scaleY: targetScale,
              duration: 150,
              ease: 'Bounce.easeOut',
            });
          },
        });
      },
    });

    const particleCount = isLevel2 ? 28 : 16;
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const particle = this.add.circle(
        this.petSprite.x,
        CORRIDOR_Y,
        isLevel2 ? 7 : 5,
        isLevel2 ? 0xffd700 : 0xffffff
      );
      const distance = (isLevel2 ? 70 : 50) + Math.random() * 30;
      this.tweens.add({
        targets: particle,
        x: this.petSprite.x + Math.cos(angle) * distance,
        y: CORRIDOR_Y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0,
        duration: isLevel2 ? 800 : 600,
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  refreshDisplay() {
    const prefix = this.evolutionLevel >= 2 ? 'Ancient ' : '';
    this.petStageText.setText(`Creature: ${prefix}${this.petStage}`);

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
