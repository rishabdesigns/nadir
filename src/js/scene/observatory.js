import * as THREE from '../../../vendor/three.module.min.js';
import { SCENE_SEED } from '../config.js';
import { SITE, createRandom, hash3, randomRange, randomSigned } from './site-plan.js';
import { clamp, lerp, smoothstep } from '../core/math.js';

const dummy = new THREE.Object3D();

function addBox(parent, size, position, material, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, radiusTop, radiusBottom, height, segments, position, material, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createInstances(parent, geometry, material, transforms, shadows = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  transforms.forEach((transform, index) => {
    dummy.position.set(...transform.position);
    dummy.rotation.set(...(transform.rotation ?? [0, 0, 0]));
    dummy.scale.set(...(transform.scale ?? [1, 1, 1]));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  parent.add(mesh);
  return mesh;
}

function addLathe(parent, profile, segments, material, y = 0) {
  const points = profile.map(([radius, height]) => new THREE.Vector2(radius, height));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(points, segments), material);
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// A stack of boxes reads as a stack of boxes from any angle. The tower is turned
// as a single battered profile instead — plinth, entasis, corbelled gallery,
// lantern room and cap — so the silhouette alone says lighthouse.
function towerProfile() {
  const { baseY } = SITE.tower;
  const profile = [
    [0, baseY],
    [8.4, baseY],
    [8.4, baseY + 3.4],
    [7.5, baseY + 4.2]
  ];

  // Entasis: the shaft narrows on a curve rather than a straight cone, which is
  // what stops it reading as a funnel.
  const shaftBottom = baseY + 4.2;
  const shaftTop = 10.6;
  const steps = 14;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const height = lerp(shaftBottom, shaftTop, t);
    const radius = lerp(6.6, 3.45, Math.pow(t, .78));
    profile.push([radius, height]);
  }

  profile.push(
    [3.45, 11.1],
    [5.35, 11.7],   // gallery deck, projecting
    [5.35, 12.35],
    [4.05, 12.55],
    [3.15, 12.75],  // lantern sill
    [3.15, 12.95],
    [0, 12.95]      // closed as the lantern floor
  );
  return profile;
}

// The roof is a separate solid. Revolving one continuous profile through the
// lantern height would wrap the optic in an opaque stone drum — which is exactly
// what hid the signal.
function roofProfile() {
  return [
    [0, 16.35],
    [3.55, 16.35],  // eaves overhang
    [3.55, 16.62],
    [2.1, 17.9],
    [.6, 18.7],
    [.28, 19.4],
    [0, 19.4]
  ];
}

// A lathe cannot have a hole cut in it, so each opening is made by splitting the
// profile into horizontal bands and revolving the band that contains the opening
// as a partial arc instead of a full turn.
//
// LatheGeometry's phi runs from +Z toward +X, and every azimuth below is written
// in that convention. The gantry door was cut at phi 0 — facing +Z, ninety degrees
// away from the gantry, the jambs and the route the camera actually takes — so the
// way in was solid masonry with a hole in the back of the tower, and only the shell
// dissolve hid it. The camera reported clearance of twelve centimetres crossing the
// threshold because it was crossing stone.
const OPENINGS = Object.freeze([
  // The mouth at the foot of the shaft, where the plinth opens into the archive.
  // Without it the only route from the stair into the hall ran through both skins
  // of the tower base.
  { sill: -14.2, head: -9.4, azimuth: Math.PI, half: .42 },
  // The gantry door, on the seaward face at deck level.
  { sill: 8.4, head: 11.05, azimuth: Math.PI / 2, half: .33 }
]);

// The gantry door, which the jambs, lintel and threshold are hung off.
const DOOR = OPENINGS[1];

function radiusAtHeight(profile, height) {
  for (let index = 0; index < profile.length - 1; index += 1) {
    const [radiusA, heightA] = profile[index];
    const [radiusB, heightB] = profile[index + 1];
    if (height >= Math.min(heightA, heightB) && height <= Math.max(heightA, heightB)) {
      if (heightB === heightA) return Math.max(radiusA, radiusB);
      return lerp(radiusA, radiusB, (height - heightA) / (heightB - heightA));
    }
  }
  return profile[profile.length - 1][0];
}

function profileBand(profile, from, to) {
  const band = [[radiusAtHeight(profile, from), from]];
  for (const [radius, height] of profile) {
    if (height > from && height < to) band.push([radius, height]);
  }
  band.push([radiusAtHeight(profile, to), to]);
  return band;
}

// 48 segments put a facet every 7.5 degrees. On a tower seven metres across that
// fills half the frame in the closing shot, that is a visible flat every fifteen
// pixels down both edges — the structure read as faceted rather than turned.
const SHELL_SEGMENTS = 96;

function addDoorwayShell(group, profile, material) {
  const lowest = profile[0][1];
  const highest = profile[profile.length - 1][1];
  // Applied to the outer shell and to the inner face alike, so an opening is a
  // hole through the whole wall rather than a hole in one skin of it.
  const openings = OPENINGS
    .filter(opening => opening.head > lowest + .05 && opening.sill < highest - .05)
    .map(opening => ({ ...opening, sill: Math.max(opening.sill, lowest), head: Math.min(opening.head, highest) }))
    .sort((a, b) => a.sill - b.sill);

  const parts = [];
  let cursor = lowest;
  for (const opening of openings) {
    if (opening.sill > cursor + .02) {
      parts.push(addLathe(group, profileBand(profile, cursor, opening.sill), SHELL_SEGMENTS, material));
    }
    const band = profileBand(profile, opening.sill, opening.head).map(([radius, height]) => new THREE.Vector2(radius, height));
    const arc = new THREE.Mesh(
      new THREE.LatheGeometry(band, SHELL_SEGMENTS - 4, opening.azimuth + opening.half, Math.PI * 2 - opening.half * 2),
      material
    );
    arc.castShadow = true;
    arc.receiveShadow = true;
    group.add(arc);
    parts.push(arc);
    cursor = opening.head;
  }
  if (cursor < highest - .02) parts.push(addLathe(group, profileBand(profile, cursor, highest), SHELL_SEGMENTS, material));
  return parts;
}

function buildTower(parent, materials) {
  const group = new THREE.Group();
  group.name = 'observatory-tower';
  group.position.set(SITE.tower.x, 0, SITE.tower.z);
  parent.add(group);

  // Cloned so the shell can still fade independently of the reef, which shares the
  // same stone material — but the fade is now only a safety net for the moment the
  // camera is level with the jamb, not the way in.
  const shellMaterial = materials.masonry.clone();
  shellMaterial.transparent = true;
  const roofMaterial = materials.darkCopper.clone();
  roofMaterial.transparent = true;

  const shellParts = addDoorwayShell(group, towerProfile(), shellMaterial);
  const roof = addLathe(group, roofProfile(), SHELL_SEGMENTS, roofMaterial);

  // Jambs and threshold, so the opening reads as built rather than missing.
  const doorRadius = radiusAtHeight(towerProfile(), (DOOR.sill + DOOR.head) * .5);
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(.5, DOOR.head - DOOR.sill, .62), materials.wetStone);
    const phi = DOOR.azimuth + side * DOOR.half;
    jamb.position.set(
      Math.sin(phi) * doorRadius,
      (DOOR.sill + DOOR.head) * .5,
      Math.cos(phi) * doorRadius
    );
    jamb.rotation.y = Math.PI / 2 - phi;
    jamb.castShadow = true;
    group.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(.55, .42, 2.9), materials.wetStone);
  lintel.position.set(doorRadius - .05, DOOR.head + .1, 0);
  lintel.castShadow = true;
  group.add(lintel);
  const threshold = new THREE.Mesh(new THREE.BoxGeometry(1.5, .24, 2.9), materials.salt);
  threshold.position.set(doorRadius - .3, DOOR.sill - .1, 0);
  threshold.receiveShadow = true;
  group.add(threshold);

  // The shaft descends inside the tower, but the outer skin is single-sided, so
  // from within the camera looked straight out through the walls. This is the
  // inner face: the same profile drawn inward, one metre in, which turns the
  // descent into an enclosed space instead of an open frame.
  const inner = towerProfile()
    .filter(([radius]) => radius > 1.6)
    .map(([radius, height]) => [Math.max(1.2, radius - 1), height]);
  const interiorParts = addDoorwayShell(group, inner, materials.towerInterior);

  // Corbels carrying the gallery. Repetition at this scale is what gives the
  // eye something to measure the tower against.
  const corbels = [];
  const corbelCount = 24;
  for (let index = 0; index < corbelCount; index += 1) {
    const angle = index / corbelCount * Math.PI * 2;
    corbels.push({
      position: [Math.cos(angle) * 4.35, 11.32, Math.sin(angle) * 4.35],
      rotation: [0, -angle, 0]
    });
  }
  createInstances(group, new THREE.BoxGeometry(1.5, .58, .42), materials.wetStone, corbels);

  // Gallery rail: uprights plus two continuous rings.
  const uprights = [];
  const railCount = 32;
  for (let index = 0; index < railCount; index += 1) {
    const angle = index / railCount * Math.PI * 2;
    uprights.push({ position: [Math.cos(angle) * 5.15, 13.05, Math.sin(angle) * 5.15] });
  }
  createInstances(group, new THREE.CylinderGeometry(.055, .055, 1.4, 6), materials.copper, uprights);
  for (const height of [13.68, 12.72]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.15, .062, 8, 56), materials.copper);
    ring.position.y = height;
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    group.add(ring);
  }

  // Lantern glazing with copper astragals — the vertical rhythm that reads as a
  // lamp room rather than a drum.
  const glazing = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 3.5, 24, 1, true), materials.lanternGlass);
  glazing.position.y = 14.6;
  group.add(glazing);

  const astragals = [];
  const astragalCount = 12;
  for (let index = 0; index < astragalCount; index += 1) {
    const angle = index / astragalCount * Math.PI * 2;
    astragals.push({
      position: [Math.cos(angle) * 3.14, 14.6, Math.sin(angle) * 3.14],
      rotation: [0, -angle, 0]
    });
  }
  createInstances(group, new THREE.BoxGeometry(.16, 3.7, .16), materials.darkCopper, astragals);

  // Window slots up the shaft, spiralling with the interior stair.
  const windows = [];
  for (let index = 0; index < 9; index += 1) {
    const angle = index * .82;
    const height = -8.5 + index * 2.15;
    const radius = lerp(6.4, 3.6, (height + 11.8) / 22.4) - .1;
    windows.push({
      position: [Math.cos(angle) * radius, height, Math.sin(angle) * radius],
      rotation: [0, -angle, 0]
    });
  }
  createInstances(group, new THREE.BoxGeometry(.5, 1.5, .6), materials.glass, windows, false);

  // Sea door and its hood at the landing.
  addBox(group, [2.1, 3.1, .7], [0, -8.9, 7.15], materials.darkCopper);
  addBox(group, [2.7, .3, 1.2], [0, -7.2, 7.3], materials.wetStone);

  // Wave-break buttresses where the plinth meets the rock. One of the six stood
  // squarely across the mouth into the archive, four metres of it directly on the
  // route out of the shaft — nobody builds a buttress across their own door, so
  // any that falls in an opening is left out and the gap reads as intended.
  const buttresses = [];
  const buttressTop = SITE.tower.baseY + 1.9 + 2.3;
  const buttressFoot = SITE.tower.baseY + 1.9 - 2.3;
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2 + .4;
    // Lathe phi, so this can be compared against the opening azimuths directly.
    const phi = Math.PI / 2 - angle;
    const blocked = OPENINGS.some(opening => {
      if (opening.head < buttressFoot || opening.sill > buttressTop) return false;
      let offset = Math.abs(((phi - opening.azimuth + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      return offset < opening.half + .3;
    });
    if (blocked) continue;
    buttresses.push({
      position: [Math.cos(angle) * 8.1, SITE.tower.baseY + 1.9, Math.sin(angle) * 8.1],
      rotation: [0, -angle, 0],
      scale: [1, 1, 1]
    });
  }
  createInstances(group, new THREE.BoxGeometry(1.8, 4.6, 3.2), materials.wetStone, buttresses);

  // The lens sits inside the lantern room, on the tower axis.
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(SITE.lens.radius, SITE.lens.radius, 2.3, 32),
    materials.lens
  );
  lens.position.y = 14.6;
  group.add(lens);

  const lensCage = new THREE.Group();
  lensCage.position.y = 14.6;
  group.add(lensCage);
  for (const height of [-1.2, 1.2]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(SITE.lens.radius + .1, .1, 8, 40), materials.copper);
    ring.position.y = height;
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    lensCage.add(ring);
  }
  // Fresnel-style vertical prisms: the cage that makes the lantern read as optics.
  const prisms = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2;
    prisms.push({
      position: [Math.cos(angle) * (SITE.lens.radius + .04), 0, Math.sin(angle) * (SITE.lens.radius + .04)],
      rotation: [0, -angle, 0]
    });
  }
  createInstances(lensCage, new THREE.BoxGeometry(.1, 2.3, .28), materials.copper, prisms, false);

  return { group, lens, lensCage, shellMaterial, roofMaterial, shellParts, roof, interiorParts };
}

