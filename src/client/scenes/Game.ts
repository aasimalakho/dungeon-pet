import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { VoteResponse } from '../../shared/api';

type RoomType = 'fire' | 'water' | 'trap' | 'treasure' | 'chaos';
type PetStage = RoomType | 'baseline';

const ROOM_CONFIG: { type: RoomType; label: string; color: string; hex: number }[] = [
  { type: 'fire', label: '🔥 Fire', color: '#ff5533', hex: 0xff5533 },
  { type: 'water', label: '💧 Water', color: '#33aaff', hex: 0x33aaff },
  { type: 'trap', label: '⚠️ Trap', color: '#aaaaaa', hex: 0xaaaaaa },
  { type: 'treasure', label: '💰 Treasure', color: '#ffd700', hex: 0xffd700 },
  { type: 'chaos', label: '🌀 Chaos', color: '#cc55ff', hex: 0xcc55ff },
];

const CORRIDOR_Y = 470;
const ROOM_SPACING = 50;
const CORRIDOR_START_X = 100;
const BASE_PET_SCALE = 0.2;
const LEVEL2_PET_SCALE = 0.32;

export class Game extends Scene {
  camera: Phaser.Cameras.Scene2D.Camera;
  background: Phaser.GameObjects.Image;
  parallaxLayer: Phaser.GameObjects.TileSprite;
  petSprite: Phaser.GameObjects.Image;
  petStageText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  countTexts: Partial<Record<RoomType, Phaser.GameObjects.Text>> = {};
  voteButtons: Phaser.GameObjects.Text[] = [];
  feedTexts: Phaser.GameObjects.Text[] = [];
  corridorContainer: Phaser.GameObjects.Container;
  roomCounts: Record<string, number> = {};
  petStage: PetStage = 'baseline';
  evolutionLevel: number = 0;
  voting: boolean = false;
  renderedRoomCount: number = 0;

  constructor() {
    super('Game');
  }

  create() {
    this.camera = this.cameras.main;
    this.camera.setBackgroundColor(0x1a1a2e);

    this.background = this.add.image(512, 384, 'background').setAlpha(0.1);

    this.parallaxLayer = this.add.tileSprite(512, CORRIDOR_Y, 1024, 120, 'background');
    this.parallaxLayer.setAlpha(0.08);

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

    this.corridorContainer = this.add.container(0, 0);

      this.petSprite = this.add
        .image(CORRIDOR_START_X, CORRIDOR_Y, 'pet-baseline')
        .setScale(BASE_PET_SCALE);
      this.corridorContainer.add(this.petSprite);

      this.cameras.main.startFollow(this.petSprite, true, 0.1, 0.1);
      this.cameras.main.setBounds(0, 0, 999999, 768);


    ROOM_CONFIG.forEach((room, i) => {
      const y = 560 + i * 65;

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
    const newRooms = rooms.slice(this.renderedRoomCount);
    if (newRooms.length === 0) return;

    newRooms.forEach((room, i) => {
      const index = this.renderedRoomCount + i;
      const x = CORRIDOR_START_X + index * ROOM_SPACING;
      const config = ROOM_CONFIG.find((r) => r.type === room.type);
      const color = config ? config.hex : 0xffffff;

      const roomIcon = this.add.rectangle(x, CORRIDOR_Y, 36, 36, color, 0.7);
      roomIcon.setStrokeStyle(2, 0xffffff, 0.5);
      this.corridorContainer.add(roomIcon);
    });

    this.renderedRoomCount = rooms.length;

    const newestX = CORRIDOR_START_X + (rooms.length - 1) * ROOM_SPACING;
    this.tweens.add({
      targets: this.petSprite,
      x: newestX,
      duration: 400,
      ease: 'Cubic.easeOut',
    });

    this.corridorContainer.bringToTop(this.petSprite);
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
