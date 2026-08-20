import * as THREE from '../../../vendor/three.module.min.js';
import { SITE } from './site-plan.js';
import { SIGNAL_ACCENT } from '../config.js';

const skyVertex = `
  varying vec3 vDirection;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vDirection = normalize(world.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const skyFragment = `
  uniform float uTime;
  uniform float uDawn;
  uniform vec3 uStormTop;
  uniform vec3 uStormHorizon;
  uniform vec3 uDawnHorizon;
  uniform vec3 uDawnMid;
  uniform vec3 uDawnTop;
  uniform vec3 uDawnLit;
  uniform vec3 uDawnGlow;
  uniform vec3 uFogColor;
  uniform vec3 uAccent;
  uniform vec3 uMoonDir;
  uniform float uMoonCos;
  uniform float uMoonBright;
  uniform float uFlash;
  uniform vec3 uFlashDir;
  varying vec3 vDirection;

  float cloud(vec2 point) {
    float value = sin(point.x * 3.1 + point.y * 1.7 + uTime * .012);
    value += sin(point.x * 7.7 - point.y * 4.2 - uTime * .018) * .48;
    value += sin(point.x * 15.3 + point.y * 9.1) * .21;
    return value * .29 + .5;
  }

  void main() {
    vec3 view = normalize(vDirection);
    float horizon = smoothstep(-.22, .42, view.y);
    float cloudField = cloud(view.xz / max(.18, abs(view.y) + .18));

    // Storm: two stops, cold, and the cloud field is a straight multiply, because
    // a storm sky has no light in it for cloud to catch.
    vec3 stormBase = mix(uStormHorizon, uStormTop, horizon);
    stormBase *= .68 + cloudField * .42;

    // Dawn used to be this same storm dome with one thin warm band laid along the
    // horizon. That is not what a morning looks like and it is why the beat read
    // as murk: a grey sky with a brown stripe under it is a grey sky. A dawn is a
    // gradient with three stops and a hue rotation across them — gold on the
    // water, rose through the middle register, violet overhead — and it is the
    // *middle* stop that does the work, because without it the warm end has
    // nothing to travel toward and reads as dirt on top of bad weather.
    vec3 dawnBase = mix(uDawnHorizon, uDawnMid, smoothstep(-.18, .24, view.y));
    dawnBase = mix(dawnBase, uDawnTop, smoothstep(.12, .62, view.y));

    // And the cloud is lit rather than darkened. At this hour the sun is under the
    // deck, so the underside of every cloud is the brightest thing in the frame —
    // multiplying the field the way the storm does would paint the one part of the
    // sky that should be glowing as a hole in it.
    dawnBase *= .84 + cloudField * .26;
    dawnBase += uDawnLit * pow(cloudField, 2.4) * (1.0 - horizon * .5);

    vec3 base = mix(stormBase, dawnBase, uDawn);

    // The moon was one power function — a point, which bloom then smeared into a
    // blob with no edge, no surface and no light of its own. It is a disc now,
    // with a limb, some maria and a halo, and it carries a directional light in
    // the scene so the thing you can see is also the thing doing the lighting.
    // Swung well off the tower axis: sitting on it put a blown highlight directly
    // behind the lantern and killed the optic as the focal point.
    float cosAngle = dot(view, uMoonDir);
    float onFace = step(0.0, cosAngle);
    vec3 moonRight = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 moonUp = cross(moonRight, uMoonDir);
    float moonRadius = max(sqrt(max(0.0, 1.0 - uMoonCos * uMoonCos)), 1e-4);
    vec2 face = vec2(dot(view, moonRight), dot(view, moonUp)) / moonRadius;
    float r = length(face);
    float disc = (1.0 - smoothstep(.955, 1.0, r)) * onFace;
    float limb = pow(max(0.0, 1.0 - r * r * .8), .3);
    float maria = .82 + .18 * cloud(face * 1.6 + 11.0);
    float halo = exp(-(max(r, 1.0) - 1.0) * 2.6) * onFace;
    vec3 moon = uAccent * (disc * limb * maria * 1.22 + halo * .58) * uMoonBright;

    // Every other surface in the world recedes into the fog. This mesh carries
    // fog: false and so it never did, which left a value step wherever fogged
    // geometry met the sky — the sea's horizon worst of all, because that join is
    // a dead straight line right across the frame. The bottom of the dome now
    // settles onto the same colour the sea is fogging toward, so the two arrive at
    // the same value and the line stops being a line.
    // Eased off at dawn. Flattening the bottom third of the dome onto one fog
    // value is right in a storm, where the air genuinely is one value; at dawn it
    // erased the gold the gradient had just built and handed the horizon back its
    // grey.
    float hazeBand = 1.0 - smoothstep(0.0, .30, max(view.y, 0.0));
    base = mix(base, uFogColor, pow(hazeBand, 1.4) * (.94 - uDawn * .34));

    // One hot line right where the sky meets the water, for the sun that has not
    // cleared the horizon yet. Tighter than the band it replaces, and it sits on
    // top of a gradient that already agrees with it rather than fighting one.
    float sunLine = exp(-abs(view.y + .012) * 12.0) * uDawn;
    base = mix(base, uDawnGlow, sunLine * .52);
    base += moon;

    // Lightning lights the cloud it stands behind, not the whole dome, and it
    // picks up the cloud field so a strike reads as structure rather than as the
    // exposure being yanked.
    float toward = max(0.0, dot(view, uFlashDir));
    // Tight, and shaped by the cloud it is behind. At a low exponent this spread
    // across most of the sky as an even gradient, which is what a sunset looks
    // like; a strike lights the one cloud mass it is inside.
    float sheet = pow(toward, 7.0) * (.22 + cloudField * 1.5);
    sheet += pow(toward, 26.0) * 1.4;
    base += uAccent * uFlash * sheet * 2.6;

    gl_FragColor = vec4(base, 1.0);
  }
