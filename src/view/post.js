import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

// Warm grade and a lamp-pool vignette, in linear light before tone mapping.
const GradeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, c * vec3(1.08, 1.0, 0.88), smoothstep(0.2, 1.0, l)); // warm highlights
      c = mix(vec3(l), c, 1.1);                                       // a touch more saturation
      float v = smoothstep(0.9, 0.3, distance(vUv, vec2(0.5)));
      c *= mix(0.7, 1.0, v);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Tilt-shift: blur grows above and below a sharp band through the board's middle,
// so the scene reads as miniatures. `blur` is in pixels at the screen's top/bottom edge.
export function createPost(renderer, scene, camera, { blur = 10 } = {}) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const h = new ShaderPass(HorizontalTiltShiftShader);
  const v = new ShaderPass(VerticalTiltShiftShader);
  h.uniforms.r.value = v.uniforms.r.value = 0.5;
  composer.addPass(h);
  composer.addPass(v);
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());
  return {
    resize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      // Shader: offset = 4 * k / size * |r - y|; at the edge |r - y| = 0.5, so k = blur / 2.
      const k = blur / 2;
      h.uniforms.h.value = k / width;
      v.uniforms.v.value = k / height;
    },
    render() { composer.render(); },
  };
}
