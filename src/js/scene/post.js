import * as THREE from '../../../vendor/three.module.min.js';

const fullScreenVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const thresholdFragment = `
  uniform sampler2D uTexture;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  void main() {
    vec3 color = texture2D(uTexture, vUv).rgb;
    float brightness = max(max(color.r, color.g), color.b);
    float soft = clamp((brightness - uThreshold + uKnee) / max(.0001, 2.0 * uKnee), 0.0, 1.0);
    soft = soft * soft * (3.0 - 2.0 * soft);
    float contribution = max(brightness - uThreshold, 0.0) + soft * uKnee;
    gl_FragColor = vec4(color * contribution / max(brightness, .0001), 1.0);
  }
`;

const copyFragment = `
  uniform sampler2D uTexture;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uTexture, vUv);
  }
`;

const blurFragment = `
  uniform sampler2D uTexture;
  uniform vec2 uDirection;
  uniform vec2 uResolution;
  varying vec2 vUv;
  void main() {
    vec2 stepUv = uDirection / uResolution;
    vec3 color = texture2D(uTexture, vUv).rgb * .227027;
    color += texture2D(uTexture, vUv + stepUv * 1.384615).rgb * .316216;
    color += texture2D(uTexture, vUv - stepUv * 1.384615).rgb * .316216;
    color += texture2D(uTexture, vUv + stepUv * 3.230769).rgb * .070270;
    color += texture2D(uTexture, vUv - stepUv * 3.230769).rgb * .070270;
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Both passes need a per-pixel random, and both were using
// fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453). That hash is only sound
// while its argument stays small. gl_FragCoord runs to ~2500 and the grain pass
// was adding uTime * 113.7 on top, so within a minute of loading the input was in
// the hundreds of thousands, the float step across it was coarser than the pattern
// itself, and sin() stopped producing noise and started producing a fixed diagonal
// moire. That is the texture that was sitting over the whole piece, above water
// and below.
//
// Both replacements keep their inputs bounded. This one is Hoskins' sine-free
// hash; the interleaved gradient below is Jimenez's, which is what the occlusion
// kernel wants because its output is evenly distributed across any small
// neighbourhood rather than merely uncorrelated.
const noiseChunk = `
  float hashed(vec2 point) {
    vec3 mixed = fract(vec3(point.xyx) * .1031);
    mixed += dot(mixed, mixed.yzx + 33.33);
    return fract((mixed.x + mixed.y) * mixed.z);
  }

  float interleavedGradient(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(.06711056, .00583715))));
  }
`;

const compositeFragment = `
  uniform sampler2D uScene;
  uniform sampler2D uBloomHalf;
  uniform sampler2D uBloomQuarter;
  uniform float uExposure;
  uniform float uSaturation;
  uniform float uBloom;
  uniform float uWarmth;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uChromatic;
  uniform float uPostMix;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform sampler2D uOcclusionMap;
  varying vec2 vUv;

  ${noiseChunk}

  vec3 aces(vec3 value) {
    const float a = 2.51;
    const float b = .03;
    const float c = 2.43;
    const float d = .59;
    const float e = .14;
    return clamp((value * (a * value + b)) / (value * (c * value + d) + e), 0.0, 1.0);
  }

  void main() {
    vec2 centered = vUv - .5;
    vec2 shift = centered * uChromatic * uPostMix / max(uResolution.x, 1.0);
    vec3 sceneColor;
    sceneColor.r = texture2D(uScene, vUv + shift).r;
    sceneColor.g = texture2D(uScene, vUv).g;
    sceneColor.b = texture2D(uScene, vUv - shift).b;
    // Occlusion goes on before bloom, so light still spills out of crevices rather
    // than being darkened after the fact.
    // The occlusion map is a quarter of the screen in each axis, so a single tap
    // carries its per-pixel kernel noise up at four times the size. A cross at its
    // own texel spacing costs four reads of a small, cache-resident target and is
    // what turns it from a visible pattern into shading.
    vec2 occlusionTexel = 4.0 / max(uResolution, vec2(1.0));
    float occlusion = texture2D(uOcclusionMap, vUv).r * .36
      + texture2D(uOcclusionMap, vUv + vec2(occlusionTexel.x, 0.0)).r * .16
      + texture2D(uOcclusionMap, vUv - vec2(occlusionTexel.x, 0.0)).r * .16
      + texture2D(uOcclusionMap, vUv + vec2(0.0, occlusionTexel.y)).r * .16
      + texture2D(uOcclusionMap, vUv - vec2(0.0, occlusionTexel.y)).r * .16;
    sceneColor *= mix(1.0, occlusion, uPostMix);
    vec3 bloom = texture2D(uBloomHalf, vUv).rgb * .68 + texture2D(uBloomQuarter, vUv).rgb * .46;
    vec3 color = sceneColor + bloom * uBloom * uPostMix;
    float luminance = dot(color, vec3(.2126, .7152, .0722));
    color = mix(vec3(luminance), color, mix(1.0, uSaturation, uPostMix));
    color *= vec3(1.0 + uWarmth * .1 * uPostMix, 1.0 + uWarmth * .018 * uPostMix, 1.0 - uWarmth * .075 * uPostMix);
    color *= mix(1.0, uExposure, uPostMix);
    float vignette = smoothstep(.88, .18, dot(centered, centered) * 1.38);
    color *= mix(1.0 - uVignette * .42 * uPostMix, 1.0, vignette);
    color = aces(max(color, 0.0));

    // Grain goes on after tone mapping and only in the midtones. It used to be
    // added in linear light before the transfer curve, with a floor of .28 that
    // applied at zero luminance — and the sRGB encode lifts the bottom of the
    // range by better than ten to one, so in a piece this dark a tiny linear
    // perturbation arrived on screen as a blizzard. Film grain is a midtone
    // phenomenon: it dies in the toe and it dies in the shoulder.
    float shade = dot(color, vec3(.2126, .7152, .0722));
    float grainWeight = smoothstep(.015, .16, shade) * (1.0 - smoothstep(.5, .95, shade));
    // The seed is wrapped rather than accumulated, so it decorrelates frame to
    // frame without the argument growing without bound.
    float grain = hashed(gl_FragCoord.xy + fract(uTime * 41.0) * 512.0) - .5;
    color += grain * uGrain * uPostMix * grainWeight;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    #include <colorspace_fragment>
  }
