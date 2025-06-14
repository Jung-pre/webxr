import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { Hands } from '@mediapipe/hands';
import { Camera as MediaPipeCamera } from '@mediapipe/camera_utils';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// Mediapipe HAND_CONNECTIONS (관절 연결 정보)
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],      // 엄지
  [0,5],[5,6],[6,7],[7,8],     // 검지
  [0,9],[9,10],[10,11],[11,12],// 중지
  [0,13],[13,14],[14,15],[15,16],// 약지
  [0,17],[17,18],[18,19],[19,20],// 소지
  [5,9],[9,13],[13,17],[5,17]  // 손바닥
];

let scene, camera, renderer, controls, boss;
let fireballs = [];
let handLandmarks = [];
let jointSpheres = [[], []]; // [손][관절]
let jointLines = [[], []];   // [손][라인]
let jointLabels = [[], []];  // [손][텍스트]

let fireballStates = [
  { fireball: null, state: 'idle', lastFist: 0, lastVictory: 0, iceball: null, iceState: 'idle', lastFingerOne: 0 },
  { fireball: null, state: 'idle', lastFist: 0, lastVictory: 0, iceball: null, iceState: 'idle', lastFingerOne: 0 }
];
let iceballs = [];
let lightningballs = [];

let bossBox = null;
let bossOriginalMaterials = [];
let bossHitTimer = 0;
let explosionParticles = [];
let damageTexts = [];

let shakeTime = 0;
let cameraOriginalPos = null;

let blinkState = { active: false, startTime: 0, effectMeshes: [], triggered: false };
let blinkFlash = 0;
let blinkCooldown = 0;

let auroraState = { active: false, startTime: 0, effectMeshes: [], triggered: false, idx: null, auroraBall: null, auroraParticles: [] };
let auroraCooldown = 0;

// 손별 오로라 이펙트 상태
let handAuroraEffects = [null, null];

// 오로라볼 및 파티클 상태
let handAuroraBall = null;
let handAuroraParticles = [];

// 오로라볼 발사 상태
let auroraBallFired = false;
let lastAuroraGestures = ['', ''];
let flyingAuroraBalls = [];
let auroraBallReadyTime = 0;

let dragonMixer; // <--- 전역 선언 추가

let groundY = 0; // 지형 최고점 Y값(전역)
let landscape = null; // 지형 mesh 전역 참조

// === 3D HP bar mesh ===
let bossHpBarBgMesh = null;
let bossHpBarMesh = null;
let barWidth = 20; // HP바 너비 (전역)
let barHeight = 0.6; // HP바 높이 (전역)
// let bossHpBarLine = null; // HP바 배경 라인

// 파티클을 뿜는 클래스
class FireballEmitter {
  constructor(scene, origin, color = 0xff5500) {
    this.scene = scene;
    this.origin = origin.clone();
    this.particles = [];
    this.alive = true;
    this.particleGeometry = new THREE.BoxGeometry(0.02, 0.02, 0.02); // 네모 파티클
    this.particleMaterial = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.7 });
  }

  emit(position) {
    // 한 번에 여러 개 입자 생성
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(this.particleGeometry, this.particleMaterial.clone());
      mesh.position.copy(position);
      this.scene.add(mesh);
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.12,
        (Math.random() - 0.5) * 0.12,
        (Math.random() - 0.5) * 0.12
      );
      this.particles.push({ mesh, velocity, life: Math.random() * 20 + 20 });
    }
  }

  update() {
    this.particles.forEach((p) => {
      p.mesh.position.add(p.velocity);
      p.life -= 1;
      p.mesh.material.opacity = Math.max(0, p.life / 40);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
      }
    });
    // 죽은 입자 제거
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length === 0 && !this.alive) {
      this.finished = true;
    }
  }

  isFinished() {
    return this.finished;
  }

  stop() {
    this.alive = false;
  }

  dispose() {
    // 모든 파티클을 즉시 제거
    this.particles.forEach((p) => {
      this.scene.remove(p.mesh);
    });
    this.particles = [];
    this.finished = true;
  }
}

let fireEmitters = [];
let iceEmitters = [];
let lightningEmitters = [];

function spawnFireParticles(position, fireballId) {
  let emitter = fireEmitters.find(e => e.ballId === fireballId);
  if (!emitter) {
    emitter = new FireballEmitter(scene, position, 0xff5500);
    emitter.ballId = fireballId;
    fireEmitters.push(emitter);
  }
  emitter.emit(position);
}
function spawnIceParticles(position, iceballId) {
  let emitter = iceEmitters.find(e => e.ballId === iceballId);
  if (!emitter) {
    emitter = new FireballEmitter(scene, position, 0x66ccff);
    emitter.ballId = iceballId;
    iceEmitters.push(emitter);
  }
  emitter.emit(position);
}
function spawnLightningParticles(position, lightningballId) {
  let emitter = lightningEmitters.find(e => e.ballId === lightningballId);
  if (!emitter) {
    emitter = new FireballEmitter(scene, position, 0xffff66);
    emitter.ballId = lightningballId;
    lightningEmitters.push(emitter);
  }
  emitter.emit(position);
}

let prevTime = performance.now();
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const speed = 100.0;
let isThirdPerson = false;
let canJump = false;
let velocityY = 0;
const gravity = 30; // 중력 가속도
let player;

function createPlayer() {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x55ff55, transparent: true, opacity: 0 }); // 완전 투명
  player = new THREE.Mesh(geometry, material);
  player.position.set(0, 2, 0);
  player.castShadow = true;
  player.receiveShadow = true;
  scene.add(player);
}

function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb3e3ff); // 밝은 하늘색 낮 배경

  // Fog
  scene.fog = new THREE.Fog(0xb3e3ff, 40, 120);

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 8, 24);

  // jointSpheres/Lines/Labels를 scene 생성 직후에 추가
  initHandSpheres();

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.85); // 밝은 흰색
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.1); // 밝은 태양빛
  dirLight.position.set(20, 30, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  scene.add(dirLight);

  // Ground: minecraft_world 35배로 교체
  const landscapeLoader = new GLTFLoader();
  landscapeLoader.load('/minecraft_world/scene.gltf', (gltf) => {
    landscape = gltf.scene;
    landscape.position.set(0, 0, 0);
    landscape.scale.set(35, 35, 35);
    scene.add(landscape);

    // 지형의 bounding box 계산 후 플레이어를 땅 위로 올림
    const box = new THREE.Box3().setFromObject(landscape);
    groundY = box.max.y;
    if (player) {
      player.position.set(0, groundY + 1, 0); // 초록색 땅 위에 시작
    }
  });

  // SkyBox (보랏빛 밤하늘)
  const skyGeo = new THREE.SphereGeometry(300, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0xb3e3ff,
    side: THREE.BackSide,
    transparent: false,
    opacity: 1.0,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // boss.glb 캐릭터 추가 → dragon.glb로 교체
  const loader = new GLTFLoader();
  loader.load('/dragon.glb', (gltf) => {
    boss = gltf.scene;
    boss.position.set(0, 21, -10); // 하늘에, 기존보다 반만 낮게
    boss.scale.set(5, 5, 5); // 2배 더 크게
    boss.maxHP = 100;
    boss.currentHP = 100;
    boss.lastHitTime = 0;
    boss.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        // 원본 재질 저장
        bossOriginalMaterials.push({ mesh: child, material: child.material.clone() });
      }
    });
    scene.add(boss);
    // boss bounding box
    bossBox = new THREE.Box3().setFromObject(boss);
    // HP바와 배경 라인 생성 (보스 머리 위, anchor 중앙)
    // barWidth, barHeight는 전역 사용
    // 보스의 머리 위 좌표 계산 (max.y + 약간 위)
    const bossWorldPos = new THREE.Vector3();
    boss.getWorldPosition(bossWorldPos);
    const barY = bossBox.max.y + 8;
    // HP바 (anchor 중앙)
    const barGeom = new THREE.PlaneGeometry(barWidth, barHeight);
    const barMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.95 });
    bossHpBarMesh = new THREE.Mesh(barGeom, barMat);
    bossHpBarMesh.position.set(bossWorldPos.x, barY, bossWorldPos.z + 0.001);
    bossHpBarMesh.renderOrder = 1000;
    bossHpBarMesh.material.depthTest = false;
    scene.add(bossHpBarMesh);
    // fly 애니메이션 적용
    if (gltf.animations && gltf.animations.length) {
      dragonMixer = new THREE.AnimationMixer(boss);
      const flyClip = gltf.animations.find(a => a.name.toLowerCase().includes('fly')) || gltf.animations[0];
      if (flyClip) {
        const action = dragonMixer.clipAction(flyClip);
        action.reset();
        action.play();
      }
    }
  });

  // Controls: PointerLockControls (1인칭/3인칭)
  controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());
  // 플레이어(박스) 생성
  createPlayer();
  // XR 세션 시작/종료 시 컨트롤 활성화/비활성화
  renderer.xr.addEventListener('sessionstart', () => {
    controls.enabled = false;
  });
  renderer.xr.addEventListener('sessionend', () => {
    controls.enabled = true;
  });
  // 클릭 시 포인터락 진입
  renderer.domElement.addEventListener('click', () => {
    controls.lock();
  });
  // 키 입력 처리
  const onKeyDown = function (event) {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW': moveForward = true; break;
      case 'ArrowLeft':
      case 'KeyA': moveLeft = true; break;
      case 'ArrowDown':
      case 'KeyS': moveBackward = true; break;
      case 'ArrowRight':
      case 'KeyD': moveRight = true; break;
      case 'Space':
        if (canJump) {
          velocityY = 12;
          canJump = false;
        }
        break;
      case 'KeyC':
        isThirdPerson = !isThirdPerson;
        break;
    }
  };
  const onKeyUp = function (event) {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW': moveForward = false; break;
      case 'ArrowLeft':
      case 'KeyA': moveLeft = false; break;
      case 'ArrowDown':
      case 'KeyS': moveBackward = false; break;
      case 'ArrowRight':
      case 'KeyD': moveRight = false; break;
    }
  };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // Resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Mediapipe용 비디오 엘리먼트 추가 (화면에 보이지 않게)
  const video = document.createElement('video');
  video.id = 'webcam';
  video.style.display = 'none';
  video.autoplay = true;
  video.playsInline = true;
  document.body.appendChild(video);

  // 노트북 카메라(웹캠) 스트림 연결 및 Mediapipe Hands 초기화
  navigator.mediaDevices.getUserMedia({ video: true })
    .then((stream) => {
      video.srcObject = stream;
      video.play();
      initMediaPipe();
    })
    .catch((err) => {
      console.error('카메라 접근 실패:', err);
      alert('카메라 접근이 거부되었습니다. 브라우저 설정을 확인하세요.');
    });
}

