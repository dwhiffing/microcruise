import { Scene } from 'phaser'
import { BRAKE_LIGHT_SWAPS } from '../constants'

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
    this.load.spritesheet('smoke', 'smoke.png', {
      frameWidth: 11,
      frameHeight: 11,
    })
    this.load.spritesheet('coin', 'coin.png', {
      frameWidth: 32,
      frameHeight: 32,
    })
    this.load.spritesheet('coin-spin', 'coin-spin.png', {
      frameWidth: 10,
      frameHeight: 10,
    })
    this.load.spritesheet('dirt', 'dirt.png', {
      frameWidth: 11,
      frameHeight: 11,
    })
    this.load.spritesheet('gearing', 'gearing.png', {
      frameWidth: 64,
      frameHeight: 32,
    })
    this.load.spritesheet('car', 'car.png', { frameWidth: 32, frameHeight: 16 })
    this.load.spritesheet('car2', 'car2.png', {
      frameWidth: 32,
      frameHeight: 16,
    })
    this.load.spritesheet('truck', 'truck.png', {
      frameWidth: 32,
      frameHeight: 32,
    })
    this.load.spritesheet('semi', 'semi.png', {
      frameWidth: 32,
      frameHeight: 48,
    })
    this.load.spritesheet('motorcycle', 'motorcycle.png', {
      frameWidth: 16,
      frameHeight: 20,
    })
    this.load.spritesheet('motorcycle-fall', 'motorcycle-fall.png', {
      frameWidth: 48,
      frameHeight: 20,
    })
    // roadside decals, each a largest-first series of pre-drawn sizes
    this.load.spritesheet('bush', 'bush.png', {
      frameWidth: 16,
      frameHeight: 16,
    })
    this.load.spritesheet('bush2', 'bush2.png', {
      frameWidth: 48,
      frameHeight: 32,
    })
    this.load.spritesheet('tree', 'tree.png', {
      frameWidth: 48,
      frameHeight: 48,
    })
    this.load.spritesheet('tree2', 'tree2.png', {
      frameWidth: 32,
      frameHeight: 48,
    })
    // desert/snow scenery variants — the recoloured bushes share the base
    // grids, the themed trees are their own shapes with their own grids
    this.load.spritesheet('desert-bush', 'desert-bush.png', {
      frameWidth: 16,
      frameHeight: 16,
    })
    this.load.spritesheet('snow-bush', 'snow-bush.png', {
      frameWidth: 16,
      frameHeight: 16,
    })
    this.load.spritesheet('desert-bush2', 'desert-bush2.png', {
      frameWidth: 48,
      frameHeight: 32,
    })
    this.load.spritesheet('snow-bush2', 'snow-bush2.png', {
      frameWidth: 18,
      frameHeight: 23,
    })
    this.load.spritesheet('desert-tree', 'desert-tree.png', {
      frameWidth: 48,
      frameHeight: 48,
    })
    this.load.spritesheet('snow-tree', 'snow-tree.png', {
      frameWidth: 32,
      frameHeight: 64,
    })
    this.load.spritesheet('desert-tree2', 'desert-tree2.png', {
      frameWidth: 32,
      frameHeight: 32,
    })
    this.load.spritesheet('snow-tree2', 'snow-tree2.png', {
      frameWidth: 32,
      frameHeight: 64,
    })
    this.load.image('sky-bg', 'sky-bg.png')
    this.load.image('sky-fg', 'sky-fg.png')
    this.load.image('desert-sky-fg', 'desert-sky-fg.png')
    this.load.image('snow-sky-fg', 'snow-sky-fg.png')
    this.load.image('stars', 'stars.png')
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
    this.load.audio('select', 'select.mp3')
    this.load.audio('explode', 'explode.wav')
    this.load.audio('fire', 'fire.wav')
    this.load.audio('fire2', 'fire2.wav')
    this.load.audio('coin', 'coin.wav')
    this.load.audio('music', 'music-crispy.mp3')
    // wav, not mp3: encoder padding puts a gap at mp3 loop points
    this.load.audio('engine', 'engine.wav')
    this.load.audio('checkpoint', 'checkpoint.wav')
    this.load.audio('drift', 'drift.wav')
    this.load.audio('keys', 'keys.wav')
    this.load.audio('light-crash', 'light-crash.wav')
    this.load.audio('crash', 'crash.wav')
    this.load.audio('ignition', 'ignition.wav')
  }

  create() {
    // carve the checkpoint gantry pieces out of flag.png's first gantry:
    // the full-width checker banner band and one post below it
    const flag = this.textures.get('flag')
    flag.add('banner', 0, 0, 3, 90, 15)
    flag.add('post', 0, 0, 18, 9, 46)

    // bake a recoloured copy of the car sheet with the taillights lit,
    // shown while braking (same frame grid as 'car')
    const carSrc = this.textures.get('car').getSourceImage() as HTMLImageElement
    const canvas = document.createElement('canvas')
    canvas.width = carSrc.width
    canvas.height = carSrc.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(carSrc, 0, 0)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue
      const rgb = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]
      for (const [from, to] of BRAKE_LIGHT_SWAPS) {
        if (rgb === from) {
          d[i] = (to >> 16) & 0xff
          d[i + 1] = (to >> 8) & 0xff
          d[i + 2] = to & 0xff
        }
      }
    }
    ctx.putImageData(img, 0, 0)
    this.textures.addSpriteSheet(
      'car-brake',
      canvas as unknown as HTMLImageElement,
      { frameWidth: 32, frameHeight: 16 },
    )

    this.scene.start('Game')
  }
}
