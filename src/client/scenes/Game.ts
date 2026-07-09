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
  { type: 'fire', label: 'Fire', color: '#ff6b4a', hex: 0xff6b4a, icon: '🔥' },
  { type: 'water', label: 'Water', color: '#4ac3ff', hex: 0x4ac3ff, icon: '💧' },
  { type: 'trap', label: 'Trap', color: '#b8bcc8', hex: 0xb8bcc8, icon: '⚠️' },
  { type: 'treasure', label: 'Treasure', color: '#ffd23f', hex: 0xffd23f, icon: '💰' },
  { type: 'chaos', label: 'Chaos', color: '#c86bff', hex: 0xc86bff, icon: '🌀' },
];

const CENTER_X = 360;
const BG_COLOR = 0x0f0f1a;
const CARD_COLOR = 0x1b1b2e;
const CARD_BORDER = 0x2e2e48;

const CORRIDOR_Y = 590;
const ROOM_SPACING = 62;
const CORRIDOR_WINDOW = 8;
const CORRIDOR_START_X = CENTER_X - ((CORRIDOR_WINDOW - 1) * ROOM_SPACING) / 2;
const BASE_PET_SCALE = 0.22;
const LEVEL2_PET_SCALE = 0.34;

const VOTE_CARD_TOP = 830;
const VOTE_ROW_SPACING = 76;

function roundedCard(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 20,
  fillColor = CARD_COLOR,
  borderColor = CARD_BORDER
) {
  const g = scene.add.graphics();
  g.fillStyle(fillColor, 1);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, radius);
  g.lineStyle(2, borderColor, 1);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, radius);
  return g;
}

export class Game extends Scene {
  camera: Phaser.Cameras.Scene2D.Camera;
  petSprite: Phaser.GameObjects.Image;
  petGlow: Phaser.GameObjects.Arc;
  petStageText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  dayText: Phaser.GameObjects.Text;
  roomsBuiltText: Phaser.GameObjects.Text;
  leaderboardTexts: Phaser.GameObjects.Text[] = [];
  countTexts: Partial<Record<RoomType, Phaser.GameObjects.Text>> = {};
  voteButtonBgs: Phaser.GameObjects.Graphics[] = [];
  voteButtonZones: Phaser.GameObjects.Zone[] = [];
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
    this.camera.setBackgroundColor(BG_COLOR);

    const grad = this.add.graphics();
    grad.fillGradientStyle(0x1a1a30, 0x1a1a30, 0x0f0f1a, 0x0f0f1a, 1);
    grad.fillRect(0, 0, 720, 1280);

    roundedCard(this, CENTER_X, 150, 680, 260, 24);