function initHandSpheres() {
  for (let hand = 0; hand < 2; hand++) {
    jointSpheres[hand] = [];
    jointLines[hand] = [];
    jointLabels[hand] = [];
    for (let i = 0; i < 21; i++) {
      const geom = new THREE.SphereGeometry(0.015, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color: hand === 0 ? 0xffff00 : 0x00aaff });
      const sphere = new THREE.Mesh(geom, mat);
      sphere.visible = false;
      scene && scene.add(sphere);
      jointSpheres[hand].push(sphere);
      // 숫자 라벨
      const label = createTextSprite(i.toString(), hand === 0 ? '#ffff00' : '#00aaff');
      label.visible = false;
      label.scale.set(0.12, 0.06, 1);
      scene && scene.add(label);
      jointLabels[hand].push(label);
    }
    // 연결선(Line)들
    for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
      const mat = new THREE.LineBasicMaterial({ color: hand === 0 ? 0xffcc00 : 0x00ffff });
      const points = [new THREE.Vector3(), new THREE.Vector3()];
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geom, mat);
      line.visible = false;
      scene && scene.add(line);
      jointLines[hand].push(line);
    }
  }
}

function updateHandSpheres(allLandmarks) {
  for (let hand = 0; hand < 2; hand++) {
    const landmarks = allLandmarks[hand];
    if (landmarks) {
      for (let i = 0; i < 21; i++) {
        const lm = landmarks[i];
        // x 좌표를 미러링: (1 - lm.x)
        const ndcX = ((1 - lm.x) - 0.5) * 2;
        const ndcY = -(lm.y - 0.5) * 2;
        const ndcZ = 0.7 - lm.z * 1.5;
        const ndc = new THREE.Vector3(ndcX, ndcY, ndcZ);
        ndc.unproject(camera);
        jointSpheres[hand][i].position.copy(ndc);
        jointSpheres[hand][i].visible = false;
        // 라벨 위치
        jointLabels[hand][i].position.copy(ndc);
        jointLabels[hand][i].visible = true;
      }
      // 연결선
      for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
        const [a, b] = HAND_CONNECTIONS[c];
        const line = jointLines[hand][c];
        const points = [jointSpheres[hand][a].position, jointSpheres[hand][b].position];
        line.geometry.setFromPoints(points);
        line.visible = true;
      }
    } else {
      // 손이 없으면 모두 숨김
      for (let i = 0; i < 21; i++) {
        jointSpheres[hand][i].visible = false;
        jointLabels[hand][i].visible = false;
      }
      for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
        jointLines[hand][c].visible = false;
      }
    }
  }
}

function createTextSprite(text, color = '#ffff00') {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 64px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 외곽선(Stroke)
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#222222';
  ctx.strokeText(text, 64, 64);

  // 본문(텍스트)
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 64);

  // 그림자 효과
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 8;

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.18, 0.18, 1); // 더 크게
  return sprite;
}

function hideHandSpheres() {
  for (let hand = 0; hand < 2; hand++) {
    for (let i = 0; i < 21; i++) {
      jointSpheres[hand][i].visible = false;
    }
    for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
      jointLines[hand][c].visible = false;
    }
  }
}

function initMediaPipe() {
  const videoElement = document.getElementById('webcam');
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
  });

  hands.onResults((results) => {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      handLandmarks = results.multiHandLandmarks;
      updateHandSpheres(handLandmarks);
    } else {
      handLandmarks = [];
      hideHandSpheres();
    }
  });

  const cameraUtils = new MediaPipeCamera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
    },
    width: 160,
    height: 120,
  });

  cameraUtils.start();
}

// 모든 마법구와 파티클을 네모, 밝고 투명하게, glow 강조
function createFireball(position) {
  // 더 붉은색의 멋진 마법의 구: 입체적이고 각진 IcosahedronGeometry + glow 강조
  const geometry = new THREE.IcosahedronGeometry(0.16, 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xcc2222, // 더 진한 붉은색
    emissive: 0xff3300, // 강렬한 오렌지빛 발광
    emissiveIntensity: 3.5,
    metalness: 0.7,
    roughness: 0.18,
    transparent: true,
    opacity: 0.9,
    transmission: 0.5,
    ior: 1.2,
    clearcoat: 0.5,
    clearcoatRoughness: 0.13
  });
  const ball = new THREE.Mesh(geometry, material);
  ball.position.copy(position);
  scene.add(ball);
  return { mesh: ball, velocity: new THREE.Vector3(0, 0, 0), active: true };
}

function createIceball(position) {
  // 멋진 마법의 구: 입체적이고 각진 IcosahedronGeometry + glow 강조, 파랑 테마
  const geometry = new THREE.IcosahedronGeometry(0.16, 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x66ccff,
    emissive: 0x66ccff,
    emissiveIntensity: 2.5,
    metalness: 0.7,
    roughness: 0.18,
    transparent: true,
    opacity: 0.85,
    transmission: 0.5,
    ior: 1.2,
    clearcoat: 0.5,
    clearcoatRoughness: 0.15
  });
  const ball = new THREE.Mesh(geometry, material);
  ball.position.copy(position);
  scene.add(ball);
  return { mesh: ball, velocity: new THREE.Vector3(0, 0, 0), active: true };
}

function createLightningBall(position) {
  // 멋진 마법의 구: 입체적이고 각진 IcosahedronGeometry + glow 강조, 노란/하늘 테마
  const geometry = new THREE.IcosahedronGeometry(0.18, 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x99e6ff,
    emissive: 0xffff66,
    emissiveIntensity: 2.8,
    metalness: 0.7,
    roughness: 0.18,
    transparent: true,
    opacity: 0.88,
    transmission: 0.5,
    ior: 1.2,
    clearcoat: 0.5,
    clearcoatRoughness: 0.15
  });
  const ball = new THREE.Mesh(geometry, material);
  ball.position.copy(position);
  scene.add(ball);
  return { mesh: ball, velocity: new THREE.Vector3(0, 0, 0), active: true };
}

