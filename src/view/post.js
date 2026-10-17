import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

// Grade, in linear light before tone mapping: cool blue shadows, warm lamp
// highlights, a touch more saturation, and a vignette that darkens the room
// around the lamp pool (centred a little towards the lamp's side).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, centre: { value: [0.47, 0.5] } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 centre;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c * vec3(0.86, 0.95, 1.18), c, smoothstep(0.0, 0.12, l)); // cool shadows
      c = mix(c, c * vec3(1.06, 1.0, 0.9), smoothstep(0.25, 1.0, l));   // warm highlights
      c = max(mix(vec3(l), c, 1.12), 0.0);                              // a touch more saturation
      float v = smoothstep(0.95, 0.25, distance(vUv, centre));
      c *= mix(0.78, 1.0, v);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Tilt-shift: blur grows above and below a sharp band, so the scene reads as
// miniatures. `blur` is in pixels at half a screen away from the focus line;
// setFocus moves the line (0 = bottom of the screen, 1 = top) onto the board.
export function createPost(renderer, scene, camera, { blur = 10 } = {}) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const h = new ShaderPass(HorizontalTiltShiftShader);
  const v = new ShaderPass(VerticalTiltShiftShader);
  h.uniforms.r.value = v.uniforms.r.value = 0.5;
  composer.addPass(h);
  composer.addPass(v);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  let size = [1, 1];
  const setBlur = () => {
    // Shader: offset = 4 * k / size * |r - y|; at half a screen |r - y| = 0.5, so k = blur / 2.
    h.uniforms.h.value = blur / 2 / size[0];
    v.uniforms.v.value = blur / 2 / size[1];
  };
  return {
    resize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      size = [width, height];
      setBlur();
    },
    setFocus(y) { h.uniforms.r.value = v.uniforms.r.value = y; },
    setBlur(px) { blur = px; setBlur(); },
    render() { composer.render(); },
  };
}
