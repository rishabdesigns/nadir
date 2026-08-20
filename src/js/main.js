import { createWorld } from './scene/world.js';
import { ScrollRig } from './motion/scroll-rig.js';
import { initNavigation } from './ui/navigation.js';
import { initReveals } from './ui/reveals.js';
import { initShutters } from './ui/shutters.js';
import { clamp, lerp } from './core/math.js';

const loader = document.getElementById('loader');
const loaderBar = document.getElementById('loaderBar');
const loaderPct = document.getElementById('loaderPct');
const underwash = document.querySelector('.underwash');
const depthRail = document.querySelector('.depth-rail__track i');
let lastRail = -1;
let lastUnderwater = -1;
const params = new URLSearchParams(location.search);

// Browsers restore the previous scroll offset across a reload, and on a page whose
// scroll position *is* its camera position that means a refresh drops you wherever
// you happened to be — usually twenty metres under water, mid-descent, with no
// indication of how you got there and the opening beat never seen. This is a
// journey with a beginning; a reload returns to it.
//
// A hash is an explicit request for a section and is left alone, as is ?shot=,
// which the capture harness uses to address a beat directly.
const addressed = location.hash.length > 1 || params.has('shot');

function toStart() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!addressed) scrollTo(0, 0);
}
toStart();

// Setting the flag once is not enough, and it is worth saying why rather than
// leaving the second call looking like superstition: traced across the document
// lifecycle, this browser reports 'manual' at DOMContentLoaded and 'auto' again by
// load — it resets the flag at roughly the same moment it performs the restore, so
// an assignment made during module evaluation has already been undone by the time
// it would matter. pageshow fires after that, which makes it the first point where
// the correction sticks. It also fires on a back-forward cache restore, which is
// the other route back into the middle of the descent. Both land while the loader
// still covers the frame, so nothing about this is visible.
addEventListener('pageshow', () => {
  toStart();
  rig?.measure();
});
let world = null;
let rig = null;
let navigation = null;
let statsPanel = null;
let statsSample = 0;
let running = true;
let raf = 0;
let lastTime = performance.now();

function setLoading(value) {
  const percent = Math.round(clamp(value) * 100);
  loaderBar.style.transform = `scaleX(${value})`;
  loaderPct.textContent = percent;
}

function preloadImages() {
  const urls = [
    'assets/generated/nadir-cliff-signal.webp',
    'assets/generated/nadir-submerged-archive.webp',
    'assets/foreground/nadir-storm-kelp.webp'
  ];
  let loaded = 0;
  return Promise.all(urls.map(url => new Promise(resolve => {
    const image = new Image();
    const done = () => {
      loaded += 1;
      setLoading(.1 + loaded / urls.length * .45);
      resolve();
    };
    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
    image.src = url;
  })));
}

function fallbackProgress() {
  const sections = [...document.querySelectorAll('[data-cam]')];
  const points = sections.map((section, index) => index === 0 ? 0 : section.offsetTop + section.offsetHeight * .5 - innerHeight * .5);
  for (let i = 0; i < points.length - 1; i += 1) {
    if (scrollY <= points[i + 1]) return i + clamp((scrollY - points[i]) / Math.max(1, points[i + 1] - points[i]));
  }
  return points.length - 1;
}

function frame(now) {
  if (!running) return;
  const delta = Math.min(.05, Math.max(.001, (now - lastTime) / 1000));
  lastTime = now;
  const progress = rig ? rig.tick(delta) : fallbackProgress();
  navigation?.update(progress);

  // --progress was written to document.documentElement on every frame. Exactly one
  // element reads it — the depth rail's fill — but setting a custom property on the
  // root invalidates inherited custom properties across the entire tree, so every
  // frame paid a full-document style recalculation on the main thread alongside the
  // render. It is scoped to its one consumer now, and only written when the value
  // it draws at actually moves.
  const railValue = progress / 5;
  if (Math.abs(railValue - lastRail) > .0008) {
    lastRail = railValue;
    depthRail?.style.setProperty('--progress', railValue.toFixed(4));
  }

  const enter = clamp((progress - 2.2) / .9);
  const leave = clamp((progress - 4.58) / .42);
  const underwater = enter * (1 - leave);
  if (Math.abs(underwater - lastUnderwater) > .002) {
    lastUnderwater = underwater;
    underwash.style.opacity = (underwater * .24).toFixed(3);
  }

  if (world) {
    world.setProgress(progress);
    world.update(now / 1000, delta);
    world.render(delta);
    if (statsPanel && now - statsSample > 350) {
      statsSample = now;
      const stats = world.getStats();
      statsPanel.textContent = `CALLS ${stats.calls}\nTRIS ${stats.triangles.toLocaleString()}\nSCALE ${stats.renderScale}\nSHOT ${stats.progress.toFixed(2)}\nSUBMERGED ${stats.underwater.toFixed(2)}`;
    }
  }
  raf = requestAnimationFrame(frame);
}

function onScroll() {
  rig?.onScroll();
  navigation?.onScroll();
}

function onResize() {
  world?.resize();
  rig?.measure();
  window.ScrollTrigger?.refresh();
}

async function boot() {
  if (!addressed) scrollTo(0, 0);
  setLoading(.04);
  navigation = initNavigation();
  initShutters();
  setLoading(.1);
  await preloadImages();

  try {
    world = createWorld(document.getElementById('world'));
    document.body.classList.add('webgl-ready');
    setLoading(.78);
    rig = new ScrollRig(world.camera);
    window.__NADIR__ = {
      world,
      rig,
      setProgress(value) {
        const safe = clamp(Number(value), 0, rig.anchors.length - 1);
        const index = Math.min(rig.anchors.length - 2, Math.floor(safe));
        const top = lerp(rig.anchors[index], rig.anchors[index + 1], safe - index);
        scrollTo({ top, behavior: 'auto' });
        rig.onScroll();
      },
      stats: () => world.getStats()
    };
    if (params.get('debug') === 'stats') {
      statsPanel = document.createElement('output');
      statsPanel.className = 'scene-stats';
      statsPanel.setAttribute('aria-label', 'WebGL scene statistics');
      document.body.append(statsPanel);
    }
    const requestedShot = Number(params.get('shot'));
    if (Number.isFinite(requestedShot)) {
      requestAnimationFrame(() => window.__NADIR__.setProgress(requestedShot));
    }
    setLoading(.9);
  } catch (error) {
    console.error('Nadir WebGL fallback:', error);
    document.body.classList.add('no-webgl');
  }

  initReveals();
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize, { passive: true });
  addEventListener('pointermove', event => rig?.onPointer(event), { passive: true });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    cancelAnimationFrame(raf);
    if (running) {
      lastTime = performance.now();
      raf = requestAnimationFrame(frame);
    }
  });
  addEventListener('beforeunload', () => world?.dispose(), { once: true });

  setLoading(1);
  document.body.classList.remove('is-loading');
  setTimeout(() => loader.classList.add('is-done'), 350);
  raf = requestAnimationFrame(frame);
}

boot();
