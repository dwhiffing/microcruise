import { GameObjects, Scene } from 'phaser'

// speedometer bar heights, left to right. Each pixel is 5 mph, so the 43
// pixels span 0-215 mph; bars light bottom-up as speed climbs
const SPEEDO_BARS = [2, 2, 2, 2, 2, 2, 3, 5, 7, 8, 8]
const MPH_PER_PIXEL = 5
const SPEEDO_PIXELS = 43 // sum of SPEEDO_BARS
const SPEEDO_RIGHT = 63 // right edge of the last bar
const SPEEDO_BOTTOM = 9 // row just below the bars

type HudElement = Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Alpha &
  Phaser.GameObjects.Components.Visible

// top-left cluster: gear digit + score above an RPM bar
const RPM_BAR_X = 2
const RPM_BAR_Y = 7
const RPM_BAR_W = 22
const RPM_BAR_H = 2
const HUD_YELLOW = 0xf0cc69

export class UI {
  public titleText!: GameObjects.Sprite
  public scoreText!: GameObjects.BitmapText
  public title!: GameObjects.Sprite
  private timerDigits: GameObjects.Sprite[]
  private timerShadows: GameObjects.Sprite[]
  private speedo: GameObjects.Graphics
  private speedoBg: GameObjects.Graphics
  private speedoText: GameObjects.BitmapText
  private gearDigit: GameObjects.Sprite
  private scoreHud: GameObjects.BitmapText
  private rpmBg: GameObjects.Rectangle
  private rpmFill: GameObjects.Rectangle
  private rpmTween?: Phaser.Tweens.Tween
  private rpmTarget = -1 // px width the fill is currently tweening toward
  private countdownDigit: GameObjects.Sprite
  private countdownShadow: GameObjects.Sprite
  private gearManual: GameObjects.Sprite
  private gearAuto: GameObjects.Sprite
  private gearFlashTimer?: Phaser.Time.TimerEvent
  private lastTimer = -1 // last value setTimer displayed
  private zeroShownAt = 0 // when the clock hit 0 (ms timestamp)
  private timerFade?: Phaser.Tweens.Tween
  // every HUD element with its designed resting alpha, for the fade-in
  private hud: { obj: HudElement; alpha: number }[] = []
  private scene: Scene

