// LP「さわってみる」のスマホを 3D で描き、ふち・余白のドラッグで傾ける（068）。
// scripts/build-public.mjs が esbuild で /phone3d.js に束ねる（three.js は CDN から読まない。CSP は script-src 'self'）。
//
// 2 層を同じカメラで描く: 下は CSS3DRenderer（既存の iframe をそのまま入れる。本物の DOM なので触れる）、
// 上は WebGLRenderer（本体。pointer-events: none）。本体の画面の位置に NoBlending の透明な穴を開け、
// 下の iframe を見せる。画面の上の操作は iframe が受けるので、ドラッグはふち・余白からだけ始まる。
// 本体は人間が作ったモデル（/assets/phone.glb。docs/sample/fbx/ から artifacts/068/scripts/ で変換）。
//
// 出す条件（満たさなければ何もしない = HTML のままの 2D の枠と iframe）: 幅 768px 以上・WebGL が使える。
// prefers-reduced-motion のときも 3D は出す（傾けるのは本人が動かす操作）が、離したあと正面へ戻る動きは
// 付けずにすぐ正面に戻す。モデルが読めなければ 2D に戻す
import { AmbientLight, DirectionalLight, Group, Mesh, MeshBasicMaterial, NoBlending, PerspectiveCamera, Scene, Shape, ShapeGeometry, WebGLRenderer } from "three";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FRONT, angleForScroll, decayTilt, isAtRest, scrollProgress, tiltFromDrag } from "./tilt.mjs";

// phone.glb の画面（黒い縁の内側）の位置と大きさ（モデルの単位。正面を正射影で描いて測った値。
// artifacts/068/stage2/report.md）。画面の表面は z = screenZ（モデルの最前面）
const MODEL = {
  screenX: -0.0008,
  screenY: 0.502,
  screenZ: 0.0439,
  screenW: 0.43,
  screenH: 0.9645,
  screenRadius: 0.065,
};
// iframe の幅は 390（CSS px）のまま、モデルの画面の幅に合わせて拡大する（1 単位 = 1 CSS px）
const IFRAME_W = 390;
const K = IFRAME_W / MODEL.screenW;
// 画面の縦横の比はモデルに合わせる（iframe を少し縦長にする。はみ出しも隙間も出さない）
const IFRAME_H = Math.round(MODEL.screenH * K);
const SCREEN_RADIUS = MODEL.screenRadius * K;
// 正面のとき 1 単位を 0.8px に見せる（2D の iframe の scale(0.8) と同じ大きさ）
const SCALE = 0.8;
const FOV = 35;
// 穴と iframe を画面の表面からどれだけ手前に置くか（単位）
const HOLE_LIFT = 0.5;