`;

// The moon sits low and nearly behind the tower from the standing-off shot, so
// it works as a backlight: rim down the seaward edge of the masonry and a broken
// glitter path on the water running back toward the lens.
const MOON_DIRECTION = new THREE.Vector3(-.72, .11, -.68).normalize();
const MOON_ANGULAR_RADIUS = .058;

// Strikes are a pure function of time rather than an accumulated random walk, so
// a captured frame at t is the same frame every run — capture.mjs drives a
// virtual clock and the contact sheets have to stay comparable.
function strikeHash(index) {
  let value = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ value >>> 13, 0xc2b2ae35);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}

const STRIKE_GAP = 5.2;
const STRIKE_TAIL = .58;

function strikeAt(index) {
  return index * STRIKE_GAP + strikeHash(index * 3 + 1) * STRIKE_GAP * .88;
}

// Lightning is several return strokes, not one flash. The first is the brightest
// and the rest stutter down behind it.
function strikeEnvelope(elapsed) {
  if (elapsed < 0 || elapsed > STRIKE_TAIL) return 0;
  const decay = Math.exp(-elapsed * 8.8);
  const stutter = elapsed < .035 ? 1 : .18 + .82 * Math.max(0, Math.sin(elapsed * 63));
  return decay * stutter;
}

export function createLighting(scene, renderer) {
  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uDawn: { value: 0 },
      uStormTop: { value: new THREE.Color(0x071419) },
      uStormHorizon: { value: new THREE.Color(0x536c71) },
      // The three dawn stops, plus the light the cloud deck catches from under it
      // and the line on the water where the sun is still to arrive. These carry
      // real chroma on purpose: the previous set were all within a few points of
      // neutral, and a desaturated warm is indistinguishable from dirt.
      uDawnHorizon: { value: new THREE.Color(0xffb066) },
      uDawnMid: { value: new THREE.Color(0xd0736a) },
      uDawnTop: { value: new THREE.Color(0x5c5883) },
      uDawnLit: { value: new THREE.Color(0x4a2a22) },
      uDawnGlow: { value: new THREE.Color(0xffd79c) },
      uFogColor: { value: new THREE.Color(0x33454a) },
      uAccent: { value: new THREE.Color(SIGNAL_ACCENT) },
      uMoonDir: { value: MOON_DIRECTION.clone() },
      uMoonCos: { value: Math.cos(MOON_ANGULAR_RADIUS) },
      uMoonBright: { value: 1 },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(1, .2, 0).normalize() }
    }
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 48, 28), skyMaterial);
  sky.name = 'storm-to-dawn-sky';
  sky.position.set(0, -8, -28);
  sky.renderOrder = -10;
  scene.add(sky);

  const ambient = new THREE.HemisphereLight(0x8eaaad, 0x02090c, .34);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xb6cdcd, 2.9);
  key.name = 'storm-key';
  // Left of the hero camera and 58 degrees off its view axis, which is a normal
  // three-quarter key and is the same side the sky shader puts its sun on. This
  // was suspected of being a flat frontal light when the tower measured 21-17-22
  // straight across its width, but driving it from outside settled it: with
  // shadows off and the intensity at four times this, the tower moved eight
  // levels. The flatness was never the angle, it was that the stone underneath
  // returns almost nothing — see the masonry surface in materials.js.
  key.position.set(-24, 32, 22);
  key.target.position.set(0, 0, -20);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -42;
  key.shadow.camera.right = 42;
  key.shadow.camera.top = 42;
  key.shadow.camera.bottom = -42;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 120;
  key.shadow.bias = -.00035;
  key.shadow.normalBias = .045;
  key.shadow.radius = 2.2;
  scene.add(key, key.target);

  // The moon is the second light source in the frame and until now it lit
  // nothing. Backlight, in the accent, so the disc you can see and the rim on the
  // tower are the same event.
  // The disc in the sky is the full accent. The light it casts is the same hue
  // with most of the chroma taken out, and that is not a compromise on the one
  // colour — it is what stops the accent turning into a defect. A specular
  // highlight takes the colour of the light, and a fully saturated copper raking
  // across normal-mapped wet rock lit every ridge in the reef with a hot orange
  // line that read as lava on a North Atlantic sea. Verified by toggling this
  // light alone: at full chroma the embers are there, at this tint they are gone
  // and the rim and the glitter path both survive.
  const moon = new THREE.DirectionalLight(
    new THREE.Color(SIGNAL_ACCENT).lerp(new THREE.Color(0xffffff), .62), 0);
  moon.name = 'moon';
  moon.position.copy(MOON_DIRECTION).multiplyScalar(140).add(new THREE.Vector3(0, 0, -20));
  moon.target.position.set(0, 0, -20);
  scene.add(moon, moon.target);

  // Repositioned per strike so the storm does not flash from one wall all night.
  // Same reasoning as the moon, further along: the sky flash carries the accent
  // at full strength because that is where the colour belongs, but a strike
  // landing on the reef at full chroma turned the near rocks rust-brown, which
  // reads as a colour grade rather than as a flash. Lightning is an energy event
  // — mostly value, very little chroma.
  const bolt = new THREE.DirectionalLight(
    new THREE.Color(SIGNAL_ACCENT).lerp(new THREE.Color(0xffffff), .72), 0);
  bolt.name = 'storm-lightning';
  bolt.position.set(120, 40, -20);
  bolt.target.position.set(0, 0, -20);
  scene.add(bolt, bolt.target);

  const rim = new THREE.DirectionalLight(0x4e9da2, .85);
  rim.name = 'ocean-rim';
  rim.position.set(24, 8, -44);
  rim.target.position.set(0, -5, -18);
  scene.add(rim, rim.target);

  // Range-limited: a point light carries no occlusion, so a 38 m reach washed the
  // rock below the tower in red straight through the masonry. It now only kisses
  // the lantern and gallery; the emissive optic and its bloom carry the signal.
  const signal = new THREE.PointLight(0xff4c39, 26, 17, 2.1);
  signal.name = 'signal-practical';
  signal.position.set(SITE.lens.x, SITE.lens.y, SITE.lens.z + .45);
  scene.add(signal);

  // Hung outside the door on the seaward face. The camera now walks the gantry
  // straight at this opening, so the doorway has to read as a lit way in — that
  // face of the tower catches nothing from the key light or the lantern.
  const PORCH_INTENSITY = 34;
  const porch = new THREE.PointLight(0xe0a071, PORCH_INTENSITY, 13, 1.5);
  porch.name = 'gallery-porch';
  porch.position.set(5.4, 10.2, SITE.tower.z);
  scene.add(porch);

  // Light spilling from the sea door at the foot of the tower. The descent from
  // the crossing to the vault passes through open water, which is correctly lit
  // and still completely empty — there was simply nothing down there to see.
  const SEA_DOOR_INTENSITY = 95;
  const seaDoor = new THREE.PointLight(0xd9a075, SEA_DOOR_INTENSITY, 27, 1.4);
  seaDoor.name = 'sea-door';
  seaDoor.position.set(0, -8.2, SITE.tower.z + 7.8);
  scene.add(seaDoor);

  // Stair lamps down the shaft. Their reach is kept modest because a point light
  // ignores occlusion and a long one lights the outside of the tower from within.
  // The topmost sits at the head of the stair, where the camera enters; its
  // absence was much of why the approach into the shaft rendered black.
  const shaftLamps = [11.4, 7.5, 1.5, -4.5, -10.5].map((y, index) => {
    const lamp = new THREE.PointLight(0xd8875a, 0, 14, 1.4);
    lamp.name = `descent-guide-${y}`;
    // On the shaft wall, not on the shaft axis. These sat at radius zero, which
    // is inside the copper spine running down the middle of the stairwell. A point
    // light carries no occlusion so the walls still lit and it looked fine — but
    // every outward-facing surface of the spine pointed away from every one of
    // them, so the spine rendered pure black. Half the frame through the descent
    // was a featureless slab, and the camera passing within half a metre of it and
    // then sliding off was the abrupt light change on the way into the water.
    // Mounted on the wall they rake the spine instead, and they wind down with
    // the stair rather than hanging in the middle of it.
    const angle = index * 1.47 + .6;
    lamp.position.set(Math.cos(angle) * 2.55, y, SITE.shaft.z + Math.sin(angle) * 2.55);
    scene.add(lamp);
    return lamp;
  });
  const shaft = shaftLamps[1];

  // The hall is nearly sixty metres long. A single lamp at one end fell off to
  // nothing before it reached the camera, which is why the archive read black.
  // Three range-limited practicals sit along the aisle instead.
  const vaultLamps = [-26, -44, -62].map(z => {
    const lamp = new THREE.PointLight(0x65d8cf, 0, 30, 1.5);
    lamp.name = `archive-practical-${Math.abs(z)}`;
    lamp.position.set(0, -9.5, z);
    scene.add(lamp);
    return lamp;
  });
  const vault = vaultLamps[1];

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  renderer.shadowMap.needsUpdate = true;

  let signalBase = 38;
  let stormLevel = 0;
  let submerged = 0;
  const flashDirection = new THREE.Vector3();
  const published = { flash: 0 };

  const rimStorm = new THREE.Color(0x4e9da2);
  const rimDawn = new THREE.Color(0xffb877);
  const skyStorm = new THREE.Color(0x8eaaad);
  // Ambient is sky bounce, and at dawn the sky directly overhead — the half of it
  // a hemisphere light actually samples — is the violet stop, not the gold one.
  // Warming this warmed the shadow side of every surface too, which is how the
  // masonry and the reef came out as pink sandstone: with key, rim and fill all
  // on the same side of neutral there was nothing cool left in the frame to make
  // the warmth read as light rather than as a wash over everything. Cool fill,
  // warm key and rim — the split the reference is built on.
  const skyDawn = new THREE.Color(0xa8adc6);

  function setState(state) {
    // Lightning belongs to the weather, so it rides the rain: full through the
    // storm, thinning on the way down, gone by dawn. Muffled rather than absent
    // once the camera is under the surface — a flash still reaches you down there.
    stormLevel = state.air.rain;
    submerged = state.ocean.underwater;
    const dawn = state.visible.dawn;
    // The moon becomes the sun. Same direction, same accent, more of it — the
    // light that was the moon is the light that brings the morning.
    skyMaterial.uniforms.uMoonBright.value = 1 + dawn * 1.5;
    // Kept low on purpose. The accent is a saturated copper, and at any real
    // intensity a low grazing backlight turns every normal-mapped ridge on the wet
    // rock into a speckle of hot orange that reads as embers rather than as a moon
    // on a cold sea. What is wanted from it is the rim and the glitter path, and
    // both of those arrive well before the sparkle does.
    // More than doubling this at dawn is what actually flooded the closing frame.
    // From the surfacing camera this light travels roughly *with* the view axis,
    // so at 2.05 it stopped being a backlight and became a warm frontal flood:
    // every rock face and the whole sea got the same peach wash, the reef came out
    // the value of the sky behind it, and the frame lost its darks. In the
    // reference the low sun does almost none of the filling — it draws a rim and
    // a glitter path on water that is otherwise dark. Held near its night value
    // so it goes back to doing that.
    moon.intensity = (.95 + dawn * .28) * state.visible.exterior * (1 - submerged * .72);
    ambient.intensity = state.light.ambient;
    key.intensity = state.light.key;
    rim.intensity = state.light.rim;
    // Cold ocean bounce all the way through the storm and the descent; warm
    // morning light as the surface comes back. A dawn rim in North Atlantic
    // teal is the single thing that made that beat read as synthetic.
    rim.color.copy(rimStorm).lerp(rimDawn, state.visible.dawn);
    ambient.color.copy(skyStorm).lerp(skyDawn, state.visible.dawn);
    signalBase = state.light.signal;
    vaultLamps.forEach(lamp => { lamp.intensity = state.light.vault; });
    const enclosed = Math.min(1, state.visible.archive * 1.4 + state.ocean.underwater * .5);
    shaftLamps.forEach(lamp => { lamp.intensity = THREE.MathUtils.lerp(3, 70, enclosed); });
    // These two are architectural practicals and they were constants — the sea
    // door alone is 95 units of warm amber on a 27 metre range, sitting at y -8.2
    // right under the tower. Through the storm and the descent that is the point
    // of it. At first light it was still burning into the reef and the near water
    // from below, and it, not the sky, is what actually made the closing frame
    // read as dirty: everything within 27 metres of the tower base got the same
    // amber wash regardless of what the sky was doing, which is why warming the
    // sky only ever made the mud warmer. A porch lamp is invisible at sunrise.
    porch.intensity = PORCH_INTENSITY * (1 - dawn);
    seaDoor.intensity = SEA_DOOR_INTENSITY * (1 - dawn);
    skyMaterial.uniforms.uDawn.value = state.visible.dawn;
    skyMaterial.uniforms.uFogColor.value.copy(state.fog.color);
  }

  function update(time) {
    skyMaterial.uniforms.uTime.value = time;
    signal.intensity = signalBase * (.94 + Math.sin(time * 1.07) * .045 + Math.sin(time * 3.9) * .015);

    // Only three candidate strikes can be live at once, so this stays O(1) and
    // allocates nothing.
    let flash = 0;
    let azimuth = 0;
    let closeness = 0;
    const around = Math.floor(time / STRIKE_GAP);
    for (let index = around - 1; index <= around + 1; index += 1) {
      if (index < 0) continue;
      const energy = strikeEnvelope(time - strikeAt(index));
      if (energy <= 0) continue;
      const near = strikeHash(index * 7 + 3);
      const weighted = energy * (.26 + near * near * 1.6);
      if (weighted > flash) {
        flash = weighted;
        closeness = near;
        azimuth = strikeHash(index * 11 + 5) * Math.PI * 2;
      }
    }

    // Clamped. The per-strike closeness multiplier tops out at 1.86, and with the
    // sky term multiplying by 3.6 a close strike was adding better than five times
    // the accent across a quarter of the dome — which blew out as a broad, soft,
    // orange wash that read as a sunset rather than as a strike. The energy now
    // goes into how hard the near field is lit, not into flooding the sky.
    flash = Math.min(1, flash) * stormLevel;
    skyMaterial.uniforms.uFlash.value = flash;
    if (flash > 0) {
      flashDirection.set(Math.cos(azimuth), .14 + closeness * .16, Math.sin(azimuth)).normalize();
      skyMaterial.uniforms.uFlashDir.value.copy(flashDirection);
      bolt.position.copy(flashDirection).multiplyScalar(150);
      bolt.position.z -= 20;
    }
    bolt.intensity = flash * (5.5 + closeness * 30) * (1 - submerged * .55);
    published.flash = flash;
  }

  function freezeShadows() {
    renderer.shadowMap.autoUpdate = false;
  }

  function requestShadowUpdate() {
    renderer.shadowMap.needsUpdate = true;
  }

  function dispose() {
    sky.geometry.dispose();
    skyMaterial.dispose();
    [sky, ambient, key, key.target, rim, rim.target, moon, moon.target, bolt, bolt.target, signal, porch, seaDoor, ...shaftLamps, ...vaultLamps].forEach(object => object.removeFromParent());
  }

  return {
    sky, ambient, key, rim, moon, bolt, signal, shaft, vault, flashDirection,
    get flash() { return published.flash; },
    setState, update, freezeShadows, requestShadowUpdate, dispose
  };
}
