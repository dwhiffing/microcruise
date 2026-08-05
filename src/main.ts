import { Game, Types } from 'phaser'
import { Boot as BootScene } from './scenes/Boot'
import { Game as GameScene } from './scenes/Game'

const config: Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 64,
  height: 64,
  parent: 'game-container',
  backgroundColor: '#000',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, GameScene],
}

const game = new Game(config)
// handy for debugging from the browser console
;(window as unknown as { game: Game }).game = game

export default game
