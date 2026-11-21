// Hide the sticky CTA while a block with its own checkout button fills the middle of the
// screen: the pricing section, and any block marked data-sticky-hide (the hero's offer card).
const bar = document.getElementById('sticky-cta');
const blocks = [document.getElementById('pricing'), ...document.querySelectorAll('[data-sticky-hide]')].filter(Boolean) as Element[];

if (bar && blocks.length) {
  const onScreen = new Set<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target);
    const away = onScreen.size > 0;
    bar.classList.toggle('away', away);
    bar.inert = away;
  }, { rootMargin: '-35% 0px -35% 0px' });
  blocks.forEach((b) => io.observe(b));
}
