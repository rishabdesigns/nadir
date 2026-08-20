import * as THREE from '../../../vendor/three.module.min.js';
import { SITE } from './site-plan.js';

// Circles describing everything that breaks the surface: xy is the position on
// the water plane, z is the radius. The sea meeting solid rock along a hard
// clean line was the strongest remaining tell that this is a plane intersecting
// solids rather than a shore. Both stages need this now — the fragment stage to
// wash foam against the rock, and the vertex stage to shoal the swell down as it
// runs into it, because a three-metre wave that keeps its full height right up to
// the stone slices through the rock instead of breaking on it.
const SHORE_COUNT = 14;

const shoreChunk = `
  uniform vec3 uShore[SHORE_COUNT];
  uniform int uShoreUsed;

  // Distance out to the nearest shore, negative inside rock.
  float shoreDistance(vec2 here) {
    float nearest = 1e9;
    for (int index = 0; index < SHORE_COUNT; index += 1) {
      if (index >= uShoreUsed) break;
      vec3 circle = uShore[index];
      nearest = min(nearest, length(here - circle.xy) - circle.z);
    }
    return nearest;
  }

  // How much open water this point has to build a wave in.
  float shoalFactor(vec2 here) {
    return .16 + .84 * smoothstep(-1.0, 26.0, shoreDistance(here));
  }
`;