  constructor(scene: Scene) {
    this.scene = scene
    scene.anims.create({
      key: 'title-reveal',
      frames: scene.anims.generateFrameNumbers('title-anim', {
        end: 78,
      }),
      frameRate: 28,
    })
    this.title = scene.add.sprite(32, 16, 'title-anim', 0).setDepth(10)

    // start-prompt button, alternating its frames once per second
    scene.anims.create({
      key: 'button-blink',
      frames: scene.anims.generateFrameNumbers('button'),
      frameRate: 1,
      repeat: -1,
    })
    this.titleText = scene.add
      .sprite(32, 61, 'button', 0)
      .setOrigin(0.5, 1)
      .setDepth(10)

    this.scoreText = scene.add
      .bitmapText(32, 42, 'pixel-dan', '')
      .setCenterAlign()
      .setTintFill(0xffffff)
      .setFontSize(5)
      .setOrigin(0.5, 0.5)
      .setDepth(10)
    this.playTitleAnimation()

    // countdown clock digits ('score' spritesheet: frame = digit), hidden
    // until a run starts. The shadows sit under the digits (created
    // first, same depth) and only show with the enlarged final-seconds
    // clock
    this.timerShadows = [0, 1].map(() =>
      scene.add
        .sprite(0, 0, 'score', 0)
        .setOrigin(0.5, 0)
        .setTintFill(0x000000)
        .setDepth(10)
        .setVisible(false),
    )
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
      .setAlpha(0.8)
      .setVisible(false)
    this.scoreHud = scene.add
      .bitmapText(RPM_BAR_X + RPM_BAR_W + 1, 1, 'pixel-dan', '')
      .setTintFill(0xffffff)
      .setFontSize(5)
      .setOrigin(1, 0)
      .setDepth(10)
      .setAlpha(0.6)
      .setVisible(false)
    this.rpmBg = scene.add
      .rectangle(RPM_BAR_X, RPM_BAR_Y, RPM_BAR_W, RPM_BAR_H, 0xffffff)
      .setOrigin(0, 0)
      .setDepth(10)
      .setAlpha(0.2)
      .setVisible(false)
    this.rpmFill = scene.add
      .rectangle(RPM_BAR_X, RPM_BAR_Y, 1, RPM_BAR_H, HUD_YELLOW)
      .setOrigin(0, 0)
      .setDepth(10)
      .setAlpha(0.8)
      .setVisible(false)

    // transmission picker ('gearing' sheet: 0/1 = manual off/on, 2/3 =
    // automatic off/on), stacked to fill the screen; shown between the
    // title and the run start
    this.gearManual = scene.add
      .sprite(32, 22, 'gearing', 0)
      .setDepth(10)
      .setVisible(false)
    this.gearAuto = scene.add
      .sprite(32, 42, 'gearing', 2)
      .setDepth(10)
      .setVisible(false)

    // 3-2-1 countdown: a big centred score-font digit over a black drop
    // shadow (same sprite cloned and offset)
    this.countdownShadow = scene.add
      .sprite(34, 34, 'score', 3)
      .setScale(3)
      .setTintFill(0x000000)
      .setDepth(10)
      .setVisible(false)
    this.countdownDigit = scene.add
      .sprite(32, 32, 'score', 3)
      .setScale(3)
      .setDepth(10)
      .setVisible(false)

    // static fully-lit gauge as a faint backdrop; the live fill draws on
    // top of it
    this.speedoBg = scene.add
      .graphics()
      .setDepth(10)
      .setAlpha(0.2)
      .setVisible(false)
    this.speedoBg.fillStyle(0xffffff)
    SPEEDO_BARS.forEach((height, i) => {
      const x = SPEEDO_RIGHT - (SPEEDO_BARS.length - i) * 2 + 1
      this.speedoBg.fillRect(x, SPEEDO_BOTTOM - height, 1, height)
    })

    this.speedo = scene.add
      .graphics()
      .setDepth(10)
      .setAlpha(0.6)
      .setVisible(false)
    this.speedoText = scene.add
      .bitmapText(SPEEDO_RIGHT - 9, SPEEDO_BOTTOM - 8, 'pixel-dan', '')
      .setTintFill(0xffffff)
      .setFontSize(5)
      .setOrigin(1, 0)
      .setDepth(10)
      .setAlpha(0.6)
      .setVisible(false)

    // remember each element's designed alpha so the HUD fade-in can
    // restore them individually
    this.hud = [
      ...this.timerDigits,
      this.speedo,
      this.speedoBg,
      this.speedoText,
      this.gearDigit,
      this.scoreHud,
      this.rpmBg,
      this.rpmFill,
    ].map((obj) => ({ obj: obj as HudElement, alpha: obj.alpha }))
  }

  // fade the whole HUD in together, each element toward its own resting
  // alpha — timed to run while the car drives in
  showHud(duration = 700) {
    this.hud.forEach(({ obj, alpha }) => {
      obj.setVisible(true)
      obj.setAlpha(0)
      this.scene.tweens.add({ targets: obj, alpha, duration })
    })
  }

  // light one bar pixel per 5 mph of the current speed
  setSpeed(mph: number) {
    const filled = Math.min(SPEEDO_PIXELS, Math.floor(mph / MPH_PER_PIXEL))
    this.speedoText.setText(String(Math.round(mph))).setVisible(true)
    this.speedoBg.setVisible(true)
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
    this.rpmFill.setVisible(true)
    // the fill never snaps: it tweens toward the new width with a little
    // overshoot, re-targeted only when the rounded width actually changes
    const fill = Math.round(RPM_BAR_W * Phaser.Math.Clamp(rpm, 0, 1))
    if (fill !== this.rpmTarget) {
      this.rpmTarget = fill
      this.rpmTween?.stop()
      this.rpmTween = this.scene.tweens.add({
        targets: this.rpmFill,
        displayWidth: fill,
        duration: 200,
        ease: 'Back.easeOut',
      })
    }
  }

