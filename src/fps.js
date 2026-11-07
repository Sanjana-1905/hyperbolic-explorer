// fps.js - a small on-screen frames-per-second counter.
//
// Call `tick(now)` once per frame. Every half second it divides the number of
// frames by the time that passed, e.g. 30 frames in 0.5 s -> 60 fps.
// Press F to show/hide it; add ?fps=1 to the URL to show it from the start.

export function createFpsCounter() {
  const el = document.createElement('div');
  el.id = 'fps';
  el.hidden = new URLSearchParams(location.search).get('fps') !== '1';
  document.body.appendChild(el);

  let frames = 0;
  let windowStart = performance.now();
  let value = 0;

  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') el.hidden = !el.hidden;
  });

  return {
    tick(now) {
      frames++;
      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        value = (frames * 1000) / elapsed;
        el.textContent = `${value.toFixed(0)} fps`;
        frames = 0;
        windowStart = now;
      }
    },
    get value() { return value; },
  };
}
