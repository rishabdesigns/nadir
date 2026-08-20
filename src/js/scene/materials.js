import * as THREE from '../../../vendor/three.module.min.js';
import { SCENE_SEED } from '../config.js';

// 192 was too coarse to survive being stretched over a 16 m rock face: the grain
// dissolved into mush and every surface read the same. Generation stays a
// one-off cost at construction.
const SIZE = 512;

function hash(x, y, seed) {
  let value = Math.imul(x ^ seed, 374761393) ^ Math.imul(y + seed, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}

function fade(value) {
  return value * value * (3 - 2 * value);
}

function noise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

function fbm(x, y, seed, streak = 1) {
  let value = 0;
  let amplitude = .56;
  let frequency = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    value += noise(x * frequency, y * frequency * streak, seed + octave * 131) * amplitude;
    frequency *= 2.07;
    amplitude *= .48;
  }
  return value;
}

function canvasTexture(canvas, color = false, repeat = [1, 1], anisotropy = 1) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = anisotropy;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSurface(spec, anisotropy) {
  const colorCanvas = document.createElement('canvas');
  const normalCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  colorCanvas.width = normalCanvas.width = roughCanvas.width = SIZE;
  colorCanvas.height = normalCanvas.height = roughCanvas.height = SIZE;
  const colorContext = colorCanvas.getContext('2d');
  const normalContext = normalCanvas.getContext('2d');
  const roughContext = roughCanvas.getContext('2d');
  const colorImage = colorContext.createImageData(SIZE, SIZE);
  const normalImage = normalContext.createImageData(SIZE, SIZE);
  const roughImage = roughContext.createImageData(SIZE, SIZE);
  const heights = new Float32Array(SIZE * SIZE);
  const seed = SCENE_SEED ^ spec.seed;
  const normal = new THREE.Vector3();

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const nx = x / SIZE * spec.scale;
      const ny = y / SIZE * spec.scale;
      let height = fbm(nx, ny, seed, spec.streak ?? 1);
      if (spec.ribs) height += Math.pow(.5 + .5 * Math.sin(nx * Math.PI * spec.ribs), 10) * .42;
      if (spec.pits) height -= Math.pow(Math.max(0, noise(nx * 3.2, ny * 3.2, seed + 71) - .68) / .32, 2) * spec.pits;
      heights[y * SIZE + x] = height;
    }
  }

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const index = y * SIZE + x;
      const offset = index * 4;
      const height = heights[index];
      const variation = (height - .48) * spec.contrast;
      const salt = Math.max(0, noise(x / 28, y / 31, seed + 919) - spec.saltThreshold) * (spec.salt ?? 0);
      for (let channel = 0; channel < 3; channel += 1) {
        colorImage.data[offset + channel] = THREE.MathUtils.clamp(spec.base[channel] + variation + salt, 0, 255);
      }
      colorImage.data[offset + 3] = 255;

      const left = heights[y * SIZE + (x + SIZE - 1) % SIZE];
      const right = heights[y * SIZE + (x + 1) % SIZE];
      const up = heights[((y + SIZE - 1) % SIZE) * SIZE + x];
      const down = heights[((y + 1) % SIZE) * SIZE + x];
      const strength = spec.normalStrength ?? 2.2;
      normal.set((left - right) * strength, (up - down) * strength, 1).normalize();
      normalImage.data[offset] = (normal.x * .5 + .5) * 255;
      normalImage.data[offset + 1] = (normal.y * .5 + .5) * 255;
      normalImage.data[offset + 2] = normal.z * 255;
      normalImage.data[offset + 3] = 255;

      const roughness = THREE.MathUtils.clamp(spec.roughness + (height - .5) * spec.roughVariation - salt * .001, 0, 1) * 255;
      roughImage.data[offset] = roughImage.data[offset + 1] = roughImage.data[offset + 2] = roughness;
      roughImage.data[offset + 3] = 255;
    }
  }

  colorContext.putImageData(colorImage, 0, 0);
  normalContext.putImageData(normalImage, 0, 0);
  roughContext.putImageData(roughImage, 0, 0);
  return {
    map: canvasTexture(colorCanvas, true, spec.repeat, anisotropy),
    normalMap: canvasTexture(normalCanvas, false, spec.repeat, anisotropy),
    roughnessMap: canvasTexture(roughCanvas, false, spec.repeat, anisotropy)
  };
}