`;

// Screen-space occlusion, computed at half resolution and upsampled. Run at full
// resolution this cost the frame budget outright: p50 went from 16.7 ms to
// 33.2 ms with a third of frames missing 30 fps, for a effect that is meant to be
// felt rather than seen.
const occlusionFragment = `
  uniform sampler2D uDepth;
  uniform float uNear;
  uniform float uFar;
  uniform float uOcclusion;
  uniform vec2 uResolution;
  varying vec2 vUv;

  ${noiseChunk}

  float linearDepth(vec2 uv) {
    float raw = texture2D(uDepth, uv).x;
    return (2.0 * uNear * uFar) / (uFar + uNear - (raw * 2.0 - 1.0) * (uFar - uNear));
  }

  void main() {
    float center = linearDepth(vUv);
    if (center >= uFar * .96) {
      gl_FragColor = vec4(1.0);
      return;
    }

    // Constant world-space radius, so it shrinks on screen with distance.
    float radius = clamp(9.0 / center, .0016, .045);
    float occluded = 0.0;
    // Six taps rotated per pixel, at quarter resolution, then upsampled four
    // times: with a degenerate hash this was the strongest artefact on screen,
    // a static hatch locked to the viewport and sitting over every wall.
    float angle = interleavedGradient(vUv * uResolution) * 6.2831853;

    for (int index = 0; index < 6; index += 1) {
      float step = (float(index) + .5) / 6.0;
      float theta = angle + step * 6.2831853 * 2.4;
      vec2 offset = vec2(cos(theta), sin(theta)) * radius * (.35 + step * .65);
      offset.y *= uResolution.x / uResolution.y;
      float difference = center - linearDepth(vUv + offset);
      // In front of us, but close enough to belong to the same surface: anything
      // far in front is a separate object and would halo the silhouette.
      occluded += smoothstep(.02, .18, difference) * (1.0 - smoothstep(1.6, 4.2, difference));
    }

    gl_FragColor = vec4(vec3(clamp(1.0 - (occluded / 6.0) * uOcclusion, 0.0, 1.0)), 1.0);
  }
