// 068 追補: FBX → GLB の変換をブラウザ（Playwright の Chromium）の中で行うための入口。convert-model.mjs が
// esbuild で束ねてページに入れる（FBXLoader・GLTFExporter は画像を扱うのに DOM が要る）
import { MeshStandardMaterial, SRGBColorSpace, TextureLoader } from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// FBX の中身を調べる（メッシュ・頂点数・材質・大きさ）
window.inspectFbx = (fbxBase64) => {
  const root = new FBXLoader().parse(base64ToBuffer(fbxBase64), "");
  const meshes = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    const g = node.geometry;
    g.computeBoundingBox();
    meshes.push({
      name: node.name,
      vertices: g.attributes.position.count,
      indexed: Boolean(g.index),
      attributes: Object.keys(g.attributes),
      material: [].concat(node.material).map((m) => ({ type: m.type, name: m.name, map: Boolean(m.map) })),
      box: [g.boundingBox.min.toArray(), g.boundingBox.max.toArray()],
      position: node.position.toArray(),
      rotation: node.rotation.toArray().slice(0, 3),
      scale: node.scale.toArray(),
    });
  });
  return { rootScale: root.scale.toArray(), meshes };
};

// FBX を読み、色のテクスチャを差し替え（ロゴを消した 1024px の JPEG）、GLB にして返す
window.convertFbx = async (fbxBase64, textureDataUrl, material) => {
  const root = new FBXLoader().parse(base64ToBuffer(fbxBase64), "");
  const texture = await new TextureLoader().loadAsync(textureDataUrl);
  texture.colorSpace = SRGBColorSpace;
  // flipY は既定（true）のまま。FBX の UV はこの向きが前提で、GLTFExporter が書き出すときに画像を反転して
  // glTF の向きに合わせる
  // GLB に埋めるときも JPEG のまま（既定は PNG で重くなる）
  texture.userData.mimeType = "image/jpeg";
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.material = new MeshStandardMaterial({ map: texture, metalness: material.metalness, roughness: material.roughness });
  });
  const glb = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  return bufferToBase64(glb);
};
