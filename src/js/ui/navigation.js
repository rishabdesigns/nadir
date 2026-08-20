import { QUALITY } from '../config.js';
import { clamp } from '../core/math.js';

export function initNavigation() {
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('navToggle');
  const links = [...document.querySelectorAll('.nav__links a[data-target]')];
  const rail = [...document.querySelectorAll('[data-rail]')];
  let lastScroll = scrollY;
  let active = -1;

  function closeMenu() {
    document.body.classList.remove('menu-open');
    toggle?.setAttribute('aria-expanded', 'false');
  }

  toggle?.addEventListener('click', () => {
    const open = !document.body.classList.contains('menu-open');
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.remove('is-hidden');
    hidden = false;
  });
  addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', event => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      closeMenu();
      const cameraSections = [...document.querySelectorAll('[data-cam]')];
      const cameraIndex = cameraSections.indexOf(target);
      const top = cameraIndex === 0
        ? 0
        : cameraIndex > 0
          ? Math.max(0, target.offsetTop + target.offsetHeight * .5 - innerHeight * .5)
          : Math.max(0, target.offsetTop - innerHeight * .04);
      scrollTo({ top, behavior: QUALITY.reduced ? 'auto' : 'smooth' });
    });
  });

  // Five pixels of travel was enough to hide or show the bar, so trackpad
  // momentum — which reverses direction constantly as it settles — had it
  // flickering in and out the whole way down the page. Travel is accumulated in
  // the current direction instead and reset when the direction changes, so it
  // takes a deliberate movement either way.
  const TRAVEL = 90;
  let travel = 0;
  let hidden = false;

  function onScroll() {
    const current = scrollY;
    const delta = current - lastScroll;
    lastScroll = current;
    nav.classList.toggle('is-stuck', current > 24);
    if (document.body.classList.contains('menu-open')) return;

    if (delta === 0) return;
    travel = Math.sign(travel) === Math.sign(delta) ? travel + delta : delta;

    if (!hidden && travel > TRAVEL && current > innerHeight * .72) {
      hidden = true;
      nav.classList.add('is-hidden');
    } else if (hidden && (travel < -TRAVEL || current < innerHeight * .3)) {
      hidden = false;
      nav.classList.remove('is-hidden');
    }
  }

  function update(progress) {
    const next = clamp(Math.round(progress), 0, 5);
    if (next !== active) {
      active = next;
      rail.forEach((link, index) => link.classList.toggle('is-active', index === active));
      links.forEach(link => link.classList.toggle('is-active', Number(link.dataset.target) === active));
    }
  }

  onScroll();
  return { onScroll, update, closeMenu };
}