function buildGantry(parent, materials) {
  const group = new THREE.Group();
  group.name = 'storm-gantry';
  parent.add(group);
  const length = SITE.gantry.endX - SITE.gantry.startX;
  const center = (SITE.gantry.endX + SITE.gantry.startX) * .5;
  addBox(group, [length, .72, 4.2], [center, SITE.gantry.y, SITE.gantry.z], materials.wetStone);
  addBox(group, [length, .18, .5], [center, SITE.gantry.y + .48, SITE.gantry.z], materials.salt);

  // Both of these were fixed counts spread across a fixed span. With the span now
  // set by the site plan a fixed count would stretch the railing stanchions out to
  // two and a half metres apart and leave the last seventeen metres of deck with
  // no truss under it at all, so both derive their count from the length and keep
  // the spacing the shot was composed at.
  const POST_SPACING = 1.625;
  const posts = [];
  const count = Math.round(length / POST_SPACING) + 1;
  for (let index = 0; index < count; index += 1) {
    const x = SITE.gantry.startX + index / (count - 1) * length;
    posts.push({ position: [x, SITE.gantry.y + 1.08, SITE.gantry.z - 1.78] });
    posts.push({ position: [x, SITE.gantry.y + 1.08, SITE.gantry.z + 1.78] });
  }
  createInstances(group, new THREE.CylinderGeometry(.075, .09, 1.45, 8), materials.copper, posts);
  addBox(group, [length, .11, .11], [center, SITE.gantry.y + 1.76, SITE.gantry.z - 1.78], materials.copper);
  addBox(group, [length, .11, .11], [center, SITE.gantry.y + 1.76, SITE.gantry.z + 1.78], materials.copper);

  const BRACE_SPACING = 3.15;
  const braces = [];
  for (let x = 2; x <= SITE.gantry.endX - 2; x += BRACE_SPACING) {
    braces.push({ position: [x, SITE.gantry.y - 1.6, SITE.gantry.z], rotation: [0, 0, braces.length % 2 ? -.72 : .72] });
  }
  createInstances(group, new THREE.BoxGeometry(.22, 4.6, .22), materials.darkCopper, braces);
  return group;
}