  // show the remaining seconds centred at the top of the screen; the
  // final seconds jump to the middle of the screen at triple size, going
  // red for the last few ticks. A 0 holds for a second, then fades out
  setTimer(seconds: number) {
    if (seconds === this.lastTimer) return
    if (seconds === 0) {
      // the 0 stays up while the car coasts to its stop — hideHud()
      // starts the fade once the run actually ends
      this.zeroShownAt = this.scene.time.now
    } else if (this.lastTimer === 0) {
      // refilled off zero (checkpoint rescue): cancel the pending fade
      this.timerFade?.stop()
      this.timerFade = undefined
      this.timerDigits.forEach((digit) => digit.setAlpha(1))
      this.timerShadows.forEach((shadow) => shadow.setAlpha(1))
    }
    this.lastTimer = seconds

    const text = String(seconds)
    const urgent = seconds < 6
    const scale = urgent ? 2 : 1
    this.timerDigits.forEach((digit, i) => {
      const used = i < text.length
      const shadow = this.timerShadows[i]
      digit.setVisible(used)
      // the drop shadow only backs the enlarged clock
      shadow.setVisible(used && urgent)
      if (used) {
        digit.setFrame(Number(text[i]))
        digit.setScale(scale)
        digit.x = 33 + (i * 8 + 4 - text.length * 4) * scale
        // top-centre origin: the enlarged digits grow downward in place
        digit.y = 0
        if (seconds < 4) digit.setTintFill(0xff3b3b)
        else digit.clearTint()
        if (urgent) {
          shadow
            .setFrame(Number(text[i]))
            .setScale(scale)
            .setPosition(digit.x + scale - 1, digit.y + scale - 1)
        }
      }
    })
  }

  // a checkpoint's time bonus shoots down out of the clock and fades
  showTimeBonus(bonus: number) {
    const label = this.scene.add
      .bitmapText(33, 8, 'pixel-dan', `+${bonus}`)
      .setOrigin(0.5, 0)
      .setTintFill(0xffffff)
      .setFontSize(5)
      .setDepth(10)
    this.scene.tweens.add({
      targets: label,
      y: label.y + 2,
      duration: 300,
      ease: 'Sine.easeOut',
    })
    this.scene.tweens.add({
      targets: label,
      alpha: 0,
      delay: 500,
      duration: 400,
      onComplete: () => label.destroy(),
    })
  }

  // big 3-2-1-0 in the centre of the screen, one second per digit; the
  // run starts (callback) as the 0 lands, and the 0 fades away over it
  countdown(onComplete: () => void) {
    let value = 3
    const show = (digit: number) => {
      this.countdownDigit.setFrame(digit).setVisible(true).setAlpha(1)
      this.countdownShadow.setFrame(digit).setVisible(true).setAlpha(1)
    }
    show(value)
    this.scene.time.addEvent({
      delay: 1000,
      repeat: 2,
      callback: () => {
        value--
        show(value)
        if (value === 0) {
          onComplete()
          this.scene.tweens.add({
            targets: [this.countdownDigit, this.countdownShadow],
            alpha: 0,
            duration: 600,
            onComplete: () => {
              this.countdownDigit.setVisible(false)
              this.countdownShadow.setVisible(false)
            },
          })
        }
      },
    })
  }

  // the transmission picker: the title fades away (alpha only, so the
  // next playTitleAnimation restores it) and the two options fade in
  // over it
  showGearMenu(auto: boolean) {
    this.cancelMenu()
    this.scene.tweens.add({
      targets: [this.title, this.titleText, this.scoreText],
      alpha: 0,
      duration: 300,
    })
    this.setGearMenu(auto)
    this.gearManual.setVisible(true).setAlpha(0)
    this.gearAuto.setVisible(true).setAlpha(0)
    this.scene.tweens.add({
      targets: [this.gearManual, this.gearAuto],
      alpha: 1,
      duration: 300,
      delay: 150,
    })
  }

