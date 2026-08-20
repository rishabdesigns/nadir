import * as THREE from '../../../vendor/three.module.min.js';
import { createCutouts } from './cutouts.js';
import { SCENE_SEED } from '../config.js';
import { createRandom, randomRange } from './site-plan.js';

const HAZE_TINT = new THREE.Color(0x5a8b8a);

const particleVertex = `
  attribute float aSeed;
  uniform float uTime;
  uniform float uType;
  uniform float uSpeed;
  uniform float uSize;
  uniform float uReference;
  uniform float uMinY;
  uniform float uMaxY;
  varying float vSeed;
  varying float vPulse;

  void main() {
    vec3 point = position;
    float span = uMaxY - uMinY;
    if (uType < .5) {
      point.y = uMinY + mod(position.y - uMinY - uTime * uSpeed - aSeed * span, span);
      point.x += sin(uTime * .8 + aSeed * 31.0) * .2 + (position.y - uMinY) * .09;
    } else if (uType < 1.5) {
      float life = fract(aSeed + uTime * uSpeed * .06);
      point.y = uMinY + life * span;
      point.x += sin(aSeed * 41.0 + life * 5.0) * life * 3.4;
      point.z += cos(aSeed * 29.0 + life * 4.0) * life * 2.2;
    } else if (uType < 2.5) {
      point.x += sin(uTime * uSpeed * .2 + aSeed * 19.0) * 3.2;
      point.y += cos(uTime * uSpeed * .12 + aSeed * 17.0) * .8;
    } else {
      point.y = uMinY + mod(position.y - uMinY + uTime * uSpeed * (0.45 + aSeed), span);
      point.x += sin(uTime * .17 + aSeed * 27.0 + point.y * .22) * mix(.22, 1.2, step(4.5, uType));
      point.z += cos(uTime * .13 + aSeed * 21.0) * .28;
    }
    vSeed = aSeed;
    vPulse = .68 + .32 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 37.0);
    vec4 view = modelViewMatrix * vec4(point, 1.0);
    // uSize is the sprite's size in pixels at uReference metres, and it falls off
    // with distance from there. It used to be a clamp of 260 over view depth into
    // the range .55 to 4.2, and 260 over any distance in this world is far above
    // the top of that range, so the clamp was
    // always active and every sprite was the same size no matter how far away it
    // was. Underwater that turned five hundred silt motes into a fixed screen-space
    // speckle that moved with the camera instead of through the water: the dirty,
    // grainy field over the whole vault. Depth is the whole point of suspended
    // matter, and it had none.
    float scale = uReference / max(.6, -view.z);
    gl_PointSize = clamp(uSize * scale * mix(.72, 1.28, aSeed), 0.0, 72.0);
    gl_Position = projectionMatrix * view;
  }
`;

const particleFragment = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uType;
  varying float vSeed;
  varying float vPulse;

  void main() {
    vec2 point = gl_PointCoord - .5;
    float alpha = 0.0;
    if (uType < .5) {
      // Rain is slanted by the wind rather than falling dead vertical. Copy on the
      // page says WNW 42 kn; plumb-straight rain reads as a screensaver.
      const float slant = .42;
      vec2 blown = vec2(
        point.x * cos(slant) - point.y * sin(slant),
        point.x * sin(slant) + point.y * cos(slant)
      );
      alpha = smoothstep(.075, .01, abs(blown.x)) * smoothstep(.5, .04, abs(blown.y));
    } else if (uType < 1.5) {
      // Spray is torn off the crests and driven sideways, so it is a short
      // horizontal smear. As a round dot it read as falling snow.
      vec2 smear = vec2(point.x * .5, point.y * 2.6);
      alpha = smoothstep(.5, .05, length(smear));
    } else if (uType > 3.5 && uType < 4.5) {
      // A bubble is a lens: bright where it catches light along the rim, near
      // clear through the middle. The hard ring this drew before read as an
      // outlined circle stamped on the frame.
      float radius = length(point);
      float shell = smoothstep(.5, .3, radius) * smoothstep(.06, .26, radius);
      alpha = shell * .55 + smoothstep(.5, .0, radius) * .12;
    } else {
      float radius = length(point);
      alpha = smoothstep(.5, .04, radius);
      if (uType > 4.5) alpha *= vPulse;
    }
    if (alpha < .015) discard;
    gl_FragColor = vec4(uColor, alpha * uOpacity);
  }