function buildShaft(parent, materials) {
  const group = new THREE.Group();
  group.name = 'descent-shaft';
  parent.add(group);
  addCylinder(group, .42, .5, 27, 28, [SITE.shaft.x, -3, SITE.shaft.z], materials.darkCopper);

  const rings = [];
  const ringGeometry = new THREE.TorusGeometry(SITE.shaft.radius, .17, 8, 42);
  for (let index = 0; index < 12; index += 1) {
    rings.push({ position: [0, SITE.shaft.topY - index * 2.15, SITE.shaft.z], rotation: [Math.PI / 2, 0, 0] });
  }
  createInstances(group, ringGeometry, materials.copper, rings);

  const steps = [];
  for (let index = 0; index < 54; index += 1) {
    const angle = index * .49;
    steps.push({
      position: [Math.cos(angle) * 3.05, 9 - index * .46, SITE.shaft.z + Math.sin(angle) * 3.05],
      rotation: [0, -angle, 0]
    });
  }
  createInstances(group, new THREE.BoxGeometry(2.2, .17, .72), materials.copper, steps);

  const cables = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    cables.push({ position: [Math.cos(angle) * 3.65, -3, SITE.shaft.z + Math.sin(angle) * 3.65] });
  }
  createInstances(group, new THREE.CylinderGeometry(.045, .045, 27, 6), materials.darkCopper, cables, false);

  // The opening into the archive at the foot of the shaft.
  const aperture = new THREE.Mesh(new THREE.CircleGeometry(SITE.shaft.radius - .35, 32), materials.aperture);
  aperture.position.set(SITE.shaft.x, SITE.shaft.bottomY + .5, SITE.shaft.z);
  aperture.rotation.x = -Math.PI / 2;
  group.add(aperture);

  return group;
}

