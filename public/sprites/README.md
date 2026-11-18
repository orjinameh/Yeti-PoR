# Drop your own character art here

Put a sprite sheet at `public/sprites/yeti.png` and the game uses it instead of the built-in vector yeti.
Nothing else needs to change. If the file is missing the vector yeti is used.

Format (see `lib/sprites.ts`, edit `SHEET` there if yours differs):
- One horizontal strip, every frame the same size (default 256 x 256), transparent background.
- Character faces right, feet touch the bottom edge, centred horizontally.
- Frames: 0-7 run cycle, 8 jump, 9 fire (arm raised), 10 hurt, 11 dead. Idle uses frame 0.
- `drawH` in `SHEET` sets the on-screen height (the world is 800 x 450).

Use artwork you own or are licensed to use.