function canUse3D() {
  if (!window.matchMedia("(min-width: 768px)").matches) return false;
  try {
    const context = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
    // 調べるために作った文脈はすぐ手放す（本物は節が近づいてから作る）
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function roundedRect(path, cx, cy, width, height, radius) {
  const x = cx - width / 2;
  const y = cy - height / 2;
  path.moveTo(x + radius, y);
  path.lineTo(x + width - radius, y);
  path.quadraticCurveTo(x + width, y, x + width, y + radius);
  path.lineTo(x + width, y + height - radius);
  path.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  path.lineTo(x + radius, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - radius);
  path.lineTo(x, y + radius);
  path.quadraticCurveTo(x, y, x + radius, y);
  return path;
}

// 画面の穴: 色を透明で上書きして（NoBlending）、下の CSS の層（iframe）を見せる。画面の上の島も覆う
// （デモの帯の文字に重なるので消す）。本体は凸で画面は最前面なので、正面が見えている間に本体が画面の手前を
// ふさぐことは無い。なので奥行きを見ずに本体の後で上書きする（depthTest: false。奥行きの競り合いで縞や点が出ない）
function buildHole() {
  const shape = roundedRect(new Shape(), 0, 0, IFRAME_W, IFRAME_H, SCREEN_RADIUS);
  const hole = new Mesh(
    new ShapeGeometry(shape, 16),
    new MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  hole.renderOrder = 1;
  hole.position.z = HOLE_LIFT;
  return hole;
}

function setUp(phone) {
  const iframe = phone.querySelector(".phone-screen");
  const frameImage = phone.querySelector(".phone-frame");
  if (!iframe) return;
  const width = phone.clientWidth;
  const height = phone.clientHeight;

  // 正面で 1 単位 = SCALE px になる距離。描く奥行きの範囲はモデルのまわり（傾けても ±0.5K 程度）に詰める。
  // near を 1 にすると奥行きの精度が足りず、穴と画面の表面が競り合って縞が出る
  const distance = height / 2 / (SCALE * Math.tan(((FOV / 2) * Math.PI) / 180));
  const camera = new PerspectiveCamera(FOV, width / height, distance - K * 0.6, distance + K * 0.6);
  camera.position.set(0, 0, distance);

  // 下の層（CSS3D）はすぐ組む: 既存の iframe をそのまま移す（2 つ目は作らない）。iframe は DOM の中で
  // 動かすと読み直しになるので早く移す（Chromium の lazy は移す前に始まるので、3D のとき HTML は 2 回読まれる。0節 #8）。
  // 本体のモデルが読めるまでは描かず、iframe は 2D の CSS のまま（.is-3d を付けない）で、枠の絵の下に置いておく
  // （遅い回線でも本体の無い画面だけが見えない。追補 2 #4）
  const css = new CSS3DRenderer();
  css.setSize(width, height);
  css.domElement.className = "phone3d-css";
  const sceneCSS = new Scene();
  const modelCSS = new Group();
  sceneCSS.add(modelCSS);
  const screen = new CSS3DObject(iframe);
  screen.position.z = HOLE_LIFT;
  modelCSS.add(screen);
  phone.append(css.domElement);
  const cameraElement = css.domElement.firstChild.firstChild;
  // CSS3DRenderer は描くときに初めて iframe を自分の層へ移すので、描くのを待つ間も先に移しておく
  cameraElement.appendChild(iframe);

  // 正面で止まっているときは、iframe を同じ位置・大きさの 2D の変形（translate + scale）に置き換える。
  // 3D の変形のままだと、Chromium は iframe を等倍で描いてから縮めるので文字がにじむ（2D の scale は縮めた
  // 大きさで描く）。CSS3DRenderer は書いた文字列を覚えていて同じなら書き直さないので、3D に戻すときは
  // 覚えている文字列を元に戻してから描く
  let flat = null;
  const flatten = () => {
    const stage = phone.getBoundingClientRect();
    const rect = iframe.getBoundingClientRect();
    flat = { camera: cameraElement.style.transform, iframe: iframe.style.transform };
    cameraElement.style.transform = "none";
    iframe.style.transformOrigin = "0 0";
    iframe.style.transform = `translate(${Math.round(rect.left - stage.left)}px, ${Math.round(rect.top - stage.top)}px) scale(${rect.width / IFRAME_W})`;
  };
  const unflatten = () => {
    if (!flat) return;
    cameraElement.style.transform = flat.camera;
    iframe.style.transformOrigin = "";
    iframe.style.transform = flat.iframe;
    flat = null;
  };

  // モデルが読めなかったときは 2D に戻す（iframe を元の場所へ。読み直しになる）
  const backTo2D = () => {
    flat = null;
    iframe.removeAttribute("style");
    iframe.removeAttribute("draggable");
    phone.insertBefore(iframe, frameImage);
    css.domElement.remove();
    gl?.domElement.remove();
    gl?.dispose();
    gl = null;
    phone.classList.remove("is-3d", "is-dragging");
    stopped = true;
  };

  // 上の層（WebGL の本体）は節が近づいてから作り、モデルを読む（最初の表示を遅らせない）
  let gl = null;
  let sceneGL = null;
  let modelGL = null;
  let stopped = false;
  let ready = false;
  const setUpGL = async () => {
    try {
      gl = new WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      backTo2D();
      return;
    }
    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    gl.setSize(width, height);
    gl.domElement.className = "phone3d-gl";
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync("/assets/phone.glb");
    } catch {
      backTo2D();
      return;
    }
    // モデルの画面の中心を原点、画面の表面を z = 0 に置き、画面の幅が IFRAME_W になるよう拡大する
    const body = gltf.scene;
    body.scale.setScalar(K);
    body.position.set(-MODEL.screenX * K, -MODEL.screenY * K, -MODEL.screenZ * K);
    body.traverse((node) => {
      if (!node.isMesh) return;
      // 環境マップが無いので金属感は控えめに（強いと暗く沈む）
      node.material.metalness = 0.35;
      node.material.roughness = 0.45;
    });
    modelGL = new Group();
    modelGL.add(body, buildHole());
    sceneGL = new Scene();
    sceneGL.add(modelGL);
    sceneGL.add(new AmbientLight(0xffffff, 1.4));
    const light = new DirectionalLight(0xffffff, 2.4);
    light.position.set(400, 600, 900);
    sceneGL.add(light);
    phone.append(gl.domElement);
    // 本体が読めたら 3D に切り替える: 枠の絵を消し（.is-3d）、iframe をモデルの画面の大きさにする
    iframe.style.width = `${IFRAME_W}px`;
    iframe.style.height = `${IFRAME_H}px`;
    iframe.style.borderRadius = `${SCREEN_RADIUS}px`;
    phone.classList.add("is-3d");
    ready = true;
    // 始めはスクロールの位置で決まる角度（節の手前なら斜め）
    target = targetForScroll();
    tilt = target;
    draw();
  };

  let tilt = { x: 0, y: 0 };
  let drag = null;
  let visible = false;
  let frame = 0;
  let last = 0;
  // 止まっているときの角度。スクロールの位置で決まる（追補 3）。動きを減らす設定なら正面のまま
  let target = FRONT;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targetForScroll = () => {
    if (reducedMotion()) return FRONT;
    const rect = phone.getBoundingClientRect();
    return angleForScroll(scrollProgress(rect.top, rect.height, window.innerHeight));
  };

  const draw = () => {
    if (stopped || !ready) return;
    for (const model of [modelGL, modelCSS]) {
      if (!model) continue;
      model.rotation.x = tilt.x;
      model.rotation.y = tilt.y;
    }
    if (gl && sceneGL) gl.render(sceneGL, camera);
    unflatten();
    css.render(sceneCSS, camera);
    if (!drag && isAtRest(tilt)) flatten();
  };

  // 見えている間かつ動いている間だけ描く。離したあとは target（スクロールで決まる角度）へ戻す
  const tick = (now) => {
    frame = 0;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!drag) tilt = decayTilt(tilt, dt, target);
    draw();
    if (!stopped && visible && (drag || !isAtRest(tilt, target))) frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (frame || !visible || stopped || !ready) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };

  phone.addEventListener("pointerdown", (event) => {
    if (stopped || !ready || drag || event.button !== 0) return;
    // タッチは横のスワイプだけ傾ける（縦はページのスクロール。CSS の touch-action: pan-y）
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: tilt, yOnly: event.pointerType === "touch" };
    phone.setPointerCapture(event.pointerId);
    phone.classList.add("is-dragging");
    start();
  });
  phone.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    tilt = tiltFromDrag(drag.start, event.clientX - drag.x, event.clientY - drag.y, { yOnly: drag.yOnly });
  });
  const release = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    phone.classList.remove("is-dragging");
    // 動きを減らす設定のときは、戻る動きを付けずにすぐ戻す
    if (reducedMotion()) tilt = target;
    start();
  };
  phone.addEventListener("pointerup", release);
  phone.addEventListener("pointercancel", release);

  const near = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      near.disconnect();
      setUpGL();
    },
    { rootMargin: "400px" },
  );
  near.observe(phone);
  // スクロールで斜めから正面へ（追補 3）。1 フレームに 1 回だけ角度を出し直す。ドラッグの間は使わない。
  // 戻っている途中なら向かう先だけを変え、止まっていればその角度で描く
  let scrollFrame = 0;
  const onScroll = () => {
    scrollFrame = 0;
    if (stopped || !ready || !visible) return;
    const atTarget = isAtRest(tilt, target);
    const next = targetForScroll();
    // 角度が変わらなければ描き直さない（中心を過ぎて正面のままスクロールしている間など）
    if (atTarget && !drag && isAtRest(next, target)) return;
    target = next;
    if (drag) return;
    if (atTarget) {
      tilt = target;
      draw();
    } else {
      start();
    }
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(onScroll);
    },
    { passive: true },
  );

  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) onScroll();
  }).observe(phone);

  draw();
}

const phone = document.querySelector(".demo .phone");
if (phone && canUse3D()) setUp(phone);