// Concatenate a list of transformed geometries into one buffer. The vendored
// three build carries no BufferGeometryUtils, and a basalt stack has to arrive as
// a single geometry or every column costs its own draw call.
function mergeGeometries(list) {
  const parts = list.map(geometry => geometry.toNonIndexed());
  const total = parts.reduce((sum, part) => sum + part.attributes.position.count, 0);
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);

  let offset = 0;
  for (const part of parts) {
    position.set(part.attributes.position.array, offset * 3);
    normal.set(part.attributes.normal.array, offset * 3);
    uv.set(part.attributes.uv.array, offset * 2);
    offset += part.attributes.position.count;
    part.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.computeBoundingSphere();
  return merged;
}

// Basalt fractures into vertical polygonal columns as it cools. That jointing is
// the whole identity of the rock, and no amount of displacement on a sphere will
// produce it — a sphere can only ever give a boulder. Each stack is a cluster of
// five- and six-sided prisms sheared off at different heights, merged into one
// geometry so the cluster still costs a single instanced draw.
function basaltStackGeometry(seed, columns = 13) {
  const random = createRandom(seed);
  const matrix = new THREE.Matrix4();
  const euler = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const parts = [];

  for (let index = 0; index < columns; index += 1) {
    const angle = random() * Math.PI * 2;
    // Square-rooted so columns cluster toward the centre instead of ringing it.
    const spread = Math.sqrt(random()) * .82;
    const radius = randomRange(random, .17, .31);
    const height = randomRange(random, .8, 2);
    const sides = random() < .58 ? 6 : 5;

    // Columns lean away from the centre of the stack, as a cooling front does.
    const lean = spread * randomRange(random, .12, .3);
    euler.set(Math.sin(angle) * lean, random() * Math.PI, -Math.cos(angle) * lean);
    quaternion.setFromEuler(euler);
    matrix.compose(
      new THREE.Vector3(Math.cos(angle) * spread, -1 + height * .5, Math.sin(angle) * spread),
      quaternion,
      scale
    );

    const column = new THREE.CylinderGeometry(radius * randomRange(random, .82, 1), radius, height, sides, 1);
    column.applyMatrix4(matrix);
    parts.push(column);
  }

  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

// `hash3` is a hash, not a noise field: neighbouring inputs return uncorrelated
// values. Driving vertex displacement with it directly gives every vertex an
// independent radius, which is what shattered the rock into splinters. Lattice
// value noise restores spatial coherence — the hash is sampled on integer cell
// corners and smoothly interpolated between them, so adjacent vertices move
// together and the surface reads as stone.
function valueNoise(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = smoothstep(0, 1, x - xi);
  const v = smoothstep(0, 1, y - yi);
  const w = smoothstep(0, 1, z - zi);
  const corner = (i, j, k) => hash3(xi + i, yi + j, zi + k, seed);
  const y0 = lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), u), lerp(corner(0, 1, 0), corner(1, 1, 0), u), v);
  const y1 = lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), u), lerp(corner(0, 1, 1), corner(1, 1, 1), u), v);
  return lerp(y0, y1, w);
}

