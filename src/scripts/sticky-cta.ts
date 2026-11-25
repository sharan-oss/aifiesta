// Sticky CTA bar.
// Pages with a hero button marked data-sticky-after (Home, Home B, GA): the bar slides up once
// that button has scrolled off the top of the screen, and then stays, so buying is always one tap
// away. It only hides again if the visitor scrolls back up to the hero button.
// Other pages (old v2 / India LPs): hide while the pricing section or a block marked
// data-sticky-hide fills the middle of the screen.
const bar = document.getElementById('sticky-cta');

function setAway(away: boolean) {
  if (!bar) return;
  bar.classList.toggle('away', away);
  bar.inert = away;
}

const after = document.querySelector('[data-sticky-after]');
if (bar && after) {
  const io = new IntersectionObserver(([e]) => {
    // Hidden while the hero button is on screen or still below it (page top); shown once it's above.
    setAway(e.isIntersecting || e.boundingClientRect.top > 0);
  });
  io.observe(after);
} else if (bar) {
  const blocks = [document.getElementById('pricing'), ...document.querySelectorAll('[data-sticky-hide]')].filter(Boolean) as Element[];
  if (blocks.length) {
    const onScreen = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target);
      setAway(onScreen.size > 0);
    }, { rootMargin: '-35% 0px -35% 0px' });
    blocks.forEach((b) => io.observe(b));
  }
}