function createAuroraBall(position) {
  // 멋진 마법의 구: 입체적이고 각진 IcosahedronGeometry + glow 강조, 오로라 테마
  const geometry = new THREE.IcosahedronGeometry(0.22, 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x99e6ff,
    emissive: 0x99e6ff,
    emissiveIntensity: 3.0,
    metalness: 0.7,
    roughness: 0.18,
    transparent: true,
    opacity: 0.82,
    transmission: 0.6,
    ior: 1.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.13
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.userData.type = 'auroraball';
  scene.add(mesh);
  return { mesh, velocity: new THREE.Vector3(0, 0, 0), active: true };
}

// 이미 파티클/이펙트는 BoxGeometry로 통일되어 있음 (FireballEmitter, spawnExplosionParticles, createAuroraParticle 등)
// 오로라 이펙트도 BoxGeometry로 유지

// 오른쪽 상단 제스처 표시용 div 추가
let gestureDiv = document.createElement('div');
gestureDiv.style.position = 'absolute';
gestureDiv.style.top = '20px';
gestureDiv.style.right = '30px';
gestureDiv.style.zIndex = '100';
gestureDiv.style.fontSize = '2em';
gestureDiv.style.fontWeight = 'bold';
gestureDiv.style.color = '#fff';
gestureDiv.style.textShadow = '2px 2px 8px #222, 0 0 8px #00f';
gestureDiv.innerText = '';
document.body.appendChild(gestureDiv);

// 간단한 제스처 판별 함수 (오픈팜, 빅토리, 핑거원)
function detectGesture(landmarks) {
  if (!landmarks) return '';
  // 엄지(4), 검지(8), 중지(12), 약지(16), 소지(20)
  const tips = [4, 8, 12, 16, 20].map(i => landmarks[i]);
  // 엄지 판정은 무시하고, 나머지 4손가락이 모두 펴져 있으면 Open Palm
  const up = [
    tips[1].y < landmarks[5].y,  // 검지
    tips[2].y < landmarks[9].y,  // 중지
    tips[3].y < landmarks[13].y, // 약지
    tips[4].y < landmarks[17].y  // 소지
  ];
  if (up.filter(Boolean).length === 4) return 'Open Palm';
  // 이하 기존 판정 유지 (Victory, Finger One, Thumbs Up, Fist)
  if (up[0] && up[1] && !up[2] && !up[3]) return 'Victory ✌️';
  if (up[0] && !up[1] && !up[2] && !up[3]) return 'Finger One ☝️';
  if (up.filter(Boolean).length === 0) return 'Fist ✊';
  return '';
}

function triggerBossHitEffect(color = 0xff3333, emissive = 0xff0000) {
  if (!boss) return;
  boss.traverse((child) => {
    if (child.isMesh && child.material) {
      child.material.color.set(color);
      if (child.material.emissive) {
        child.material.emissive.set(emissive);
        child.material.emissiveIntensity = 1.5;
      }
    }
  });
  bossHitTimer = 0.2; // 0.2초
}

function restoreBossMaterial() {
  bossOriginalMaterials.forEach(({ mesh, material }) => {
    mesh.material.color.copy(material.color);
    mesh.material.emissive.copy(material.emissive);
    mesh.material.emissiveIntensity = material.emissiveIntensity;
  });
}

function spawnExplosionParticles(position, color = 0xffee88, emissive = 0xffaa00) {
  for (let i = 0; i < 18; i++) {
    const geom = new THREE.BoxGeometry(0.025, 0.025, 0.025); // 네모 파티클
    const mat = new THREE.MeshBasicMaterial({ color: color, emissive: emissive, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(position);
    scene.add(mesh);
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.25,
      (Math.random() - 0.5) * 0.25,
      (Math.random() - 0.5) * 0.25
    );
    explosionParticles.push({ mesh, velocity, life: 0.25 + Math.random() * 0.2 });
  }
}

function spawnDamageText(position, value = 10) {
  // 텍스트를 그린 canvas texture sprite
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 48px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff0000';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#fff';
  ctx.fillText(value.toString(), 64, 32);
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 4;
  ctx.strokeText(value.toString(), 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(0.8, 0.4, 1);
  scene.add(sprite);
  damageTexts.push({ sprite, time: 0 });
}

function getRandomDamage() {
  return Math.floor(Math.random() * 11) + 5; // 5~15
}

function explodeBoss() {
  if (!boss) return;
  // boss 위치에서 큰 폭발 파티클
  const pos = new THREE.Vector3();
  boss.getWorldPosition(pos);
  for (let i = 0; i < 48; i++) {
    const geom = new THREE.SphereGeometry(0.07, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffee88, emissive: 0xffaa00, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.7,
      (Math.random() - 0.5) * 0.7 + 0.2,
      (Math.random() - 0.5) * 0.7
    );
    explosionParticles.push({ mesh, velocity, life: 0.7 + Math.random() * 0.4 });
  }
  // boss, HP바 제거
  scene.remove(boss);
  boss = null;
  bossBox = null;
  // 화면 흔들림 효과
  shakeTime = 0.5;
}

// 오로라볼 색상 변화 함수(HSV to RGB)
function auroraColorByTime(t) {
  // t: 0~1, HSV 색상환을 따라 부드럽게 변화
  const h = (t % 1.0);
  const s = 0.7;
  const v = 1.0;
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t2 = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v, g = t2, b = p; break;
    case 1: r = q, g = v, b = p; break;
    case 2: r = p, g = v, b = t2; break;
    case 3: r = p, g = q, b = v; break;
    case 4: r = t2, g = p, b = v; break;
    case 5: r = v, g = p, b = q; break;
  }
  return new THREE.Color(r, g, b);
}

// animate 함수 내 카메라/플레이어 이동/점프/중력/땅뚫기/1인칭/3인칭 처리
const originalAnimate = animate;
function animate() {
  renderer.setAnimationLoop(() => {
    // Apply acceleration to all magic effects
    const accel = 1.1; // 가속도를 1.1로 설정

    // fireball 이동 (역순 for문)
    for (let idx = fireballs.length - 1; idx >= 0; idx--) {
      const f = fireballs[idx];
      if (f.active && f.velocity.lengthSq() > 0) {
        f.velocity.multiplyScalar(accel);
        f.mesh.position.add(f.velocity);
        // boss와의 충돌 체크
        if (boss && bossBox) {
          bossBox.setFromObject(boss);
          const fireballBox = new THREE.Box3().setFromObject(f.mesh);
          if (bossBox.intersectsBox(fireballBox)) {
            // fireball 제거
            f.active = false;
            scene.remove(f.mesh);
            fireballs.splice(idx, 1);
            // fireball 삭제 시 emitter도 정리
            fireEmitters = fireEmitters.filter(e => {
              if (e.ballId === f.mesh.id) {
                e.dispose();
                return false;
              }
              return true;
            });
            // 데미지 계산
            let dmg = getRandomDamage();
            const now = performance.now();
            if (boss.lastHitTime && now - boss.lastHitTime < 300) {
              dmg += 1;
            }
            boss.lastHitTime = now;
            boss.currentHP -= dmg;
            if (boss.currentHP <= 0) {
              boss.currentHP = 0;
              console.log('Boss Defeated!');
              explodeBoss();
            }
            // boss 피격 이펙트 (fireball: 붉은색)
            triggerBossHitEffect(0xff3333, 0xff0000);
            // 폭발 파티클 생성 (fireball: 노란/주황)
            spawnExplosionParticles(f.mesh.position, 0xffee88, 0xffaa00);
            // 데미지 텍스트 생성
            spawnDamageText(f.mesh.position, dmg);
            continue;
          }
        }
        if (f.mesh.position.distanceTo(boss?.position || new THREE.Vector3(0,0,0)) < 1) {
          f.active = false;
          scene.remove(f.mesh);
          fireballs.splice(idx, 1);
          // fireball 삭제 시 emitter도 정리
          fireEmitters = fireEmitters.filter(e => {
            if (e.ballId === f.mesh.id) {
              e.dispose();
              return false;
            }
            return true;
          });
        }
        if (f.mesh.position.length() > 200) {
          f.active = false;
          scene.remove(f.mesh);
          fireballs.splice(idx, 1);
          // fireball 삭제 시 emitter도 정리
          fireEmitters = fireEmitters.filter(e => {
            if (e.ballId === f.mesh.id) {
              e.dispose();
              return false;
            }
            return true;
          });
        }
      }
      // --- fullyCharged 마법구 회전 ---
      if (f.mesh.userData.fullyCharged && f.mesh.userData.rotationSpeed) {
        f.mesh.rotation.x += f.mesh.userData.rotationSpeed.x;
        f.mesh.rotation.y += f.mesh.userData.rotationSpeed.y;
        f.mesh.rotation.z += f.mesh.userData.rotationSpeed.z;
      }
      // fireball이 존재하면 파티클 계속 생성
      if (f.mesh && f.active) {
        spawnFireParticles(f.mesh.position, f.mesh.id);
      }
    }
    // iceball 이동 (역순 for문)
    for (let idx = iceballs.length - 1; idx >= 0; idx--) {
      const f = iceballs[idx];
      if (f.active && f.velocity.lengthSq() > 0) {
        f.velocity.multiplyScalar(accel);
        f.mesh.position.add(f.velocity);
        // boss와의 충돌 체크
        if (boss && bossBox) {
          bossBox.setFromObject(boss);
          const iceballBox = new THREE.Box3().setFromObject(f.mesh);
          if (bossBox.intersectsBox(iceballBox)) {
            // iceball 제거
            f.active = false;
            scene.remove(f.mesh);
            iceballs.splice(idx, 1);
            // iceball 삭제 시 emitter도 정리
            iceEmitters = iceEmitters.filter(e => {
              if (e.ballId === f.mesh.id) {
                e.dispose();
                return false;
              }
              return true;
            });
            // 데미지 계산
            let dmg = getRandomDamage();
            const now = performance.now();
            if (boss.lastHitTime && now - boss.lastHitTime < 300) {
              dmg += 1;
            }
            boss.lastHitTime = now;
            boss.currentHP -= dmg;
            if (boss.currentHP <= 0) {
              boss.currentHP = 0;
              console.log('Boss Defeated!');
              explodeBoss();
            }
            // boss 피격 이펙트 (iceball: 밝은 파랑/하양)
            triggerBossHitEffect(0x99e6ff, 0x66ccff);
            // 폭발 파티클 생성 (iceball: 밝은 파랑/하양)
            spawnExplosionParticles(f.mesh.position, 0xe0f7ff, 0x66ccff);
            // 데미지 텍스트 생성
            spawnDamageText(f.mesh.position, dmg);
            continue;
          }
        }
        if (f.mesh.position.distanceTo(boss?.position || new THREE.Vector3(0,0,0)) < 1) {
          f.active = false;
          scene.remove(f.mesh);
          iceballs.splice(idx, 1);
          // iceball 삭제 시 emitter도 정리
          iceEmitters = iceEmitters.filter(e => {
            if (e.ballId === f.mesh.id) {
              e.dispose();
              return false;
            }
            return true;
          });
        }
        if (f.mesh.position.length() > 200) {
          f.active = false;
          scene.remove(f.mesh);
          iceballs.splice(idx, 1);
          // iceball 삭제 시 emitter도 정리
          iceEmitters = iceEmitters.filter(e => {
            if (e.ballId === f.mesh.id) {
              e.dispose();
              return false;
            }
            return true;
          });
        }
      }
      // --- fullyCharged 마법구 회전 ---
      if (f.mesh.userData.fullyCharged && f.mesh.userData.rotationSpeed) {
        f.mesh.rotation.x += f.mesh.userData.rotationSpeed.x;
        f.mesh.rotation.y += f.mesh.userData.rotationSpeed.y;
        f.mesh.rotation.z += f.mesh.userData.rotationSpeed.z;
      }
      // iceball이 존재하면 파티클 계속 생성
      if (f.mesh && f.active) {
        spawnIceParticles(f.mesh.position, f.mesh.id);
      }
    }
    // lightningball 이동 (역순 for문)
    for (let idx = lightningballs.length - 1; idx >= 0; idx--) {
      const f = lightningballs[idx];
      if (f.active && f.velocity.lengthSq() > 0) {
        f.velocity.multiplyScalar(accel);
        f.mesh.position.add(f.velocity);
        // boss와의 충돌 체크
        if (boss && bossBox) {
          bossBox.setFromObject(boss);
          const lightningBox = new THREE.Box3().setFromObject(f.mesh);
          if (bossBox.intersectsBox(lightningBox)) {
            // lightningball 제거
            f.active = false;
            scene.remove(f.mesh);
            lightningballs.splice(idx, 1);
            // lightningball 삭제 시 emitter도 정리
            lightningEmitters = lightningEmitters.filter(e => {
              if (e.ballId === f.mesh.id) {
                e.dispose();
                return false;
              }
              return true;
            });
            // 데미지 계산
            let dmg = getRandomDamage();
            const now = performance.now();
            if (boss.lastHitTime && now - boss.lastHitTime < 300) {
              dmg += 1;
            }
            boss.lastHitTime = now;
            boss.currentHP -= dmg;
            if (boss.currentHP <= 0) {
              boss.currentHP = 0;
              console.log('Boss Defeated!');
              explodeBoss();
            }
            // boss 피격 이펙트 (lightningball: 노란/하늘)
            triggerBossHitEffect(0xffff99, 0x99e6ff);
            // 폭발 파티클 생성 (lightningball: 노란/하늘)
            spawnExplosionParticles(f.mesh.position, 0xffff99, 0x99e6ff);
            // 데미지 텍스트 생성
            spawnDamageText(f.mesh.position, dmg);
            continue;
          }
        }
        if (f.mesh.position.distanceTo(boss?.position || new THREE.Vector3(0,0,0)) < 1) {
          f.active = false;
          scene.remove(f.mesh);
          lightningballs.splice(idx, 1);
          // lightningball 삭제 시 emitter도 정리
          lightningEmitters = lightningEmitters.filter(e => {
            if (e.ballId === f.mesh.id) {
              e.dispose();
              return false;
            }
            return true;
          });
        }
        if (f.mesh.position.length() > 200) {
          f.active = false;
          scene.remove(f.mesh);
          lightningballs.splice(idx, 1);
          // lightningball 삭제 시 emitter도 정리
          lightningEmitters = lightningEmitters.filter(e => {
            if (e.ballId === f.mesh.id) {
              e.dispose();
              return false;
            }
            return true;
          });
        }
      }
      // --- fullyCharged 마법구 회전 ---
      if (f.mesh.userData.fullyCharged && f.mesh.userData.rotationSpeed) {
        f.mesh.rotation.x += f.mesh.userData.rotationSpeed.x;
        f.mesh.rotation.y += f.mesh.userData.rotationSpeed.y;
        f.mesh.rotation.z += f.mesh.userData.rotationSpeed.z;
      }
      // lightningball이 존재하면 파티클 계속 생성
      if (f.mesh && f.active) {
        spawnLightningParticles(f.mesh.position, f.mesh.id);
      }
    }
    // 두 손 각각 독립적으로 처리
    let gestureText = '';
    // 오로라볼이 준비/생성/발사 대기 중이면 fire/ice/lightning 무시
    const auroraActive = handAuroraBall || (auroraBallReadyTime > 0 && !auroraBallFired);
    for (let hand = 0; hand < 2; hand++) {
      const landmarks = handLandmarks[hand];
      if (!landmarks) continue;
      const gesture = detectGesture(landmarks);
      if (gesture) gestureText += (gestureText ? ' | ' : '') + gesture;
      const state = fireballStates[hand];
      const now = performance.now();
      // 오로라볼이 준비/생성/발사 대기 중이면 fire/ice/lightning 관련 로직 모두 무시
      if (auroraActive) continue;
      // Fist → Victory: fireball 생성
      if (gesture === 'Fist ✊') {
        state.lastFist = now;
        if (state.state !== 'idle') {
          state.state = 'idle';
          if (state.fireball) {
            scene.remove(state.fireball.mesh);
            const idx = fireballs.indexOf(state.fireball);
            if (idx !== -1) fireballs.splice(idx, 1);
            state.fireball = null;
          }
        }
        // 얼음볼 상태도 초기화
        state.iceState = 'idle';
        if (state.iceball) {
          scene.remove(state.iceball.mesh);
          const idx = iceballs.indexOf(state.iceball);
          if (idx !== -1) iceballs.splice(idx, 1);
          state.iceball = null;
        }
      } else if (
        gesture === 'Victory ✌️' &&
        state.state === 'idle' &&
        now - state.lastFist < 300 &&
        !state.lightningball
      ) {
        // fireball 생성
        const palm = landmarks[0];
        const ndcX = ((1 - palm.x) - 0.5) * 2;
        const ndcY = -(palm.y - 0.5) * 2;
        const ndcZ = 0.7 - palm.z * 1.5;
        const ndc = new THREE.Vector3(ndcX, ndcY, ndcZ);
        ndc.unproject(camera);
        state.fireball = createFireball(ndc);
        fireballs.push(state.fireball);
        state.state = 'ready';
        state.lastVictory = now;
      } else if (
        gesture === 'Open Palm' &&
        state.state === 'ready' &&
        state.fireball &&
        state.fireball.velocity.lengthSq() === 0
      ) {
        // fullyCharged 판정
        if (state.fireball.active) {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          state.fireball.velocity = dir.normalize().multiplyScalar(0.15);
          // fullyCharged 판정
          if (state.fireball.mesh.scale.x >= 1.5) {
            state.fireball.mesh.userData.fullyCharged = true;
            state.fireball.mesh.userData.rotationSpeed = new THREE.Vector3(
              Math.random() * 0.2 + 0.1,
              Math.random() * 0.2 + 0.1,
              Math.random() * 0.2 + 0.1
            );
          }
          state.state = 'fired';
          state.fireball = null;
        }
      } else if (
        gesture === 'Finger One ☝️' &&
        state.iceState === 'idle' &&
        now - state.lastFist < 300
      ) {
        const palm = landmarks[0];
        const ndcX = ((1 - palm.x) - 0.5) * 2;
        const ndcY = -(palm.y - 0.5) * 2;
        const ndcZ = 0.7 - palm.z * 1.5;
        const ndc = new THREE.Vector3(ndcX, ndcY, ndcZ);
        ndc.unproject(camera);
        state.iceball = createIceball(ndc);
        iceballs.push(state.iceball);
        state.iceState = 'ready';
        state.lastFingerOne = now;
      } else if (
        gesture === 'Victory ✌️' &&
        state.iceState === 'ready' &&
        now - state.lastFingerOne < 300
      ) {
        // iceball과 fireball이 모두 있으면 합쳐서 lightning ball 생성
        if (state.iceball && state.fireball) {
          // 두 볼의 위치 중간점 계산
          const pos1 = state.iceball.mesh.position;
          const pos2 = state.fireball.mesh.position;
          const mid = new THREE.Vector3().addVectors(pos1, pos2).multiplyScalar(0.5);
          // lightningball 생성 직전, 해당 손의 fireball/iceball 모두 삭제
          if (state.iceball) {
            scene.remove(state.iceball.mesh);
            let idx = iceballs.indexOf(state.iceball);
            if (idx !== -1) iceballs.splice(idx, 1);
            state.iceball = null;
            state.iceState = 'idle';
          }
          if (state.fireball) {
            scene.remove(state.fireball.mesh);
            let idx = fireballs.indexOf(state.fireball);
            if (idx !== -1) fireballs.splice(idx, 1);
            state.fireball = null;
            state.state = 'idle';
          }
          // lightning ball 생성
          state.lightningball = createLightningBall(mid);
          lightningballs.push(state.lightningball);
          state.lightningState = 'ready';
          state.lastLightning = now;
        } else if (state.iceball) {
          // iceball만 있으면 기존 iceball 제거, fireball이 남아있으면 같이 삭제
          if (state.iceball) {
            scene.remove(state.iceball.mesh);
            let idx = iceballs.indexOf(state.iceball);
            if (idx !== -1) iceballs.splice(idx, 1);
            state.iceball = null;
            state.iceState = 'idle';
          }
          if (state.fireball) {
            scene.remove(state.fireball.mesh);
            let idx2 = fireballs.indexOf(state.fireball);
            if (idx2 !== -1) fireballs.splice(idx2, 1);
            state.fireball = null;
            state.state = 'idle';
          }
          // lightningball은 생성하지 않음 (iceball만 있을 때는 기존 fireball 생성 로직 유지)
          if (state.state === 'idle') {
            const palm = landmarks[0];
            const ndcX = ((1 - palm.x) - 0.5) * 2;
            const ndcY = -(palm.y - 0.5) * 2;
            const ndcZ = 0.7 - palm.z * 1.5;
            const ndc = new THREE.Vector3(ndcX, ndcY, ndcZ);
            ndc.unproject(camera);
            state.fireball = createFireball(ndc);
            fireballs.push(state.fireball);
            state.state = 'ready';
            state.lastVictory = now;
          }
        }
      }
      // fireball follow
      if (
        gesture === 'Victory ✌️' &&
        state.fireball &&
        state.fireball.velocity.lengthSq() === 0 &&
        state.state === 'ready'
      ) {
        const palm = landmarks[0];
        const ndcX = ((1 - palm.x) - 0.5) * 2;
        const ndcY = -(palm.y - 0.5) * 2;
        const ndcZ = 0.7 - palm.z * 1.5;
        const ndc = new THREE.Vector3(ndcX, ndcY, ndcZ);
        ndc.unproject(camera);
        state.fireball.mesh.position.copy(ndc);
        state.fireball.velocity.set(0,0,0);
        // follow 중일 때 서서히 커지게
        const maxScale = 1.5;
        if (state.fireball.mesh.scale.x < maxScale) {
          state.fireball.mesh.scale.multiplyScalar(1.0065);
          if (state.fireball.mesh.scale.x > maxScale) {
            state.fireball.mesh.scale.set(maxScale, maxScale, maxScale);
          }
        }
      }
      // iceball follow
      if (
        gesture === 'Finger One ☝️' &&
        state.iceball &&
        state.iceball.velocity.lengthSq() === 0 &&
        state.iceState === 'ready'
      ) {
        const palm = landmarks[0];
        const ndcX = ((1 - palm.x) - 0.5) * 2;
        const ndcY = -(palm.y - 0.5) * 2;
        const ndcZ = 0.7 - palm.z * 1.5;
        const ndc = new THREE.Vector3(ndcX, ndcY, ndcZ);
        ndc.unproject(camera);
        state.iceball.mesh.position.copy(ndc);
        state.iceball.velocity.set(0,0,0);
        // follow 중일 때 서서히 커지게
        const maxScale = 1.5;
        if (state.iceball.mesh.scale.x < maxScale) {
          state.iceball.mesh.scale.multiplyScalar(1.0065);
          if (state.iceball.mesh.scale.x > maxScale) {
            state.iceball.mesh.scale.set(maxScale, maxScale, maxScale);
          }
        }
      }
      // iceball 발사
      if (
        gesture === 'Open Palm' &&
        state.iceState === 'ready' &&
        state.iceball &&
        state.iceball.velocity.lengthSq() === 0
      ) {
        if (state.iceball.active) {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          state.iceball.velocity = dir.normalize().multiplyScalar(0.15);
          // fullyCharged 판정
          if (state.iceball.mesh.scale.x >= 1.5) {
            state.iceball.mesh.userData.fullyCharged = true;
            state.iceball.mesh.userData.rotationSpeed = new THREE.Vector3(
              Math.random() * 0.2 + 0.1,
              Math.random() * 0.2 + 0.1,
              Math.random() * 0.2 + 0.1
            );
          }
          state.iceState = 'fired';
          state.iceball = null;
        }
      }
      // lightningball follow
      if (
        gesture === 'Victory ✌️' &&
        state.lightningball &&
        state.lightningball.velocity.lengthSq() === 0 &&
        state.lightningState === 'ready'
      ) {
        const palm = landmarks[0];
        const ndcX = ((1 - palm.x) - 0.5) * 2;
        const ndcY = -(palm.y - 0.5) * 2;
        const ndcZ = 0.7 - palm.z * 1.5;
        const ndc = new THREE.Vector3(ndcX, ndcY, ndcZ);
        ndc.unproject(camera);
        state.lightningball.mesh.position.copy(ndc);
        state.lightningball.velocity.set(0,0,0);
        // follow 중일 때 서서히 커지게
        const maxScale = 1.7;
        if (state.lightningball.mesh.scale.x < maxScale) {
          state.lightningball.mesh.scale.multiplyScalar(1.0065);
          if (state.lightningball.mesh.scale.x > maxScale) {
            state.lightningball.mesh.scale.set(maxScale, maxScale, maxScale);
          }
        }
      }
      // lightningball 발사
      if (
        gesture === 'Open Palm' &&
        state.lightningState === 'ready' &&
        state.lightningball &&
        state.lightningball.velocity.lengthSq() === 0
      ) {
        if (state.lightningball.active) {
          const dir = new THREE.Vector3();
          camera.getWorldDirection(dir);
          state.lightningball.velocity = dir.normalize().multiplyScalar(0.15);
          // fullyCharged 판정
          if (state.lightningball.mesh.scale.x >= 1.7) {
            state.lightningball.mesh.userData.fullyCharged = true;
            state.lightningball.mesh.userData.rotationSpeed = new THREE.Vector3(
              Math.random() * 0.2 + 0.1,
              Math.random() * 0.2 + 0.1,
              Math.random() * 0.2 + 0.1
            );
          }
          state.lightningState = 'fired';
          state.lightningball = null;
        }
      }
      // 잘못된 제스처 시 해당 손의 fireball/iceball/lightningball만 제거
      else if (
        gesture !== 'Victory ✌️' &&
        gesture !== 'Open Palm' &&
        gesture !== 'Fist ✊' &&
        gesture !== 'Finger One ☝️'
      ) {
        if (state.fireball) {
          scene.remove(state.fireball.mesh);
          const idx = fireballs.indexOf(state.fireball);
          if (idx !== -1) fireballs.splice(idx, 1);
          // fireball 삭제 시 emitter도 정리
          fireEmitters = fireEmitters.filter(e => {
            if (e.ballId === state.fireball.mesh.id) {
              e.dispose();
              return false;
            }
            return true;
          });
          state.fireball = null;
          state.state = 'idle';
        }
        if (state.iceball) {
          scene.remove(state.iceball.mesh);
          const idx = iceballs.indexOf(state.iceball);
          if (idx !== -1) iceballs.splice(idx, 1);
          // iceball 삭제 시 emitter도 정리
          iceEmitters = iceEmitters.filter(e => {
            if (e.ballId === state.iceball.mesh.id) {
              e.dispose();
              return false;
            }
            return true;
          });
          state.iceball = null;
          state.iceState = 'idle';
        }
        if (state.lightningball) {
          scene.remove(state.lightningball.mesh);
          const idx = lightningballs.indexOf(state.lightningball);
          if (idx !== -1) lightningballs.splice(idx, 1);
          // lightningball 삭제 시 emitter도 정리
          lightningEmitters = lightningEmitters.filter(e => {
            if (e.ballId === state.lightningball.mesh.id) {
              e.dispose();
              return false;
            }
            return true;
          });
          state.lightningball = null;
          state.lightningState = 'idle';
        }
      }
    }
    // fireEmitters 업데이트
    for (let i = fireEmitters.length - 1; i >= 0; i--) {
      fireEmitters[i].update();
      if (fireEmitters[i].isFinished()) {
        fireEmitters.splice(i, 1);
      }
    }
    // iceEmitters 업데이트
    for (let i = iceEmitters.length - 1; i >= 0; i--) {
      iceEmitters[i].update();
      if (iceEmitters[i].isFinished()) {
        iceEmitters.splice(i, 1);
      }
    }
    // lightningEmitters 업데이트
    for (let i = lightningEmitters.length - 1; i >= 0; i--) {
      lightningEmitters[i].update();
      if (lightningEmitters[i].isFinished()) {
        lightningEmitters.splice(i, 1);
      }
    }
    // boss 피격 이펙트 타이머
    if (bossHitTimer > 0) {
      bossHitTimer -= renderer.xr.isPresenting ? 1/72 : 1/60;
      if (bossHitTimer <= 0) {
        restoreBossMaterial();
      }
    }
    // 폭발 파티클 업데이트
    for (let i = explosionParticles.length - 1; i >= 0; i--) {
      const p = explosionParticles[i];
      p.mesh.position.add(p.velocity);
      p.mesh.material.opacity *= 0.88;
      p.life -= renderer.xr.isPresenting ? 1/72 : 1/60;
      if (p.life <= 0 || p.mesh.material.opacity < 0.05) {
        scene.remove(p.mesh);
        explosionParticles.splice(i, 1);
      }
    }
    // 데미지 텍스트 애니메이션
    for (let i = damageTexts.length - 1; i >= 0; i--) {
      const t = damageTexts[i];
      t.sprite.position.y += 0.012;
      t.sprite.material.opacity = 1 - t.time;
      t.time += (renderer.xr.isPresenting ? 1/72 : 1/60);
      if (t.time > 1) {
        scene.remove(t.sprite);
        damageTexts.splice(i, 1);
      }
    }
    // 3D HP바 업데이트 (보스 머리 위)
    if (boss && bossHpBarMesh && bossBox) {
      // HP 비율
      const hpRatio = Math.max(0, Math.min(1, boss.currentHP / boss.maxHP));
      // HP바 스케일
      bossHpBarMesh.scale.x = Math.max(0.01, hpRatio);
      // 보스의 머리 위 좌표 계산 (max.y + 약간 위)
      const bossWorldPos = new THREE.Vector3();
      boss.getWorldPosition(bossWorldPos);
      // barWidth는 전역 사용
      const barY = bossBox.max.y + 8;
      // HP바 position.x를 항상 같게!
      bossHpBarMesh.position.set(bossWorldPos.x, barY, bossWorldPos.z);
      // 카메라를 향하도록 (수평 회전만 적용)
      const dx = camera.position.x - bossHpBarMesh.position.x;
      const dz = camera.position.z - bossHpBarMesh.position.z;
      const rotY = Math.atan2(dx, dz);
      bossHpBarMesh.rotation.set(0, rotY, 0);
    }
    updateBlinkMagic();
    // 번쩍임 효과
    if (blinkFlash > 0) {
      blinkFlash -= renderer.xr.isPresenting ? 1/72 : 1/60;
      renderer.setClearColor(0x99e6ff, Math.min(1, blinkFlash * 3));
      if (blinkFlash <= 0) {
        renderer.setClearColor(0x18132a, 1);
      }
    }
    // 블링크 쿨타임 감소
    if (blinkCooldown > 0) {
      blinkCooldown -= renderer.xr.isPresenting ? 1/72 : 1/60;
      if (blinkCooldown < 0) blinkCooldown = 0;
    }
    // 오로라 파티클/볼 업데이트
    if (auroraState.auroraBall) {
      // 볼은 유지, 파티클은 이동/사라짐
      for (let i = auroraState.auroraParticles.length - 1; i >= 0; i--) {
        const p = auroraState.auroraParticles[i];
        p.mesh.position.add(p.velocity);
        p.mesh.material.opacity *= 0.92;
        p.life -= renderer.xr.isPresenting ? 1/72 : 1/60;
        if (p.life <= 0 || p.mesh.material.opacity < 0.05) {
          scene.remove(p.mesh);
          auroraState.auroraParticles.splice(i, 1);
        }
      }
    }
    if (auroraCooldown > 0) {
      auroraCooldown -= renderer.xr.isPresenting ? 1/72 : 1/60;
      if (auroraCooldown < 0) auroraCooldown = 0;
    }
    updateHandAuroraEffects();
    // 오로라볼 파티클 업데이트
    for (let i = handAuroraParticles.length - 1; i >= 0; i--) {
      const p = handAuroraParticles[i];
      p.mesh.position.add(p.velocity);
      p.mesh.material.opacity *= 0.96;
      p.life -= renderer.xr.isPresenting ? 1/72 : 1/60;
      if (p.life <= 0 || p.mesh.material.opacity < 0.05) {
        scene.remove(p.mesh);
        handAuroraParticles.splice(i, 1);
      }
    }
    // 오로라볼이 존재하면 파티클 여러 개 동시 생성
    if (handAuroraBall) {
      for (let k = 0; k < 3; k++) {
        const p = createAuroraParticle(handAuroraBall.position, handAuroraBall.scale.x);
        handAuroraParticles.push(p);
      }
    }
    // 오로라볼 발사체 파티클 생성/업데이트
    if (!window.flyingAuroraParticles) window.flyingAuroraParticles = [];
    for (let i = flyingAuroraBalls.length - 1; i >= 0; i--) {
      const ball = flyingAuroraBalls[i];
      // 매 프레임 파티클 여러 개 생성
      for (let k = 0; k < 3; k++) {
        const p = createAuroraParticle(ball.position, ball.scale.x);
        window.flyingAuroraParticles.push(p);
      }
    }
    // flyingAuroraBalls 파티클 업데이트
    for (let i = window.flyingAuroraParticles.length - 1; i >= 0; i--) {
      const p = window.flyingAuroraParticles[i];
      p.mesh.position.add(p.velocity);
      p.mesh.material.opacity *= 0.96;
      p.life -= renderer.xr.isPresenting ? 1/72 : 1/60;
      if (p.life <= 0 || p.mesh.material.opacity < 0.05) {
        scene.remove(p.mesh);
        window.flyingAuroraParticles.splice(i, 1);
      }
    }
    // 오로라볼 발사체 이동/충돌
    for (let i = flyingAuroraBalls.length - 1; i >= 0; i--) {
      const ball = flyingAuroraBalls[i];
      if (ball.userData.active) {
        // 가속도 적용
        ball.userData.velocity.multiplyScalar(accel); // accel = 1.1 적용
        ball.position.add(ball.userData.velocity);
        // 색상 변화
        const t = performance.now() * 0.00025 + i * 0.1;
        const color = auroraColorByTime(t);
        ball.material.color.copy(color);
        ball.material.emissive.copy(color);
        ball.material.emissiveIntensity = 2.5 + Math.sin(t * 2) * 0.7;
        // boss와의 충돌 체크
        if (boss && bossBox) {
          bossBox.setFromObject(boss);
          const ballBox = new THREE.Box3().setFromObject(ball);
          if (bossBox.intersectsBox(ballBox)) {
            // 오로라볼 제거
            ball.userData.active = false;
            scene.remove(ball);
            flyingAuroraBalls.splice(i, 1);
            // 데미지 30
            let dmg = 30;
            boss.currentHP -= dmg;
            if (boss.currentHP <= 0) {
              boss.currentHP = 0;
              explodeBoss();
            }
            triggerBossHitEffect(0x99e6ff, 0x9933ff);
            spawnExplosionParticles(ball.position, 0x99e6ff, 0x9933ff);
            spawnDamageText(ball.position, dmg);
            continue;
          }
        }
        // 너무 멀리 가면 제거
        if (ball.position.length() > 200) {
          ball.userData.active = false;
          scene.remove(ball);
          flyingAuroraBalls.splice(i, 1);
        }
      }
    }
    // 오로라볼 색상 변화(손에 들고 있을 때)
    if (handAuroraBall) {
      const t = performance.now() * 0.00025;
      const color = auroraColorByTime(t);
      handAuroraBall.material.color.copy(color);
      handAuroraBall.material.emissive.copy(color);
      handAuroraBall.material.emissiveIntensity = 2.5 + Math.sin(t * 2) * 0.7;
    }
    gestureDiv.innerText = gestureText;
    renderer.render(scene, camera);
    // 드래곤 fly 애니메이션 업데이트 및 플레이어(혹은 카메라) 바라보게
    if (dragonMixer) dragonMixer.update(1/60);
    if (boss) {
      const target = player ? player.position : camera.position;
      const fixedY = 21; // 드래곤 y값 고정
      boss.lookAt(target.x, fixedY + 1, target.z);
      boss.rotateY(Math.PI);
    }
  });
  requestAnimationFrame(animate);
  const time = performance.now();
  const delta = (time - prevTime) / 1000;
  prevTime = time;
  // 이동 방향
  direction.z = Number(moveForward) - Number(moveBackward);
  direction.x = Number(moveRight) - Number(moveLeft);
  direction.normalize();
  // 이동 속도
  velocity.x -= velocity.x * 10.0 * delta;
  velocity.z -= velocity.z * 10.0 * delta;
  if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
  if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;
  // 플레이어 이동
  if (player) {
    // 1인칭/3인칭 모두 카메라(controls.getObject()) 기준 이동
    const forward = new THREE.Vector3();
    controls.getDirection(forward); // 카메라가 바라보는 방향
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    let moveDir = new THREE.Vector3();
    if (moveForward) moveDir.add(forward);
    if (moveBackward) moveDir.sub(forward);
    if (moveLeft) moveDir.sub(right);
    if (moveRight) moveDir.add(right);
    moveDir.normalize();
    // 기존 속도와 delta를 곱해 너무 빠르지 않게 조정 (speed * delta * 0.5 등으로 조절)
    player.position.add(moveDir.multiplyScalar(speed * delta * 0.2)); // 더 느리게
    // 중력 적용
    velocityY -= gravity * delta;
    player.position.y += velocityY * delta;

    // Raycaster로 바닥 y값 샘플링
    let groundAt = groundY;
    if (landscape) {
      const raycaster = new THREE.Raycaster();
      const origin = player.position.clone();
      origin.y += 2; // 위에서 아래로 쏨
      raycaster.set(origin, new THREE.Vector3(0, -1, 0));
      const intersects = raycaster.intersectObject(landscape, true);
      if (intersects.length > 0) {
        groundAt = intersects[0].point.y;
      }
    }
    // 바닥보다 아래로 못 내려가게
    if (player.position.y < groundAt + 1) {
      player.position.y = groundAt + 1;
      velocityY = 0;
      canJump = true;
    }
  }
  // 카메라 위치/시점 처리
  if (isThirdPerson && player) {
    // 3인칭: 플레이어 뒤쪽/위에서 따라감
    const camOffset = new THREE.Vector3(0, 3, 6);
    camOffset.applyAxisAngle(new THREE.Vector3(0,1,0), controls.getObject().rotation.y);
    camera.position.copy(player.position).add(camOffset);
    if (camera.position.y < 2) camera.position.y = 2;
    camera.lookAt(player.position.x, player.position.y + 1, player.position.z);
  } else if (player) {
    // 1인칭: 카메라가 플레이어 머리 위치
    camera.position.copy(player.position).add(new THREE.Vector3(0, 1.2, 0));
    if (camera.position.y < 2) camera.position.y = 2;
    camera.rotation.copy(controls.getObject().rotation);
  }
  // controls.getObject() 위치를 항상 player 위치에 맞춤
  if (player) {
    controls.getObject().position.copy(player.position).add(new THREE.Vector3(0, 1.2, 0));
  }
  // 기존 마법/파티클/이펙트 등은 그대로 유지
  updateBlinkMagic();
  updateAuroraMagic();
  updateHandAuroraEffects();
  renderer.render(scene, camera);
}

function updateBlinkMagic() {
  // 오로라볼이 존재하면 블링크 비활성화
  if (handAuroraBall) return;
  if (blinkCooldown > 0) {
    clearBlinkEffect();
    return;
  }
  // 양손 4번 관절만 체크
  if (handLandmarks[0] && handLandmarks[1]) {
    const p0 = handLandmarks[0][4];
    const p1 = handLandmarks[1][4];
    const v0 = new THREE.Vector3(((1 - p0.x) - 0.5) * 2, -(p0.y - 0.5) * 2, 0.7 - p0.z * 1.5);
    const v1 = new THREE.Vector3(((1 - p1.x) - 0.5) * 2, -(p1.y - 0.5) * 2, 0.7 - p1.z * 1.5);
    v0.unproject(camera);
    v1.unproject(camera);
    const dist = v0.distanceTo(v1);
    const threshold = 0.13;
    if (dist < threshold) {
      // aurora 준비 중이면 블링크 불가
      if (auroraState.active) {
        clearBlinkEffect();
        return;
      }
      // 블링크 준비 시작
      if (!blinkState.active) {
        blinkState.active = true;
        blinkState.startTime = performance.now();
        blinkState.triggered = false;
        blinkState.effectMeshes = [
          createBlinkEffectMesh(v0),
          createBlinkEffectMesh(v1)
        ];
      } else {
        blinkState.effectMeshes[0].position.copy(v0);
        blinkState.effectMeshes[1].position.copy(v1);
        if (!blinkState.triggered && performance.now() - blinkState.startTime > 300) {
          blinkState.triggered = true;
          triggerBlinkTeleport();
        }
      }
    } else {
      clearBlinkEffect();
    }
  } else {
    clearBlinkEffect();
  }
  // aurora 마법 처리
  updateAuroraMagic();
}

function createBlinkEffectMesh(pos) {
  const geom = new THREE.SphereGeometry(0.045, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.7 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pos);
  scene.add(mesh);
  return mesh;
}

function clearBlinkEffect() {
  blinkState.active = false;
  blinkState.startTime = 0;
  blinkState.triggered = false;
  blinkState.effectMeshes.forEach(m => scene.remove(m));
  blinkState.effectMeshes = [];
}

function triggerBlinkTeleport() {
  // 맵 전체에서 랜덤 위치 찾기 (최대 20회 시도)
  let found = false;
  let x, y, z;
  if (landscape) {
    const box = new THREE.Box3().setFromObject(landscape);
    for (let attempt = 0; attempt < 20; attempt++) {
      x = box.min.x + Math.random() * (box.max.x - box.min.x);
      z = box.min.z + Math.random() * (box.max.z - box.min.z);
      // Raycaster로 해당 (x, z) 위치의 땅 높이(y) 구하기
      const rayOrigin = new THREE.Vector3(x, 1000, z);
      const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0));
      const intersects = raycaster.intersectObject(landscape, true);
      if (intersects.length > 0) {
        y = intersects[0].point.y + 1.5;
        // 장애물 체크: boss와 너무 가까운지, 혹은 다른 mesh와 겹치는지 등
        let isBlocked = false;
        if (boss) {
          const bossPos = new THREE.Vector3();
          boss.getWorldPosition(bossPos);
          if (new THREE.Vector3(x, y, z).distanceTo(bossPos) < 3) isBlocked = true;
        }
        // 추가 장애물 체크 필요시 여기에
        if (!isBlocked) {
          found = true;
          break;
        }
      }
    }
  }
  // 못 찾으면 기존 보스 주변 랜덤 위치 fallback
  if (!found && boss) {
    const center = new THREE.Vector3();
    boss.getWorldPosition(center);
    const theta = Math.random() * Math.PI * 2;
    const radius = 7 + Math.random() * 4;
    x = center.x + Math.cos(theta) * radius;
    z = center.z + Math.sin(theta) * radius;
    y = center.y + 1.5;
    if (landscape) {
      const rayOrigin = new THREE.Vector3(x, 1000, z);
      const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0));
      const intersects = raycaster.intersectObject(landscape, true);
      if (intersects.length > 0) {
        y = intersects[0].point.y + 1.5;
      }
    }
  }
  // 카메라 번쩍임 효과
  blinkFlash = 0.18;
  camera.position.set(x, y, z);
  if (boss) {
    const center = new THREE.Vector3();
    boss.getWorldPosition(center);
    camera.lookAt(center.x, center.y + 1, center.z);
    if (player) {
      player.position.set(x, y, z);
      player.lookAt(center.x, center.y + 1, center.z);
    }
  }
  clearBlinkEffect();
  blinkCooldown = 5.0;
}