// An icosahedron is non-indexed: one corner is repeated in up to five triangles.
// Every displacement term must be a pure function of the surface direction, or
// those copies drift apart and the rock tears open. Directions are quantized so
// float drift in the subdivided midpoints cannot reintroduce the split.
function quantize(value) {
  return Math.round(value * 4096) / 4096;
}

// The top octave stays coarser than the icosahedron's edge length, otherwise the
// mesh cannot represent it and the spikes come straight back as aliasing.
const ROCK_OCTAVES = [
  { frequency: 2.2, amplitude: .30 },
  { frequency: 5.0, amplitude: .12 },
  { frequency: 9.0, amplitude: .05 }
];

function displacedRockGeometry(seed, detail = 2) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.attributes.position;
  const direction = new THREE.Vector3();
  // One profile per rock rather than per vertex: this elongates or flattens the
  // whole form instead of adding another layer of per-vertex noise.
  const squash = .78 + hash3(seed, 17, 31, seed) * .46;

  for (let index = 0; index < position.count; index += 1) {
    direction.fromBufferAttribute(position, index).normalize();
    const x = quantize(direction.x);
    const y = quantize(direction.y);
    const z = quantize(direction.z);
    let radius = .80;
    for (let octave = 0; octave < ROCK_OCTAVES.length; octave += 1) {
      const { frequency, amplitude } = ROCK_OCTAVES[octave];
      radius += valueNoise(x * frequency, y * frequency, z * frequency, seed + octave * 97) * amplitude;
    }
    position.setXYZ(index, direction.x * radius, direction.y * radius * squash, direction.z * radius);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// The far coast used to be fifteen copies of one rock in one flat grey, standing
// in a single row at a single depth. At a hundred and forty metres the scene's
// exponential-squared fog is already past ninety-five per cent, so every one of
// them resolved to the same value as the sky behind it and the whole coast read
// as a paper cutout.
//
// Two things fix that, and both are what a landscape painter would do. Ranges are
// separated in depth so one overlaps the next, and each range is hazed on a
// shallower curve than the scene fog — the mood fog is authored for the
// forty-metre foreground and saturates long before it reaches the coast, so the
// headlands carry their own falloff and keep the near range darker than the far
// one. Haze also pools low, so a range dissolves at its foot before its crest
// does, which is what actually separates one ridge from the one behind it.
const headlandVertex = `
  varying vec3 vShade;
  varying float vAltitude;
  varying float vDistance;

  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 localNormal = normal;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      localNormal = mat3(instanceMatrix) * normal;
    #endif
    vec4 world = modelMatrix * local;
    vShade = normalize(mat3(modelMatrix) * localNormal);
    vAltitude = world.y;
    vDistance = length(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const headlandFragment = `
  uniform vec3 uRock;
  uniform vec3 uHaze;
  uniform float uDepth;
  uniform float uFalloff;
  varying vec3 vShade;
  varying float vAltitude;
  varying float vDistance;

  void main() {
    vec3 normal = normalize(vShade);
    // One soft skylight and nothing else. At this range the point of shading is
    // to keep the mass from reading as a stencil, not to describe its surface.
    float sky = clamp(normal.y * .5 + .5, 0.0, 1.0);
    float seaward = clamp(-normal.z * .5 + .5, 0.0, 1.0);
    // Shading gain falls off with range as well. A far ridge that still picks up
    // a 1.32x skylight kick is a ridge the eye reads as *nearer* than the mass in
    // front of it, whatever its colour, because the light on it is doing more work.
    // The near end comes below 1.0 too: the first range has to sit clearly under
    // the sea, not level with it.
    float gain = mix(.92, .66, uDepth);
    vec3 color = mix(uRock * .66 * gain, uRock * 1.32 * gain, sky * .74 + seaward * 1.15);

    float haze = 1.0 - exp(-uFalloff * uFalloff * vDistance * vDistance);
    float pooling = 1.0 - smoothstep(-6.0, 18.0, vAltitude);
    haze = clamp(haze + pooling * .26 * (1.0 - uDepth * .35), 0.0, .96);

    // The air a far range dissolves into is not the same value as the air at forty
    // metres. Bound to the live fog colour alone, the last ridge went pale at dawn
    // and read as the nearest thing on screen; sinking the haze target with range
    // keeps the coast stepping away from the eye in every weather.
    //
    // The near end of this ramp used to be 1.0 — the raw fog colour — and that is
    // the specific reason the first range would not separate from the water. At
    // 140 metres the haze term is already about .64, so a range settling onto the
    // unmodified fog colour converges on the same value the sea converges on, and
    // two things arriving at one colour cannot be told apart whatever their albedo
    // is. The whole coast now sits under the air it stands in: the first range
    // reads as land against the water, and each range behind steps down from there.
    vec3 haze_far = uHaze * mix(.62, .38, uDepth);
    gl_FragColor = vec4(mix(color, haze_far, haze), 1.0);
  }
`;

function headlandMaterial(depth, falloff) {
  return new THREE.ShaderMaterial({
    vertexShader: headlandVertex,
    fragmentShader: headlandFragment,
    uniforms: {
      // This used to lerp toward a *lighter* grey with range, on the daylight
      // aerial-perspective rule — but that rule describes a bright sky lifting the
      // far distance, and this piece has no bright sky in four of its six shots.
      // What it produced was a back range paler than the mass in front of it, which
      // inverts the depth order the composition depends on. Range darkens here.
      uRock: { value: new THREE.Color(0x2a343a).lerp(new THREE.Color(0x101619), depth * .88) },
      uHaze: { value: new THREE.Color(0x07171b) },
      uDepth: { value: depth },
      uFalloff: { value: falloff }
    }
  });
}

function buildTerrain(parent, materials) {
  const group = new THREE.Group();
  group.name = 'basalt-cliff';
  parent.add(group);
  const random = createRandom(SCENE_SEED + 301);
  const transforms = [[], [], [], []];

  // The tower has to stand on the rock, not inside it. Everything below is placed
  // against a clear apron: a broad wet skerry carrying the plinth, a reef ring
  // held outside the tower's own footprint, and a far headland for silhouette.
  const CLEAR_RADIUS = 21;

  // The skerry the tower stands on is wave-worn, so it stays an eroded mass
  // rather than a columnar stack. Kept tight enough that the waterline camera
  // passes outside it: at its old size it enclosed the crossing and that shot
  // rendered solid black.
  // Moved seaward of the tower. Sitting behind it, the skerry filled the water
  // between the crossing and the mouth of the archive, and every route from one to
  // the other ran through solid rock. The tower's own plinth carries it.
  // Anything whose top reaches near the tide gets published to the ocean so the
  // water can break against it.
  const shoreline = [];

  const masses = [
    { position: [4, -8.5, -2], rotation: [0, .7, 0], scale: [12, 8.5, 9] },
    { position: [-11, -10.6, 2], rotation: [.1, 2.2, -.08], scale: [11, 8, 10] }
  ];

  for (let index = 0; index < 46; index += 1) {
    const reef = index < 22;
    const angle = randomRange(random, 0, Math.PI * 2);
    const distance = reef
      ? randomRange(random, CLEAR_RADIUS, CLEAR_RADIUS + 19)
      : randomRange(random, 44, 76);
    let x = Math.cos(angle) * distance;
    const z = SITE.tower.z + Math.sin(angle) * distance * .78;
    // The archive runs the length of the sea floor behind the tower. Rock dropped
    // into that corridor ends up standing inside the hall, so it is pushed clear
    // of the vault's footprint.
    const ARCHIVE_HALF_WIDTH = 24;
    if (z < -18 && Math.abs(x) < ARCHIVE_HALF_WIDTH) {
      x = (x < 0 ? -1 : 1) * (ARCHIVE_HALF_WIDTH + (ARCHIVE_HALF_WIDTH - Math.abs(x)) * .5);
    }
    // Reef stacks break the surface; the far headland stands taller behind it.
    const height = reef ? randomRange(random, 3, 6.6) : randomRange(random, 5.5, 11);
    const y = reef ? randomRange(random, -12.5, -7) : randomRange(random, -11, -4);
    const spanX = randomRange(random, 3.4, 8.2);
    const spanZ = randomRange(random, 3.2, 7.6);
    transforms[index % 4].push({
      position: [x, y, z],
      rotation: [randomSigned(random, .5), randomRange(random, 0, Math.PI * 2), randomSigned(random, .35)],
      scale: [spanX, height, spanZ]
    });
    // Only stacks that actually reach the surface get a wash.
    // Only stacks that genuinely break the tide, or the wash floats on open water.
    if (y + height > .4 && y < 1.5) shoreline.push([x, z, Math.max(spanX, spanZ) * .58]);
  }
  masses.forEach(({ position, scale }) => {
    shoreline.push([position[0], position[2], Math.max(scale[0], scale[2]) * .6]);
  });
  createInstances(group, displacedRockGeometry(SCENE_SEED + 7), materials.wetStone, masses);

  // Two columnar variants and two eroded ones, so the reef reads as jointed rock
  // weathered to different degrees rather than one repeated shape.
  transforms.forEach((items, index) => {
    const geometry = index < 2
      ? basaltStackGeometry(SCENE_SEED + index * 131 + 53)
      : displacedRockGeometry(SCENE_SEED + index * 131);
    createInstances(group, geometry, materials.stone, items);
  });

  // Three ranges rather than one row. Each is wide enough to overlap its
  // neighbours, so the coast reads as notched continuous land instead of a line
  // of separate objects, and the near range is held clear of the archive's
  // footprint — the hall runs back to z -71 and rock dropped on it stands inside
  // the vault.
  const ranges = [
    // Heights are held down deliberately: the coast is a floor for the composition,
    // not competition for it. The lantern has to keep clear sky behind it from the
    // standing-off shot, and a range that crests above the tower takes that away.
    { count: 13, z: -86, jitterZ: 4, y: -5, jitterY: 2, step: 11.4, from: -68, spanX: [10, 18], spanY: [6, 12.5], spanZ: [5, 9], depth: 0, falloff: .0072, seed: 811 },
    { count: 11, z: -113, jitterZ: 7, y: -3, jitterY: 2.5, step: 15, from: -78, spanX: [13, 24], spanY: [8, 16], spanZ: [7, 12], depth: .62, falloff: .0056, seed: 947 },
    { count: 8, z: -151, jitterZ: 12, y: -1, jitterY: 3, step: 25, from: -92, spanX: [22, 38], spanY: [12, 22], spanZ: [9, 16], depth: 1, falloff: .0042, seed: 1063 }
  ];
  const headlandMaterials = ranges.map(range => headlandMaterial(range.depth, range.falloff));
  ranges.forEach((range, index) => {
    const transforms = [];
    for (let step = 0; step < range.count; step += 1) {
      transforms.push({
        position: [
          range.from + step * range.step + randomSigned(random, range.step * .3),
          range.y + randomSigned(random, range.jitterY),
          range.z + randomSigned(random, range.jitterZ)
        ],
        rotation: [0, randomRange(random, 0, Math.PI * 2), 0],
        scale: [
          randomRange(random, ...range.spanX),
          randomRange(random, ...range.spanY),
          randomRange(random, ...range.spanZ)
        ]
      });
    }
    createInstances(group, displacedRockGeometry(SCENE_SEED + range.seed, 1), headlandMaterials[index], transforms, false);
  });
  group.userData.headlandMaterials = headlandMaterials;
  group.userData.shoreline = shoreline;
  return group;
}

function buildArchive(parent, materials) {
  const group = new THREE.Group();
  group.name = 'submerged-archive';
  parent.add(group);
  addBox(group, [22.8, 1.2, 62], [0, -16.6, -43], materials.wetStone);
  addBox(group, [20.8, .14, 59], [0, -15.92, -43], materials.salt);

  for (const side of [-1, 1]) {
    addBox(group, [1.45, 12.4, 60], [side * 10.55, -10.4, -43], materials.stone);
    addBox(group, [.42, 10.8, 60.4], [side * 9.72, -10.1, -43], materials.darkCopper);
  }

  const shelves = [];
  for (const side of [-1, 1]) {
    for (let z = -16; z >= -70; z -= 4.6) {
      shelves.push({ position: [side * 9.05, -12.55, z], scale: [1, 1, 1] });
      shelves.push({ position: [side * 9.05, -8.55, z], scale: [1, 1, 1] });
    }
  }
  createInstances(group, new THREE.BoxGeometry(2.7, .22, 3.85), materials.copper, shelves);

  const capsuleBodies = [];
  const capsuleCaps = [];
  const suspension = [];
  for (let z = -18; z >= -70; z -= 6.4) {
    for (const side of [-1, 1]) {
      const x = side * 6.35;
      capsuleBodies.push({ position: [x, -11.2, z] });
      capsuleCaps.push({ position: [x, -9.75, z] });
      capsuleCaps.push({ position: [x, -12.65, z] });
      suspension.push({ position: [x, -5.9, z] });
    }
  }
  createInstances(group, new THREE.CylinderGeometry(.56, .56, 2.6, 20), materials.archiveGlass, capsuleBodies, false);
  // Suspended inside the glass, one instanced draw for the whole hall.
  createInstances(group, new THREE.CylinderGeometry(.11, .11, .78, 8), materials.capsuleCore, capsuleBodies, false);
  createInstances(group, new THREE.CylinderGeometry(.67, .67, .25, 20), materials.copper, capsuleCaps);
  createInstances(group, new THREE.CylinderGeometry(.055, .055, 7.8, 6), materials.darkCopper, suspension, false);

  const arches = [];
  for (let z = -18; z >= -72; z -= 7.6) arches.push({ position: [0, -5.1, z], rotation: [0, 0, Math.PI] });
  createInstances(group, new THREE.TorusGeometry(8.65, .28, 10, 56, Math.PI), materials.copper, arches);

  const floorLights = [];
  for (let z = -20; z >= -70; z -= 5.5) {
    floorLights.push({ position: [-4.2, -15.26, z], rotation: [-Math.PI / 2, 0, 0], scale: [1.7, 1, .42] });
    floorLights.push({ position: [4.2, -15.26, z], rotation: [-Math.PI / 2, 0, 0], scale: [1.7, 1, .42] });
  }
  createInstances(group, new THREE.PlaneGeometry(1, 1), materials.caustic, floorLights, false);
  return group;
}

export function createObservatory(scene, materials) {
  const root = new THREE.Group();
  root.name = 'nadir-world-geometry';
  scene.add(root);
  const terrain = buildTerrain(root, materials);
  // The plinth the tower stands on is the shore the eye checks first.
  terrain.userData.shoreline.unshift([SITE.tower.x, SITE.tower.z, 8.4]);
  const tower = buildTower(root, materials);
  const gantry = buildGantry(root, materials);
  const shaft = buildShaft(root, materials);
  const archive = buildArchive(root, materials);

  // How hard the optic is burning, relative to its storm-night output. The lens
  // emissive was a constant: at dawn, with the practical light down from 38 to 11
  // and the copy saying the signal has come back up into first light, the optic was
  // still blazing at full storm output. It read as a traffic signal stuck on red
  // over an otherwise quiet morning.
  let signalLevel = 1;

  function update(time, camera) {
    // The optic turns about the vertical axis now that it stands in the lantern.
    tower.lensCage.rotation.y = time * .075;
    tower.lens.material.emissiveIntensity = (.55 + 7.7 * signalLevel) + Math.sin(time * 1.15) * 1.15 * signalLevel;
    if (camera) dissolveShell(camera);
  }

  // Driven by where the camera actually is, not by which shot is active: the
  // descent key sits inside the tower and the keys on either side sit outside it,
  // so a per-shot value would either wall off the descent or make the hero shots
  // translucent. Radial distance from the tower axis gives the true answer, and
  // reverse scrubbing gets the same dissolve for free.
  // Now that the camera enters through an actual doorway, this is only a safety
  // net for the instant it is level with the jamb. Kept tight so the tower stays
  // solid everywhere the viewer is likely to be looking at it.
  const SHELL_FADE_INNER = 2.4;
  const SHELL_FADE_OUTER = 4.2;

  function dissolveShell(camera) {
    const dx = camera.position.x - SITE.tower.x;
    const dz = camera.position.z - SITE.tower.z;
    const radial = Math.sqrt(dx * dx + dz * dz);
    const withinHeight = smoothstep(-15, -11, camera.position.y) * (1 - smoothstep(17, 20.5, camera.position.y));
    const inside = (1 - smoothstep(SHELL_FADE_INNER, SHELL_FADE_OUTER, radial)) * withinHeight;

    const shellOpacity = 1 - inside * .97;
    tower.shellMaterial.opacity = shellOpacity;
    tower.roofMaterial.opacity = shellOpacity;
    tower.shellMaterial.transparent = shellOpacity < .999;
    tower.roofMaterial.transparent = shellOpacity < .999;
    tower.shellParts.forEach(part => { part.visible = shellOpacity > .02; });
    tower.roof.visible = shellOpacity > .02;
    // The inner face stays solid throughout and is *revealed* by the dissolving
    // shell. Fading it in alongside the shell left both surfaces part-transparent
    // mid-crossing, so the camera looked clean through the building at open sea
    // and the frame went black. Outside the tower the opaque shell hides it anyway.
    tower.interiorParts.forEach(part => { part.visible = true; });
  }

  const SIGNAL_STORM = 38;

  function setState(state) {
    signalLevel = clamp(state.light.signal / SIGNAL_STORM, 0, 1);
    materials.caustic.opacity = .03 + state.ocean.caustics * .15;
    // The coast has to recede toward whatever the air is doing at this point in
    // the journey, not toward a fixed storm grey.
    terrain.userData.headlandMaterials?.forEach(material => {
      material.uniforms.uHaze.value.copy(state.fog.color);
    });
  }

  function setDebugMode(mode) {
    root.traverse(object => {
      if (!object.isMesh && !object.isInstancedMesh) return;
      object.userData.originalMaterial ??= object.material;
      object.material = mode === 'massing' ? materials.silhouette : object.userData.originalMaterial;
    });
  }

  function dispose() {
    const geometries = new Set();
    root.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
    geometries.forEach(geometry => geometry.dispose());
    terrain.userData.headlandMaterials?.forEach(material => material.dispose());
    root.removeFromParent();
  }

  return { root, terrain, tower, gantry, shaft, archive, update, setState, setDebugMode, dispose };
}
