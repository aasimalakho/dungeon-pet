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

const MAP_CENTER_Y = 560;
const MAP_ROOM_COUNT = 8;
const MAP_COLS = [-200, -67, 67, 200];
const MAP_ROW_Y = [-70, 70];
const BASE_PET_SCALE = 0.2;
const LEVEL2_PET_SCALE = 0.3;

const VOTE_ROW_START_Y = 1030;
const VOTE_ROW_SPACING = 46;

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

function mapSlotPosition(index: number): { x: number; y: number } {
  const col = index % 4;
  const rowPair = Math.floor(index / 4);
  const rowInPair = rowPair % 2;
  const actualCol = rowInPair === 0 ? col : 3 - col;
  const y = MAP_CENTER_Y + MAP_ROW_Y[rowPair % 2 === 0 ? 0 : 1];
  return { x: CENTER_X + MAP_COLS[actualCol], y };
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
  petSprite: Phaser.GameObjects.Image;
  petGlow: Phaser.GameObjects.Arc;
  petStageText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
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

    roundedCard(this, CENTER_X, 130, 680, 200, 22);

    this.dayText = this.add
      .text(CENTER_X, 50, 'DAY 1', {
        fontFamily: 'Arial',
        fontSize: 14,
        color: '#7a7aa0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.petStageText = this.add
      .text(CENTER_X, 80, 'Creature: baseline', {
        fontFamily: 'Arial Black',
        fontSize: 26,
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: 620 },
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(CENTER_X, 113, 'Vote to build the dungeon!', {
        fontFamily: 'Arial',
        fontSize: 16,
        color: '#9a9ac0',
        align: 'center',
        wordWrap: { width: 600 },
      })
      .setOrigin(0.5);

    for (let i = 0; i < 3; i++) {
      const feedLine = this.add
        .text(CENTER_X, 150 + i * 20, '', {
          fontFamily: 'Arial',
          fontSize: 13,
          color: '#5a5a80',
        })
        .setOrigin(0.5);
      this.feedTexts.push(feedLine);
    }

    roundedCard(this, CENTER_X, MAP_CENTER_Y, 680, 560, 26);

    this.roomsBuiltText = this.add
      .text(CENTER_X, MAP_CENTER_Y - 250, 'DUNGEON MAP  •  ROOMS BUILT: 0', {
        fontFamily: 'Arial',
        fontSize: 15,
        color: '#7a7aa0',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.pathLines = this.add.graphics();

    for (let i = 0; i < MAP_ROOM_COUNT; i++) {
      const pos = mapSlotPosition(i);
      const tile = this.add.container(pos.x, pos.y);
      const bg = this.add.graphics();
      bg.fillStyle(0x252540, 0.7);
      bg.fillRoundedRect(-32, -32, 64, 64, 14);
      bg.lineStyle(2, 0x3a3a58, 0.6);
      bg.strokeRoundedRect(-32, -32, 64, 64, 14);
      tile.add(bg);
      this.mapTiles.push(tile);
    }

    const startPos = mapSlotPosition(0);
    this.petGlow = this.add.circle(startPos.x, startPos.y + 90, 34, 0xff6b4a, 0.15);
    this.petSprite = this.add
      .image(startPos.x, startPos.y + 90, 'pet-baseline')
      .setScale(BASE_PET_SCALE);

    this.time.addEvent({
      delay: 700,
      loop: true,
      callback: () => this.spawnAmbientParticles(),
    });

    roundedCard(this, CENTER_X, 900, 680, 130, 20);

    this.add
      .text(CENTER_X, 850, '🏆  TOP VOTERS', {
        fontFamily: 'Arial Black',
        fontSize: 16,
        color: '#ffd23f',
      })
      .setOrigin(0.5);

    for (let i = 0; i < 3; i++) {
      const line = this.add
        .text(CENTER_X, 878 + i * 20, '', {
          fontFamily: 'Arial',
          fontSize: 14,
          color: '#b8b8d8',
        })
        .setOrigin(0.5);
      this.leaderboardTexts.push(line);
    }

    ROOM_CONFIG.forEach((room, i) => {
      const y = VOTE_ROW_START_Y + i * VOTE_ROW_SPACING;

      const rowCard = this.add.graphics();
      rowCard.fillStyle(CARD_COLOR, 1);
      rowCard.fillRoundedRect(20, y - 20, 680, 40, 12);
      rowCard.lineStyle(1.5, room.hex, 0.5);
      rowCard.strokeRoundedRect(20, y - 20, 680, 40, 12);

      this.add.text(55, y, room.icon, { fontSize: 18 }).setOrigin(0.5);

      const countText = this.add
        .text(85, y, `${room.label}`, {
          fontFamily: 'Arial Black',
          fontSize: 15,
          color: '#ffffff',
        })
        .setOrigin(0, 0.5);
      this.countTexts[room.type] = countText;

      // Mini progress bar toward next threshold
      const progressBar = this.add.graphics();
      this.progressBars[room.type] = progressBar;

      const btnW = 90;
      const btnH = 30;
      const btnX = 630;
      const btnBg = this.add.graphics();
      btnBg.fillStyle(room.hex, 0.9);
      btnBg.fillRoundedRect(btnX - btnW / 2, y - btnH / 2, btnW, btnH, 15);
      this.voteButtonBgs[room.type] = btnBg;

      this.add
        .text(btnX, y, 'VOTE', {
          fontFamily: 'Arial Black',
          fontSize: 13,
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

  spawnAmbientParticles() {
    this.mapTiles.forEach((tile, i) => {
      const roomType = this.activeTileRoomTypes[i];
      if (!roomType) return;
      const config = ROOM_CONFIG.find((r) => r.type === roomType);
      if (!config) return;

      const particle = this.add.circle(
        tile.x + (Math.random() - 0.5) * 30,
        tile.y + 20,
        Math.random() * 2 + 1.5,
        config.particleColor,
        0.7
      );

      this.tweens.add({
        targets: particle,
        y: particle.y - 40 - Math.random() * 20,
        x: particle.x + (Math.random() - 0.5) * 15,
        alpha: 0,
        duration: 1200 + Math.random() * 400,
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
    this.petGlow.setFillStyle(config ? config.hex : 0xffffff, 0.15);
    this.dayText.setText(`DAY ${data.dayNumber}`);
    this.refreshDisplay();
    this.updateFeed(data.recentVotes);
    this.renderMap(data.rooms);
    this.updateLeaderboard(data.leaderboard);
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
      bg.fillRoundedRect(-32, -32, 64, 64, 14);
      bg.lineStyle(2, 0x3a3a58, 0.6);
      bg.strokeRoundedRect(-32, -32, 64, 64, 14);
      tile.add(bg);

      const room = visibleRooms[i];
      if (room) {
        const config = ROOM_CONFIG.find((r) => r.type === room.type);
        const color = config ? config.hex : 0xffffff;
        this.activeTileRoomTypes[i] = room.type as RoomType;

        const glow = this.add.circle(0, 0, 34, color, 0.2);
        const roomImage = this.add.image(0, 0, `room-${room.type}`).setDisplaySize(56, 56);
        const border = this.add.graphics();
        border.lineStyle(2, color, 0.9);
        border.strokeRoundedRect(-28, -28, 56, 56, 12);
        tile.add([glow, roomImage, border]);

        if (i === visibleRooms.length - 1) {
          tile.setScale(0);
          this.tweens.add({
            targets: tile,
            scale: 1,
            duration: 300,
            ease: 'Back.easeOut',
          });
          const flash = this.add.circle(tile.x, tile.y, 40, 0xffffff, 0.5);
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

    const lastIndex = visibleRooms.length - 1;
    const targetPos = lastIndex >= 0 ? mapSlotPosition(lastIndex) : mapSlotPosition(0);
    const targetY = targetPos.y + 90;

    this.tweens.add({
      targets: [this.petSprite, this.petGlow],
      x: targetPos.x,
      y: targetY,
      duration: 400,
      ease: 'Cubic.easeOut',
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
    const squashScaleX = isLevel2 ? 0.05 : 0.03;
    const squashScaleY = isLevel2 ? 0.35 : 0.22;
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
      const distance = (isLevel2 ? 60 : 45) + Math.random() * 25;
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
        text.setText(`${room.label} (${count})`);
      }

      // Update the mini progress bar toward the next threshold
      const bar = this.progressBars[room.type];
      if (bar) {
        bar.clear();
        const nextThreshold =
          count < EVOLUTION_THRESHOLD ? EVOLUTION_THRESHOLD : EVOLUTION_THRESHOLD_2;
        const prevThreshold = count < EVOLUTION_THRESHOLD ? 0 : EVOLUTION_THRESHOLD;
        const progress = Math.min(
          1,
          (count - prevThreshold) / (nextThreshold - prevThreshold)
        );

        if (count < EVOLUTION_THRESHOLD_2) {
          const barX = 200;
          const barY = VOTE_ROW_START_Y + ROOM_CONFIG.indexOf(room) * VOTE_ROW_SPACING + 10;
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
                  }