function updateAuroraMagic() {
  if (auroraCooldown > 0) {
    clearAuroraEffect();
    return;
  }
  if (blinkState.active) return; // 블링크 준비 중이면 aurora 불가
  // 각 손의 4-8, 8-4 쌍이 모두 가까워야 발동
  let found = false;
  let v0, v1, v2, v3;
  if (handLandmarks[0] && handLandmarks[1]) {
    // 왼손4-오른손8
    const p0 = handLandmarks[0][4];
    const p1 = handLandmarks[1][8];
    v0 = new THREE.Vector3(((1 - p0.x) - 0.5) * 2, -(p0.y - 0.5) * 2, 0.7 - p0.z * 1.5);
    v1 = new THREE.Vector3(((1 - p1.x) - 0.5) * 2, -(p1.y - 0.5) * 2, 0.7 - p1.z * 1.5);
    v0.unproject(camera);
    v1.unproject(camera);
    const dist1 = v0.distanceTo(v1);
    // 왼손8-오른손4
    const p2 = handLandmarks[0][8];
    const p3 = handLandmarks[1][4];
    v2 = new THREE.Vector3(((1 - p2.x) - 0.5) * 2, -(p2.y - 0.5) * 2, 0.7 - p2.z * 1.5);
    v3 = new THREE.Vector3(((1 - p3.x) - 0.5) * 2, -(p3.y - 0.5) * 2, 0.7 - p3.z * 1.5);
    v2.unproject(camera);
    v3.unproject(camera);
    const dist2 = v2.distanceTo(v3);
    const threshold = 0.13;
    if (dist1 < threshold && dist2 < threshold) {
      found = true;
    }
  }
  if (found) {
    if (blinkState.active) {
      clearAuroraEffect();
      return;
    }
    if (!auroraState.active) {
      auroraState.active = true;
      auroraState.startTime = performance.now();
      auroraState.triggered = false;
      // 이펙트 생성
      auroraState.effectMeshes = [
        createAuroraEffectMesh(v0),
        createAuroraEffectMesh(v1),
        createAuroraEffectMesh(v2),
        createAuroraEffectMesh(v3)
      ];
    } else {
      // 이펙트 위치 갱신
      auroraState.effectMeshes[0].position.copy(v0);
      auroraState.effectMeshes[1].position.copy(v1);
      auroraState.effectMeshes[2].position.copy(v2);
      auroraState.effectMeshes[3].position.copy(v3);
      // 0.3초 유지 시 aurora 발동
      if (!auroraState.triggered && performance.now() - auroraState.startTime > 300) {
        auroraState.triggered = true;
        // 두 쌍의 중간점
        const mid = new THREE.Vector3().addVectors(v0, v1).add(v2).add(v3).multiplyScalar(0.25);
        triggerAuroraSkill(mid);
      }
    }
  } else {
    clearAuroraEffect();
  }
}

