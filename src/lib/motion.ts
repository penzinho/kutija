/** Reduced motion: the OS setting, or the site's calm toggle (html[data-motion="calm"]). */
export function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'calm';
}

// Scroll reveal (SPECS motion table): fade + 28px rise, 640ms + 70ms × data-reveal index, once.
const REVEAL = { duration: 640, stagger: 70, rise: 28 };
let observer: IntersectionObserver | undefined;

/**
 * Observe every [data-reveal] element on the page. Call on each `astro:page-load`.
 * Elements already on screen when the page loads are left alone: hiding them after first
 * paint would flash and delay LCP. Without JS or IntersectionObserver nothing is hidden.
 */
export function initReveal(): void {
  observer?.disconnect();
  observer = undefined;
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (!targets.length || reducedMotion() || !('IntersectionObserver' in window)) return;

  let initial = true;
  observer = new IntersectionObserver(
    (entries, obs) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        obs.unobserve(en.target);
        if (initial) continue;
        const index = Number((en.target as HTMLElement).dataset.reveal) || 0;
        en.target.animate(
          [
            { opacity: 0, transform: `translateY(${REVEAL.rise}px)` },
            { opacity: 1, transform: 'none' },
          ],
          { duration: REVEAL.duration, delay: index * REVEAL.stagger, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' },
        );
      }
      // The first callback reports every target's starting state.
      initial = false;
    },
    { rootMargin: '0px 0px -6% 0px' },
  );
  targets.forEach((el) => observer!.observe(el));
}
