# Game Assets (T033)

Top-down pixel-art assets for the Lise Dev Idle Game office scene.
Generated programmatically as MVP-quality placeholders. Phaser 4 loads
these via the `public/` static path (served at `/assets/`).

## Files

### `office_tileset.png`
- **Dimensions**: 128×64 px (RGB)
- **Layout**: 4 columns × 2 rows = **8 tiles**, each **32×32 px**
- **Tiles** (0-indexed left-to-right, top-to-bottom):
  | Idx | Color        | Use                     |
  |-----|--------------|-------------------------|
  | 0   | Grey carpet  | Floor                   |
  | 1   | Dark brown   | Wall border             |
  | 2   | Wood brown   | Desk                    |
  | 3   | Dark grey    | Shadow / dark floor     |
  | 4   | Light wood   | Accent flooring         |
  | 5   | Chair grey   | Chair                   |
  | 6   | White        | Whiteboard              |
  | 7   | Black        | Void                    |

### `office.json`
- **Format**: Tiled 1.10+ JSON map export (`tilemapTiledJSON`)
- **Map size**: 20×15 tiles (640×480 px at 32px tiles)
- **Tile size**: 32×32 px
- **Orientation**: orthogonal, render order right-down
- **Layers**:
  - `Ground` — floor + wall border (tilelayer)
  - `Furniture` — desks, chairs, whiteboard, accents (tilelayer)
- **Tileset**: references `office_tileset.png` (relative path), firstgid 1, 8 tiles, 4 columns

### `dev.png`
- **Dimensions**: 128×32 px (RGBA, transparent background)
- **Layout**: **4 frames** horizontally, each **32×32 px**
- **Frames**: idle animation (subtle vertical bob: frame 0 neutral, 1 up, 2 neutral, 3 down)

## Phaser 4 Load Keys & Snippet

T034 (`OfficeScene`) should load assets in `preload()` using these exact keys:

```typescript
preload(): void {
  // Tileset image
  this.load.image('office-tileset', 'assets/office_tileset.png');
  // Tiled JSON map
  this.load.tilemapTiledJSON('office-map', 'assets/office.json');
  // Dev character spritesheet (4 frames, 32x32 each)
  this.load.spritesheet('dev', 'assets/dev.png', { frameWidth: 32, frameHeight: 32 });
}
```

| Key              | Asset file           | Phaser loader              |
|------------------|----------------------|----------------------------|
| `office-tileset` | `office_tileset.png` | `this.load.image(...)`     |
| `office-map`     | `office.json`        | `this.load.tilemapTiledJSON(...)` |
| `dev`            | `dev.png`            | `this.load.spritesheet(...)` |

### Creating the dev idle animation (T034 reference)

```typescript
create(): void {
  const map = this.make.tilemap({ key: 'office-map' });
  const tileset = map.addTilesetImage('office-tileset', 'office-tileset');
  map.createLayer('Ground', tileset!, 0, 0);
  map.createLayer('Furniture', tileset!, 0, 0);

  this.anims.create({
    key: 'dev-idle',
    frames: this.anims.generateFrameNumbers('dev', { start: 0, end: 3 }),
    frameRate: 4,
    repeat: -1,
  });

  const dev = this.add.sprite(160, 256, 'dev');
  dev.play('dev-idle');
}
```
