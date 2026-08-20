export const CAMERA_SHOTS = [
  // `fit` is how much room this key has to give when the viewport goes portrait.
  //
  // The rig answers a narrow screen by dollying the camera back along its own view
  // axis, which is right in the open and catastrophic indoors — and every key from
  // the doorway to the far wall of the vault is indoors. On a phone the descent key
  // rose from y 6.4 to y 16.6, ten metres straight up, because that shot looks down
  // the shaft and "back" along a downward axis is *up*: the camera came out level
  // with the optic and the frame blew out to a white wash. The waterline key went
  // from z -13.1 to z -4.2 and left the tower altogether, so the crossing — the one
  // transition the whole piece is built around — happened outside the building.
  //
  // 1 is open water and can give as much ground as it likes; 0 is a shot with walls
  // close enough that it must stay exactly where it was authored, and pays for the
  // narrow screen in field of view alone.
  //
  // Camera keys along the journey. `at` is the journey position each key sits on,
  // which lets the path carry waypoints that are not narrative beats. The six shot
  // states in scene/state.js are sampled separately and still land on 0 through 5.
  //
  // Two rules the earlier path broke. Depth only ever decreases until the archive:
  // the journey is a descent, and it used to leave the tower underwater, climb back
  // above the surface for the crossing, then sink again — a zigzag that fought the
  // copy, which labels that beat -08 m while the camera sat at +0.9. And the route
  // passes through openings: the tower is entered once, through its door, rather
  // than by dissolving through masonry wherever the spline happened to cross it.
  //
  // The third rule, added here: the vault is the thing worth looking at, so it gets
  // the scroll. The route used to reach the aisle at 3.9 and start climbing out at
  // 4.55 — about a screen and a half of the only room in the piece. Everything from
  // the doorway to the foot of the shaft is now tightened, the hall opens as the
  // "room below" card arrives, and the aisle is walked from 3.35 to 4.55 with the
  // section under it lengthened to match.

  // 0 — Signal, +18 m. Stand off far enough to hold the whole tower, aimed left of
  // it so the mass sits in the right third with weather and open sea beside it.
  { at: 0, position: [24, 14, 52], target: [-8, 6, -12], fov: 36, fit: 1 },

  // 1 — Exposure, +10 m, on the gantry looking up at the lantern.
  { at: 1, position: [15, 10.4, -12.3], target: [1, 12.4, -13], fov: 44, fit: .85 },

  // Along the gantry to the door, which sits at the deck's own level on the
  // seaward face, and through it.
  { at: 1.5, position: [9.8, 9.8, -12.7], target: [2.6, 9.9, -13], fov: 48, fit: .5 },
  { at: 1.78, position: [6.1, 9.6, -12.85], target: [1.4, 9.5, -13.02], fov: 52, fit: .2 },
  { at: 1.92, position: [2.7, 9.4, -12.95], target: [0, 5.5, -13.1], fov: 58, fit: 0 },

  // 2 — Descent, sea level approaching. Down the shaft axis so the rings read as
  // concentric circles and echo the lens cage above.
  { at: 2, position: [1.1, 6.4, -12.6], target: [0, -9, -13.3], fov: 62, fit: 0 },

  // Through the surface, which stands inside the shaft. This lands under the
  // waterline beat's own heading — "The crossing / −08 m" — rather than a screen
  // and a half after it.
  { at: 2.42, position: [1.5, .4, -12.15], target: [.5, -9.2, -13.4], fov: 58, fit: 0 },

  // Held out from the shaft axis and aimed steeply down. The copper spine stands
  // on that axis, and a camera a half metre from it that rotates its look through
  // horizontal spends the crossing staring at a column standing between the lens
  // and every lamp in the shaft. Off-axis it sits to one side of frame instead.
  { at: 2.57, position: [1.45, -3.6, -12.1], target: [.7, -12.4, -13.6], fov: 58, fit: 0 },

  // 3 — Waterline. Below the surface, looking back up through it: the rings
  // silhouetted against the lit water ceiling.
  { at: 2.72, position: [1.35, -6.4, -12.3], target: [-.2, 1.2, -13.5], fov: 58, fit: 0 },

  // The foot of the shaft, turning to face the mouth that opens into the hall.
  { at: 3, position: [.7, -11.9, -13.1], target: [0, -12.4, -19.5], fov: 54, fit: 0 },

  // Out of the mouth and into the aisle. From here to 4.55 the camera does one
  // thing only: travel the length of the vault.
  { at: 3.35, position: [0, -11.9, -20], target: [0, -12, -48], fov: 46, fit: .25 },

  // 4 — Archive, −24 m, halfway down the aisle with shelves running out both sides.
  { at: 4, position: [0, -11.6, -33], target: [0, -12, -62], fov: 44, fit: .35 },

  // The far end, where the shelves stop.
  { at: 4.55, position: [0, -11.1, -49], target: [1.6, -10.4, -68], fov: 44, fit: .35 },

  // The only ascent in the journey: turning back and rising out of the open top
  // of the hall.
  { at: 4.78, position: [5.4, -7.4, -54], target: [2, -2.5, -40], fov: 44, fit: .6 },

  // 5 — First light, +03 m. Surfaces and turns back toward the tower.
  { at: 5, position: [14, 4.5, -47], target: [1, 7, -14], fov: 40, fit: 1 }
];

// One colour for every light event above the water: the optic, the beam it
// throws, the moon behind the cloud, and the lightning. The reference this piece
// is being held against works because a single accent repeats at five scales and
// several brightnesses — moon, gate, foliage, falling leaves, a dot before a
// chapter number — so it reads as a palette rather than as an accident. Three
// different warm hues would read as three accidents. Everything here varies in
// intensity only; lightning reads as lightning because its core is bright enough
// to clip toward white through the tone curve while its falloff stays copper.
export const SIGNAL_ACCENT = 0xff6b3a;

// A stable seed keeps procedural geometry, texture studies and visual captures
// identical across reloads. 0x4e414449 spells "NADI" in ASCII.
export const SCENE_SEED = 0x4e414449;

export const QUALITY = {
  mobile: matchMedia('(max-width: 820px)').matches,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  // The post stack runs seven screen-sized passes. At 1.75 on a Retina display
  // that is upward of ten million pixels a frame through all seven, which was
  // enough to keep the adaptive scaler firing — and every time it fires it
  // reallocates six render targets, which is a visible hitch. Backing the cap off
  // to 1.35 cuts the pixel work by forty per cent and keeps the scaler idle, which
  // is worth far more than the supersampling it gives up.
  maxPixelRatio: matchMedia('(max-width: 820px)').matches ? 1.15 : 1.35,
  minRenderScale: .62
};
