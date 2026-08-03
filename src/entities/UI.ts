import { GameObjects, Scene } from 'phaser'

export class UI {
  public titleText!: GameObjects.BitmapText
  public scoreText!: GameObjects.BitmapText
  public title!: GameObjects.Image
  public titleTextTween?: Phaser.Tweens.Tween
  private timerDigits: GameObjects.Sprite[]

  constructor(scene: Scene) {
    this.title = scene.add.image(32, 28, 'title').setDepth(10)

    this.titleText = scene.add
      .bitmapText(32, 64, 'pixel-dan', 'PRESS ARROW KEY')
      .setTintFill(0xffffff)
      .setFontSize(5)
      .setOrigin(0.5, 1)
      .setDepth(10)

    this.titleTextTween = scene.tweens.add({
      targets: this.titleText,
      alpha: { from: 1, to: 0.4 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    this.scoreText = scene.add
      .bitmapText(32, 42, 'pixel-dan', '')
      .setCenterAlign()
      .setTintFill(0xffffff)
      .setFontSize(5)
      .setOrigin(0.5, 0.5)
      .setDepth(10)

    // countdown clock digits ('score' spritesheet: frame = digit), hidden
    // until a run starts
    this.timerDigits = [0, 1].map(() =>
      scene.add.sprite(0, 1, 'score', 0).setOrigin(0.5, 0).setDepth(10).setVisible(false),
    )
  }

  // show the remaining seconds centred at the top of the screen
  setTimer(seconds: number) {
    const text = String(seconds)
    this.timerDigits.forEach((digit, i) => {
      const used = i < text.length
      digit.setVisible(used)
      if (used) {
        digit.setFrame(Number(text[i]))
        digit.x = 32 - text.length * 4 + i * 8 + 4
      }
    })
  }

  hideTimer() {
    this.timerDigits.forEach((digit) => digit.setVisible(false))
  }
}
