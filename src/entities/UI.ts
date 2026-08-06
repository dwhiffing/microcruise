import { GameObjects, Scene } from 'phaser'

// speedometer bar heights, left to right. Each pixel is 5 mph, so the 43
// pixels span 0-215 mph; bars light bottom-up as speed climbs
const SPEEDO_BARS = [2, 2, 2, 2, 2, 2, 3, 5, 7, 8, 8]
const MPH_PER_PIXEL = 5
const SPEEDO_PIXELS = 43 // sum of SPEEDO_BARS
const SPEEDO_RIGHT = 63 // right edge of the last bar
const SPEEDO_BOTTOM = 9 // row just below the bars

// top-left cluster: gear digit + score above an RPM bar
const RPM_BAR_X = 2
const RPM_BAR_Y = 7
const RPM_BAR_W = 22
const RPM_BAR_H = 2
const HUD_YELLOW = 0xffec27

export class UI {
  public titleText!: GameObjects.BitmapText
  public scoreText!: GameObjects.BitmapText
  public title!: GameObjects.Image
  public titleTextTween?: Phaser.Tweens.Tween
  private timerDigits: GameObjects.Sprite[]
  private speedo: GameObjects.Graphics
  private speedoText: GameObjects.BitmapText
  private gearDigit: GameObjects.Sprite
  private scoreHud: GameObjects.BitmapText
  private rpmBg: GameObjects.Rectangle
  private rpmFill: GameObjects.Rectangle

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
      scene.add
        .sprite(0, 0, 'score', 0)
        .setOrigin(0.5, 0)
        .setDepth(10)
        .setVisible(false),
    )

    // gear digit ('small-numbers' spritesheet: frame = digit), with the
    // live score beside it and the RPM bar underneath
    this.gearDigit = scene.add
      .sprite(RPM_BAR_X, 1, 'small-numbers', 1)
      .setOrigin(0, 0)
      .setTintFill(HUD_YELLOW)
      .setDepth(10)
      .setVisible(false)
    this.scoreHud = scene.add
      .bitmapText(RPM_BAR_X + RPM_BAR_W + 1, 1, 'pixel-dan', '')
      .setTintFill(0xffffff)
      .setFontSize(5)
      .setOrigin(1, 0)
      .setDepth(10)
      .setVisible(false)
    this.rpmBg = scene.add
      .rectangle(RPM_BAR_X, RPM_BAR_Y, RPM_BAR_W, RPM_BAR_H, 0xffffff)
      .setOrigin(0, 0)
      .setDepth(10)
      .setVisible(false)
    this.rpmFill = scene.add
      .rectangle(RPM_BAR_X, RPM_BAR_Y, 1, RPM_BAR_H, HUD_YELLOW)
      .setOrigin(0, 0)
      .setDepth(10)
      .setVisible(false)

    this.speedo = scene.add.graphics().setDepth(10).setVisible(false)
    this.speedoText = scene.add
      .bitmapText(SPEEDO_RIGHT - 9, SPEEDO_BOTTOM - 8, 'pixel-dan', '')
      .setTintFill(0xffffff)
      .setFontSize(5)
      .setOrigin(1, 0)
      .setDepth(10)
      .setVisible(false)
  }

  // light one bar pixel per 5 mph of the current speed
  setSpeed(mph: number) {
    const filled = Math.min(SPEEDO_PIXELS, Math.floor(mph / MPH_PER_PIXEL))
    this.speedoText.setText(String(Math.round(mph))).setVisible(true)
    this.speedo.clear().setVisible(true)
    let start = 0
    SPEEDO_BARS.forEach((height, i) => {
      const x = SPEEDO_RIGHT - (SPEEDO_BARS.length - i) * 2 + 1
      const lit = Phaser.Math.Clamp(filled - start, 0, height)
      if (lit > 0) {
        this.speedo.fillStyle(0xffffff).fillRect(x, SPEEDO_BOTTOM - lit, 1, lit)
      }
      start += height
    })
  }

  // top-left cluster: current gear (yellow), live score (white, right
  // aligned to the RPM bar's edge), and the RPM bar filling 0..1
  setGearHud(gear: number, rpm: number, score: number) {
    this.gearDigit.setFrame(gear).setVisible(true)
    this.scoreHud.setText(String(score)).setVisible(true)
    this.rpmBg.setVisible(true)
    const fill = Math.round(RPM_BAR_W * Phaser.Math.Clamp(rpm, 0, 1))
    this.rpmFill.setVisible(fill > 0)
    if (fill > 0) this.rpmFill.setDisplaySize(fill, RPM_BAR_H)
  }

  // show the remaining seconds centred at the top of the screen
  setTimer(seconds: number) {
    const text = String(seconds)
    this.timerDigits.forEach((digit, i) => {
      const used = i < text.length
      digit.setVisible(used)
      if (used) {
        digit.setFrame(Number(text[i]))
        digit.x = 33 - text.length * 4 + i * 8 + 4
      }
    })
  }

  hideHud() {
    this.timerDigits.forEach((digit) => digit.setVisible(false))
    this.speedo.setVisible(false)
    this.speedoText.setVisible(false)
    this.gearDigit.setVisible(false)
    this.scoreHud.setVisible(false)
    this.rpmBg.setVisible(false)
    this.rpmFill.setVisible(false)
  }
}
