import { Scene } from 'phaser';
import * as Phaser from 'phaser';
import { VoteResponse } from '../../shared/api';
import { EVOLUTION_THRESHOLD, EVOLUTION_THRESHOLD_2 } from '../../shared/types';

type RoomType = 'fire' | 'water' | 'trap' | 'treasure' | 'chaos';
type PetStage = RoomType | 'baseline';

const ROOM_CONFIG: {
  type: RoomType;
  label: string;
  hex: number;
  icon: string;
  particleColor: number;
}[] = [
  { type: 'fire', label: 'Fire', hex: 0xff6b4a, icon: '🔥', particleColor: 0xff8844 },
  { type: 'water', label: 'Water', hex: 0x4ac3ff, icon: '💧', particleColor: 0x6fd8ff },
  { type: 'trap', label: 'Trap', hex: 0xb8bcc8, icon: '⚠️', particleColor: 0xdddddd },
  { type: 'treasure', label: 'Treasure', hex: 0xffd23f, icon: '💰', particleColor: 0xffe680 },
  { type: 'chaos', label: 'Chaos', hex: 0xc86bff, icon: '🌀', particleColor: 0xdb9bff },
];

const CENTER_X = 360;
const BG_COLOR = 0x0f0f1a;
const CARD_COLOR = 0x1b1b2e;
const CARD_BORDER = 0x2e2e48;

// ===== Layout constants (recalculated with margins that actually fit) =====
const HERO_Y = 280;
const HERO_H = 520;
const PET_CENTER_Y = HERO_Y - 20;

const MAP_Y = 700;
const MAP_H = 280;
const MAP_ROOM_COUNT = 8;
const MAP_COLS = [-200, -67, 67, 200];
const MAP_ROW_Y = [-55, 55];

const LEADERBOARD_Y = 915;
const LEADERBOARD_H = 110;

const VOTE_ROW_START_Y = 1013;
const VOTE_ROW_SPACING = 50;

const BASE_PET_SCALE = 0.85;
const LEVEL2_PET_SCALE = 1.05;

// Depth layers — explicit, so stacking order is never ambiguous
const DEPTH_CARD = 0;
const DEPTH_ROOM_BG = 1;
const DEPTH_GLOW = 2;
const DEPTH_PET = 3;
const DEPTH_TEXT = 4;

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
  g.setDepth(DEPTH_CARD);
  g.fillStyle(fillColor, 1);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, radius);
  g.lineStyle(2, borderColor, 1);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, radius);
  return g;
}

function mapSlotPosition(index: number): { x: number; y: number } {
  const col = index % 4;
  const rowPair = Math.floor(index / 4);
  const rowInPair = rowPair % 2;
  const actualCol = rowInPair === 0 ? col : 3 - col;
  const colX = MAP_COLS[actualCol] ?? 0;
  const rowY = MAP_ROW_Y[rowPair % 2] ?? 0;
  return { x: CENTER_X + colX, y: MAP_Y + rowY };
}

class SoundManager {
  ctx: AudioContext | null = null;

