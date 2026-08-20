import { QUALITY } from '../config.js';

function splitWords(element) {
  if (!element || element.dataset.split === 'true') return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);
  }
  nodes.forEach(node => {
    const fragment = document.createDocumentFragment();
    const parts = node.nodeValue.split(/(\s+)/);
    parts.forEach(part => {
      if (/^\s+$/.test(part)) fragment.append(part);
      else if (part) {
        const word = document.createElement('span');
        word.className = 'word';
        word.textContent = part;
        fragment.append(word);
      }
    });
    node.replaceWith(fragment);
  });
  element.dataset.split = 'true';
}

export function initReveals() {
  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (!gsap || !ScrollTrigger || QUALITY.reduced) return;
  gsap.registerPlugin(ScrollTrigger);

  document.querySelectorAll('.reveal-words').forEach(element => {
    splitWords(element);
    gsap.fromTo(element.querySelectorAll('.word'),
      { opacity: .12, yPercent: 40 },
      {
        opacity: 1, yPercent: 0, stagger: .035, ease: 'none',
        scrollTrigger: { trigger: element, start: 'top 80%', end: 'bottom 38%', scrub: .6 }
      }
    );
  });

  document.querySelectorAll('.reveal-group').forEach(group => {
    gsap.fromTo([...group.children],
      { opacity: 0, y: 34 },
      {
        opacity: 1, y: 0, duration: 1.15, stagger: .11, ease: 'power4.out',
        scrollTrigger: { trigger: group, start: 'top 82%', toggleActions: 'play none none reverse' }
      }
    );
  });

  document.querySelectorAll('.record-card__image img').forEach(image => {
    gsap.fromTo(image,
      { scale: 1.16, opacity: .58 },
      { scale: 1, opacity: 1, ease: 'none', scrollTrigger: { trigger: image.closest('.record-card'), start: 'top 90%', end: 'top 18%', scrub: .7 } }
    );
  });

  const cards = [...document.querySelectorAll('.record-card')];
  cards.slice(0, -1).forEach((card, index) => {
    gsap.to(card, {
      scale: .94 - index * .008,
      opacity: .34,
      filter: 'blur(4px)',
      ease: 'none',
      scrollTrigger: { trigger: cards[index + 1], start: 'top 76%', end: 'top 22%', scrub: .65 }
    });
  });

  gsap.fromTo('.archive__records article',
    { opacity: .25, x: 45 },
    {
      opacity: 1, x: 0, stagger: .08, ease: 'none',
      scrollTrigger: { trigger: '.archive__records', start: 'top 78%', end: 'bottom 72%', scrub: .7 }
    }
  );

  addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}