function createAuroraEffectMesh(pos) {
  const geom = new THREE.BoxGeometry(0.055, 0.055, 0.055);
  const mat = new THREE.MeshBasicMaterial({ color: 0x99e6ff, transparent: true, opacity: 0.8 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pos);
  scene.add(mesh);
  return mesh;
}

function clearAuroraEffect() {
  auroraState.active = false;
  auroraState.startTime = 0;
  auroraState.triggered = false;
  auroraState.idx = null;
  auroraState.effectMeshes.forEach(m => scene.remove(m));
  auroraState.effectMeshes = [];
  if (auroraState.auroraBall) {
    scene.remove(auroraState.auroraBall.mesh);
    auroraState.auroraBall = null;
  }
  auroraState.auroraParticles.forEach(p => scene.remove(p.mesh));
  auroraState.auroraParticles = [];
}

function triggerAuroraSkill(mid) {
  // 오로라볼 생성
  const geom = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x99e6ff, emissive: 0x99e6ff, emissiveIntensity: 2.5 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(mid);
  scene.add(mesh);
  auroraState.auroraBall = { mesh };
  // 오로라 파티클 생성
  for (let i = 0; i < 36; i++) {
    const pgeom = new THREE.BoxGeometry(0.035, 0.035, 0.035);
    const auroraColors = [0x99e6ff, 0x9933ff, 0x33ffcc, 0x66ff99];
    const color = auroraColors[Math.floor(Math.random() * auroraColors.length)];
    const pmat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const pmesh = new THREE.Mesh(pgeom, pmat);
    pmesh.position.copy(mid);
    scene.add(pmesh);
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.22,
      (Math.random() - 0.5) * 0.22,
      (Math.random() - 0.5) * 0.22
    );
    auroraState.auroraParticles.push({ mesh: pmesh, velocity, life: 0.5 + Math.random() * 0.3 });
  }
  auroraCooldown = 5.0;
}