`;

// `antialias: true` on the WebGLRenderer applies to the default framebuffer and
// nothing else. Every frame of this piece is rendered into a target instead and
// then composited, so that flag has never done anything here and every polygon
// edge in the world — the tower's silhouette, the gantry trusses, the reef, the
// arches — has been going to screen hard-aliased. Multisampling has to be asked
// for on the target itself.
function makeTarget(width, height, depthBuffer = false, samples = 0) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer,
    samples
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  return target;
}

function makeMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: fullScreenVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
}

export function createPost(renderer, worldScene, worldCamera) {
  const sceneTarget = makeTarget(1, 1, true, 2);
  // Ambient occlusion needs the scene's depth, not just a depth buffer to test
  // against. Without it every object sat on the world with no darkening at the
  // contact, which is what made the whole scene read as placed rather than seated.
  sceneTarget.depthTexture = new THREE.DepthTexture(1, 1);
  sceneTarget.depthTexture.type = THREE.UnsignedIntType;
  const occlusionTarget = makeTarget(1, 1);
  const bloomHalfA = makeTarget(1, 1);
  const bloomHalfB = makeTarget(1, 1);
  const bloomQuarterA = makeTarget(1, 1);
  const bloomQuarterB = makeTarget(1, 1);
  const screenScene = new THREE.Scene();
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  screenScene.add(quad);

  const threshold = makeMaterial(thresholdFragment, {
    uTexture: { value: sceneTarget.texture }, uThreshold: { value: 1.05 }, uKnee: { value: .45 }
  });
  const occlusion = makeMaterial(occlusionFragment, {
    uDepth: { value: sceneTarget.depthTexture },
    uNear: { value: worldCamera.near }, uFar: { value: worldCamera.far },
    uOcclusion: { value: .78 }, uResolution: { value: new THREE.Vector2(1, 1) }
  });
  const copy = makeMaterial(copyFragment, { uTexture: { value: bloomHalfA.texture } });
  const blur = makeMaterial(blurFragment, {
    uTexture: { value: bloomHalfA.texture }, uDirection: { value: new THREE.Vector2(1, 0) }, uResolution: { value: new THREE.Vector2(1, 1) }
  });
  const composite = makeMaterial(compositeFragment, {
    uScene: { value: sceneTarget.texture }, uBloomHalf: { value: bloomHalfA.texture }, uBloomQuarter: { value: bloomQuarterA.texture },
    uExposure: { value: .86 }, uSaturation: { value: .83 }, uBloom: { value: .72 }, uWarmth: { value: 0 },
    uVignette: { value: .7 }, uGrain: { value: .075 }, uChromatic: { value: .55 }, uPostMix: { value: 1 }, uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uOcclusionMap: { value: occlusionTarget.texture }
  });
  const drawingSize = new THREE.Vector2();
  let enabled = true;

  function draw(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(screenScene, screenCamera);
  }

  function resize() {
    renderer.getDrawingBufferSize(drawingSize);
    const width = Math.max(1, Math.floor(drawingSize.x));
    const height = Math.max(1, Math.floor(drawingSize.y));
    sceneTarget.setSize(width, height);
    // Quarter resolution: occlusion is low-frequency, and at half res the tail of
    // the frame-time distribution was still five times worse than without it.
    occlusionTarget.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    occlusion.uniforms.uResolution.value.set(Math.max(1, width >> 2), Math.max(1, height >> 2));
    bloomHalfA.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
    bloomHalfB.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
    bloomQuarterA.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    bloomQuarterB.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    composite.uniforms.uResolution.value.set(width, height);
    sceneTarget.depthTexture.image.width = width;
    sceneTarget.depthTexture.image.height = height;
    sceneTarget.depthTexture.needsUpdate = true;
  }

  function setState(state) {
    composite.uniforms.uExposure.value = state.grade.exposure;
    composite.uniforms.uSaturation.value = state.grade.saturation;
    composite.uniforms.uBloom.value = state.grade.bloom;
    composite.uniforms.uWarmth.value = state.grade.warmth;
    composite.uniforms.uVignette.value = state.grade.vignette;
    composite.uniforms.uGrain.value = state.grade.grain;
    composite.uniforms.uChromatic.value = .35 + state.ocean.underwater * .55;
  }

  function render(time) {
    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    renderer.render(worldScene, worldCamera);

    if (enabled) {
      draw(occlusion, occlusionTarget);
      threshold.uniforms.uTexture.value = sceneTarget.texture;
      draw(threshold, bloomHalfA);
      blur.uniforms.uResolution.value.set(bloomHalfA.width, bloomHalfA.height);
      blur.uniforms.uTexture.value = bloomHalfA.texture;
      blur.uniforms.uDirection.value.set(1, 0);
      draw(blur, bloomHalfB);
      blur.uniforms.uTexture.value = bloomHalfB.texture;
      blur.uniforms.uDirection.value.set(0, 1);
      draw(blur, bloomHalfA);

      copy.uniforms.uTexture.value = bloomHalfA.texture;
      draw(copy, bloomQuarterA);
      blur.uniforms.uResolution.value.set(bloomQuarterA.width, bloomQuarterA.height);
      blur.uniforms.uTexture.value = bloomQuarterA.texture;
      blur.uniforms.uDirection.value.set(1, 0);
      draw(blur, bloomQuarterB);
      blur.uniforms.uTexture.value = bloomQuarterB.texture;
      blur.uniforms.uDirection.value.set(0, 1);
      draw(blur, bloomQuarterA);
    }

    composite.uniforms.uTime.value = time;
    composite.uniforms.uScene.value = sceneTarget.texture;
    composite.uniforms.uBloomHalf.value = bloomHalfA.texture;
    composite.uniforms.uBloomQuarter.value = bloomQuarterA.texture;
    draw(composite, null);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    composite.uniforms.uPostMix.value = enabled ? 1 : 0;
  }

  function dispose() {
    [sceneTarget, bloomHalfA, bloomHalfB, bloomQuarterA, bloomQuarterB].forEach(target => target.dispose());
    [threshold, copy, blur, composite].forEach(material => material.dispose());
    quad.geometry.dispose();
  }

  return { resize, setState, render, setEnabled, dispose, get enabled() { return enabled; } };
}
