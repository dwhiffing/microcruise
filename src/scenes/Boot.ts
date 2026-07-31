import { Scene } from 'phaser'

export class Boot extends Scene {
  constructor() {
    super('Boot')
  }

  init() {
    const bar = this.add.rectangle(0, 0, 0, 64, 0xffffff).setOrigin(0, 0)
    this.load.on('progress', (progress: number) => {
      bar.width = 64 * progress
    })
  }

  preload() {
    this.load.setPath('assets')
    this.load.bitmapFont('pixel-dan', 'pixel-dan.png', 'pixel-dan.xml')
    this.load.image('title', 'title.png')
    this.load.spritesheet('car', 'car.png', { frameWidth: 32, frameHeight: 16 })
    this.load.image('sky', 'sky.png')

    this.load.setPath('assets/audio')
    this.load.audio('coin-hit', 'coin-hit.mp3')
    this.load.audio('music', 'music-crispy.mp3')
  }

  create() {
    this.scene.start('Game')
  }
}
