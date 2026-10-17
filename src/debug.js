// FPS overlay, shown when the URL has ?debug. Real numbers only on real devices.
export function createDebugOverlay(el, renderer) {
  el.hidden = false;
  let frames = 0;
  let last = performance.now();
  let worst = 0;
  let prev = last;
  return {
    frame() {
      const now = performance.now();
      worst = Math.max(worst, now - prev);
      prev = now;
      frames++;
      if (now - last >= 500) {
        const fps = (frames * 1000) / (now - last);
        const info = renderer.info.render;
        el.textContent =
          `${fps.toFixed(0)} fps  worst ${worst.toFixed(0)} ms\n` +
          `draws ${info.calls}  tris ${info.triangles}\n` +
          `px ratio ${renderer.getPixelRatio().toFixed(2)}  ${renderer.domElement.width}x${renderer.domElement.height}`;
        frames = 0;
        worst = 0;
        last = now;
      }
    },
  };
}
