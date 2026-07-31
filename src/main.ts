import { Game as GameScene } from './scenes/Game'
import { Boot as BootScene } from './scenes/Boot'
import { Game, Types } from 'phaser'

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
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [BootScene, GameScene],
}

export default new Game(config)
