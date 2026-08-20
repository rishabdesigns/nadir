import * as THREE from '../../../vendor/three.module.min.js';
import { clamp, lerp } from '../core/math.js';

export const SHOT_STATES = Object.freeze([
  {
    id: 'signal', fog: [0x33454a, .0104],
    light: [.34, 2.9, .85, 38, 0], ocean: [.97, 0, .72, 0],
    air: [.9, .52, .58, 0, 0, .02], grade: [.86, .83, .72, 0, .42, .075],
    visible: [1, .04, 0, .1, 0]
  },
  {
    id: 'exposure', fog: [0x304248, .0128],
    light: [.3, 2.55, 1.05, 46, 0], ocean: [.96, 0, .8, 0],
    air: [1, .7, .64, 0, 0, .03], grade: [.82, .78, .84, .02, .46, .08],
    visible: [1, .08, 0, .08, .12]
  },
  {
    id: 'descent', fog: [0x0c2026, .021],
    light: [.24, 1.8, 1.18, 32, 2], ocean: [.8, .08, .64, .08],
    air: [.72, .52, .72, .12, .04, .08], grade: [.78, .72, .78, -.03, .76, .085],
    visible: [.82, .35, .08, .04, 1]
  },
  {
    // The camera reaches the foot of the shaft at this beat now rather than
    // hanging a few metres under the surface, so the water above it is twelve
    // metres deep instead of six and the state follows: rain and spray are all
    // but gone, silt and bubbles are up, and the vault is most of what is lit.
    id: 'waterline', fog: [0x06262c, .0305],
    light: [.18, .92, .94, 14, 21], ocean: [.54, .74, .42, .8],
    air: [.2, .13, .58, .77, .4, .52], grade: [.75, .68, .74, -.09, .8, .088],
    // Kelp thinned: at .58 the near planes filled the lower third of the crossing
    // and buried the surface the beat is about.
    visible: [.44, .86, .24, .015, .14]
  },
  {
    id: 'archive', fog: [0x052c33, .035],
    light: [.14, .46, .7, 5, 31], ocean: [.18, 1, .12, 1],
    air: [0, 0, .28, .92, .64, 1], grade: [.72, .74, .94, -.12, .82, .085],
    // Kelp belongs to the crossing, not to a sealed stone vault at −24 m.
    visible: [.14, 1, .12, 0, 0]
  },
  {
    // Dawn was lit with more ambient than anything else in the journey, which
    // filled every shadow on the tower and left it a flat grey mass in front of a
    // bright sky — no form, no edge, and nothing serene about it. Ambient comes
    // down and the rim comes up instead: the tower reads as a dark silhouette
    // with the morning caught along its seaward edge, which is what the beat is.
    // The beat is calm after a storm, and it was reading as murk after a storm: a
    // heavier vignette than any other state, a warm-grey fog, and rain still
    // falling. Vignette and grain come down, the fog lifts to a pale morning blue,
    // exposure comes up, and the rain stops — the mist stays, because air that has
    // just been full of water does not clear all at once.
    // Fog colour is what every distant surface converges on, so it sets the value
    // of the sea, the coast and the bottom of the sky all at once. It was
    // 0x9fb0b3, a mid blue-grey, which is why the whole background sat at one
    // desaturated slate while the copy over it called this first light. Warming it
    // was necessary but not sufficient: at 0xdba077 the frame simply became a
    // bright warm wash instead of a bright grey one, because the *value* had not
    // moved. This is a deep amber — warm enough to be dawn, dark enough that the
    // sky can be the brightest thing in the shot rather than one bright thing
    // among several. Density comes down with it so the wash stops at the horizon
    // instead of closing over the reef.
    // Density down with the hue change. A warm fog at storm density does not read
    // as morning air, it reads as a dust storm: at .0072 the haze was closing over
    // the reef and the near water inside forty metres and painting both the same
    // peach as the horizon, so the sea lost its own colour and the frame lost the
    // cool half of its contrast. Thinner air lets the near field keep its green
    // and holds the warmth where it belongs, out at the horizon. Mist eases back
    // for the same reason.
    // Every light in the frame comes down, and this is the change that matters
    // most. What makes the reference beautiful is not its hue, it is its *range*:
    // the land and the sea are nearly black and the sky is blazing, and the whole
    // picture is carried by that gap. This beat had no gap — sky, rock and water
    // all measured between roughly 60 and 85 per cent, so no amount of colour
    // correction could make it read as anything but a wash. Warming a flat frame
    // only ever produces a warm flat frame. The sky is now the only bright thing
    // in the shot and everything under it is allowed to fall toward silhouette.
    id: 'first-light', fog: [0x9c6540, .0042],
    light: [.11, .72, .95, 2.4, 0], ocean: [.94, 0, .3, 0],
    air: [0, .02, .28, 0, 0, .02], grade: [.95, 1.12, .44, .2, .22, .028],
    visible: [1, .08, 0, 1, 0]
  }
]);

