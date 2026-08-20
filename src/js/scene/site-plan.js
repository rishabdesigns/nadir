import { SCENE_SEED } from '../config.js';

export const SITE = Object.freeze({
  waterY: 0,
  tower: Object.freeze({ x: 0, z: -13, width: 9, depth: 9, baseY: -16, topY: 17.8 }),
  // The lens now sits on the tower axis inside the lantern room, not projecting
  // from the seaward face. Lighting reads this as the signal emitter position.
  lens: Object.freeze({ x: 0, y: 14.6, z: -13, radius: 2.15 }),
  // The gantry used to stop dead at x 23, which projects to about 0.92 of half
  // frame width on the hero shot — just inside the right edge on 16:10, further
  // inside on wider displays. So the walkway ran out of frame's way and simply
  // ended, unsupported, over open water: a ramp hanging in mid air. A structure
  // this size has to either land on something or leave the picture, and leaving
  // the picture is the cheaper and truer of the two. Carried out to 40 it exits
  // past the right edge at every aspect down to 21:9, and it is far enough out
  // that the scene fog takes the end of it before the frame does — so it reads as
  // continuing into the weather rather than as being cut off by the camera.
  gantry: Object.freeze({ y: 8.2, startX: -3, endX: 40, z: -12.2 }),
  shaft: Object.freeze({ x: 0, z: -13, radius: 3.25, topY: 9.2, bottomY: -15.2 })
});

export function createRandom(seed = SCENE_SEED) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

export function randomRange(random, min, max) {
  return min + random() * (max - min);
}

export function randomSigned(random, amount = 1) {
  return (random() * 2 - 1) * amount;
}

export function hash3(x, y, z, seed = SCENE_SEED) {
  let value = seed ^ Math.imul((x * 1009) | 0, 0x45d9f3b);
  value ^= Math.imul((y * 9176) | 0, 0x27d4eb2d);
  value ^= Math.imul((z * 6113) | 0, 0x165667b1);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}