    this.dayText = this.add
      .text(CENTER_X, 55, 'DAY 1', {
        fontFamily: 'Arial',
        fontSize: 15,
        color: '#7a7aa0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.petStageText = this.add
      .text(CENTER_X, 90, 'Creature: baseline', {
        fontFamily: 'Arial Black',
        fontSize: 30,
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: 620 },
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(CENTER_X, 130, 'Vote for a room to build the dungeon!', {
        fontFamily: 'Arial',
        fontSize: 18,
        color: '#9a9ac0',
        align: 'center',
        wordWrap: { width: 600 },
      })
      .setOrigin(0.5);

    for (let i = 0; i < 5; i++) {
      const feedLine = this.add
        .text(CENTER_X, 175 + i * 22, '', {
          fontFamily: 'Arial',
          fontSize: 14,
          color: '#5a5a80',
        })
        .setOrigin(0.5);
      this.feedTexts.push(feedLine);
    }

    roundedCard(this, CENTER_X, CORRIDOR_Y, 680, 300, 24);

    this.roomsBuiltText = this.add
      .text(CENTER_X, CORRIDOR_Y - 120, 'ROOMS BUILT: 0', {
        fontFamily: 'Arial',
        fontSize: 15,
        color: '#7a7aa0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    for (let i = 0; i < CORRIDOR_WINDOW; i++) {
      const x = CORRIDOR_START_X + i * ROOM_SPACING;
      const tile = this.add.container(x, CORRIDOR_Y - 30);
      const bgRounded = this.add.graphics();
      bgRounded.fillStyle(0x2a2a42, 0.6);
      bgRounded.fillRoundedRect(-25, -25, 50, 50, 10);
      tile.add(bgRounded);
      this.corridorTiles.push(tile);
    }

    this.petGlow = this.add.circle(CORRIDOR_START_X, CORRIDOR_Y + 60, 30, 0xff6b4a, 0.15);

    this.petSprite = this.add
      .image(CORRIDOR_START_X, CORRIDOR_Y + 60, 'pet-baseline')
      .setScale(BASE_PET_SCALE);

    roundedCard(this, CENTER_X, 760, 680, 170, 24);

    this.add
      .text(CENTER_X, 690, '🏆  TOP VOTERS', {
        fontFamily: 'Arial Black',
        fontSize: 18,
        color: '#ffd23f',
      })
      .setOrigin(0.5);

    for (let i = 0; i < 5; i++) {
      const line = this.add
        .text(CENTER_X, 720 + i * 18, '', {
          fontFamily: 'Arial',
          fontSize: 15,
          color: '#b8b8d8',
        })
        .setOrigin(0.5);
      this.leaderboardTexts.push(line);
    }

    ROOM_CONFIG.forEach((room, i) => {
      const y = VOTE_CARD_TOP + i * VOTE_ROW_SPACING;
      const rowHeight = 58;
      
      const rowCard = this.add.graphics();
      rowCard.fillStyle(CARD_COLOR, 1);
      rowCard.fillRoundedRect(20, y - rowHeight/2, 680, rowHeight, 16);
      rowCard.lineStyle(2, room.hex, 0.5);
      rowCard.strokeRoundedRect(20, y - rowHeight/2, 680, rowHeight, 16);

      const iconBg = this.add.circle(75, y, 22, room.hex, 0.18);
      iconBg.setStrokeStyle(2, room.hex, 0.6);
      this.add.text(75, y, room.icon, { fontSize: 24 }).setOrigin(0.5);

      const countText = this.add
        .text(115, y, `${room.label}`, {
          fontFamily: 'Arial Black',
          fontSize: 20,
          color: '#ffffff',
        })
        .setOrigin(0, 0.5);
      this.countTexts[room.type] = countText;

      const btnW = 120;
      const btnH = 46;
      const btnX = 620;
      const btnBg = this.add.graphics();
      btnBg.fillStyle(room.hex, 0.9);
      btnBg.fillRoundedRect(btnX - btnW / 2, y - btnH / 2, btnW, btnH, 26);
      this.voteButtonBgs.push(btnBg);

      this.add
        .text(btnX, y, 'VOTE', {
          fontFamily: 'Arial Black',
          fontSize: 18,
          color: '#0f0f1a',
        })
        .setOrigin(0.5);

      const zone = this.add
        .zone(btnX, y, btnW, btnH)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => btnBg.setAlpha(1))
        .on('pointerout', () => btnBg.setAlpha(0.9))
        .on('pointerdown', () => this.castVote(room.type));
      this.voteButtonZones.push(zone);
    });

    void this.loadState();
  }

  async loadState() {
    try {
      const response = await fetch('/api/state');
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = (await response.json()) as VoteResponse;
      this.applyState(data);
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
      this.applyState(data);

      if (data.sabotaged) {
        this.statusText.setText(`⚡ CHAOS SABOTAGE! Creature became ${data.petStage}!`);
        this.playEvolutionEffect(false);
      } else if (data.justEvolved) {
        this.statusText.setText(`The creature evolved into ${data.petStage}!`);
        this.playEvolutionEffect(false);
      } else if (previousLevel < 2 && data.evolutionLevel >= 2) {
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

  applyState(data: VoteResponse) {
    this.roomCounts = data.roomCounts;
    this.petStage = data.petStage as PetStage;
    this.evolutionLevel = data.evolutionLevel;
    this.petSprite.setTexture(`pet-${this.petStage}`);
    if (this.evolutionLevel >= 2) {
      this.petSprite.setScale(LEVEL2_PET_SCALE);
    }
    const config = ROOM_CONFIG.find((r) => r.type === this.petStage);
    if (config) {
      this.petGlow.setFillStyle(config.hex, 0.15);
    }
    this.dayText.setText(`DAY ${data.dayNumber}`);
    this.refreshDisplay();
    this.updateFeed(data.recentVotes);
    this.renderCorridor(data.rooms);
    this.updateLeaderboard(data.leaderboard);
  }

  renderCorridor(rooms: { type: string; dayPicked: number }[]) {
    this.totalRoomsBuilt = rooms.length;
    this.roomsBuiltText.setText(`ROOMS BUILT: ${this.totalRoomsBuilt}`);

    const visibleRooms = rooms.slice(-CORRIDOR_WINDOW);

    this.corridorTiles.forEach((tile, i) => {
      tile.removeAll(true);
      const bgRounded = this.add.graphics();
      bgRounded.fillStyle(0x2a2a42, 0.6);
      bgRounded.fillRoundedRect(-25, -25, 50, 50, 10);
      tile.add(bgRounded);

      const room = visibleRooms[i];
      if (room) {
        const config = ROOM_CONFIG.find((r) => r.type === room.type);
        const color = config ? config.hex : 0xffffff;
        const icon = config ? config.icon : '?';

        const roomBg = this.add.graphics();
        roomBg.fillStyle(color, 0.25);
        roomBg.fillRoundedRect(-23, -23, 46, 46, 10);
        roomBg.lineStyle(2, color, 0.8);
        roomBg.strokeRoundedRect(-23, -23, 46, 46, 10);
        const roomIcon = this.add.text(0, 0, icon, { fontSize: 20 }).setOrigin(0.5);
        tile.add([roomBg, roomIcon]);
      }
    });

    const lastIndex = Math.min(visibleRooms.length, CORRIDOR_WINDOW) - 1;
    const targetX =
      lastIndex >= 0 ? CORRIDOR_START_X + lastIndex * ROOM_SPACING : CORRIDOR_START_X;

    this.tweens.add({
      targets: [this.petSprite, this.petGlow],
      x: targetX,
      duration: 350,
      ease: 'Cubic.easeOut',
    });
  }

  updateLeaderboard(leaderboard: { username: string; votes: number }[]) {
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    this.leaderboardTexts.forEach((text, i) => {
      const entry = leaderboard[i];
      if (entry) {
        text.setText(`${medals[i]}  u/${entry.username}  —  ${entry.votes} votes`);
      } else {
        text.setText('');
      }
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
        this.petSprite.y,
        isLevel2 ? 7 : 5,
        isLevel2 ? 0xffd23f : 0xffffff
      );
      const distance = (isLevel2 ? 70 : 50) + Math.random() * 30;
      this.tweens.add({
        targets: particle,
        x: this.petSprite.x + Math.cos(angle) * distance,
        y: this.petSprite.y + Math.sin(angle) * distance,
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
        text.setText(`${room.label}  (${count})`);
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
