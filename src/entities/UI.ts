import { GameObjects, Scene } from 'phaser'

export class UI {
  public sceneRef: Scene
  public titleText!: GameObjects.BitmapText
  public scoreText!: GameObjects.BitmapText
  public title!: GameObjects.Image
  public titleTextTween?: Phaser.Tweens.Tween

  constructor(scene: Scene) {
    this.sceneRef = scene

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
  }
}
