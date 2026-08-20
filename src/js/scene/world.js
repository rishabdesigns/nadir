import * as THREE from '../../../vendor/three.module.min.js';
import { clamp } from '../core/math.js';
import { QUALITY } from '../config.js';
import { createMaterialLibrary } from './materials.js';
import { createObservatory } from './observatory.js';
import { createOcean } from './ocean.js';
import { createAtmosphere } from './atmosphere.js';
import { createLighting } from './lighting.js';
import { createPost } from './post.js';
import { sampleShotState } from './state.js';

export function createWorld(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x07171b);
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07171b);
  scene.fog = new THREE.FogExp2(0x07171b, .0135);
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 260);

  const materials = createMaterialLibrary(renderer);
  scene.environment = materials.environment;
  const observatory = createObservatory(scene, materials);
  const ocean = createOcean(scene);
  const atmosphere = createAtmosphere(scene);
  const lighting = createLighting(scene, renderer);
  const post = createPost(renderer, scene, camera);
  // The water needs to know what breaks it before the first frame.
  ocean.setShoreline(observatory.terrain.userData.shoreline ?? []);

  const systems = [observatory, ocean, atmosphere, lighting, post];
  let state = sampleShotState(0);
  let underwater = 0;
  let progress = 0;
  let elapsed = 0;
  let renderScale = 1;
  let sampleTime = 0;
  let sampleFrames = 0;
  let shadowFrames = 0;
  let slowSamples = 0;
  let fastSamples = 0;
  let scaleCooldown = 0;
  let debugMode = options.study ?? '';

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, QUALITY.maxPixelRatio) * renderScale;
    renderer.setPixelRatio(ratio);
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    post.resize();
  }

  function applyState() {
    scene.background.copy(state.fog.color);
    scene.fog.color.copy(state.fog.color);
    scene.fog.density = state.fog.density;
    renderer.setClearColor(state.fog.color);
    materials.setEnvironment(state);
    systems.forEach(system => system.setState?.(state));
    underwater = state.ocean.underwater;
  }

  function setProgress(value) {
    progress = clamp(value, 0, 5);
    state = sampleShotState(progress);
    applyState();
  }

  function update(time) {
    elapsed = time;
    observatory.update(time, camera);
    // Lighting first: the ocean is hand shaded and has to be handed the moon, the
    // optic and the current strike before it draws, or it reflects last frame's.
    lighting.update(time);
    ocean.setLighting(lighting);
    ocean.update(time);
    atmosphere.update(time);
  }

  function render(delta = 0) {
    renderer.info.reset();
    post.render(elapsed);
    shadowFrames += 1;
    if (shadowFrames === 2) lighting.freezeShadows();
    if (QUALITY.reduced) return;
    sampleTime += delta;
    sampleFrames += 1;
    if (sampleFrames >= 50 || sampleTime > 1.2) {
      const average = sampleTime / sampleFrames;
      sampleFrames = 0;
      sampleTime = 0;

      // Every scale change reallocates the scene target, its depth texture and
      // four bloom targets, and each reallocation costs a long frame. Reacting to
      // a single slow sample made the adaptive scaler its own worst input: one
      // spike dropped the scale, the recovery stepped it back up, and each step
      // cost another spike. Changes now need several consecutive samples agreeing
      // and a cooldown between them.
      // The two directions are not symmetric, and treating them as if they were is
      // what made this oscillate. Dropping the scale is worth doing promptly: it
      // costs one reallocation and it protects the frame rate. Climbing back is
      // worth almost nothing — the viewer does not notice the extra resolution —
      // and it is what arms the next drop, so it wants a great deal more evidence.
      // Slowing both ends equally, which is what I tried first, measurably cost the
      // tail: p95 went from 33 ms to 50 because the scaler sat and took slow frames
      // rather than shedding pixels.
      if (average > .027) {
        slowSamples += 1;
        fastSamples = 0;
      } else if (average < .0125) {
        fastSamples += 1;
        slowSamples = 0;
      } else {
        slowSamples = 0;
        fastSamples = 0;
      }

      scaleCooldown = Math.max(0, scaleCooldown - 1);
      if (scaleCooldown === 0 && slowSamples >= 2 && renderScale > QUALITY.minRenderScale) {
        renderScale = Math.max(QUALITY.minRenderScale, renderScale * .84);
        slowSamples = 0;
        scaleCooldown = 6;
        resize();
      } else if (scaleCooldown === 0 && fastSamples >= 14 && renderScale < 1) {
        renderScale = Math.min(1, renderScale + .06);
        fastSamples = 0;
        scaleCooldown = 16;
        resize();
      }
    }
  }

  function setDebugMode(mode = '') {
    debugMode = mode;
    observatory.setDebugMode(mode);
    atmosphere.setDebugMode(mode);
    ocean.mesh.visible = mode !== 'materials' && mode !== 'lighting';
    if (mode === 'ocean') {
      atmosphere.root.visible = false;
      observatory.archive.visible = false;
    } else if (mode !== 'massing' && mode !== 'materials' && mode !== 'lighting') {
      observatory.archive.visible = true;
    }
  }

  function getStats() {
    const info = renderer.info.render;
    return {
      calls: info.calls,
      triangles: info.triangles,
      points: info.points,
      lines: info.lines,
      renderScale: Number(renderScale.toFixed(2)),
      pixelRatio: Number(renderer.getPixelRatio().toFixed(2)),
      progress: Number(progress.toFixed(3)),
      underwater: Number(underwater.toFixed(3)),
      debugMode
    };
  }

  function dispose() {
    systems.slice().reverse().forEach(system => system.dispose?.());
    materials.dispose();
    renderer.dispose();
  }

  resize();
  setProgress(0);
  if (debugMode) setDebugMode(debugMode);
  return {
    THREE, renderer, scene, camera, systems, materials,
    resize, setProgress, update, render, setDebugMode, getStats, dispose,
    setPostEnabled: value => post.setEnabled(value),
    get underwater() { return underwater; },
    get progress() { return progress; },
    get state() { return state; }
  };
}