// Everything standing in the sea carries a record of where the water reaches:
// saturated dark stone below the tide, a weed band worked by the waves, bleached
// salt above it, and staining where run-off has streaked down the face. Without
// it, stone reads the same at the waterline as it does forty feet up, which is
// the single clearest sign that a structure was placed rather than weathered.
const TIDE = {
  low: -2.6,
  high: 1.9,
  spray: 6.5
};

function applyTideLine(material, options = {}) {
  const strength = options.strength ?? 1;
  material.onBeforeCompile = shader => {
    shader.uniforms.uTideStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTideWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n\tvTideWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTideWorld;
        uniform float uTideStrength;

        // sin-free hash: this runs on every stone fragment in the frame, and the
        // four-sin version was costing more than the ambient occlusion pass.
        float tideHash(vec2 cell) {
          vec3 spread = fract(vec3(cell.xyx) * .1031);
          spread += dot(spread, spread.yzx + 33.33);
          return fract((spread.x + spread.y) * spread.z);
        }

        float tideNoise(vec2 point) {
          vec2 cell = floor(point);
          vec2 frac = fract(point);
          vec2 blend = frac * frac * (3.0 - 2.0 * frac);
          return mix(
            mix(tideHash(cell), tideHash(cell + vec2(1.0, 0.0)), blend.x),
            mix(tideHash(cell + vec2(0.0, 1.0)), tideHash(cell + vec2(1.0, 1.0)), blend.x),
            blend.y
          );
        }

        // Set while shading colour and reused for roughness, which runs later in
        // the standard fragment chain.
        float gTideWet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // The tide does not sit at one exact height: it is ragged, and it stains
          // upward in streaks where water has run back down the face.
          float ragged = (tideNoise(vTideWorld.xz * .6) - .5) * 1.5
                       + (tideNoise(vTideWorld.xz * 2.3) - .5) * .55;
          float level = vTideWorld.y - ragged;

          float submerged = 1.0 - smoothstep(${TIDE.low}, ${TIDE.high}, level);
          gTideWet = submerged;
          float weed = exp(-pow((level - ${TIDE.low} - 1.1) * 1.05, 2.0));
          float streak = tideNoise(vec2(vTideWorld.x * 3.4 + vTideWorld.z * 2.1, vTideWorld.y * .22));
          float saltZone = smoothstep(${TIDE.high}, ${TIDE.spray}, level);

          vec3 wet = diffuseColor.rgb * vec3(.4, .47, .5);
          diffuseColor.rgb = mix(diffuseColor.rgb, wet, submerged * .82 * uTideStrength);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.13, .17, .1), weed * .45 * uTideStrength);
          diffuseColor.rgb += vec3(.05, .055, .05) * saltZone * streak * uTideStrength;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // Wet stone is glossy, and that specular change carries most of the read.
        roughnessFactor = mix(roughnessFactor, roughnessFactor * .34, gTideWet * uTideStrength);`);
  };
  material.customProgramCacheKey = () => `tide-${strength}`;
  return material;
}

// Every metal in this world had nothing to reflect.
//
// MeshStandardMaterial scales its diffuse response by (1 - metalness), and the
// rest of the response is specular reflection of the environment. Copper is at
// .72 metalness here and dark copper at .6, and `scene.environment` was never set
// — so roughly two thirds of what those surfaces should return was multiplied by
// an environment that did not exist, and they rendered near black. Turning the
// point lights up to sixty did not touch it, because the missing term is not a
// direct-lighting term. The copper spine down the middle of the stairwell was the
// worst of it: a featureless black slab across half the frame for the whole
// descent, which read as the light cutting out on the way into the water.
//
// This is a small equirectangular gradient — sky above the horizon, water below —
// prefiltered into a cube map. It is not a captured environment and is not trying
// to be; it exists so that metal has a direction-dependent thing to return.
function buildEnvironment(renderer) {
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = height * 2;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#93a9ae');
  gradient.addColorStop(.44, '#75898e');
  gradient.addColorStop(.5, '#4e6469');
  gradient.addColorStop(.56, '#1d3037');
  gradient.addColorStop(1, '#08161c');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, height);

  const source = new THREE.CanvasTexture(canvas);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.SRGBColorSpace;
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromEquirectangular(source);
  generator.dispose();
  source.dispose();
  return target.texture;
}

export function createMaterialLibrary(renderer) {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const surfaces = {
    // Albedo was low enough that lit stone still resolved to black and the whole
    // structure read as a cut-out. Lifted into a range where the key light can
    // actually describe the form without breaking the night palette.
    basalt: makeSurface({ seed: 17, scale: 5.2, base: [40, 52, 54], contrast: 64, roughness: .9, roughVariation: .18, pits: .7, salt: 38, saltThreshold: .78, repeat: [2.2, 5.5] }, anisotropy),
    // The tower was built from the same basalt as the rocks it stands on, at the
    // same albedo, and that is most of why the hero frame read as one grey mass:
    // subject and foreground measured 18.2 and 18.5, which is no separation at
    // all. It is also why no lighting change would give the tower form — sRGB
    // [40,52,54] is about 0.033 linear, darker than fresh asphalt, so a four-fold
    // key increase with shadows disabled moved it eight levels out of 255. There
    // was nothing there to light. Dressed masonry is genuinely paler and more
    // neutral than sea-worn basalt, so this separates the tower from the rock in
    // both value and hue, and it does it truthfully rather than by cheating the
    // exposure.
    masonry: makeSurface({ seed: 137, scale: 4.4, base: [86, 88, 84], contrast: 58, roughness: .88, roughVariation: .2, pits: .42, salt: 30, saltThreshold: .8, repeat: [2.6, 6] }, anisotropy),
    wetBasalt: makeSurface({ seed: 29, scale: 6.4, base: [31, 47, 51], contrast: 55, roughness: .48, roughVariation: .28, pits: .5, salt: 22, saltThreshold: .84, repeat: [3, 7] }, anisotropy),
    copper: makeSurface({ seed: 43, scale: 7.2, base: [106, 79, 59], contrast: 62, roughness: .61, roughVariation: .3, streak: 2.8, salt: 28, saltThreshold: .81, repeat: [1.5, 7] }, anisotropy),
    // Base was [39, 43, 40] at .6 metalness, which leaves a diffuse response of
    // about six per cent — near black before any light reaches it. That is fine
    // for a truss read as a silhouette against sky and wrong for the copper spine
    // the camera passes half a metre from, which is the same material. Lifted into
    // dark patinated bronze so it has a value to be lit at.
    darkMetal: makeSurface({ seed: 61, scale: 8.8, base: [74, 63, 52], contrast: 42, roughness: .72, roughVariation: .24, streak: 3.6, repeat: [2, 8] }, anisotropy),
    ribbedGlass: makeSurface({ seed: 79, scale: 3.4, base: [25, 61, 64], contrast: 38, roughness: .23, roughVariation: .22, ribs: 4, normalStrength: 3.6, repeat: [2.4, 1] }, anisotropy),
    saltGlass: makeSurface({ seed: 97, scale: 5.4, base: [80, 123, 119], contrast: 34, roughness: .3, roughVariation: .36, pits: .18, salt: 66, saltThreshold: .7, repeat: [1.4, 4] }, anisotropy),
    salt: makeSurface({ seed: 113, scale: 11, base: [148, 154, 143], contrast: 70, roughness: .85, roughVariation: .13, pits: .28, repeat: [5, 9] }, anisotropy)
  };

  const materials = {
    // Normal response carries the difference between these surfaces far more than
    // albedo does at this light level: dry basalt is coarse and matte, wet basalt
    // is smoother but catches specular, copper is directional, salt is fine.
    masonry: applyTideLine(new THREE.MeshStandardMaterial({ ...surfaces.masonry, color: 0xffffff, roughness: .88, metalness: .02, normalScale: new THREE.Vector2(1.25, 1.25) })),
    stone: applyTideLine(new THREE.MeshStandardMaterial({ ...surfaces.basalt, color: 0xffffff, roughness: .96, metalness: .02, normalScale: new THREE.Vector2(1.45, 1.45) })),
    wetStone: applyTideLine(new THREE.MeshStandardMaterial({ ...surfaces.wetBasalt, color: 0xffffff, roughness: .42, metalness: .06, normalScale: new THREE.Vector2(1.15, 1.15) }), { strength: .8 }),
    copper: new THREE.MeshStandardMaterial({ ...surfaces.copper, color: 0xffffff, roughness: .58, metalness: .72, normalScale: new THREE.Vector2(1.05, 1.05) }),
    darkCopper: new THREE.MeshStandardMaterial({ ...surfaces.darkMetal, color: 0xffffff, roughness: .74, metalness: .46, normalScale: new THREE.Vector2(.85, .85) }),
    glass: new THREE.MeshPhysicalMaterial({ ...surfaces.ribbedGlass, color: 0xb2e2df, roughness: .25, metalness: .03, transparent: true, opacity: .42, transmission: .08, thickness: .8, normalScale: new THREE.Vector2(.52, .52) }),
    // Lantern glazing is its own surface: the shaft glass can stay dark and
    // ribbed, but anything wrapped around the optic has to let the signal out.
    lanternGlass: new THREE.MeshPhysicalMaterial({ color: 0xdff2ec, roughness: .12, metalness: 0, transparent: true, opacity: .12, transmission: .5, thickness: .3, side: THREE.DoubleSide, depthWrite: false }),
    // A uniform emissive across a cylinder gives it no shading gradient at all, so
    // the capsules collapsed into flat pale cards. The glass is now mostly
    // transparent and carries almost no emissive of its own: it reads as glass
    // from its lit edges and from the core suspended inside it.
    archiveGlass: new THREE.MeshPhysicalMaterial({
      ...surfaces.saltGlass, color: 0xbfe8e1, emissive: 0x2f7f74, emissiveIntensity: .1,
      roughness: .14, metalness: 0, transparent: true, opacity: .3, transmission: .35,
      thickness: 1.1, ior: 1.46, clearcoat: 1, clearcoatRoughness: .08,
      normalScale: new THREE.Vector2(.3, .3), depthWrite: false
    }),
    // The record itself. Small, bright and inside the glass, so each capsule has a
    // centre to read against and selective bloom has a compact source to catch.
    capsuleCore: new THREE.MeshStandardMaterial({ color: 0x0d2b2c, emissive: 0x84f0e0, emissiveIntensity: 3.4, roughness: .5, metalness: 0 }),
    salt: new THREE.MeshStandardMaterial({ ...surfaces.salt, color: 0xffffff, roughness: .94, metalness: 0, normalScale: new THREE.Vector2(.7, .7) }),
    // Seen only from inside the shaft, so it renders back faces.
    towerInterior: new THREE.MeshStandardMaterial({ ...surfaces.wetBasalt, color: 0x8f9c9c, roughness: .82, metalness: .03, side: THREE.BackSide, normalScale: new THREE.Vector2(1.3, 1.3) }),
    lens: new THREE.MeshStandardMaterial({ color: 0xff5a43, emissive: 0xff2d1f, emissiveIntensity: 8.5, roughness: .2, metalness: .08 }),
    caustic: new THREE.MeshBasicMaterial({ color: 0x59d9cf, transparent: true, opacity: .09, blending: THREE.AdditiveBlending, depthWrite: false }),
    // The mouth of the archive, seen from the top of the shaft. Gives the descent
    // something to descend toward and feeds selective bloom.
    aperture: new THREE.MeshBasicMaterial({ color: 0x74e4d8, transparent: true, opacity: .9, depthWrite: false }),
    silhouette: new THREE.MeshStandardMaterial({ color: 0x283033, roughness: 1, metalness: 0 })
  };

  function dispose() {
    environment.dispose();
    Object.values(materials).forEach(material => material.dispose());
    Object.values(surfaces).forEach(set => Object.values(set).forEach(texture => texture.dispose()));
  }

  const environment = buildEnvironment(renderer);
  const reflective = Object.values(materials).filter(material => 'envMapIntensity' in material);

  // How much of that environment reaches a surface at this point in the journey.
  // Under twenty metres of water there is very little skylight, and metal that
  // goes on mirroring an open sky down there looks like chrome in a cave.
  function setEnvironment(state) {
    const value = 1.05 - state.ocean.underwater * .74;
    reflective.forEach(material => { material.envMapIntensity = value; });
  }

  return { ...materials, surfaces, environment, setEnvironment, dispose };
}
