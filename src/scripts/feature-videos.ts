// Feature videos sit over their static screenshot with no src, so nothing downloads on page load.
// Each one loads when its card nears the viewport, plays while visible, and pauses when it leaves.
// Reduced-motion and data-saver visitors keep the screenshot only.
const videos = [...document.querySelectorAll<HTMLVideoElement>('video[data-src]')];
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

if (videos.length && !saveData && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const video = target as HTMLVideoElement;
      if (!isIntersecting) { video.pause(); continue; }
      if (!video.src) {
        video.addEventListener('playing', () => video.classList.add('on'), { once: true });
        video.muted = true;
        video.src = video.dataset.src!;
      }
      video.play().catch(() => {});
    }
  }, { rootMargin: '200px 0px' });
  videos.forEach((video) => io.observe(video));
}
