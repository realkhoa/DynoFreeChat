/**
 * @file mount.ts
 * @brief Contract every playable game module implements.
 * @details A game module owns its DOM and timers, but not its tab: the shared
 * {@link GameStage} mounts it into the generic game document, so adding a game
 * never touches the page shell. Modules are loaded lazily from
 * {@link GAME_FACTORIES} to keep the initial bundle small.
 */

import type { OnlineBridge } from "./online/bridge";

/** Extra context handed to a game when it mounts. */
export interface GameContext {
  /** Present when the game was opened from an online match. */
  online?: OnlineBridge;
}

/** One mounted game instance. */
export interface GameMount {
  /**
   * @brief Builds the game inside the host element.
   * @param host Empty container owned by the stage; the game may fill it.
   * @param context Optional mount context, e.g. an online bridge.
   */
  mount(host: HTMLElement, context?: GameContext): void;

  /**
   * @brief Releases timers, listeners and animation frames.
   */
  unmount(): void;
}

/** Factory for one game module, keyed by the registry id. */
export type GameFactory = () => GameMount;