const vertexShader = `
  uniform float uTime;
  uniform float uStorm;
  uniform float uSwell;
  varying vec3 vWorld;
  varying vec3 vNormalWorld;
  varying float vHeight;
  varying float vSteep;
  varying float vShoal;

  ${shoreChunk}

  // A swell crest is not a sine. Water piles into a narrow peak and leaves a long
  // flat trough behind it, so each component is remapped through a power curve
  // before it is summed. Sines alone gave the sea a quilted, upholstered look at
  // any amplitude large enough to see.
  float swellTerm(vec2 point, vec2 direction, float wavelength, float speed, float sharpen) {
    float phase = dot(point, direction) * (6.2831853 / wavelength) + uTime * speed;
    float raised = sin(phase) * .5 + .5;
    return pow(raised, sharpen) * 2.0 - 1.0;
  }

  // Height in metres above the still surface. The station log in the hero reads
  // "Swell 6.2 m", which is a crest-to-trough figure, so the three swell trains
  // are scaled to reach roughly +-3 m in open water at full storm.
  float waveHeight(vec2 point) {
    float swell = swellTerm(point, vec2(.923, .385), 74.0, .55, 1.75) * 1.52;
    swell += swellTerm(point, vec2(.615, -.788), 47.0, .78, 1.55) * .94;
    swell += swellTerm(point, vec2(.196, .981), 128.0, .36, 1.35) * .72;
    // Wind chop rides on top, kept well above the 1.6 m mesh spacing so it is
    // carried by the geometry rather than aliasing across it.
    float chop = sin(point.x * .34 - point.y * .21 + uTime * 1.31) * .21;
    chop += sin(point.x * .19 + point.y * .47 - uTime * 1.06) * .12;
    return (swell * mix(.42, 1.0, uStorm) + chop * uStorm) * uSwell;
  }

  void main() {
    // Shore distance is measured before displacement: raising the surface does
    // not move it across the plan.
    vec2 worldFlat = (modelMatrix * vec4(position.xy, 0.0, 1.0)).xz;
    float shoal = shoalFactor(worldFlat);

    vec3 point = position;
    float height = waveHeight(worldFlat) * shoal;
    float stepSize = .8;
    float heightX = waveHeight(worldFlat + vec2(stepSize, 0.0)) * shoalFactor(worldFlat + vec2(stepSize, 0.0));
    float heightY = waveHeight(worldFlat + vec2(0.0, stepSize)) * shoalFactor(worldFlat + vec2(0.0, stepSize));
    point.z += height;

    float slopeX = (heightX - height) / stepSize;
    float slopeY = (heightY - height) / stepSize;
    vec3 localNormal = normalize(vec3(-slopeX, -slopeY, 1.0));
    vec4 world = modelMatrix * vec4(point, 1.0);
    vWorld = world.xyz;
    vNormalWorld = normalize(mat3(modelMatrix) * localNormal);
    vHeight = height;
    // Steepness, not height, is what decides where water breaks.
    vSteep = length(vec2(slopeX, slopeY));
    vShoal = shoal;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uMoonDir;
  uniform vec3 uMoonColor;
  uniform vec3 uSignalPos;
  uniform vec3 uSignalColor;
  uniform vec3 uAccent;
  uniform float uFlash;
  uniform vec3 uFlashDir;
  uniform float uUnderwater;
  uniform float uFoam;
  uniform float uCaustics;
  uniform float uFogDensity;
  uniform vec3 uFogColor;
  uniform vec3 uDeep;
  uniform vec3 uSurface;
  uniform vec3 uSky;
  varying vec3 vWorld;
  varying vec3 vNormalWorld;
  varying float vHeight;
  varying float vSteep;
  varying float vShoal;

  float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
  }

  // floor()ing world position straight into hash() quantised the foam into hard
  // square cells — a visible checkerboard across the water. Interpolating between
  // lattice corners gives breakup without the grid.
  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 frac = fract(point);
    vec2 blend = frac * frac * (3.0 - 2.0 * frac);
    float a = hash(cell);
    float b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0));
    float d = hash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  }

  ${shoreChunk}

  void main() {
    vec3 normal = normalize(vNormalWorld);
    vec3 viewDirection = normalize(cameraPosition - vWorld);
    float facing = clamp(dot(viewDirection, normal), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 4.0);
    float distanceToCamera = length(cameraPosition - vWorld);

    float crest = smoothstep(.3, 2.2, vHeight);
    float micro = valueNoise(vWorld.xz * 2.4 + uTime * .2) * .6
                + valueNoise(vWorld.xz * 7.1 - uTime * .35) * .4;

    // How much of the sea a single pixel covers. Everything below is either
    // near-field detail that has to fade out before it aliases, or far-field
    // statistics that only make sense once a pixel spans many crests.
    float packing = smoothstep(38.0, 155.0, distanceToCamera);

    // Near water: whitecaps live on the steep forward face of a crest, and the
    // foam they leave behind is torn apart rather than evenly spread. The tearing
    // is metre-scale, so it is dissolved into a flat coverage as it recedes —
    // carried to the horizon it turned into fine engraved hatching.
    float breaking = smoothstep(.42, .95, vSteep) * smoothstep(.15, 1.1, vHeight);
    breaking *= mix(.35 + micro * .95, .78, packing);

    // Far water: what the eye reads at range is the fraction of the sea that is
    // broken, not any single crest. Without this the horizon was a ruled line —
    // the swell is there, but three metres of it at a hundred and fifty metres
    // subtends too little to survive the haze on its own. The patches are drawn
    // out along the crests of the dominant swell, because that is the direction
    // breaking water actually runs.
    vec2 crestAxis = vec2(-.385, .923);
    vec2 travelAxis = vec2(.923, .385);
    vec2 capPoint = vec2(dot(vWorld.xz, crestAxis) * .029, dot(vWorld.xz, travelAxis) * .052 + uTime * .014);
    float streak = valueNoise(capPoint) * .58 + valueNoise(capPoint * 3.7 + uTime * .04) * .42;
    float distantCaps = smoothstep(.5, .86, streak) * packing;

    float whitecap = clamp(max(breaking, distantCaps), 0.0, 1.0) * vShoal * uFoam;

    float brokenReflection = .5 + .5 * sin(vWorld.x * .7 + vWorld.z * .43 + uTime * .65);
    vec3 surfaceColor = mix(uDeep, uSurface, crest * .48 + fresnel * .58);
    surfaceColor = mix(surfaceColor, uSky, fresnel * (.42 + brokenReflection * .15));
    surfaceColor = mix(surfaceColor, vec3(.7, .78, .77), whitecap * .74);

    // Wash against the rock. The band breathes in and out with the swell so it
    // reads as water working at a shore rather than a painted outline, and it is
    // eaten into by noise so the edge is never a clean circle.
    // Warp the query point before measuring. Straight circle distance drew
    // literal rings on the water; pushing the sample around with noise turns each
    // one into an irregular shoreline that still tracks its rock.
    vec2 warp = vec2(
      valueNoise(vWorld.xz * .28 + uTime * .05),
      valueNoise(vWorld.xz * .31 - uTime * .04)
    ) - .5;
    float distance = shoreDistance(vWorld.xz + warp * 6.4);
    // The wash now runs up the rock on the actual wave that arrives rather than
    // on a sine of its own, so crest and run-up are the same event.
    float band = 1.5 + clamp(vHeight, -1.0, 3.0) * 1.15 + 1.1;
    float wash = 1.0 - smoothstep(0.0, band, max(distance, 0.0));
    wash *= smoothstep(-1.6, -.2, distance);
    wash *= .45 + valueNoise(vWorld.xz * 1.6 - uTime * .5) * .85;
    // A brighter lip right at the rock, where the water is thinnest.
    float lip = (1.0 - smoothstep(0.0, .55, max(distance, 0.0))) * smoothstep(-.7, -.1, distance);
    float shoreFoam = clamp(wash * .9 + lip * .8, 0.0, 1.0) * uFoam;
    surfaceColor = mix(surfaceColor, vec3(.78, .85, .84), shoreFoam * .74);

    // Nothing in the frame was reflecting anything, because this material is hand
    // shaded and has no lights bound to it — it never saw the moon, the optic or a
    // strike. A sea without specular is a painted floor, and that is the reason
    // the water read flat no matter what the sky was doing.
    //
    // Blinn-Phong against the wave normal. The crests carry varied normals, so the
    // moon breaks into a glitter path running back toward the horizon rather than
    // sitting on the water as a single blob.
    // The swell normal alone is far too smooth to glitter: at any exponent broad
    // enough to catch it, the highlight covers half the sea as a milky smear. Real
    // glitter is thousands of individual facets each catching the light for an
    // instant, so the normal is jittered at a much higher frequency for the
    // specular term only — the shading normal is left alone.
    vec3 facet = normalize(normal + vec3(
      valueNoise(vWorld.xz * 5.4 + uTime * .55) - .5,
      0.0,
      valueNoise(vWorld.xz * 6.1 - uTime * .48) - .5) * .62);

    vec3 moonHalf = normalize(uMoonDir + viewDirection);
    float moonSpec = pow(max(0.0, dot(facet, moonHalf)), 420.0);
    surfaceColor += uMoonColor * moonSpec * 3.2;

    // The optic is a point source a few metres up, so its reflection runs back
    // toward the tower and falls off with distance instead of lying on the horizon.
    vec3 toSignal = uSignalPos - vWorld;
    float signalRange = max(length(toSignal), .001);
    vec3 signalHalf = normalize(toSignal / signalRange + viewDirection);
    float signalSpec = pow(max(0.0, dot(facet, signalHalf)), 260.0);
    surfaceColor += uSignalColor * signalSpec * (900.0 / (signalRange * signalRange + 260.0));

    // A strike lifts the whole surface briefly and throws its own highlight.
    vec3 flashHalf = normalize(uFlashDir + viewDirection);
    float flashSpec = pow(max(0.0, dot(facet, flashHalf)), 110.0);
    surfaceColor += uAccent * uFlash * (.14 + flashSpec * 2.1);

    // Whether this fragment is being seen from above or from beneath is a fact
    // about the geometry, and it was being decided by journey position instead —
    // so through the crossing the camera could be plainly above the water while
    // the shader was already half-submerged, and plainly below it while the shader
    // was still half a surface. Measured across that stretch the frame's mean
    // luminance went 35.8, 47.4, 46.2, 35.3, 53.7, 69.6: up, back down, then a
    // lurch. This is exact, and it is per-fragment, so a crest passing the lens
    // gets it right too.
    float facingSign = dot(viewDirection, normal);
    float submerged = 1.0 - smoothstep(-.05, .05, facingSign);

    // Seen from beneath, the surface is not dark water — it is a lit ceiling.
    // Within about forty-nine degrees of vertical the whole sky is refracted into
    // a bright disc, and outside it the underside turns mirror. The old below
    // colour was uDeep darkened further, which is why looking up through the
    // surface — the shot this whole beat is built on — went dark.
    float window = smoothstep(.36, .84, abs(facingSign));
    vec3 belowColor = mix(uDeep * .78, uSky * .92, window);
    belowColor = mix(belowColor, uSurface * 1.15, (1.0 - window) * .45);
    float caustic = pow(max(0.0, sin(vWorld.x * .72 + uTime) * sin(vWorld.z * .61 - uTime * .72)), 4.0) * uCaustics;
    belowColor += vec3(.18, .8, .76) * caustic * .34;
    vec3 color = mix(surfaceColor, belowColor, submerged);

    float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * distanceToCamera * distanceToCamera);
    // Capped at .88 the far sea kept an eighth of its own colour forever, so it
    // could never arrive at the value the sky was going to. It fogs out properly
    // now; the whitecap term below is what keeps the distant band from going
    // completely dead.
    color = mix(color, uFogColor, clamp(fogAmount, 0.0, .985));
    // Breaking water is far brighter than the haze in front of it, so the band of
    // packed crests below the horizon keeps a little contrast where the body of
    // the sea has none left.
    // This was added after the fog mix, so a whitecap two hundred metres out came
    // through at exactly the strength of one breaking at the camera. That is what
    // drew the horizon as a ruled line: the sea kept crisp bright texture right up
    // to where it stopped, against a sky that had none, so the join between them
    // was a hard edge no amount of colour matching could soften. Haze takes the
    // crests down with everything else now, leaving just enough to keep the
    // distant band from going dead.
    color += vec3(.085, .095, .095) * whitecap * packing * (1.0 - submerged)
      * mix(1.0, .12, clamp(fogAmount, 0.0, 1.0));

    // Looking along the surface you are looking through metres of water and see
    // nothing through it; looking down into it you see the bottom. Alpha was a
    // constant, which made the sea a sheet of frosted glass laid over the reef —
    // at dawn the submerged rock read as pale ice through milk.
    float throughWater = 1.0 - pow(clamp(abs(facingSign), 0.0, 1.0), 1.6);
    // Looking down into water you see further in than you do at a grazing angle,
    // which is why the floor here is below one — but a fixed .52 floor meant the
    // storm sea was half transparent straight down, and the submerged reef stood
    // up through it like glass. That ghosting was a good part of why the hero read
    // as a puddle rather than a sea. A churned surface is not see-through, so the
    // floor now rises with how opaque the beat asks the water to be: near solid
    // during the storm, still open during the crossing where the camera has to
    // watch the surface it is about to pass through.
    float clarityFloor = mix(.42, .86, uOpacity);
    // The horizon is not a horizon, it is the outer edge of a 230 m quad. Beyond
    // the fog's reach it makes no difference, but toward the sides the plane runs
    // out while there is still sea colour left in it, so the last stretch is faded
    // out and the water dissolves rather than stopping.
    vec2 fromCentre = vWorld.xz - vec2(0.0, -27.0);
    float edgeFade = 1.0 - smoothstep(370.0, 470.0, max(abs(fromCentre.x), abs(fromCentre.y)));
    float alpha = uOpacity * mix(clarityFloor, 1.0, throughWater) * mix(1.0, .58, submerged) * edgeFade;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createOcean(scene) {
  // 1.6 m between vertices: fine enough to carry the chop, coarse enough that the
  // per-fragment shore loop is still the dominant cost rather than the mesh.
  const geometry = new THREE.PlaneGeometry(230, 230, 144, 144);

  // The horizon was not a horizon, it was the edge of this quad. 230 m across
  // means the sides sit about 115 m out, and the fog is nowhere near finished at
  // that range — so the sea simply stopped, and because the side edges are seen
  // almost end-on the stop projected as a hard line right across the frame. No
  // amount of colour matching or edge fading fixed it: at a grazing angle the
  // whole fade band compresses into a handful of pixels.
  //
  // The outer fifth of the plane is pushed out to roughly 480 m instead. The
  // interior keeps its 1.6 m spacing where the waves have to read, the skirt is
  // stretched and under-sampled and it does not matter because it is behind a
  // hundred per cent of the fog, and it costs no extra vertices and no extra
  // draw call.
  {
    const position = geometry.attributes.position;
    const half = 115;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const reach = Math.max(Math.abs(x), Math.abs(y)) / half;
      if (reach <= .78) continue;
      const spread = (reach - .78) / .22;
      const factor = 1 + spread * spread * 3.4;
      position.setX(index, x * factor);
      position.setY(index, y * factor);
    }
    position.needsUpdate = true;
    geometry.computeBoundingSphere();
  }
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonColor: { value: new THREE.Color(0x000000) },
      uSignalPos: { value: new THREE.Vector3(0, 14.6, -13) },
      uSignalColor: { value: new THREE.Color(0x000000) },
      uAccent: { value: new THREE.Color(0x000000) },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(1, 0, 0) },
      uStorm: { value: .85 },
      uSwell: { value: 1 },
      uOpacity: { value: .88 },
      uUnderwater: { value: 0 },
      uFoam: { value: .72 },
      uCaustics: { value: 0 },
      uFogDensity: { value: .014 },
      uFogColor: { value: new THREE.Color(0x07171b) },
      uDeep: { value: new THREE.Color(0x03171d) },
      uSurface: { value: new THREE.Color(0x31555a) },
      uSky: { value: new THREE.Color(0x7f999b) },
      uShore: { value: Array.from({ length: SHORE_COUNT }, () => new THREE.Vector3()) },
      uShoreUsed: { value: 0 }
    },
    defines: { SHORE_COUNT }
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'continuous-ocean-surface';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, SITE.waterY, -27);
  mesh.renderOrder = 3;
  scene.add(mesh);

  // Called once after the world is built.
  function setShoreline(circles) {
    const used = Math.min(SHORE_COUNT, circles.length);
    for (let index = 0; index < used; index += 1) {
      const [x, z, radius] = circles[index];
      material.uniforms.uShore.value[index].set(x, z, radius);
    }
    material.uniforms.uShoreUsed.value = used;
  }

  // At a grazing angle water is almost entirely a mirror, so what the sea looks
  // like is mostly what the sky looks like. uSky was a fixed cold grey for the
  // whole journey: at dawn the sea went on reflecting a storm sky under an amber
  // one, which is why it read as fog lying on the water rather than water.
  const skyStorm = new THREE.Color(0x7f999b);
  // Warm, but nowhere near this warm. At a grazing angle fresnel is close to one
  // across almost the whole visible sea, so whatever colour goes in here is what
  // the entire surface becomes — and a saturated amber turned the water the colour
  // of rust from shore to horizon. A dawn sky is warm; a dawn sea reflecting it is
  // a pale warm grey, and the water underneath stays cold.
  // Still nowhere near a saturated amber, for the reason above — but the earlier
  // correction went past neutral and landed on a warm grey, which made the whole
  // sea one flat value. What the reference actually shows is a *split*: the far
  // water is grazing, so it is nearly all reflected sky and goes warm, while the
  // near water is steep enough to show its own body and stays green. That split
  // is already in the shader — uSky drives the far field through fresnel and
  // uSurface drives the near — so the two only have to be allowed to disagree.
  const skyDawn = new THREE.Color(0x7d6a63);
  const deepStorm = new THREE.Color(0x03171d);
  const deepDawn = new THREE.Color(0x061a1a);
  const surfaceStorm = new THREE.Color(0x31555a);
  const surfaceDawn = new THREE.Color(0x18403e);

  function setState(state) {
    const dawn = state.visible.dawn;
    material.uniforms.uSky.value.copy(skyStorm).lerp(skyDawn, dawn);
    material.uniforms.uDeep.value.copy(deepStorm).lerp(deepDawn, dawn);
    material.uniforms.uSurface.value.copy(surfaceStorm).lerp(surfaceDawn, dawn);
    material.uniforms.uOpacity.value = state.ocean.opacity;
    material.uniforms.uUnderwater.value = state.ocean.underwater;
    material.uniforms.uFoam.value = state.ocean.foam;
    material.uniforms.uCaustics.value = state.ocean.caustics;
    material.uniforms.uStorm.value = 1 - state.visible.dawn * .62;
    // Seen from beneath, the surface is a ceiling a few metres overhead; a full
    // three-metre swell on it reaches down past the camera in the shaft. The
    // swell is eased off as the journey submerges rather than switched away.
    material.uniforms.uSwell.value = 1 - state.ocean.underwater * .62;
    material.uniforms.uFogDensity.value = state.fog.density;
    material.uniforms.uFogColor.value.copy(state.fog.color);
  }

  // The sea has to be told what is lighting it, because nothing else will.
  function setLighting(lighting) {
    const uniforms = material.uniforms;
    uniforms.uMoonDir.value.copy(lighting.moon.position).sub(lighting.moon.target.position).normalize();
    uniforms.uMoonColor.value.copy(lighting.moon.color).multiplyScalar(lighting.moon.intensity * .5);
    uniforms.uSignalColor.value.copy(lighting.signal.color).multiplyScalar(lighting.signal.intensity * .012);
    uniforms.uAccent.value.copy(lighting.bolt.color);
    uniforms.uFlash.value = lighting.flash;
    uniforms.uFlashDir.value.copy(lighting.flashDirection);
  }

  function update(time) {
    material.uniforms.uTime.value = time;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    mesh.removeFromParent();
  }

  return { mesh, material, setShoreline, setLighting, setState, update, dispose };
}
