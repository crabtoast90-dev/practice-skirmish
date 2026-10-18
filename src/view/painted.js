import * as THREE from 'three';

// The painted look (?look=painted): a painting of the empty board, made over a
// render from the play camera, is projected back onto the room's geometry from
// that same camera. The minis stay lit 3D on top. Where the painting's frame
// doesn't reach, the normal lit material shows through.
//
// The painting is already a finished picture, but the frame still goes through
// tone mapping, so the shader undoes ACES before writing it out. The grade pass
// is switched off in this look (the painting carries its own grade).

const ProjectShader = {
  vertexShader: /* glsl */ `
    uniform mat4 paintViewProj;
    varying vec4 vPaint;
    void main() {
      vPaint = paintViewProj * modelMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D paint;
    uniform float exposure;
    varying vec4 vPaint;
    // Inverse of three's ACESFilmicToneMapping (tonemapping_pars_fragment).
    vec3 inverseACES(vec3 y) {
      const mat3 inMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      vec3 w = clamp(inverse(outMat) * y, 0.0, 1.0);
      vec3 a = 1.0 - 0.983729 * w;
      vec3 b = 0.0245786 - 0.4329510 * w;
      vec3 c = -0.000090537 - 0.238081 * w;
      vec3 v = (-b + sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * max(a, 1e-3));
      return max(inverse(inMat) * v, 0.0) * 0.6 / exposure;
    }
    void main() {
      if (vPaint.w <= 0.0) discard;
      vec2 ndc = vPaint.xy / vPaint.w;
      if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) discard;
      vec3 c = texture2D(paint, ndc * 0.5 + 0.5).rgb;
      gl_FragColor = vec4(inverseACES(c), 1.0);
    }`,
};

// The plate camera saved next to each painting: where the play camera was when
// the plate was rendered (see scripts/paintover.mjs).
export function cameraFromJSON(j) {
  const cam = new THREE.PerspectiveCamera(j.fov, j.aspect, j.near, j.far);
  cam.position.fromArray(j.position);
  cam.quaternion.fromArray(j.quaternion);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

export function cameraToJSON(cam, aspect) {
  return { position: cam.position.toArray(), quaternion: cam.quaternion.toArray(), fov: cam.fov, aspect, near: cam.near, far: cam.far };
}

// name: 'laptop' or 'phone'. Resolves once every static mesh carries the painting.
export async function applyPaintedLook({ room, propsReady, renderer, post, name }) {
  const base = `${import.meta.env.BASE_URL}look/painted-${name}`;
  const [json, paint] = await Promise.all([
    fetch(`${base}.json`).then((r) => r.json()),
    new THREE.TextureLoader().loadAsync(`${base}.png`),
  ]);
  await propsReady;
  paint.colorSpace = THREE.SRGBColorSpace;
  paint.anisotropy = 8;
  const cam = cameraFromJSON(json);
  const paintViewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const material = new THREE.ShaderMaterial({
    ...ProjectShader,
    uniforms: { paint: { value: paint }, paintViewProj: { value: paintViewProj }, exposure: { value: renderer.toneMappingExposure } },
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  // Mini shadows only: the painting already has the room's own shadows in it.
  const shadow = new THREE.ShadowMaterial({ opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  const meshes = [];
  room.traverse((o) => {
    if (o.isMesh) meshes.push(o);
    if (o.isSprite) o.visible = false; // the lamp's glow: the painting has its own
  });
  for (const m of meshes) {
    m.castShadow = false;
    const over = new THREE.Mesh(m.geometry, material);
    over.renderOrder = 1;
    m.add(over);
    if (m.receiveShadow) {
      const s = new THREE.Mesh(m.geometry, shadow);
      s.receiveShadow = true;
      s.renderOrder = 2;
      m.add(s);
    }
  }
  post.setGrade(false);
  return { meshes: meshes.length, painting: `${paint.image.width}x${paint.image.height}`, camera: json };
}