  // highlight the selected option
  setGearMenu(auto: boolean) {
    this.gearManual.setFrame(auto ? 0 : 1)
    this.gearAuto.setFrame(auto ? 3 : 2)
  }

  // the moment a choice is made: the pick jumps to its lit-up frame
  // (gearing 4 = manual lit, 5 = automatic lit) and the option that
  // wasn't picked drops away, ahead of the (possibly delayed) flash
  dismissGearChoice(auto: boolean) {
    const target = auto ? this.gearAuto : this.gearManual
    const other = auto ? this.gearManual : this.gearAuto
    target.setFrame(auto ? 5 : 4)
    this.scene.tweens.killTweensOf(other)
    this.scene.tweens.add({
      targets: other,
      alpha: 0,
      duration: 300,
      onComplete: () => other.setVisible(false),
    })
  }

  // confirm feedback: the already-lit choice blinks between its lit
  // frame and its dedicated flash frame (gearing 6 = manual, 7 =
  // automatic) a fixed number of times, paced to fill the given window
  // — it ends lit
  flashGearChoice(auto: boolean, flashes: number, duration: number) {
    const target = auto ? this.gearAuto : this.gearManual
    const litFrame = auto ? 5 : 4
    const flashFrame = auto ? 7 : 6
    this.gearFlashTimer?.remove()
    target.setFrame(litFrame)
    let lit = true
    this.gearFlashTimer = this.scene.time.addEvent({
      delay: duration / (flashes * 2),
      repeat: flashes * 2 - 1,
      callback: () => {
        lit = !lit
        target.setFrame(lit ? litFrame : flashFrame)
      },
    })
  }

  // confirmed: the picker fades back out as the run approach begins
  hideGearMenu() {
    this.scene.tweens.killTweensOf([this.gearManual, this.gearAuto])
    this.scene.tweens.add({
      targets: [this.gearManual, this.gearAuto],
      alpha: 0,
      duration: 300,
      onComplete: () => {
        this.gearManual.setVisible(false)
        this.gearAuto.setVisible(false)
      },
    })
  }

  // a run is starting: stop the title reveal, drop its pending fade-in
  // callback, and kill any in-flight menu tweens so nothing pops back in
  // mid-run
  cancelMenu() {
    this.title.off('animationcomplete-title-reveal')
    this.title.stop()
    this.scene.tweens.killTweensOf([this.title, this.titleText, this.scoreText])
  }

  // the start button and high score stay hidden until the title reveal
  // ends, then fade in on their own
  playTitleAnimation() {
    this.titleText.setAlpha(0)
    this.scoreText.setAlpha(0)
    this.title.play('title-reveal')
    this.title.once('animationcomplete-title-reveal', () => {
      this.titleText.play('button-blink')
      this.scene.tweens.add({
        targets: [this.titleText, this.scoreText],
        alpha: 1,
        duration: 400,
      })
    })
  }

  hideHud() {
    // a 0 on the clock owns its own exit: it lingers until the car has
    // stopped (which is when this runs), holds at least a second total
    // on screen, then fades
    if (this.lastTimer === 0 && !this.timerFade) {
      const held = this.scene.time.now - this.zeroShownAt
      this.timerFade = this.scene.tweens.add({
        targets: [...this.timerDigits, ...this.timerShadows],
        alpha: 0,
        delay: Math.max(0, 1000 - held),
        duration: 400,
        onComplete: () => {
          this.timerFade = undefined
          this.timerDigits.forEach((digit) => digit.setVisible(false))
          this.timerShadows.forEach((shadow) => shadow.setVisible(false))
        },
      })
    } else if (!this.timerFade) {
      this.timerDigits.forEach((digit) => digit.setVisible(false))
      this.timerShadows.forEach((shadow) => shadow.setVisible(false))
    }
    this.speedo.setVisible(false)
    this.speedoBg.setVisible(false)
    this.speedoText.setVisible(false)
    this.gearDigit.setVisible(false)
    this.scoreHud.setVisible(false)
    this.rpmBg.setVisible(false)
    this.rpmFill.setVisible(false)
  }
}