function updateHandAuroraEffects() {
  // 제스처 추적
  let gestures = ['', ''];
  for (let hand = 0; hand < 2; hand++) {
    if (handLandmarks[hand]) {
      gestures[hand] = detectGesture(handLandmarks[hand]);
    }
  }

  // 양손 모두 Fist일 때만 오로라볼 합체/유지
  const bothFist = gestures[0] === 'Fist ✊' && gestures[1] === 'Fist ✊';
  const bothOpenPalm = gestures[0] === 'Open Palm' && gestures[1] === 'Open Palm';

  // 오로라볼 생성 조건: 양손 Fist + 4번-4번 거리 < threshold
  let canCreateAuroraBall = false;
  let auroraBallMid = null;
  let auroraBallDist = 0;
  if (bothFist && handLandmarks[0] && handLandmarks[1]) {
    const pL = handLandmarks[0][4];
    const pR = handLandmarks[1][4];
    const vL = new THREE.Vector3(((1 - pL.x) - 0.5) * 2, -(pL.y - 0.5) * 2, 0.7 - pL.z * 1.5);
    const vR = new THREE.Vector3(((1 - pR.x) - 0.5) * 2, -(pR.y - 0.5) * 2, 0.7 - pR.z * 1.5);
    vL.unproject(camera);
    vR.unproject(camera);
    const dist = vL.distanceTo(vR);
    const threshold = 0.18;
    if (dist < threshold) {
      canCreateAuroraBall = true;
      auroraBallMid = new THREE.Vector3().addVectors(vL, vR).multiplyScalar(0.5);
      auroraBallDist = dist;
    }
  }

  // 작은 오로라 이펙트(각 손 4-8)는 여전히 Fist+4-8 가까울 때만
  for (let hand = 0; hand < 2; hand++) {
    if (handLandmarks[hand]) {
      const p4 = handLandmarks[hand][4];
      const p8 = handLandmarks[hand][8];
      const v4 = new THREE.Vector3(((1 - p4.x) - 0.5) * 2, -(p4.y - 0.5) * 2, 0.7 - p4.z * 1.5);
      const v8 = new THREE.Vector3(((1 - p8.x) - 0.5) * 2, -(p8.y - 0.5) * 2, 0.7 - p8.z * 1.5);
      v4.unproject(camera);
      v8.unproject(camera);
      const dist = v4.distanceTo(v8);
      const threshold = 0.20;
      if (dist < threshold && bothFist) {
        if (!handAuroraEffects[hand]) {
          handAuroraEffects[hand] = createSmallAuroraEffectMesh(v4);
        } else {
          handAuroraEffects[hand].position.copy(v4);
        }
      } else {
        if (handAuroraEffects[hand]) {
          scene.remove(handAuroraEffects[hand]);
          handAuroraEffects[hand] = null;
        }
      }
    } else {
      if (handAuroraEffects[hand]) {
        scene.remove(handAuroraEffects[hand]);
        handAuroraEffects[hand] = null;
      }
    }
  }

  // 오로라볼 생성/갱신 (조건: canCreateAuroraBall)
  if (canCreateAuroraBall && !handAuroraBall) {
    // 크기 보간 (0.12~0.5)
    const minD = 0.07, maxD = 0.18;
    const minS = 0.12, maxS = 0.5;
    let scale = minS + (maxS - minS) * ((auroraBallDist - minD) / (maxD - minD));
    scale = Math.max(minS, Math.min(maxS, scale));
    handAuroraBall = createBigAuroraBall(auroraBallMid, scale);
    auroraBallFired = false;
    auroraBallReadyTime = performance.now();
  }
  // 오로라볼이 이미 생성된 경우, 손이 인식 밖이 아니면 위치/크기만 갱신(사라지지 않음)
  if (handAuroraBall && handLandmarks[0] && handLandmarks[1]) {
    // 크기/위치 갱신(손이 인식 중이면)
    if (canCreateAuroraBall) {
      const minD = 0.07, maxD = 0.18;
      const minS = 0.12, maxS = 0.5;
      let scale = minS + (maxS - minS) * ((auroraBallDist - minD) / (maxD - minD));
      scale = Math.max(minS, Math.min(maxS, scale));
      handAuroraBall.position.copy(auroraBallMid);
      handAuroraBall.scale.set(scale, scale, scale);
    }
    // 오로라 파티클은 handAuroraBall이 존재하면 항상 생성
    if (Math.random() < 0.5) {
      const p = createAuroraParticle(handAuroraBall.position, handAuroraBall.scale.x);
      handAuroraParticles.push(p);
    }
  }

  // 오로라볼 발사: handAuroraBall이 존재할 때 양손 모두 Open Palm이 되면 언제든 발사
  if (
    handAuroraBall &&
    handLandmarks[0] && handLandmarks[1] &&
    detectGesture(handLandmarks[0]) === 'Open Palm' &&
    detectGesture(handLandmarks[1]) === 'Open Palm'
  ) {
    // 카메라가 바라보는 방향으로 발사
    const from = handAuroraBall.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.normalize();
    const velocity = dir.multiplyScalar(0.19);
    const flying = createBigAuroraBall(from, handAuroraBall.scale.x);
    flying.userData = { velocity, active: true };
    flyingAuroraBalls.push(flying);
    scene.remove(handAuroraBall);
    handAuroraBall = null;
    handAuroraParticles.forEach(p => scene.remove(p.mesh));
    handAuroraParticles = [];
    auroraBallFired = true;
    auroraBallReadyTime = 0;
  }
  // 오로라볼 사라짐 조건: 손이 하나라도 인식 밖이면 즉시 제거
  if (!handLandmarks[0] || !handLandmarks[1]) {
    if (handAuroraBall) {
      scene.remove(handAuroraBall);
      handAuroraBall = null;
    }
    handAuroraParticles.forEach(p => scene.remove(p.mesh));
    handAuroraParticles = [];
    auroraBallReadyTime = 0;
    auroraBallFired = false;
  }
  lastAuroraGestures = gestures;
}

