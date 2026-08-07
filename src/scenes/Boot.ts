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
    this.load.spritesheet('title-anim', 'title-animation.png', {
      frameWidth: 64,
      frameHeight: 32,
    })
    this.load.spritesheet('car', 'car.png', { frameWidth: 32, frameHeight: 16 })
    this.load.spritesheet('car2', 'car2.png', {
      frameWidth: 32,
      frameHeight: 16,
    })
    this.load.image('sky', 'sky.png')
    this.load.spritesheet('turn-sign', 'turn-sign.png', {
      frameWidth: 16,
      frameHeight: 20,
    })
    this.load.spritesheet('score', 'score.png', {
      frameWidth: 8,
      frameHeight: 10,
    })
    this.load.spritesheet('small-numbers', 'small-numbers.png', {
      frameWidth: 3,
      frameHeight: 5,
    })
    this.load.spritesheet('button', 'button.png', {
      frameWidth: 11,
      frameHeight: 11,
    })
    // damage effects: one animation strip per size. Frame sizes are
    // placeholders — set each to match the exported sheet
    ;[
      'small-smoke',
      'med-smoke',
      'large-smoke',
      'small-fire',
      'med-fire',
      'large-fire',
    ].forEach((key) => {
      this.load.spritesheet(key, `${key}.png`, {
        frameWidth: 16,
        frameHeight: 40,
      })
    })
    this.load.spritesheet('explode', 'explode.png', {
      frameWidth: 32,
      frameHeight: 32,
    })
    this.load.image('flag', 'flag.png')

    this.load.setPath('assets/audio')
    this.load.audio('coin-hit', 'coin-hit.mp3')
    this.load.audio('music', 'music-crispy.mp3')
  }

  create() {
    // carve the checkpoint gantry pieces out of flag.png's first gantry:
    // the full-width checker banner band and one post below it
    const flag = this.textures.get('flag')
    flag.add('banner', 0, 0, 3, 90, 15)
    flag.add('post', 0, 0, 18, 9, 46)

    this.scene.start('Game')
  }
}