`;

function createParticleSystem(group, config, seedOffset) {
  const random = createRandom(SCENE_SEED + seedOffset);
  const positions = new Float32Array(config.count * 3);
  const seeds = new Float32Array(config.count);
  for (let index = 0; index < config.count; index += 1) {
    positions[index * 3] = randomRange(random, config.x[0], config.x[1]);
    positions[index * 3 + 1] = randomRange(random, config.y[0], config.y[1]);
    positions[index * 3 + 2] = randomRange(random, config.z[0], config.z[1]);
    seeds[index] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    depthWrite: false,
    blending: config.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uType: { value: config.type },
      uSpeed: { value: config.speed },
      uSize: { value: config.size },
      uReference: { value: config.reference },
      uMinY: { value: config.y[0] },
      uMaxY: { value: config.y[1] },
      uColor: { value: new THREE.Color(config.color) },
      uOpacity: { value: 0 }
    }
  });
  const points = new THREE.Points(geometry, material);
  points.name = config.name;
  points.frustumCulled = false;
  points.renderOrder = config.additive ? 7 : 5;
  group.add(points);
  return { points, geometry, material };
}

const hazeVertex = `
  varying vec2 vUv;
  varying float vDistance;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const hazeFragment = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vDistance;
  void main() {
    float edge = smoothstep(0.0, .2, vUv.x) * smoothstep(1.0, .8, vUv.x);
    edge *= smoothstep(0.0, .32, vUv.y) * smoothstep(1.0, .68, vUv.y);
    float depth = smoothstep(7.0, 70.0, vDistance);
    gl_FragColor = vec4(uColor, edge * uOpacity * (.45 + depth * .55));
  }
