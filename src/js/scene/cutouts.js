import * as THREE from '../../../vendor/three.module.min.js';
import { SCENE_SEED } from '../config.js';
import { createRandom, randomRange, randomSigned } from './site-plan.js';

// Foreground occluders are drawn here rather than loaded as artwork. A
// photographic plate arrives with its own colour temperature and its own light
// direction, and no amount of tinting made the warm olive original sit inside a
// cold North Atlantic storm. Generating the alpha means the palette is ours, the
// silhouette is ours, and each beat can carry a different plant.

const SIZE = 512;

function createCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  return canvas;
}

function toTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// One tapered blade, drawn as a closed path between two curves so the tip comes
// to an actual point instead of a stroked cap.
function blade(context, options) {
  const { x, baseWidth, height, lean, bow, color, edge } = options;
  const tipX = x + lean;
  const tipY = SIZE - height;
  const controlX = x + lean * .35 + bow;
  const controlY = SIZE - height * .55;
  const half = baseWidth * .5;

  context.beginPath();
  context.moveTo(x - half, SIZE);
  context.quadraticCurveTo(controlX - half * .5, controlY, tipX, tipY);
  context.quadraticCurveTo(controlX + half * .5, controlY, x + half, SIZE);
  context.closePath();

  const gradient = context.createLinearGradient(0, SIZE, 0, tipY);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, edge);
  context.fillStyle = gradient;
  context.fill();
}


export function kelpCutout(seed) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  const random = createRandom(seed);

  for (let index = 0; index < 46; index += 1) {
    const depth = random();
    const x = random() * SIZE;
    const lean = randomSigned(random, SIZE * .3);
    const height = randomRange(random, SIZE * .45, SIZE * .95);
    const shade = Math.round(30 + depth * 34);
    blade(context, {
      x,
      baseWidth: randomRange(random, 16, 42) * (.6 + depth * .6),
      height,
      lean,
      bow: randomSigned(random, 60),
      color: `rgba(${shade - 6}, ${shade + 20}, ${shade + 14}, ${(.62 + depth * .38).toFixed(2)})`,
      edge: `rgba(${shade + 20}, ${shade + 46}, ${shade + 36}, ${(.24 + depth * .4).toFixed(2)})`
    });

    // Bladders ride up the strap and give the silhouette its kelp reading.
    const bladders = Math.floor(randomRange(random, 2, 6));
    for (let step = 0; step < bladders; step += 1) {
      const t = (step + 1) / (bladders + 1);
      const bx = x + lean * t * .8 + randomSigned(random, 7);
      const by = SIZE - height * t;
      context.beginPath();
      context.ellipse(bx, by, randomRange(random, 4, 9), randomRange(random, 7, 15), randomSigned(random, .5), 0, Math.PI * 2);
      context.fillStyle = `rgba(${shade + 16}, ${shade + 42}, ${shade + 30}, ${(.5 + depth * .35).toFixed(2)})`;
      context.fill();
    }
  }
  return toTexture(canvas);
}

// A near-black rock lip for the very front of frame: no interior detail, because
// its whole job is to occlude and to give the eye a foreground edge to sit behind.
export function rockEdgeCutout(seed) {
  const canvas = createCanvas();
  const context = canvas.getContext('2d');
  const random = createRandom(seed);

  context.beginPath();
  context.moveTo(0, SIZE);
  context.lineTo(0, SIZE * randomRange(random, .52, .68));
  let x = 0;
  while (x < SIZE) {
    const stepX = randomRange(random, SIZE * .06, SIZE * .17);
    const stepY = SIZE * randomRange(random, .42, .78);
    context.lineTo(Math.min(SIZE, x + stepX), stepY);
    x += stepX;
  }
  context.lineTo(SIZE, SIZE);
  context.closePath();

  const gradient = context.createLinearGradient(0, SIZE * .5, 0, SIZE);
  gradient.addColorStop(0, 'rgba(26, 36, 38, .96)');
  gradient.addColorStop(1, 'rgba(9, 15, 17, 1)');
  context.fillStyle = gradient;
  context.fill();
  return toTexture(canvas);
}

export function createCutouts() {
  return {
    kelp: kelpCutout(SCENE_SEED + 409),
    rockEdge: rockEdgeCutout(SCENE_SEED + 419)
  };
}
