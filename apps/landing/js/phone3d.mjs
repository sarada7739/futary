// LP「さわってみる」のスマホを 3D で描き、ふち・余白のドラッグで傾ける（068）。
// scripts/build-public.mjs が esbuild で /phone3d.js に束ねる（three.js は CDN から読まない。CSP は script-src 'self'）。
//
// 2 層を同じカメラで描く: 下は CSS3DRenderer（既存の iframe をそのまま入れる。本物の DOM なので触れる）、
// 上は WebGLRenderer（本体。pointer-events: none）。本体の画面の位置に NoBlending の透明な穴を開け、
// 下の iframe を見せる。画面の上の操作は iframe が受けるので、ドラッグはふち・余白からだけ始まる。
//
// 出す条件（満たさなければ何もしない = HTML のままの 2D の枠と iframe）: 幅 768px 以上・WebGL が使える・
// prefers-reduced-motion でない
import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoBlending,
  PerspectiveCamera,
  Scene,
  Shape,
  ShapeGeometry,
  WebGLRenderer,
} from "three";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { decayTilt, isAtRest, tiltFromDrag } from "./tilt.mjs";

// 画面は iframe と同じ 390×844（単位 = CSS px）。本体は縁 20 ずつ・厚み 40
const SCREEN_W = 390;
const SCREEN_H = 844;
const SCREEN_RADIUS = 48;
const BODY_W = 430;
const BODY_H = 884;
const BODY_D = 40;
const BODY_RADIUS = 66;
// 正面のとき 1 単位を 0.8px に見せる（2D の iframe の scale(0.8) と同じ大きさ）
const SCALE = 0.8;
const FOV = 35;

function canUse3D() {
  if (!window.matchMedia("(min-width: 768px)").matches) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    const context = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
    // 調べるために作った文脈はすぐ手放す（本物は節が近づいてから作る）
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function roundedRectShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

// 本体（WebGL）。コードで組む（glTF は使わない）
function buildPhoneModel() {
  const group = new Group();
  const titanium = new MeshStandardMaterial({ color: 0x8a8a94, metalness: 0.6, roughness: 0.35 });
  const black = new MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.2, roughness: 0.5 });
  const front = BODY_D / 2;

  group.add(new Mesh(new RoundedBoxGeometry(BODY_W, BODY_H, BODY_D, 8, BODY_RADIUS / 2), titanium));

  // 画面のまわりの黒い縁（ガラスの下の黒い帯）
  const bezel = new Mesh(new ShapeGeometry(roundedRectShape(BODY_W - 10, BODY_H - 10, BODY_RADIUS - 4), 12), black);
  bezel.position.z = front + 0.2;
  group.add(bezel);

  // 画面の穴: 色を透明で上書きして（NoBlending）、下の CSS の層（iframe）を見せる
  const hole = new Mesh(
    new ShapeGeometry(roundedRectShape(SCREEN_W, SCREEN_H, SCREEN_RADIUS), 12),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: NoBlending }),
  );
  hole.position.z = front + 0.4;
  group.add(hole);

  // 画面の上のピル型の黒い島
  const island = new Mesh(new CapsuleGeometry(14, 72, 4, 12), black);
  island.rotation.z = Math.PI / 2;
  island.position.set(0, SCREEN_H / 2 - 28, front + 1);
  island.scale.z = 0.1;
  group.add(island);

  // 側面のボタン（左に 2 つ・右に 1 つ）
  const button = (x, y, length) => {
    const mesh = new Mesh(new BoxGeometry(6, length, 14), titanium);
    mesh.position.set(x, y, 0);
    group.add(mesh);
  };
  button(-BODY_W / 2 - 2, 190, 70);
  button(-BODY_W / 2 - 2, 90, 70);
  button(BODY_W / 2 + 2, 140, 110);

  // 背面のカメラの出っ張り
  const bump = new Mesh(new RoundedBoxGeometry(150, 150, 10, 4, 30), titanium);
  bump.position.set(-BODY_W / 2 + 100, BODY_H / 2 - 100, -front - 4);
  group.add(bump);
  for (const [dx, dy] of [
    [-34, 34],
    [-34, -34],
    [34, 0],
  ]) {
    const lens = new Mesh(new CylinderGeometry(26, 26, 8, 32), black);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(bump.position.x + dx, bump.position.y + dy, -front - 10);
    group.add(lens);
  }
  return group;
}

function setUp(phone) {
  const iframe = phone.querySelector(".phone-screen");
  if (!iframe) return;
  const width = phone.clientWidth;
  const height = phone.clientHeight;

  // 正面で 1 単位 = SCALE px になる距離
  const distance = height / 2 / (SCALE * Math.tan(((FOV / 2) * Math.PI) / 180));
  const camera = new PerspectiveCamera(FOV, width / height, 1, distance * 3);
  camera.position.set(0, 0, distance);

  // 下の層（CSS3D）はすぐ組む: 既存の iframe をそのまま移す（2 つ目は作らない）。移すと読み直しに
  // なるので、節が見える前（lazy の読み込みが始まる前）に移す
  const css = new CSS3DRenderer();
  css.setSize(width, height);
  css.domElement.className = "phone3d-css";
  const sceneCSS = new Scene();
  const modelCSS = new Group();
  sceneCSS.add(modelCSS);
  const screen = new CSS3DObject(iframe);
  screen.position.z = BODY_D / 2 + 0.4;
  modelCSS.add(screen);
  phone.classList.add("is-3d");
  phone.append(css.domElement);

  // 上の層（WebGL の本体）は節が近づいてから作る（最初の表示を遅らせない）
  let gl = null;
  let sceneGL = null;
  let modelGL = null;
  const setUpGL = () => {
    try {
      gl = new WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return; // 作れなければ本体なしで iframe だけ（触れるまま）
    }
    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    gl.setSize(width, height);
    gl.domElement.className = "phone3d-gl";
    sceneGL = new Scene();
    modelGL = buildPhoneModel();
    sceneGL.add(modelGL);
    sceneGL.add(new AmbientLight(0xffffff, 1.6));
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(400, 600, 900);
    sceneGL.add(light);
    phone.append(gl.domElement);
  };

  let tilt = { x: 0, y: 0 };
  let drag = null;
  let visible = false;
  let frame = 0;
  let last = 0;

  const draw = () => {
    for (const model of [modelGL, modelCSS]) {
      if (!model) continue;
      model.rotation.x = tilt.x;
      model.rotation.y = tilt.y;
    }
    if (gl) gl.render(sceneGL, camera);
    css.render(sceneCSS, camera);
  };

  // 見えている間かつ動いている間だけ描く
  const tick = (now) => {
    frame = 0;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!drag) tilt = decayTilt(tilt, dt);
    draw();
    if (visible && (drag || !isAtRest(tilt))) frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (frame || !visible) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };

  phone.addEventListener("pointerdown", (event) => {
    if (drag || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: tilt };
    phone.setPointerCapture(event.pointerId);
    phone.classList.add("is-dragging");
    start();
  });
  phone.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    tilt = tiltFromDrag(drag.start, event.clientX - drag.x, event.clientY - drag.y);
  });
  const release = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    phone.classList.remove("is-dragging");
    start();
  };
  phone.addEventListener("pointerup", release);
  phone.addEventListener("pointercancel", release);

  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      setUpGL();
      draw();
    },
    { rootMargin: "400px" },
  );
  near.observe(phone);
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) start();
  }).observe(phone);

  draw();
}

const phone = document.querySelector(".demo .phone");
if (phone && canUse3D()) setUp(phone);