const sampled = {
  id: 'signal', local: 0,
  fog: { color: new THREE.Color(), density: 0 },
  light: { ambient: 0, key: 0, rim: 0, signal: 0, vault: 0 },
  ocean: { opacity: 0, underwater: 0, foam: 0, caustics: 0 },
  air: { rain: 0, spray: 0, mist: 0, silt: 0, bubbles: 0, biolume: 0 },
  grade: { exposure: 0, saturation: 0, bloom: 0, warmth: 0, vignette: 0, grain: 0 },
  visible: { exterior: 0, archive: 0, kelp: 0, dawn: 0, interior: 0 }
};

const colorA = new THREE.Color();
const colorB = new THREE.Color();

function mixTuple(target, keys, from, to, amount) {
  keys.forEach((key, index) => { target[key] = lerp(from[index], to[index], amount); });
}

// How far into a segment the crossfade is allowed to start. Every segment but the
// last carries the whole of its distance, because the camera is moving the whole
// time. The last one does not: the camera walks the aisle from 4.0 to 4.55 and only
// then turns and climbs, so a fade spread evenly across 4 to 5 had the water
// draining away and dawn arriving while the viewer was still twelve metres down
// inside the vault.
const SEGMENT_HOLD = [0, 0, 0, 0, .58];

export function sampleShotState(progress) {
  const last = SHOT_STATES.length - 1;
  const safe = clamp(progress, 0, last);
  const index = Math.min(last - 1, Math.floor(safe));
  const hold = SEGMENT_HOLD[index];
  const local = clamp((safe - index - hold) / (1 - hold));
  const eased = local * local * (3 - 2 * local);
  const from = SHOT_STATES[index];
  const to = SHOT_STATES[index + 1];

  sampled.id = eased < .5 ? from.id : to.id;
  sampled.local = eased;
  colorA.setHex(from.fog[0]);
  colorB.setHex(to.fog[0]);
  sampled.fog.color.copy(colorA).lerp(colorB, eased);
  sampled.fog.density = lerp(from.fog[1], to.fog[1], eased);
  mixTuple(sampled.light, ['ambient', 'key', 'rim', 'signal', 'vault'], from.light, to.light, eased);
  mixTuple(sampled.ocean, ['opacity', 'underwater', 'foam', 'caustics'], from.ocean, to.ocean, eased);
  mixTuple(sampled.air, ['rain', 'spray', 'mist', 'silt', 'bubbles', 'biolume'], from.air, to.air, eased);
  mixTuple(sampled.grade, ['exposure', 'saturation', 'bloom', 'warmth', 'vignette', 'grain'], from.grade, to.grade, eased);
  mixTuple(sampled.visible, ['exterior', 'archive', 'kelp', 'dawn', 'interior'], from.visible, to.visible, eased);
  return sampled;
}