function createAuroraParticle(center, scale) {
  // 더 강렬한 컬러와 glow, 크기, 속도, 투명도 랜덤
  const geom = new THREE.BoxGeometry(0.03 + Math.random() * 0.04 * scale, 0.03 + Math.random() * 0.04 * scale, 0.03 + Math.random() * 0.04 * scale);
  const auroraColors = [0x99e6ff, 0x9933ff, 0x33ffcc, 0x66ff99, 0xffe066, 0xff66cc, 0x66ffd9, 0xffffff];
  const color = auroraColors[Math.floor(Math.random() * auroraColors.length)];
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: 2.5 + Math.random() * 1.5,
    roughness: 0.15,
    metalness: 0.7,
    transparent: true,
    opacity: 0.8 + Math.random() * 0.2,
    transmission: 0.6 + Math.random() * 0.3,
    ior: 1.2 + Math.random() * 0.4
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(center);
  // 폭발 느낌의 방향성, 더 빠르게
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.random() * Math.PI;
  const r = 0.18 + Math.random() * 0.25 * scale;
  const velocity = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  ).multiplyScalar(r * 0.13 + 0.03);
  scene.add(mesh);
  return { mesh, velocity, life: 0.7 + Math.random() * 0.4 };
}

function createSmallAuroraEffectMesh(pos) {
  const geom = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  const mat = new THREE.MeshBasicMaterial({ color: 0x99e6ff, transparent: true, opacity: 0.7 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pos);
  scene.add(mesh);
  return mesh;
}

// Mediapipe 랜드마크 시각화용 함수 (CDN)
// import { drawConnectors, drawLandmarks, HAND_CONNECTIONS } from 'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js';

// 진입점
init();
animate();

// createBigAuroraBall를 createFireball 등과 같은 위치(상단)로 이동
function createBigAuroraBall(pos, scale) {
  // 멋진 마법의 구: 입체적이고 각진 IcosahedronGeometry + glow 강조, 오로라 테마
  const geom = new THREE.IcosahedronGeometry(1, 2);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x99e6ff,
    emissive: 0x9933ff,
    emissiveIntensity: 3.2,
    roughness: 0.18,
    metalness: 0.7,
    transparent: true,
    opacity: 0.82,
    transmission: 0.7,
    ior: 1.4,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pos);
  mesh.scale.set(scale, scale, scale);
  scene.add(mesh);
  return mesh;
}