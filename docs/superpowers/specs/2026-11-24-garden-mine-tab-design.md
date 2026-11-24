# ASCII Garden Mine Tab & Automated Staff Mining System

- **Date**: 2026-11-24
- **Status**: Draft (Awaiting user review)
- **Scope**:
  - `shared/src/garden.ts`: Mine state, floor generation, rock cells, pickaxe levels, smelter machine, new products/ores, staff miner role.
  - `worker/src/garden-rules.ts`: Mine hit/descend/elevator actions, pickaxe upgrades, staff miner automation.
  - `worker/src/staff.ts`: Staff miner task runner.
  - `web/src/features/games/garden/game.ts`: Mine tab UI, floor grid, dedicated staff miner slot, elevator picker.
  - `web/src/features/games/garden/ascii.ts`: Mine cell rendering & glyphs.
  - `web/src/shared/i18n/dictionary.ts`: Bilingual strings for ores, bars, floors, and pickaxe tiers.

---

## 1. Executive Summary & Goals

The user requested adding a **Mine tab (`mine`)** to ASCII Garden for ore mining, with support for **assigning staff to mine automatically** ("có ô để gắn nhân sự đi mine nha").

### Core Objectives:
1. **Explore Deep Mines (Floors 1 – 100+)**:
   - Each floor features an ASCII grid (5x5 = 25 cells) filled with stone, gravel, ores, gems, and treasure chests.
   - Breaking rocks uncovers resources and has a chance to reveal the **ladder downward (`[ v ]`)**.
   - Checkpoint elevators every 5 or 10 floors allow fast-traveling back to reached depths.
2. **Dedicated Staff Miner Slot**:
   - The Mine tab provides a tactile, dedicated **Staff Miner Cell (`[ Miner Slot ]`)** right in the UI.
   - Clicking this cell opens the staff assignment popover to assign a worker to the `mine` role.
   - Once assigned, the worker automatically chips rocks and descends ladders on each work interval (`staffWorkIntervalMs`).
3. **Smelter in Warehouse**:
   - Introduces the **Smelter (`smelter`)** artisan machine to the Warehouse tab, smelting raw ores (copper, iron, gold, iridium) + coal into metal bars with queue support.
4. **Progression & Upgrades**:
   - Metal bars upgrade the player's Pickaxe (Rusty $\to$ Copper $\to$ Iron $\to$ Gold $\to$ Iridium), increasing mining damage and allowing deeper exploration.
   - All ores, bars, and gems are recorded into the Codex / Dynopedia with coin discovery rewards.

---

## 2. Detailed Gameplay Mechanics

### 2.1 Mine Floors & Depths
- **Floor Generation**:
  - Floors are deterministically seeded per player, depth, and descent count using `createRng(hash32(...))`.
  - Depths dictate available minerals:
    - **Floors 1 – 15**: Stone, gravel, coal, copper ore.
    - **Floors 16 – 35**: Iron ore, amethyst, quartz.
    - **Floors 36 – 65**: Gold ore, ruby, emerald.
    - **Floors 66+**: Iridium ore, diamond, prismatic shards.
- **Rock Cell Types**:
  - `stone` (`#`): 1-2 HP. Drops `stone`.
  - `gravel` (`.`): 1 HP. Drops `stone` or `coal`.
  - `copper` (`c`): 2 HP. Drops `copperOre`.
  - `iron` (`i`): 3 HP. Drops `ironOre`.
  - `gold` (`g`): 4 HP. Drops `goldOre`.
  - `iridium` (`I`): 5 HP. Drops `iridiumOre`.
  - `gem` (`♦`): 3 HP. Drops random gems (`ruby`, `emerald`, `diamond`, etc.).
  - `chest` (`?`): 1 HP. Opens a mystery reward (coins, rare tools, bulk ores).
  - `ladder` (`v`): Revealed when a rock is cleared. Clicking descends to `currentFloor + 1`.
  - `empty` (` `): Already cleared cell.
- **Elevators**:
  - Unlocked at Floors 5, 10, 15, 20, 25, 30, ... (every 5 floors).
  - Quick-jump selector at the top of the Mine tab allows immediate access to any reached elevator checkpoint.

### 2.2 Pickaxe Upgrades
- Levels:
  - **Level 0 (Rusty Pickaxe)**: 1 DMG/hit.
  - **Level 1 (Copper Pickaxe)**: 2 DMG/hit. Costs: 5 `copperBar` + 50,000c.
  - **Level 2 (Iron Pickaxe)**: 3 DMG/hit. Costs: 5 `ironBar` + 250,000c.
  - **Level 3 (Gold Pickaxe)**: 4 DMG/hit. Costs: 5 `goldBar` + 1,000,000c.
  - **Level 4 (Iridium Pickaxe)**: 6 DMG/hit (instant break most rocks). Costs: 5 `iridiumBar` + 5,000,000c.

