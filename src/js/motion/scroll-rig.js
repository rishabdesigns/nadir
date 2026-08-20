import * as THREE from '../../../vendor/three.module.min.js';
import { CAMERA_SHOTS, QUALITY } from '../config.js';
import { clamp, damp, lerp } from '../core/math.js';

export class ScrollRig {
  constructor(camera) {
    this.camera = camera;
    this.sections = [...document.querySelectorAll('[data-cam]')];
    this.anchors = [];
    this.target = 0;
    this.smooth = 0;
    this.pointer = new THREE.Vector2();
    this.pointerSmooth = new THREE.Vector2();
    // Camera keys carry their own `at` position along the journey, so the path can
    // take waypoints that are not narrative beats — routing in through a doorway,
    // for instance, instead of straight through a wall. Journey state still
    // samples the six shot states independently.
    this.keys = CAMERA_SHOTS;
    this.keyAt = CAMERA_SHOTS.map((shot, index) => shot.at ?? index);
    this.lastKey = this.keys.length - 1;
    this.positionCurve = new THREE.CatmullRomCurve3(CAMERA_SHOTS.map(shot => new THREE.Vector3(...shot.position)), false, 'catmullrom', .42);
    this.targetCurve = new THREE.CatmullRomCurve3(CAMERA_SHOTS.map(shot => new THREE.Vector3(...shot.target)), false, 'catmullrom', .42);
    this.position = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.viewDirection = new THREE.Vector3();
    this.measure();
    this.onScroll();
  }

  measure() {
    this.maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    this.anchors = this.sections.map((section, index) => {
      if (index === 0) return 0;
      return clamp(section.offsetTop + section.offsetHeight * .5 - innerHeight * .5, 0, this.maxScroll);
    });
    for (let i = 1; i < this.anchors.length; i += 1) this.anchors[i] = Math.max(this.anchors[i], this.anchors[i - 1] + 1);
    this.onScroll();
  }

  progressFor(scrollPosition = scrollY) {
    if (scrollPosition <= this.anchors[0]) return 0;
    for (let i = 0; i < this.anchors.length - 1; i += 1) {
      if (scrollPosition <= this.anchors[i + 1]) {
        return i + (scrollPosition - this.anchors[i]) / (this.anchors[i + 1] - this.anchors[i]);
      }
    }
    return this.anchors.length - 1;
  }

  onScroll() { this.target = this.progressFor(); }

  // Journey position -> curve parameter. CatmullRomCurve3 places control point i
  // exactly at i / lastKey, so a piecewise-linear map through `keyAt` keeps each
  // key landing on its own progress value whatever the spacing.
  keyBracket(progress) {
    let index = 0;
    while (index < this.lastKey - 1 && progress > this.keyAt[index + 1]) index += 1;
    const from = this.keyAt[index];
    const to = this.keyAt[index + 1];
    return { index, local: clamp((progress - from) / (to - from)) };
  }

  curveParameter(progress) {
    const { index, local } = this.keyBracket(progress);
    return clamp((index + local) / this.lastKey);
  }

  onPointer(event) {
    if (QUALITY.reduced) return;
    this.pointer.set((event.clientX / innerWidth - .5) * 2, (event.clientY / innerHeight - .5) * 2);
  }

  tick(delta) {
    this.smooth = QUALITY.reduced ? Math.round(this.target) : damp(this.smooth, this.target, 4.7, delta);
    this.pointerSmooth.x = damp(this.pointerSmooth.x, this.pointer.x, 2.4, delta);
    this.pointerSmooth.y = damp(this.pointerSmooth.y, this.pointer.y, 2.4, delta);
    const normalized = this.curveParameter(this.smooth);
    this.positionCurve.getPoint(normalized, this.position);
    this.targetCurve.getPoint(normalized, this.look);

    const { index, local } = this.keyBracket(this.smooth);
    let fov = lerp(this.keys[index].fov, this.keys[index + 1].fov, local);
    const narrow = clamp((1.25 - innerWidth / innerHeight) / .65);

    // Two things used to happen here and both were wrong indoors. The camera was
    // pushed back along its full view axis — including the vertical component, so
    // a shot looking down a shaft answered a narrow screen by climbing it — and it
    // was pushed by a flat nine metres whether it stood in open water or in a
    // stone room nine metres wide.
    //
    // The retreat is now horizontal only, because on a narrow screen you want to
    // step back, never to rise, and it is scaled by the key's own `fit`, so a shot
    // with walls close by does not move at all.
    this.viewDirection.subVectors(this.position, this.look);
    this.viewDirection.y = 0;
    const room = narrow * lerp(this.keys[index].fit ?? 1, this.keys[index + 1].fit ?? 1, local);
    // A key aimed straight down has no horizontal axis to retreat along, and
    // normalizing it would send the camera somewhere arbitrary.
    if (room > .001 && this.viewDirection.lengthSq() > 1e-4) {
      this.viewDirection.normalize();
      this.position.addScaledVector(this.viewDirection, room * 11);
      this.position.y += room * 1.2;
    }

    // Field of view carries what the retreat no longer does. It is capped, because
    // the descent key starts at 62 degrees and the old multiplier took it to 83 on
    // a phone — past the point where a wide angle reads as space and into the point
    // where it reads as a fisheye lens.
    fov = Math.min(fov * (1 + narrow * .3), 68);

    this.position.x += this.pointerSmooth.x * .36;
    this.position.y -= this.pointerSmooth.y * .22;
    this.look.x += this.pointerSmooth.x * .18;
    this.look.y -= this.pointerSmooth.y * .12;
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - fov) > .01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    return this.smooth;
  }
}
