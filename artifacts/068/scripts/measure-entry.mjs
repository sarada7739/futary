// 068 追補: GLB の正面を正射影・光なしで描き、画面（黒い縁の内側）の位置と大きさを測るための入口。
// measure-model.mjs が esbuild で束ねてページに入れる
import { Box3, MeshBasicMaterial, OrthographicCamera, Raycaster, Scene, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// 正面（+z から）・背面（-z から）を描いて、canvas の dataURL と、モデルの箱を返す
window.renderViews = async (glbBase64, pixelsPerUnit) => {
  const gltf = await new GLTFLoader().parseAsync(base64ToBuffer(glbBase64), "");
  const model = gltf.scene;
  model.traverse((node) => {
    if (node.isMesh) node.material = new MeshBasicMaterial({ map: node.material.map });
  });
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const width = Math.round(size.x * pixelsPerUnit);
  const height = Math.round(size.y * pixelsPerUnit);
  const renderer = new WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
  renderer.setSize(width, height);
  renderer.setClearColor(0x00ff00, 1);
  const scene = new Scene();
  scene.add(model);
  const views = {};
  for (const [name, z] of [
    ["front", 1],
    ["back", -1],
  ]) {
    const camera = new OrthographicCamera(-size.x / 2, size.x / 2, size.y / 2, -size.y / 2, 0.001, 10);
    camera.position.set(center.x, center.y, center.z + z * 2);
    camera.lookAt(center);
    renderer.render(scene, camera);
    views[name] = renderer.domElement.toDataURL("image/png");
  }
  return { views, box: { min: box.min.toArray(), max: box.max.toArray() }, width, height };
};

// 正面（+z）から -z へ光線を当て、最初に当たる面の z を返す（画面の表面・縁の高さを測る）
window.raycastZ = async (glbBase64, points) => {
  const gltf = await new GLTFLoader().parseAsync(base64ToBuffer(glbBase64), "");
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  return points.map(([x, y]) => {
    raycaster.set(new Vector3(x, y, 1), new Vector3(0, 0, -1));
    const hit = raycaster.intersectObject(model, true)[0];
    return { x, y, z: hit ? hit.point.z : null };
  });
};
