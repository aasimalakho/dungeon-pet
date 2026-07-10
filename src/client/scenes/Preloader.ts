import { Scene } from 'phaser';

export class Preloader extends Scene {
  constructor() {
    super('Preloader');
  }

  init() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const centerX = w / 2;
    const centerY = h / 2;

    // Full-canvas dark dungeon gradient background
    const grad = this.add.graphics();
    grad.fillGradientStyle(0x1a1a30, 0x1a1a30, 0x0a0a14, 0x0a0a14, 1);
    grad.fillRect(0, 0, w, h);

    // Soft ambient glow behind the title
    this.add.circle(centerX, centerY - 80, 140, 0x6b4aff, 0.08);

    // Title
    this.add
      .text(centerX, centerY - 100, 'DUNGEON PET', {
        fontFamily: 'Arial Black',
        fontSize: 42,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(centerX, centerY - 55, 'A community-built dungeon', {
        fontFamily: 'Arial',
        fontSize: 16,
        color: '#9a9ac0',
      })
      .setOrigin(0.5);

    // Small pulsing dungeon icon while loading
    const icon = this.add.text(centerX, centerY + 10, '🔥', { fontSize: 36 }).setOrigin(0.5);
    this.tweens.add({
      targets: icon,
      scale: 1.2,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Progress bar track (rounded, dark)
    const barWidth = Math.min(400, w * 0.7);
    const barHeight = 14;
    const barX = centerX - barWidth / 2;
    const barY = centerY + 70;

    const track = this.add.graphics();
    track.fillStyle(0x1b1b2e, 1);
    track.fillRoundedRect(barX, barY, barWidth, barHeight, 8);
    track.lineStyle(2, 0x2e2e48, 1);
    track.strokeRoundedRect(barX, barY, barWidth, barHeight, 8);

    // Progress bar fill (glowing)
    const fill = this.add.graphics();

    this.add
      .text(centerX, barY + 30, 'Loading...', {
        fontFamily: 'Arial',
        fontSize: 14,
        color: '#7a7aa0',
      })
      .setOrigin(0.5);

    this.load.on('progress', (progress: number) => {
      fill.clear();
      const fillWidth = Math.max(4, barWidth * progress);
      fill.fillStyle(0xc86bff, 1);
      fill.fillRoundedRect(barX, barY, fillWidth, barHeight, 8);
    });
  }

  preload() {
    this.load.setPath('../assets');

    this.load.image('logo', 'logo.png');
    this.load.image('pet-baseline', 'pet-baseline.png');
    this.load.image('pet-fire', 'pet-fire.png');
    this.load.image('pet-water', 'pet-water.png');
    this.load.image('pet-trap', 'pet-trap.png');
    this.load.image('pet-treasure', 'pet-treasure.png');
    this.load.image('pet-chaos', 'pet-chaos.png');
    this.load.image('room-fire', 'room-fire.png');
    this.load.image('room-water', 'room-water.png');
    this.load.image('room-trap', 'room-trap.png');
    this.load.image('room-treasure', 'room-treasure.png');
    this.load.image('room-chaos', 'room-chaos.png');
  }

  create() {
    this.scene.start('Game');
  }
}