### 2.3 Stamina & Energy System
- Players have a stamina pool (e.g. 100/100).
- Manual pickaxe strikes consume 2 stamina.
- Stamina regenerates slowly over time (+1 every 30s) or instantly by consuming farm produce (`mineEat`: eating fruits/vegetables or drinking juice restores stamina based on crop value).
- Staff miners do not consume player stamina (they work on their own salary/interval).

### 2.4 Dedicated Staff Miner Slot in Mine Tab
- A dedicated plot cell is prominently rendered in the Mine controls:
  - Unassigned: Shows `[ + Thợ mỏ ]` / `[ + Assign Miner ]` with tone `"money"`.
  - Assigned: Shows `[ Miner: WorkerName | Lv.X | Timer ]` with tone `"tool"`.
- Clicking the cell opens the staff picker popover to assign or switch workers to the `"mine"` role.
- **Worker Behavior in Mine**:
  - On each worker tick (`staffWorkIntervalMs`):
    1. If a ladder (`ladder`) exists on the floor, the worker automatically descends to `currentFloor + 1`.
    2. Otherwise, finds the highest-value rock/ore cell that is still intact and deals pickaxe damage.
    3. Mined resources are deposited directly into `state.bag.products`.

---

## 3. Warehouse Smelter Integration

- Machine ID: `smelter`.
- Recipes:
  - 5 `copperOre` + 1 `coal` $\to$ 1 `copperBar` (Time: 3 min).
  - 5 `ironOre` + 1 `coal` $\to$ 1 `ironBar` (Time: 5 min).
  - 5 `goldOre` + 1 `coal` $\to$ 1 `goldBar` (Time: 8 min).
  - 5 `iridiumOre` + 1 `coal` $\to$ 1 `iridiumBar` (Time: 15 min).
- Queuing: Enabled (`queued: true`).

---

## 4. State & Schema Specifications

### 4.1 Data Types in `@dyno/shared`
```typescript
export type MineRockKind =
  | "stone"
  | "gravel"
  | "copper"
  | "iron"
  | "gold"
  | "iridium"
  | "gem"
  | "chest"
  | "ladder"
  | "empty";

export interface MineRockCell {
  readonly kind: MineRockKind;
  readonly hp: number;
  readonly maxHp: number;
  readonly oreDrop?: ProductId;
}

export interface MineState {
  readonly currentFloor: number;
  readonly maxFloor: number;
  readonly pickaxeLevel: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly lastStaminaAt: number;
  readonly grid: readonly MineRockCell[];
  readonly assignedStaffSlot: number | null; // Dedicated miner slot
}
```

### 4.2 Actions (`GardenAction`)
- `{ kind: "mineHit", slot: number }`: Strikes a rock cell.
- `{ kind: "mineDescend" }`: Descends via discovered ladder.
- `{ kind: "mineElevator", targetFloor: number }`: Teleports via elevator.
- `{ kind: "upgradePickaxe" }`: Upgrades the pickaxe.
- `{ kind: "mineEat", item: ProductId }`: Eats produce to recover stamina.
- `{ kind: "assignMiner", staffSlot: number | null }`: Assigns or unassigns staff to the mine post.

---

## 5. Testing & Verification

1. **Shared Logic Tests (`shared/test/mine.spec.ts`)**:
   - Floor generation determinism and ore distribution by depth.
   - Ladder discovery odds and elevator unlock rules.
   - Pickaxe damage calculations and upgrade prerequisite checks.
2. **Worker Rules Tests (`worker/test/mine.spec.ts`)**:
   - Manual rock breaking, stamina consumption, and inventory drops.
   - Automatic worker mining and descending when ladder is discovered.
   - Smelter queue processing and bar creation.
3. **Web View Tests (`web/test/features/games/garden.spec.ts`)**:
   - Mine tab switching in reborn view (`gardenTab:mine`).
   - Dedicated miner slot opens staff picker popover.
   - Elevator buttons jump to checkpoint floors.

---

## 6. Implementation Stages
1. **Core Data & Rules**: Update `@dyno/shared` (products, smelter, mine types) and `@dyno/worker` (actions, rules, staff runner).
2. **UI & ASCII Grid**: Implement `buildMineReborn`, rock cell renderers, elevator bar, and dedicated miner slot in `@dyno/web`.
3. **Verification & Deployment**: Run full regression test suite, typecheck, format check, worker deploy, and GitHub Pages deployment.