`;

const kelpVertex = `
  uniform float uTime;
  uniform float uSway;
  varying vec2 vUv;
  varying float vDistance;
  void main() {
    vUv = uv;
    vec3 point = position;
    float anchor = smoothstep(0.0, .72, uv.y);
    point.x += sin(uTime * .62 + position.y * .28 + position.x * .08) * anchor * .58 * uSway;
    point.z += cos(uTime * .41 + position.y * .19) * anchor * .18 * uSway;
    vec4 world = modelMatrix * vec4(point, 1.0);
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const kelpFragment = `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uFogDensity;
  uniform vec3 uFogColor;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vDistance;
  void main() {
    vec4 sampleColor = texture2D(uMap, vUv);
    float edge = smoothstep(.035, .18, sampleColor.a);
    if (edge < .02) discard;
    float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * vDistance * vDistance);
    vec3 color = mix(sampleColor.rgb * uTint, uFogColor, clamp(fogAmount, 0.0, .82));
    gl_FragColor = vec4(color, edge * uOpacity);
  }
`;

export function createAtmosphere(scene) {
  const root = new THREE.Group();
  root.name = 'weather-and-depth';
  scene.add(root);
  const systems = {
    rain: createParticleSystem(root, { name: 'rain', type: 0, count: 2900, x: [-48, 48], y: [0, 34], z: [-74, 30], speed: 20, size: 19, reference: 22, color: 0x91aeb2 }, 31),
    spray: createParticleSystem(root, { name: 'storm-spray', type: 1, count: 620, x: [-38, 38], y: [-.3, 7.5], z: [-60, 12], speed: 2.6, size: 12, reference: 16, color: 0xa8bec0 }, 59),
    mist: createParticleSystem(root, { name: 'mist-wisps', type: 2, count: 200, x: [-36, 36], y: [-2, 18], z: [-74, 8], speed: 1, size: 40, reference: 30, color: 0x6c8d90 }, 83),
    // Suspended matter, not confetti: silt is fine and near-invisible, bubbles are
    // sparse and rise, biolume is a rare spark. At full strength these three
    // overlapped into a uniform swarm of dots across the whole vault.
    silt: createParticleSystem(root, { name: 'archive-silt', type: 3, count: 360, x: [-15, 15], y: [-17, -1], z: [-78, -6], speed: .34, size: 3.4, reference: 9, color: 0x86b8ad }, 109),
    bubbles: createParticleSystem(root, { name: 'bubbles', type: 4, count: 34, x: [-12, 12], y: [-17, -1], z: [-74, -8], speed: .7, size: 9, reference: 12, color: 0xb3ded8 }, 137),
    biolume: createParticleSystem(root, { name: 'biolume', type: 5, count: 140, x: [-12, 12], y: [-16, -2], z: [-76, -12], speed: .18, size: 8, reference: 14, color: 0x61eee0, additive: true }, 173)
  };

  const hazeMaterial = new THREE.ShaderMaterial({
    vertexShader: hazeVertex,
    fragmentShader: hazeFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0x4c7479) }, uOpacity: { value: .18 } }
  });
  const haze = [];
  [-20, -35, -51, -67].forEach((z, index) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(58 - index * 4, 24), hazeMaterial);
    plane.position.set(index % 2 ? 4 : -3, -2 - index * 1.2, z);
    plane.rotation.y = index % 2 ? -.08 : .07;
    plane.renderOrder = 2;
    root.add(plane);
    haze.push(plane);
  });

  const cutouts = createCutouts();

  function cutoutMaterial(map, tint, sway) {
    return new THREE.ShaderMaterial({
      vertexShader: kelpVertex,
      fragmentShader: kelpFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMap: { value: map }, uTime: { value: 0 }, uOpacity: { value: 0 },
        uSway: { value: sway }, uTint: { value: new THREE.Color(tint) },
        uFogDensity: { value: .03 }, uFogColor: { value: new THREE.Color(0x052c33) }
      }
    });
  }

  // Three occluder families rather than one plate repeated. Grass belongs to the
  // cliff top and barely moves; kelp belongs below the surface and sways with the
  // swell; the rock lip is dead still because it is rock.
  const cutoutMaterials = {
    // Foreground reads as foreground by being darker than what it stands in front
    // of, not by being more detailed.
    kelp: cutoutMaterial(cutouts.kelp, 0x5f8f85, 1.35),
    rockEdge: cutoutMaterial(cutouts.rockEdge, 0x4d5a5c, 0)
  };

  const kelpGroup = new THREE.Group();
  kelpGroup.name = 'foreground-cutouts';
  [
    // Grass cutouts removed. Sitting close to the opening key they barely moved
    // against the camera, so they read as a sticker on the lens rather than as
    // planting in the world — worse than having no foreground at all. The rock lip
    // stays, well back, where it occludes without announcing itself.
    ['rockEdge', -4, -1.6, 20, 34, 14, .05, 'surface'],
    // Kelp forest through the crossing and the descent below it.
    ['kelp', -9.5, -11.2, -27, 15, 10, .12, 'deep'],
    ['kelp', 9.8, -12.1, -37, 18, 12, -.17, 'deep'],
    ['kelp', -7.4, -13.2, -57, 14, 9, .08, 'deep']
  ].forEach(([kind, x, y, z, width, height, rotation, band]) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 12, 6), cutoutMaterials[kind]);
    plane.position.set(x, y, z);
    plane.rotation.y = rotation;
    plane.renderOrder = 6;
    plane.userData.band = band;
    kelpGroup.add(plane);
  });
  root.add(kelpGroup);

  function setState(state) {
    systems.rain.material.uniforms.uOpacity.value = state.air.rain * .82;
    systems.spray.material.uniforms.uOpacity.value = state.air.spray * .46;
    systems.mist.material.uniforms.uOpacity.value = state.air.mist * .2;
    systems.silt.material.uniforms.uOpacity.value = state.air.silt * .15;
    systems.bubbles.material.uniforms.uOpacity.value = state.air.bubbles * .3;
    systems.biolume.material.uniforms.uOpacity.value = state.air.biolume * .5;
    hazeMaterial.uniforms.uOpacity.value = .035 + state.air.mist * .19 + state.ocean.underwater * .06;
    hazeMaterial.uniforms.uColor.value.copy(state.fog.color).lerp(HAZE_TINT, .24);
    // Surface planting shows itself whenever the camera is outdoors at the top of
    // the world, and hides inside the tower and down in the vault. Kelp follows the
    // journey's own kelp channel.
    const outdoors = (1 - state.visible.interior) * (1 - state.visible.archive) * state.visible.exterior;
    Object.entries(cutoutMaterials).forEach(([kind, material]) => {
      material.uniforms.uOpacity.value = kind === 'kelp' ? state.visible.kelp * .72 : outdoors * .8;
      material.uniforms.uFogDensity.value = state.fog.density;
      material.uniforms.uFogColor.value.copy(state.fog.color);
    });
  }

  function update(time) {
    Object.values(systems).forEach(system => { system.material.uniforms.uTime.value = time; });
    Object.values(cutoutMaterials).forEach(material => { material.uniforms.uTime.value = time; });
  }

  function setDebugMode(mode) {
    root.visible = !['massing', 'materials', 'lighting'].includes(mode);
  }

  function dispose() {
    Object.values(systems).forEach(system => {
      system.geometry.dispose();
      system.material.dispose();
    });
    haze.forEach(plane => plane.geometry.dispose());
    hazeMaterial.dispose();
    kelpGroup.traverse(object => object.geometry?.dispose());
    Object.values(cutoutMaterials).forEach(material => material.dispose());
    Object.values(cutouts).forEach(texture => texture.dispose());
    root.removeFromParent();
  }

  return { root, systems, haze, kelpGroup, setState, update, setDebugMode, dispose };
}
