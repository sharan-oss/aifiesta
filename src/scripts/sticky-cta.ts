// Hide the sticky CTA while the pricing section fills the middle of the screen:
// the pricing card's own checkout button is right there.
const bar = document.getElementById('sticky-cta');
const pricing = document.getElementById('pricing');

if (bar && pricing) {
  new IntersectionObserver(([entry]) => {
    bar.classList.toggle('away', entry.isIntersecting);
    bar.inert = entry.isIntersecting;
  }, { rootMargin: '-35% 0px -35% 0px' }).observe(pricing);
}
