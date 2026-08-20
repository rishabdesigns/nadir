export function initShutters() {
  const container = document.querySelector('[data-shutters]');
  if (!container) return;
  const shutters = [...container.querySelectorAll('.shutter')];

  function activate(index) {
    shutters.forEach((shutter, shutterIndex) => {
      const active = shutterIndex === index;
      shutter.classList.toggle('is-active', active);
      shutter.querySelector('button')?.setAttribute('aria-expanded', String(active));
    });
    if (matchMedia('(min-width: 821px)').matches) {
      container.style.gridTemplateColumns = shutters.map((_, shutterIndex) => shutterIndex === index ? '2.05fr' : '.65fr').join(' ');
    } else {
      container.style.gridTemplateColumns = '';
    }
  }

  shutters.forEach((shutter, index) => {
    const button = shutter.querySelector('button');
    button?.addEventListener('click', () => activate(index));
    shutter.addEventListener('pointerenter', () => {
      if (matchMedia('(hover:hover) and (min-width: 821px)').matches) activate(index);
    });
  });
  addEventListener('resize', () => activate(Math.max(0, shutters.findIndex(shutter => shutter.classList.contains('is-active')))), { passive: true });
}