  private ensureContext() {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(freq: number, duration: number, type: OscillatorType, delay = 0, volume = 0.08) {
    try {
      const ctx = this.ensureContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const startTime = ctx.currentTime + delay;
      gain.gain.setValueAtTime(volume, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch (e) {
      console.warn('Sound playback unavailable:', e);
    }
  }

  playVote() {
    this.playTone(520, 0.08, 'sine');
  }

  playEvolution() {
    this.playTone(440, 0.15, 'triangle', 0);
    this.playTone(660, 0.15, 'triangle', 0.1);
    this.playTone(880, 0.25, 'triangle', 0.2);
  }

  playSabotage() {
    this.playTone(300, 0.1, 'sawtooth', 0);
    this.playTone(180, 0.2, 'sawtooth', 0.1);
  }

  playBlocked() {
    this.playTone(220, 0.15, 'square', 0, 0.05);
  }
}

export class Game extends Scene {
  camera: Phaser.Cameras.Scene2D.Camera;
  sound2: SoundManager = new SoundManager();
  heroBg: Phaser.GameObjects.Image | null = null;
  petSprite: Phaser.GameObjects.Image;
  petGlow: Phaser.GameObjects.Arc;
  petStageText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  stakesText: Phaser.GameObjects.Text;
  chaosRiskText: Phaser.GameObjects.Text | null = null;
  dayText: Phaser.GameObjects.Text;
  roomsBuiltText: Phaser.GameObjects.Text;
  leaderboardTexts: Phaser.GameObjects.Text[] = [];
  countTexts: Partial<Record<RoomType, Phaser.GameObjects.Text>> = {};
  progressBars: Partial<Record<RoomType, Phaser.GameObjects.Graphics>> = {};
  voteButtonZones: Phaser.GameObjects.Zone[] = [];
  voteButtonBgs: Partial<Record<RoomType, Phaser.GameObjects.Graphics>> = {};
  feedTexts: Phaser.GameObjects.Text[] = [];
  mapTiles: Phaser.GameObjects.Container[] = [];
  pathLines: Phaser.GameObjects.Graphics;
  activeTileRoomTypes: (RoomType | null)[] = new Array(MAP_ROOM_COUNT).fill(null);
  roomCounts: Record<string, number> = {};
  petStage: PetStage = 'baseline';
  evolutionLevel: number = 0;
  voting: boolean = false;
  votingLocked: boolean = false;
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

    // ===== HERO CARD =====
    roundedCard(this, CENTER_X, HERO_Y, 680, HERO_H, 24);

    this.dayText = this.add
      .text(CENTER_X, HERO_Y - HERO_H / 2 + 24, 'DAY 1', {
        fontFamily: 'Arial',
        fontSize: 14,
        color: '#9a9ac0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_TEXT);

    this.petStageText = this.add
      .text(CENTER_X, HERO_Y - HERO_H / 2 + 58, 'Creature: baseline', {
        fontFamily: 'Arial Black',
        fontSize: 26,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'center',
        wordWrap: { width: 620 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_TEXT);

    this.petGlow = this.add.circle(CENTER_X, PET_CENTER_Y, 130, 0xff6b4a, 0.18);
    this.petGlow.setDepth(DEPTH_GLOW);

    this.petSprite = this.add
      .image(CENTER_X, PET_CENTER_Y, 'pet-baseline')
      .setScale(BASE_PET_SCALE);
    this.petSprite.setDepth(DEPTH_PET);

    this.statusText = this.add
      .text(CENTER_X, HERO_Y + HERO_H / 2 - 96, 'Vote to build the dungeon!', {
        fontFamily: 'Arial',
        fontSize: 16,
        color: '#e0e0f0',
        align: 'center',
        wordWrap: { width: 600 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_TEXT);

    this.stakesText = this.add
      .text(CENTER_X, HERO_Y + HERO_H / 2 - 70, '', {
        fontFamily: 'Arial Black',
        fontSize: 15,
        color: '#ffd23f',
        align: 'center',
        wordWrap: { width: 600 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_TEXT);

    for (let i = 0; i < 2; i++) {
      const feedLine = this.add
        .text(CENTER_X, HERO_Y + HERO_H / 2 - 46 + i * 20, '', {
          fontFamily: 'Arial',
          fontSize: 12,
          color: '#8888aa',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_TEXT);
      this.feedTexts.push(feedLine);
    }

    this.startIdleAnimation();

    // ===== DUNGEON MAP CARD =====
    roundedCard(this, CENTER_X, MAP_Y, 680, MAP_H, 22);

    this.roomsBuiltText = this.add
      .text(CENTER_X, MAP_Y - MAP_H / 2 + 22, 'DUNGEON MAP  •  ROOMS BUILT: 0', {
        fontFamily: 'Arial',
        fontSize: 14,
        color: '#7a7aa0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_TEXT);

    this.pathLines = this.add.graphics();
    this.pathLines.setDepth(DEPTH_CARD + 0.5);

    for (let i = 0; i < MAP_ROOM_COUNT; i++) {
      const pos = mapSlotPosition(i);
      const tile = this.add.container(pos.x, pos.y);
      tile.setDepth(DEPTH_TEXT);
      const bg = this.add.graphics();
      bg.fillStyle(0x252540, 0.7);
      bg.fillRoundedRect(-28, -28, 56, 56, 12);
      bg.lineStyle(2, 0x3a3a58, 0.6);
      bg.strokeRoundedRect(-28, -28, 56, 56, 12);
      tile.add(bg);
      this.mapTiles.push(tile);
    }

    this.time.addEvent({
      delay: 700,
      loop: true,
      callback: () => this.spawnAmbientParticles(),
    });

    // ===== LEADERBOARD CARD =====
    roundedCard(this, CENTER_X, LEADERBOARD_Y, 680, LEADERBOARD_H, 18);

    this.add
      .text(CENTER_X, LEADERBOARD_Y - LEADERBOARD_H / 2 + 25, '🏆  TOP VOTERS', {
        fontFamily: 'Arial Black',
        fontSize: 15,
        color: '#ffd23f',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_TEXT);

    for (let i = 0; i < 3; i++) {
      const line = this.add
        .text(CENTER_X, LEADERBOARD_Y - LEADERBOARD_H / 2 + 50 + i * 19, '', {
          fontFamily: 'Arial',
          fontSize: 13,
          color: '#b8b8d8',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_TEXT);
      this.leaderboardTexts.push(line);
    }

    // ===== VOTE ROWS =====
    ROOM_CONFIG.forEach((room, i) => {
      const y = VOTE_ROW_START_Y + i * VOTE_ROW_SPACING;

      const rowCard = this.add.graphics();
      rowCard.setDepth(DEPTH_CARD);
      rowCard.fillStyle(CARD_COLOR, 1);
      rowCard.fillRoundedRect(20, y - 21, 680, 42, 12);
      rowCard.lineStyle(1.5, room.hex, 0.5);
      rowCard.strokeRoundedRect(20, y - 21, 680, 42, 12);

      this.add.text(55, y, room.icon, { fontSize: 18 }).setOrigin(0.5).setDepth(DEPTH_TEXT);

      const countText = this.add
        .text(85, y, `${room.label}`, {
          fontFamily: 'Arial Black',
          fontSize: 14,
          color: '#ffffff',
        })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH_TEXT);
      this.countTexts[room.type] = countText;

      const progressBar = this.add.graphics();
      progressBar.setDepth(DEPTH_TEXT);
      this.progressBars[room.type] = progressBar;

      if (room.type === 'chaos') {
        this.chaosRiskText = this.add
          .text(85, y + 13, '', {
            fontFamily: 'Arial',
            fontSize: 11,
            color: '#c86bff',
          })
          .setOrigin(0, 0.5)
          .setDepth(DEPTH_TEXT);
      }

      const btnW = 90;
      const btnH = 30;
      const btnX = 630;
      const btnBg = this.add.graphics();
      btnBg.setDepth(DEPTH_TEXT);
      btnBg.fillStyle(room.hex, 0.9);
      btnBg.fillRoundedRect(btnX - btnW / 2, y - btnH / 2, btnW, btnH, 15);
      this.voteButtonBgs[room.type] = btnBg;

      this.add
        .text(btnX, y, 'VOTE', {
          fontFamily: 'Arial Black',
          fontSize: 13,
          color: '#0f0f1a',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_TEXT + 1);

      const zone = this.add
        .zone(btnX, y, btnW, btnH)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => {
          if (!this.votingLocked) btnBg.setAlpha(1);
        })
        .on('pointerout', () => {
          if (!this.votingLocked) btnBg.setAlpha(0.9);
        })
        .on('pointerdown', () => this.castVote(room.type));
      this.voteButtonZones.push(zone);
    });

    void this.loadState();
  }

  startIdleAnimation() {
    this.tweens.add({
      targets: this.petSprite,
      y: PET_CENTER_Y + 15,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.time.addEvent({
      delay: 4500,
      loop: true,
      callback: () => {
        this.tweens.add({
          targets: this.petSprite,
          angle: { from: 0, to: 6 },
          duration: 120,
          yoyo: true,
          repeat: 1,
          ease: 'Sine.easeInOut',
        });
      },
    });
  }

  spawnAmbientParticles() {
    this.mapTiles.forEach((tile, i) => {
      const roomType = this.activeTileRoomTypes[i];
      if (!roomType) return;
      const config = ROOM_CONFIG.find((r) => r.type === roomType);
      if (!config) return;

      const particle = this.add.circle(
        tile.x + (Math.random() - 0.5) * 24,
        tile.y + 16,
        Math.random() * 2 + 1.2,
        config.particleColor,
        0.7
      );
      particle.setDepth(DEPTH_TEXT + 1);

      this.tweens.add({
        targets: particle,
        y: particle.y - 32 - Math.random() * 16,
        x: particle.x + (Math.random() - 0.5) * 12,
        alpha: 0,
        duration: 1100 + Math.random() * 300,
        ease: 'Sine.easeOut',
        onComplete: () => particle.destroy(),
      });
    });
  }

  async loadState() {
    try {
      const response = await fetch('/api/state');
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = (await response.json()) as VoteResponse;
      this.applyState(data);
      this.applyVoteLockState(data.alreadyVotedToday);
      if (data.alreadyVotedToday) {
        this.statusText.setText("You've already voted today — come back tomorrow!");
      }
    } catch (error) {
      console.error('Failed to load game state:', error);
      this.statusText.setText('Failed to load — try refreshing.');
    }
  }

  async castVote(roomType: RoomType) {
    if (this.voting || this.votingLocked) {
      if (this.votingLocked) {
        this.statusText.setText("You've already voted today — come back tomorrow!");
        this.sound2.playBlocked();
      }
      return;
    }
    this.voting = true;
    this.statusText.setText('Voting...');
    this.sound2.playVote();

    try {
      const response = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomType }),
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const data = (await response.json()) as VoteResponse;

      if (data.alreadyVotedToday) {
        this.applyState(data);
        this.applyVoteLockState(true);
        this.statusText.setText("You've already voted today — come back tomorrow!");
        this.sound2.playBlocked();
        return;
      }

      const previousLevel = this.evolutionLevel;
      this.applyState(data);
      this.applyVoteLockState(true);

      if (data.sabotaged) {
        this.statusText.setText(`⚡ CHAOS SABOTAGE! Creature became ${data.petStage}!`);
        this.playEvolutionEffect(false);
        this.sound2.playSabotage();
      } else if (data.justEvolved) {
        this.statusText.setText(`The creature evolved into ${data.petStage}!`);
        this.playEvolutionEffect(false);
        this.sound2.playEvolution();
      } else if (previousLevel < 2 && data.evolutionLevel >= 2) {
        this.statusText.setText(`The creature reached its Ancient form!`);
        this.playEvolutionEffect(true);
        this.sound2.playEvolution();
      } else {
        this.statusText.setText(`Vote counted! Come back tomorrow for another.`);
      }
    } catch (error) {
      console.error('Failed to cast vote:', error);
      this.statusText.setText('Vote failed — try again.');
    } finally {
      this.voting = false;
    }
  }

  applyVoteLockState(locked: boolean) {
    this.votingLocked = locked;
    Object.values(this.voteButtonBgs).forEach((bg) => {
      bg?.setAlpha(locked ? 0.35 : 0.9);
    });
  }

  applyState(data: VoteResponse) {
    this.roomCounts = data.roomCounts;
    this.petStage = data.petStage as PetStage;
    this.evolutionLevel = data.evolutionLevel;
    this.petSprite.setTexture(`pet-${this.petStage}`);
    this.petSprite.setScale(this.evolutionLevel >= 2 ? LEVEL2_PET_SCALE : BASE_PET_SCALE);

    const config = ROOM_CONFIG.find((r) => r.type === this.petStage);
    this.petGlow.setFillStyle(config ? config.hex : 0xffffff, 0.18);
    this.updateHeroBackground();

    this.dayText.setText(`DAY ${data.dayNumber}`);
    this.refreshDisplay();
    this.updateFeed(data.recentVotes);
    this.renderMap(data.rooms);
    this.updateLeaderboard(data.leaderboard);
  }

  updateHeroBackground() {
    if (this.petStage === 'baseline') {
      if (this.heroBg) {
        this.heroBg.destroy();
        this.heroBg = null;
      }
      return;
    }

    const textureKey = `room-${this.petStage}`;
    if (!this.heroBg) {
      this.heroBg = this.add
        .image(CENTER_X, HERO_Y, textureKey)
        .setDisplaySize(660, HERO_H - 20)
        .setAlpha(0.3);
      this.heroBg.setDepth(DEPTH_ROOM_BG);
    } else {
      this.heroBg.setTexture(textureKey);
    }
  }

  computeStakes(): string {
    if (this.evolutionLevel === 0) {
      let bestType: RoomType | null = null;
      let bestCount = -1;
      ROOM_CONFIG.forEach((room) => {
        const c = this.roomCounts[room.type] ?? 0;
        if (c > bestCount) {
          bestCount = c;
          bestType = room.type;
        }
      });
      if (!bestType) return '';
      const config = ROOM_CONFIG.find((r) => r.type === bestType);
      if (!config) return '';
      const needed = Math.max(0, EVOLUTION_THRESHOLD - bestCount);
      if (needed === 0) return 'The dungeon is about to hatch a creature!';
      return `${needed} more ${config.label} vote${needed > 1 ? 's' : ''} hatches the creature!`;
    }

    if (this.evolutionLevel === 1) {
      const config = ROOM_CONFIG.find((r) => r.type === this.petStage);
      const currentCount = this.roomCounts[this.petStage] ?? 0;
      const needed = Math.max(0, EVOLUTION_THRESHOLD_2 - currentCount);
      if (!config) return '';
      if (needed === 0) return 'The creature is ready to reach its Ancient form!';
      return `${needed} more ${config.label} vote${needed > 1 ? 's' : ''} reaches Ancient form!`;
    }

    return `The Ancient ${this.petStage} reigns over the dungeon!`;
  }

  computeChaosRisk(): number {
    const chaosCount = this.roomCounts['chaos'] ?? 0;
    return Math.round(Math.min(50, chaosCount * 10));
  }

  renderMap(rooms: { type: string; dayPicked: number }[]) {
    this.totalRoomsBuilt = rooms.length;
    this.roomsBuiltText.setText(`DUNGEON MAP  •  ROOMS BUILT: ${this.totalRoomsBuilt}`);

    const visibleRooms = rooms.slice(-MAP_ROOM_COUNT);

    this.pathLines.clear();
    this.pathLines.lineStyle(2, 0x3a3a58, 0.5);

    for (let i = 0; i < visibleRooms.length - 1; i++) {
      const a = mapSlotPosition(i);
      const b = mapSlotPosition(i + 1);
      this.pathLines.lineBetween(a.x, a.y, b.x, b.y);
    }

    this.activeTileRoomTypes = new Array(MAP_ROOM_COUNT).fill(null);

    this.mapTiles.forEach((tile, i) => {
      tile.removeAll(true);
      const bg = this.add.graphics();
      bg.fillStyle(0x252540, 0.7);
      bg.fillRoundedRect(-28, -28, 56, 56, 12);
      bg.lineStyle(2, 0x3a3a58, 0.6);
      bg.strokeRoundedRect(-28, -28, 56, 56, 12);
      tile.add(bg);

      const room = visibleRooms[i];
      if (room) {
        const config = ROOM_CONFIG.find((r) => r.type === room.type);
        const color = config ? config.hex : 0xffffff;
        this.activeTileRoomTypes[i] = room.type as RoomType;

        const glow = this.add.circle(0, 0, 30, color, 0.2);
        const roomImage = this.add.image(0, 0, `room-${room.type}`).setDisplaySize(50, 50);
        const border = this.add.graphics();
        border.lineStyle(2, color, 0.9);
        border.strokeRoundedRect(-25, -25, 50, 50, 10);
        tile.add([glow, roomImage, border]);

        if (i === visibleRooms.length - 1) {
          tile.setScale(0);
          this.tweens.add({
            targets: tile,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
          });
          const flash = this.add.circle(tile.x, tile.y, 36, 0xffffff, 0.5);
          flash.setDepth(DEPTH_TEXT + 2);
          this.tweens.add({
            targets: flash,
            scale: 2,
            alpha: 0,
            duration: 400,
            ease: 'Cubic.easeOut',
            onComplete: () => flash.destroy(),
          });
        }
      }
    });
  }

  updateLeaderboard(leaderboard: { username: string; votes: number }[]) {
    const medals = ['🥇', '🥈', '🥉'];
    this.leaderboardTexts.forEach((text, i) => {
      const entry = leaderboard[i];
      if (entry) {
        text.setText(`${medals[i]} u/${entry.username} — ${entry.votes} votes`);
      } else {
        text.setText('');
      }
    });
  }

  playEvolutionEffect(isLevel2: boolean) {
    const newTexture = `pet-${this.petStage}`;
    const targetScale = isLevel2 ? LEVEL2_PET_SCALE : BASE_PET_SCALE;
    const squashScaleX = isLevel2 ? 0.2 : 0.13;
    const squashScaleY = isLevel2 ? 1.4 : 0.9;
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
        isLevel2 ? 8 : 6,
        isLevel2 ? 0xffd23f : 0xffffff
      );
      particle.setDepth(DEPTH_TEXT + 2);
      const distance = (isLevel2 ? 130 : 95) + Math.random() * 40;
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
    this.stakesText.setText(this.computeStakes());

    if (this.chaosRiskText) {
      this.chaosRiskText.setText(`Chaos risk: ${this.computeChaosRisk()}%`);
    }

    ROOM_CONFIG.forEach((room) => {
      const count = this.roomCounts[room.type] ?? 0;
      const text = this.countTexts[room.type];
      if (text) {
        text.setText(`${room.label} (${count})`);
      }

      const bar = this.progressBars[room.type];
      if (bar) {
        bar.clear();
        const nextThreshold =
          count < EVOLUTION_THRESHOLD ? EVOLUTION_THRESHOLD : EVOLUTION_THRESHOLD_2;
        const prevThreshold = count < EVOLUTION_THRESHOLD ? 0 : EVOLUTION_THRESHOLD;
        const progress = Math.min(1, (count - prevThreshold) / (nextThreshold - prevThreshold));

        if (count < EVOLUTION_THRESHOLD_2) {
          const barX = 200;
          const barY = VOTE_ROW_START_Y + ROOM_CONFIG.indexOf(room) * VOTE_ROW_SPACING + 11;
          const barW = 220;
          bar.fillStyle(0x2a2a42, 1);
          bar.fillRoundedRect(barX, barY, barW, 5, 3);
          bar.fillStyle(room.hex, 0.9);
          bar.fillRoundedRect(barX, barY, barW * progress, 5, 3);
        }
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
 }                                        }
