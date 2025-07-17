import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { Hands } from '@mediapipe/hands';
import { Camera as MediaPipeCamera } from '@mediapipe/camera_utils';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// TWEEN 라이브러리 (CDN에서 로드)
const TWEEN = window.TWEEN;

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

let bossMoveTarget = null;
let bossMoveTimer = 0;

// === [보스 등장 시퀀스 관련 변수] ===
let bossSpawnTimer = 0;
let bossSpawnStarted = false;
let bossSpawnPhase = 'waiting'; // 'waiting', 'portal', 'spawning', 'descending', 'complete'
let bossSpawnEffects = [];
let bossSpawnStartTime = 0;
let bossSpawnPortal = null;
let portalParticles = [];

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
let shieldMesh = null;

// === [플레이어 HP 시스템 추가] ===
let playerHP = 100;
let playerMaxHP = 100;
let playerHpBarMesh = null;
let playerHpBarBgMesh = null;
let isPlayerDead = false;

// === [플레이어 피격 임팩트 변수 전역 선언] ===
let playerHitFlash = 0;
let playerShakeTime = 0;
let shakeOffset = { x: 0, y: 0, z: 0 };

// === [2D HP UI 업데이트 함수 추가] ===
function updatePlayerHpUI() {
  const fill = document.querySelector('#player-hp-ui .mc-hp-fill');
  const label = document.querySelector('#player-hp-ui .mc-hp-label');
  if (fill) {
    const ratio = Math.max(0, playerHP) / playerMaxHP;
    fill.style.width = (ratio * 100) + '%';
  }
  if (label) {
    label.textContent = `HP: ${playerHP} / ${playerMaxHP}`;
  }
}

function createPlayerHpBar() {
  if (!player) return;
  // HP바 배경
  const bgGeom = new THREE.PlaneGeometry(2.2, 0.18);
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.7 });
  playerHpBarBgMesh = new THREE.Mesh(bgGeom, bgMat);
  playerHpBarBgMesh.position.set(0, 2.5, 0);
  playerHpBarBgMesh.renderOrder = 1000;
  playerHpBarBgMesh.material.depthTest = false;
  player.add(playerHpBarBgMesh);
  // HP바
  const barGeom = new THREE.PlaneGeometry(2, 0.12);
  const barMat = new THREE.MeshBasicMaterial({ color: 0x55ff55, transparent: true, opacity: 0.95 });
  playerHpBarMesh = new THREE.Mesh(barGeom, barMat);
  playerHpBarMesh.position.set(0, 2.5, 0.01);
  playerHpBarMesh.renderOrder = 1001;
  playerHpBarMesh.material.depthTest = false;
  player.add(playerHpBarMesh);
  updatePlayerHpUI(); // 2D HP UI도 초기화
}

function updatePlayerHpBar() {
  if (!playerHpBarMesh) return;
  const hpRatio = Math.max(0, playerHP) / playerMaxHP;
  playerHpBarMesh.scale.x = hpRatio;
  playerHpBarMesh.position.x = -(1 - hpRatio) * 1;
  // === 2D HP UI도 갱신 ===
  updatePlayerHpUI();
}

function damagePlayer(amount, pos) {
  if (isPlayerDead) return;
  playerHP -= amount;
  if (playerHP < 0) playerHP = 0;
  updatePlayerHpBar();
  spawnPlayerDamageText(pos || player.position, amount);
  triggerPlayerHitEffect();
  // [임팩트] 화면 흔들림, 붉은 번쩍임
  playerShakeTime = 0.38; // 더 길고 강하게
  playerHitFlash = 0.18;
  if (playerHP <= 0) {
    isPlayerDead = true;
    onPlayerDeath();
  }
  // === 2D HP UI도 갱신 ===
  updatePlayerHpUI();
}

function spawnPlayerDamageText(position, value = 10) {
  // 카메라 12시 방향에 고정된 데미지 텍스트 생성
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 120px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff0033';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#fff';
  ctx.fillText('-' + value.toString(), 256, 128);
  ctx.strokeStyle = '#ff0033';
  ctx.lineWidth = 12;
  ctx.strokeText('-' + value.toString(), 256, 128);
  
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ 
    map: texture, 
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  
  // 카메라 앞쪽 12시 방향에 위치 설정
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);
  
  // 카메라 위쪽 방향 벡터
  const cameraUp = new THREE.Vector3(0, 1, 0);
  cameraUp.applyQuaternion(camera.quaternion);
  
  // 카메라 앞쪽 + 위쪽으로 위치 설정 (10% 아래로)
  const damagePosition = camera.position.clone();
  damagePosition.add(cameraDirection.multiplyScalar(3)); // 앞쪽으로 3만큼
  damagePosition.add(cameraUp.multiplyScalar(1.35)); // 위쪽으로 1.35만큼 (1.5에서 10% 감소)
  
  sprite.position.copy(damagePosition);
  sprite.scale.set(1.5, 0.75, 1); // 크기를 절반으로 줄임
  
  // 항상 카메라를 바라보도록 설정
  sprite.lookAt(camera.position);
  
  scene.add(sprite);
  damageTexts.push({ sprite, time: 0, isPlayerDamage: true });
}

function triggerPlayerHitEffect() {
  if (!player) return;
  player.material.color.set(0xff3333);
  if (playerHpBarMesh) playerHpBarMesh.material.color.set(0xff3333);
  setTimeout(() => {
    if (player) player.material.color.set(0x55ff55);
    if (playerHpBarMesh) playerHpBarMesh.material.color.set(0x55ff55);
  }, 180);
}

function onPlayerDeath() {
  // 게임 일시 정지 (보스 공격 중단)
  isPlayerDead = true;
  
  // 플레이어 죽음 파티클 효과
  spawnPlayerDeathParticles();
  
  // 카메라 강한 흔들림 효과
  playerShakeTime = 3.0;
  
  // 화면 암전 효과
  renderer.setClearColor(0x000000, 0.8);
  
  // 1.5초 후 게임 오버 화면 표시
  setTimeout(() => {
    showGameOverScreen();
    renderer.setClearColor(0x18132a, 1);
  }, 1500);
  
  updatePlayerHpUI(); // 2D HP UI도 갱신
}

function spawnPlayerDeathParticles() {
  if (!player) return;
  
  // 플레이어 위치에서 파티클 폭발
  const pos = player.position.clone();
  
  // 붉은 파티클 (피)
  for (let i = 0; i < 30; i++) {
    const geom = new THREE.SphereGeometry(0.05, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ 
      color: 0xff0000, 
      emissive: 0x660000, 
      transparent: true, 
      opacity: 0.8 
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(pos);
    mesh.position.y += Math.random() * 2; // 높이 랜덤
    scene.add(mesh);
    
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.4,
      Math.random() * 0.3 + 0.1,
      (Math.random() - 0.5) * 0.4
    );
    explosionParticles.push({ 
      mesh, 
      velocity, 
      life: 1.0 + Math.random() * 0.5 
    });
  }
  
  // 어두운 연기 파티클
  for (let i = 0; i < 20; i++) {
    const geom = new THREE.SphereGeometry(0.08, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ 
      color: 0x333333, 
      transparent: true, 
      opacity: 0.6 
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(pos);
    mesh.position.y += Math.random() * 1.5;
    scene.add(mesh);
    
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.2,
      Math.random() * 0.2 + 0.05,
      (Math.random() - 0.5) * 0.2
    );
    explosionParticles.push({ 
      mesh, 
      velocity, 
      life: 1.5 + Math.random() * 0.8 
    });
  }
}

function showGameOverScreen() {
  const gameOverScreen = document.getElementById('game-over-screen');
  if (gameOverScreen) {
    gameOverScreen.style.display = 'flex';
    
    // 게임 오버 사운드 효과 (시각적 플래시)
    const flash = { intensity: 0 };
    const flashTween = new TWEEN.Tween(flash)
      .to({ intensity: 1 }, 300)
      .onUpdate(() => {
        renderer.setClearColor(0xff0000, flash.intensity * 0.5);
      })
      .onComplete(() => {
        const fadeOut = new TWEEN.Tween(flash)
          .to({ intensity: 0 }, 1000)
          .onUpdate(() => {
            renderer.setClearColor(0xff0000, flash.intensity * 0.5);
          })
          .onComplete(() => {
            renderer.setClearColor(0x18132a, 1);
          });
        fadeOut.start();
      });
    flashTween.start();
  }
}

function hideGameOverScreen() {
  const gameOverScreen = document.getElementById('game-over-screen');
  if (gameOverScreen) {
    gameOverScreen.style.display = 'none';
  }
}

function restartGame() {
  // 게임 오버 화면 숨기기
  hideGameOverScreen();
  
  // 게임 상태 리셋
  resetGameState();
  
  // 기존 타이머 취소
  if (bossSpawnTimeout) {
    clearTimeout(bossSpawnTimeout);
  }
  
  // 보스 등장 시퀀스 재시작 (3초 후)
  bossSpawnTimeout = setTimeout(() => {
    startBossSpawnSequence();
    bossSpawnTimeout = null;
  }, 3000);
}

function returnToMainMenu() {
  // 게임 오버 화면 숨기기
  hideGameOverScreen();
  
  // 메인 메뉴 표시
  const mainMenu = document.getElementById('main-menu');
  if (mainMenu) {
    mainMenu.style.display = 'flex';
  }
  
  // 게임 상태 완전 초기화
  resetGameState();
}

function createPlayer() {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x55ff55, transparent: true, opacity: 0 }); // 완전 투명
  player = new THREE.Mesh(geometry, material);
  // 초기 위치는 groundY가 설정된 후 landscape 로드 콜백에서 설정됨
  player.position.set(0, groundY + 1, 0);
  player.castShadow = true;
  player.receiveShadow = true;
  scene.add(player);
  createPlayerHpBar();
  updatePlayerHpUI(); // 2D HP UI도 초기화
}

// === [보스 등장 시퀀스 함수들] ===
function startBossSpawnSequence() {
  if (bossSpawnStarted) return;
  bossSpawnStarted = true;
  bossSpawnPhase = 'portal';
  bossSpawnStartTime = performance.now();
  
  // 먼저 포털 생성
  createBossSpawnPortal();
  
  // 2초 후 하늘 어두워지기 시작
  setTimeout(() => {
    bossSpawnPhase = 'spawning';
    
    // 하늘이 어두워지는 효과
    const sky = scene.children.find(child => child.geometry && child.geometry.type === 'SphereGeometry');
    if (sky) {
      const originalColor = sky.material.color.clone();
      const targetColor = new THREE.Color(0x2a1a3a); // 어두운 보라색
      
      const tween = { t: 0 };
      const skyTween = new TWEEN.Tween(tween)
        .to({ t: 1 }, 2000)
        .onUpdate(() => {
          sky.material.color.lerpColors(originalColor, targetColor, tween.t);
        });
      skyTween.start();
    }
    
    // 번개 효과 생성
    createLightningEffects();
    
    // 포털 강화
    enhancePortal();
  }, 2000);
  
  // 5초 후 보스 등장
  setTimeout(() => {
    spawnBoss();
  }, 5000);
}

function createLightningEffects() {
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const lightning = createLightning();
      bossSpawnEffects.push(lightning);
      
      // 번개 소리 효과 (시각적 플래시)
      const flash = { intensity: 0 };
      const flashTween = new TWEEN.Tween(flash)
        .to({ intensity: 1 }, 100)
        .onUpdate(() => {
          renderer.setClearColor(0xffffff, flash.intensity * 0.3);
        })
        .onComplete(() => {
          const fadeOut = new TWEEN.Tween(flash)
            .to({ intensity: 0 }, 300)
            .onUpdate(() => {
              renderer.setClearColor(0xffffff, flash.intensity * 0.3);
            })
            .onComplete(() => {
              renderer.setClearColor(0x18132a, 1);
            });
          fadeOut.start();
        });
      flashTween.start();
    }, i * 800);
  }
}

function createLightning() {
  const geometry = new THREE.CylinderGeometry(0.1, 0.1, 50, 8);
  const material = new THREE.MeshBasicMaterial({ 
    color: 0xffffff, 
    emissive: 0x9999ff,
    transparent: true,
    opacity: 0.8
  });
  const lightning = new THREE.Mesh(geometry, material);
  
  // 랜덤 위치에 번개 생성
  lightning.position.set(
    (Math.random() - 0.5) * 100,
    25,
    (Math.random() - 0.5) * 100
  );
  
  scene.add(lightning);
  
  // 번개 애니메이션 (깜빡임)
  const flash = { opacity: 0.8 };
  const flashTween = new TWEEN.Tween(flash)
    .to({ opacity: 0 }, 200)
    .onUpdate(() => {
      lightning.material.opacity = flash.opacity;
    })
    .onComplete(() => {
      scene.remove(lightning);
    });
  flashTween.start();
  
  return lightning;
}

function createBossSpawnPortal() {
  // 포털 위치 (보스가 나타날 자리)
  const portalPosition = new THREE.Vector3(0, 21, -10);
  
  // 메인 포털 원기둥 (외부 링)
  const outerRingGeometry = new THREE.RingGeometry(8, 10, 32);
  const outerRingMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x6644ff,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide
  });
  const outerRing = new THREE.Mesh(outerRingGeometry, outerRingMaterial);
  outerRing.rotation.x = -Math.PI / 2; // 수평으로 회전
  outerRing.position.copy(portalPosition);
  scene.add(outerRing);
  
  // 내부 포털 원기둥 (내부 링)
  const innerRingGeometry = new THREE.RingGeometry(5, 7, 32);
  const innerRingMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x9966ff,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide
  });
  const innerRing = new THREE.Mesh(innerRingGeometry, innerRingMaterial);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.copy(portalPosition);
  scene.add(innerRing);
  
  // 중앙 코어 (빛나는 중심)
  const coreGeometry = new THREE.CircleGeometry(4, 32);
  const coreMaterial = new THREE.MeshBasicMaterial({ 
    color: 0xccaaff,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.rotation.x = -Math.PI / 2;
  core.position.copy(portalPosition);
  scene.add(core);
  
  // 수직 원기둥 (포털 기둥)
  const cylinderGeometry = new THREE.CylinderGeometry(10, 10, 30, 32, 1, true);
  const cylinderMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x4433aa,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide
  });
  const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
  cylinder.position.set(portalPosition.x, portalPosition.y, portalPosition.z);
  scene.add(cylinder);
  
  // 포털 객체 저장
  bossSpawnPortal = {
    outerRing: outerRing,
    innerRing: innerRing,
    core: core,
    cylinder: cylinder,
    startTime: performance.now()
  };
  
  // 포털 애니메이션 시작
  animatePortal();
  
  // 포털 파티클 생성
  createPortalParticles();
}

function animatePortal() {
  if (!bossSpawnPortal) return;
  
  // 링들 회전 애니메이션
  const rotationTween = { rotation: 0 };
  const rotateTween = new TWEEN.Tween(rotationTween)
    .to({ rotation: Math.PI * 2 }, 4000)
    .repeat(Infinity)
    .onUpdate(() => {
      if (bossSpawnPortal.outerRing) {
        bossSpawnPortal.outerRing.rotation.z = rotationTween.rotation;
      }
      if (bossSpawnPortal.innerRing) {
        bossSpawnPortal.innerRing.rotation.z = -rotationTween.rotation * 1.5;
      }
    });
  rotateTween.start();
  
  // 포털 펄스 효과
  const pulse = { scale: 1 };
  const pulseTween = new TWEEN.Tween(pulse)
    .to({ scale: 1.1 }, 1000)
    .repeat(Infinity)
    .yoyo(true)
    .easing(TWEEN.Easing.Sinusoidal.InOut)
    .onUpdate(() => {
      if (bossSpawnPortal.core) {
        bossSpawnPortal.core.scale.set(pulse.scale, pulse.scale, pulse.scale);
      }
    });
  pulseTween.start();
}

function createPortalParticles() {
  if (!bossSpawnPortal) return;
  
  const portalPosition = new THREE.Vector3(0, 21, -10);
  
  // 포털 주변 파티클 생성
  for (let i = 0; i < 20; i++) {
    setTimeout(() => {
      const geometry = new THREE.SphereGeometry(0.2, 8, 8);
      const material = new THREE.MeshBasicMaterial({ 
        color: 0x9966ff,
        transparent: true,
        opacity: 0.8
      });
      const particle = new THREE.Mesh(geometry, material);
      
      // 포털 주변 원형으로 배치
      const angle = (i / 20) * Math.PI * 2;
      const radius = 12 + Math.random() * 3;
      particle.position.set(
        portalPosition.x + Math.cos(angle) * radius,
        portalPosition.y + (Math.random() - 0.5) * 5,
        portalPosition.z + Math.sin(angle) * radius
      );
      
      scene.add(particle);
      
      // 파티클이 포털 중심으로 나선형으로 이동
      const spiralVelocity = {
        angle: angle,
        radius: radius,
        y: particle.position.y,
        speed: 0.02
      };
      
      portalParticles.push({
        mesh: particle,
        velocity: spiralVelocity,
        life: 10.0,
        maxLife: 10.0
      });
    }, i * 200);
  }
}

function enhancePortal() {
  if (!bossSpawnPortal) return;
  
  // 포털 강화 - 더 밝고 크게
  const enhanceTween = { intensity: 1 };
  const enhance = new TWEEN.Tween(enhanceTween)
    .to({ intensity: 2 }, 1500)
    .onUpdate(() => {
      if (bossSpawnPortal.outerRing) {
        bossSpawnPortal.outerRing.material.opacity = 0.7 * enhanceTween.intensity;
      }
      if (bossSpawnPortal.innerRing) {
        bossSpawnPortal.innerRing.material.opacity = 0.8 * enhanceTween.intensity;
      }
      if (bossSpawnPortal.core) {
        bossSpawnPortal.core.material.opacity = 0.6 * enhanceTween.intensity;
      }
      if (bossSpawnPortal.cylinder) {
        bossSpawnPortal.cylinder.material.opacity = 0.3 * enhanceTween.intensity;
      }
    });
  enhance.start();
  
  // 추가 강화 파티클
  const portalPosition = new THREE.Vector3(0, 21, -10);
  for (let i = 0; i < 30; i++) {
    setTimeout(() => {
      const geometry = new THREE.SphereGeometry(0.3, 8, 8);
      const material = new THREE.MeshBasicMaterial({ 
        color: 0xffaa66,
        emissive: 0xff6600,
        transparent: true,
        opacity: 0.9
      });
      const particle = new THREE.Mesh(geometry, material);
      
      // 포털 중심에서 바깥으로 폭발
      particle.position.copy(portalPosition);
      scene.add(particle);
      
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.5
      );
      
      portalParticles.push({
        mesh: particle,
        velocity: velocity,
        life: 3.0,
        maxLife: 3.0
      });
    }, i * 50);
  }
}

function updatePortalParticles() {
  for (let i = portalParticles.length - 1; i >= 0; i--) {
    const particle = portalParticles[i];
    
    if (particle.velocity.angle !== undefined) {
      // 나선형 이동
      particle.velocity.angle += particle.velocity.speed;
      particle.velocity.radius -= 0.05;
      
      if (particle.velocity.radius > 0) {
        particle.mesh.position.x = Math.cos(particle.velocity.angle) * particle.velocity.radius;
        particle.mesh.position.z = Math.sin(particle.velocity.angle) * particle.velocity.radius;
        particle.mesh.position.y = 21 + Math.sin(particle.velocity.angle * 3) * 2;
      }
    } else {
      // 직선 이동
      particle.mesh.position.add(particle.velocity);
    }
    
    // 수명 감소
    particle.life -= 1/60;
    
    // 페이드 아웃
    const alpha = particle.life / particle.maxLife;
    if (particle.mesh.material) {
      particle.mesh.material.opacity = alpha;
    }
    
    // 수명이 다하면 제거
    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      portalParticles.splice(i, 1);
    }
  }
}

function destroyPortal() {
  if (!bossSpawnPortal) return;
  
  // 포털 페이드 아웃
  const fadeOut = { opacity: 1 };
  const fade = new TWEEN.Tween(fadeOut)
    .to({ opacity: 0 }, 1000)
    .onUpdate(() => {
      if (bossSpawnPortal.outerRing) {
        bossSpawnPortal.outerRing.material.opacity = 0.7 * fadeOut.opacity;
      }
      if (bossSpawnPortal.innerRing) {
        bossSpawnPortal.innerRing.material.opacity = 0.8 * fadeOut.opacity;
      }
      if (bossSpawnPortal.core) {
        bossSpawnPortal.core.material.opacity = 0.6 * fadeOut.opacity;
      }
      if (bossSpawnPortal.cylinder) {
        bossSpawnPortal.cylinder.material.opacity = 0.3 * fadeOut.opacity;
      }
    })
    .onComplete(() => {
      // 포털 제거
      if (bossSpawnPortal.outerRing) scene.remove(bossSpawnPortal.outerRing);
      if (bossSpawnPortal.innerRing) scene.remove(bossSpawnPortal.innerRing);
      if (bossSpawnPortal.core) scene.remove(bossSpawnPortal.core);
      if (bossSpawnPortal.cylinder) scene.remove(bossSpawnPortal.cylinder);
      bossSpawnPortal = null;
    });
  fade.start();
}

function spawnBoss() {
  bossSpawnPhase = 'descending';
  
  // 포털 마지막 강화 (보스 등장 직전)
  if (bossSpawnPortal) {
    const finalEnhance = { intensity: 1 };
    const finalTween = new TWEEN.Tween(finalEnhance)
      .to({ intensity: 3 }, 800)
      .onUpdate(() => {
        if (bossSpawnPortal.outerRing) {
          bossSpawnPortal.outerRing.material.opacity = Math.min(1, 0.7 * finalEnhance.intensity);
        }
        if (bossSpawnPortal.innerRing) {
          bossSpawnPortal.innerRing.material.opacity = Math.min(1, 0.8 * finalEnhance.intensity);
        }
        if (bossSpawnPortal.core) {
          bossSpawnPortal.core.material.opacity = Math.min(1, 0.6 * finalEnhance.intensity);
        }
        if (bossSpawnPortal.cylinder) {
          bossSpawnPortal.cylinder.material.opacity = Math.min(1, 0.3 * finalEnhance.intensity);
        }
      });
    finalTween.start();
  }
  
  // 보스 로딩
  const loader = new GLTFLoader();
  loader.load('/dragon.glb', (gltf) => {
    boss = gltf.scene;
    
    // 보스를 포털 중심에서 시작 (포털을 통해 나오는 것처럼)
    boss.position.set(0, 35, -10); // 포털 중심 높이에서 시작
    boss.scale.set(5, 5, 5);
    boss.maxHP = 100;
    boss.currentHP = 100;
    boss.lastHitTime = 0;
    
    // 보스 초기 투명도 설정
    boss.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        bossOriginalMaterials.push({ mesh: child, material: child.material.clone() });
        
        // 초기에는 투명하게
        if (child.material) {
          child.material.transparent = true;
          child.material.opacity = 0;
        }
      }
    });
    
    scene.add(boss);
    
    // 보스 등장 애니메이션
    animateBossEntrance();
    
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
}

function animateBossEntrance() {
  // 보스 하강 애니메이션
  const targetY = 21;
  const startY = 35;
  
  const descentTween = new TWEEN.Tween(boss.position)
    .to({ y: targetY }, 3000)
    .easing(TWEEN.Easing.Cubic.Out)
    .onUpdate(() => {
      // 하강하면서 서서히 나타나기
      const progress = (startY - boss.position.y) / (startY - targetY);
      boss.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.opacity = Math.min(1, progress * 1.5);
        }
      });
      
             // 보스가 하강하면서 포털도 함께 사라지게 (보스가 20% 하강했을 때부터 포털 사라짐 시작)
      if (progress > 0.2 && bossSpawnPortal) {
        const portalFadeProgress = (progress - 0.2) / 0.8; // 0.2~1.0을 0~1로 변환
        const portalOpacity = Math.max(0, 1 - portalFadeProgress);
        
        if (bossSpawnPortal.outerRing) {
          bossSpawnPortal.outerRing.material.opacity = 0.7 * portalOpacity;
        }
        if (bossSpawnPortal.innerRing) {
          bossSpawnPortal.innerRing.material.opacity = 0.8 * portalOpacity;
        }
        if (bossSpawnPortal.core) {
          bossSpawnPortal.core.material.opacity = 0.6 * portalOpacity;
        }
        if (bossSpawnPortal.cylinder) {
          bossSpawnPortal.cylinder.material.opacity = 0.3 * portalOpacity;
        }
        
        // 포털이 사라지면서 추가 파티클 효과
        if (portalFadeProgress > 0.5) {
          // 포털 붕괴 파티클 (간헐적으로 생성)
          if (Math.random() < 0.1) {
            const geometry = new THREE.SphereGeometry(0.4, 8, 8);
            const material = new THREE.MeshBasicMaterial({ 
              color: 0x6644ff,
              transparent: true,
              opacity: 0.8
            });
            const particle = new THREE.Mesh(geometry, material);
            particle.position.set(
              (Math.random() - 0.5) * 15,
              21 + (Math.random() - 0.5) * 8,
              -10 + (Math.random() - 0.5) * 15
            );
            scene.add(particle);
            
            const velocity = new THREE.Vector3(
              (Math.random() - 0.5) * 0.3,
              Math.random() * 0.2 + 0.1,
              (Math.random() - 0.5) * 0.3
            );
            
            portalParticles.push({
              mesh: particle,
              velocity: velocity,
              life: 2.0,
              maxLife: 2.0
            });
          }
        }
      }
    })
    .onComplete(() => {
      bossSpawnPhase = 'complete';
      createBossHPBar();
      
      // 포털 완전 제거
      if (bossSpawnPortal) {
        if (bossSpawnPortal.outerRing) scene.remove(bossSpawnPortal.outerRing);
        if (bossSpawnPortal.innerRing) scene.remove(bossSpawnPortal.innerRing);
        if (bossSpawnPortal.core) scene.remove(bossSpawnPortal.core);
        if (bossSpawnPortal.cylinder) scene.remove(bossSpawnPortal.cylinder);
        bossSpawnPortal = null;
      }
      
      // 보스 등장 완료 이펙트
      createBossSpawnCompleteEffect();
    });
  
  descentTween.start();
  
  // 보스 등장 중 파티클 효과
  createBossSpawnParticles();
}

function createBossHPBar() {
  if (!boss) return;
  
  // boss bounding box
  bossBox = new THREE.Box3().setFromObject(boss);
  
  // HP바와 배경 라인 생성 (보스 머리 위, anchor 중앙)
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
}

function createBossSpawnParticles() {
  if (!boss) return;
  
  const particleCount = 30;
  for (let i = 0; i < particleCount; i++) {
    setTimeout(() => {
      const geometry = new THREE.SphereGeometry(0.3, 8, 8);
      const material = new THREE.MeshBasicMaterial({ 
        color: 0xff4444, 
        emissive: 0xff0000,
        transparent: true,
        opacity: 0.8
      });
      const particle = new THREE.Mesh(geometry, material);
      
      // 보스 주변에 파티클 생성
      const angle = (i / particleCount) * Math.PI * 2;
      const radius = 8 + Math.random() * 4;
      particle.position.set(
        boss.position.x + Math.cos(angle) * radius,
        boss.position.y + (Math.random() - 0.5) * 10,
        boss.position.z + Math.sin(angle) * radius
      );
      
      scene.add(particle);
      
      // 파티클 애니메이션
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.2,
        Math.random() * 0.1 + 0.05,
        (Math.random() - 0.5) * 0.2
      );
      
      bossSpawnEffects.push({
        mesh: particle,
        velocity: velocity,
        life: 3.0,
        maxLife: 3.0
      });
    }, i * 100);
  }
}

function createBossSpawnCompleteEffect() {
  if (!boss) return;
  
  // 보스 등장 완료 시 큰 폭발 효과
  const pos = boss.position.clone();
  for (let i = 0; i < 50; i++) {
    const geometry = new THREE.SphereGeometry(0.5, 8, 8);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0xffaa00, 
      emissive: 0xff4400,
      transparent: true,
      opacity: 0.9
    });
    const particle = new THREE.Mesh(geometry, material);
    particle.position.copy(pos);
    
    scene.add(particle);
    
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 0.8
    );
    
    bossSpawnEffects.push({
      mesh: particle,
      velocity: velocity,
      life: 2.0,
      maxLife: 2.0
    });
  }
  
  // 화면 흔들림 효과
  shakeTime = 1.0;
  
  // 보스 등장 완료 플래시
  const flash = { intensity: 0 };
  const flashTween = new TWEEN.Tween(flash)
    .to({ intensity: 1 }, 200)
    .onUpdate(() => {
      renderer.setClearColor(0xff4444, flash.intensity * 0.4);
    })
    .onComplete(() => {
      const fadeOut = new TWEEN.Tween(flash)
        .to({ intensity: 0 }, 800)
        .onUpdate(() => {
          renderer.setClearColor(0xff4444, flash.intensity * 0.4);
        })
        .onComplete(() => {
          renderer.setClearColor(0x18132a, 1);
        });
      fadeOut.start();
    });
  flashTween.start();
}

function updateBossSpawnEffects() {
  for (let i = bossSpawnEffects.length - 1; i >= 0; i--) {
    const effect = bossSpawnEffects[i];
    
    if (effect.mesh && effect.velocity) {
      // 파티클 이동
      effect.mesh.position.add(effect.velocity);
      
      // 수명 감소
      effect.life -= 1/60;
      
      // 페이드 아웃
      const alpha = effect.life / effect.maxLife;
      if (effect.mesh.material) {
        effect.mesh.material.opacity = alpha;
      }
      
      // 수명이 다하면 제거
      if (effect.life <= 0) {
        scene.remove(effect.mesh);
        bossSpawnEffects.splice(i, 1);
      }
    }
  }
}

function init() {
  // Scene
  scene = new THREE.Scene();
  // 마인크래프트 스타일 파란색 큐브맵 하늘 적용 (복구)
  scene.background = createSolidColorCubeTexture(0x7ec0ee);

  // Fog
  scene.fog = new THREE.Fog(0xb3e3ff, 40, 120);

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  // 초기 카메라 위치는 landscape 로드 후 설정됨
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
      // 맵 중앙에서 시작하도록 수정 (하늘에서 내려오지 않게)
      player.position.set(0, groundY + 1, 0); // 초록색 땅 위에 시작
      // 카메라도 플레이어 위치로 이동
      camera.position.set(0, groundY + 8, 24);
      if (controls) {
        controls.object.position.set(0, groundY + 1.2, 0);
      }
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

  // 보스 등장 시퀀스는 게임 시작 후 지연 로딩
  // init() 함수에서는 보스를 즉시 로드하지 않음

  // Controls: PointerLockControls (1인칭/3인칭)
  controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.object);
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
  updatePlayerHpUI(); // 2D HP UI도 초기화
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
      
      if (t.isPlayerDamage) {
        // 플레이어 데미지는 카메라 12시 방향에 고정
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        
        const cameraUp = new THREE.Vector3(0, 1, 0);
        cameraUp.applyQuaternion(camera.quaternion);
        
        const damagePosition = camera.position.clone();
        damagePosition.add(cameraDirection.multiplyScalar(3));
        damagePosition.add(cameraUp.multiplyScalar(1.35 + t.time * 0.25)); // 위로 천천히 이동 (시작점과 이동량 조정)
        
        t.sprite.position.copy(damagePosition);
        t.sprite.lookAt(camera.position);
        
        // 크기 애니메이션 (처음에는 크게, 점점 작아짐 + 펄스 효과) - 전체 크기 절반
        const baseScale = 1.5 * (1 + (1 - t.time) * 0.5);
        const pulseScale = 1 + Math.sin(t.time * 20) * 0.1; // 빠른 펄스 효과
        const finalScale = baseScale * pulseScale;
        t.sprite.scale.set(finalScale, finalScale * 0.5, 1);
      } else {
        // 보스 데미지는 기존 방식
        t.sprite.position.y += 0.012;
      }
      
      if (t.isPlayerDamage) {
        // 플레이어 데미지는 더 오래 지속 (1.5초)
        t.sprite.material.opacity = Math.max(0, 1 - t.time / 1.5);
        t.time += (renderer.xr.isPresenting ? 1/72 : 1/60);
        if (t.time > 1.5) {
          scene.remove(t.sprite);
          damageTexts.splice(i, 1);
        }
      } else {
        // 보스 데미지는 기존 방식
        t.sprite.material.opacity = 1 - t.time;
        t.time += (renderer.xr.isPresenting ? 1/72 : 1/60);
        if (t.time > 1) {
          scene.remove(t.sprite);
          damageTexts.splice(i, 1);
        }
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
    // 플레이어를 바라보게
    if (boss && player) {
      boss.lookAt(player.position.x, boss.position.y, player.position.z);
      boss.rotateY(Math.PI); // Y축 180도 회전
    }
    // === [보스 파이어볼 이동/충돌/데미지 처리] ===
    for (let i = bossProjectiles.length - 1; i >= 0; i--) {
      const f = bossProjectiles[i];
      if (!f.mesh) continue;
      // === 0.4초 대기 후 발사 ===
      if (f._delayTimer && f._delayTimer > 0) {
        f._delayTimer -= (renderer.xr.isPresenting ? 1/72 : 1/60);
        f.velocity.set(0, 0, 0);
        // 대기 중에는 드래곤 머리 위치를 계속 따라감
        if (f._attachedToBoss && boss) {
          const bossWorldPos = new THREE.Vector3();
          boss.getWorldPosition(bossWorldPos);
          bossBox.setFromObject(boss);
          const headY = bossBox.max.y + boss.scale.y * 1.2;
          const headPos = new THREE.Vector3(bossWorldPos.x, headY, bossWorldPos.z);
          const lookDir = new THREE.Vector3();
          boss.getWorldDirection(lookDir);
          const magicStart = headPos.add(lookDir.multiplyScalar(2 * (boss.scale.x || 1)));
          f.mesh.position.copy(magicStart);
        }
        if (f._delayTimer <= 0 && f._attachedToBoss) {
          f._attachedToBoss = false; // 이제부터는 따라가지 않음
        }
        if (f._delayTimer <= 0) {
          // === 발사 순간, 실제 위치에서 플레이어를 향해 velocity 재계산 ===
          const from = f.mesh.position.clone();
          const to = player.position.clone();
          const dir = to.sub(from).normalize();
          f.velocity = dir.multiplyScalar(0.6 * (boss.scale.x || 1));
          delete f._delayedVelocity;
          delete f._delayTimer;
        }
      }
      f.mesh.position.add(f.velocity);
      // === 파티클 이펙트 추가 ===
      if (f._delayTimer && f._delayTimer > 0) {
        // 대기 중에는 중앙에서만 파티클 생성
        const scale = (f.mesh.scale.x || 1) * 4;
        if (f.mesh.userData.type === 'fireball') {
          spawnFireParticles(f.mesh.position, f.mesh.id, scale);
        } else if (f.mesh.userData.type === 'iceball') {
          spawnIceParticles(f.mesh.position, f.mesh.id, scale);
        } else if (f.mesh.userData.type === 'lightningball') {
          spawnLightningParticles(f.mesh.position, f.mesh.id, scale);
        }
      } else {
        // 발사 후에는 여러 오프셋에서 파티클 생성
        for (let repeat = 0; repeat < 5; repeat++) {
          if (f.mesh && f.active) {
            const scale = (f.mesh.scale.x || 1) * 4;
            const radius = scale * 0.5;
            const velocity = f.velocity.clone().normalize();
            const up = new THREE.Vector3(0, 1, 0);
            let side = new THREE.Vector3().crossVectors(velocity, up).normalize();
            if (side.lengthSq() < 0.01) side = new THREE.Vector3(1, 0, 0);
            const offsets = [
              new THREE.Vector3(0, 0, 0),
              velocity.clone().multiplyScalar(-radius),
              side.clone().multiplyScalar(radius),
              side.clone().multiplyScalar(-radius),
            ];
            for (const offsetVec of offsets) {
              const pos = f.mesh.position.clone().add(offsetVec);
              if (f.mesh.userData.type === 'fireball') {
                spawnFireParticles(pos, f.mesh.id, scale);
              } else if (f.mesh.userData.type === 'iceball') {
                spawnIceParticles(pos, f.mesh.id, scale);
              } else if (f.mesh.userData.type === 'lightningball') {
                spawnLightningParticles(pos, f.mesh.id, scale);
              }
            }
          }
        }
      }
      // 실드 우선 판정
      let hit = false;
      if (shieldMesh && player) {
        const shieldBox = new THREE.Box3().setFromObject(shieldMesh);
        // 실드 충돌 박스를 약간 확장 (더 관대한 방어)
        const expandAmount = 0.3;
        shieldBox.expandByScalar(expandAmount);
        
        const projectileBox = new THREE.Box3().setFromObject(f.mesh);
        if (shieldBox.intersectsBox(projectileBox)) {
          // 실드 이펙트
          spawnExplosionParticles(f.mesh.position, 0x33ccff, 0x99e6ff);
          scene.remove(f.mesh);
          bossProjectiles.splice(i, 1);
          hit = true;
        }
      }
      if (!hit && player) {
        const playerBox = new THREE.Box3().setFromObject(player);
        // 플레이어 충돌 박스를 약간 확장 (더 관대한 판정)
        const expandAmount = 0.5;
        playerBox.expandByScalar(expandAmount);
        
        const projectileBox = new THREE.Box3().setFromObject(f.mesh);
        if (playerBox.intersectsBox(projectileBox)) {
          damagePlayer(15, f.mesh.position);
          spawnExplosionParticles(f.mesh.position, 0xff5500, 0xff2200);
          scene.remove(f.mesh);
          bossProjectiles.splice(i, 1);
          hit = true;
        }
      }
      // 너무 멀리 가면 제거
      if (!hit && f.mesh.position.distanceTo(boss.position) > 120) {
        scene.remove(f.mesh);
        bossProjectiles.splice(i, 1);
      }
    }
    // === [보스 공격 타이머] ===
    if (boss && player && !isPlayerDead) {
      bossAttackTimer += renderer.xr.isPresenting ? 1/72 : 1/60;
      if (bossAttackTimer > bossAttackInterval) {
        spawnBossMagic();
        bossAttackTimer = 0;
        bossAttackInterval = 1.2 + Math.random() * 1.6; // 다음 간격(1.2~2.8초)
      }
    }
    updatePlayerHpBar();
    // === [플레이어 피격 임팩트: 화면 흔들림/플래시] ===
    if (playerShakeTime > 0) {
      playerShakeTime -= renderer.xr.isPresenting ? 1/72 : 1/60;
      // 랜덤 방향으로 강하게 흔들림, 점차 줄어듦
      const intensity = playerShakeTime * 1.2;
      camera.position.x += Math.sin(performance.now() * 60) * shakeOffset.x * intensity;
      camera.position.y += Math.cos(performance.now() * 60) * shakeOffset.y * intensity;
      camera.position.z += Math.sin(performance.now() * 40) * shakeOffset.z * intensity * 0.5;
    }
    if (playerHitFlash > 0) {
      playerHitFlash -= renderer.xr.isPresenting ? 1/72 : 1/60;
      renderer.setClearColor(0xff0033, Math.min(1, playerHitFlash * 6));
      if (playerHitFlash <= 0) {
        renderer.setClearColor(0x18132a, 1);
      }
    }
    // === 드래곤(보스) 랜덤 이동 ===
    if (boss) {
      // 목표 위치가 없거나, 타이머가 끝나면 새 목표 위치 설정
      if (!bossMoveTarget || bossMoveTimer <= 0) {
        const range = 30; // 이동 범위
        const minY = 15, maxY = 18; // 하늘 높이
        bossMoveTarget = new THREE.Vector3(
          (Math.random() - 0.5) * 2 * range,
          minY + Math.random() * (maxY - minY),
          (Math.random() - 0.5) * 2 * range
        );
        bossMoveTimer = 2.5 + Math.random() * 2.5; // 2.5~5초마다 목표 변경
      }
      // 현재 위치에서 목표 위치로 부드럽게 이동
      const moveSpeed = 0.04; // 1프레임당 이동 비율
      boss.position.lerp(bossMoveTarget, moveSpeed);
      bossMoveTimer -= (renderer.xr.isPresenting ? 1/72 : 1/60);
      // 이동 직후에만 바라보게!
      if (boss && player) {
        boss.lookAt(player.position.x, boss.position.y, player.position.z);
        boss.rotateY(Math.PI); // Y축 180도 회전
      }
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
    const movement = moveDir.multiplyScalar(speed * delta * 0.2);
    const newPos = player.position.clone().add(movement);
    
    // 맵 경계 제한 (landscape 기준)
    if (landscape) {
      const box = new THREE.Box3().setFromObject(landscape);
      const margin = 2; // 경계에서 약간 떨어진 거리
      newPos.x = Math.max(box.min.x + margin, Math.min(box.max.x - margin, newPos.x));
      newPos.z = Math.max(box.min.z + margin, Math.min(box.max.z - margin, newPos.z));
    }
    
    player.position.copy(newPos);
    
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
    camOffset.applyAxisAngle(new THREE.Vector3(0,1,0), controls.object.rotation.y);
    camera.position.copy(player.position).add(camOffset);
    if (camera.position.y < 2) camera.position.y = 2;
    camera.lookAt(player.position.x, player.position.y + 1, player.position.z);
  } else if (player) {
    // 1인칭: 카메라가 플레이어 머리 위치
    camera.position.copy(player.position).add(new THREE.Vector3(0, 1.2, 0));
    if (camera.position.y < 2) camera.position.y = 2;
    camera.rotation.copy(controls.object.rotation);
  }
  // controls.getObject() 위치를 항상 player 위치에 맞춤
  if (player) {
    controls.object.position.copy(player.position).add(new THREE.Vector3(0, 1.2, 0));
  }
  // 기존 마법/파티클/이펙트 등은 그대로 유지
  updateBlinkMagic();
  updateAuroraMagic();
  updateHandAuroraEffects();
  
  // 보스 등장 시퀀스 업데이트
  updateBossSpawnEffects();
  updatePortalParticles();
  
  // TWEEN 업데이트
  if (TWEEN) TWEEN.update();
  
  renderer.render(scene, camera);

  // === 실드: 양손 모두 Open Palm일 때만 표시 ===
  // console.log('손0:', handLandmarks[0] ? detectGesture(handLandmarks[0]) : '없음', '손1:', handLandmarks[1] ? detectGesture(handLandmarks[1]) : '없음', 'player:', !!player, 'shieldMesh:', !!shieldMesh);
  let bothOpenPalm = false;
  if (handLandmarks[0] && handLandmarks[1]) {
    const g0 = detectGesture(handLandmarks[0]);
    const g1 = detectGesture(handLandmarks[1]);
    bothOpenPalm = (g0 === 'Open Palm' && g1 === 'Open Palm');
  }
  if (bothOpenPalm) {
    tryCreateShield();
    if (shieldMesh && player) {
      shieldMesh.position.copy(player.position);
    }
  } else {
    tryRemoveShield();
  }
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
    const margin = 5; // 경계에서 더 멀리 떨어진 거리
    for (let attempt = 0; attempt < 20; attempt++) {
      x = (box.min.x + margin) + Math.random() * ((box.max.x - margin) - (box.min.x + margin));
      z = (box.min.z + margin) + Math.random() * ((box.max.z - margin) - (box.min.z + margin));
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
  // 못 찾으면 기존 보스 주변 랜덤 위치 fallback (맵 경계 내에서)
  if (!found && boss && landscape) {
    const center = new THREE.Vector3();
    boss.getWorldPosition(center);
    const box = new THREE.Box3().setFromObject(landscape);
    const margin = 5;
    
    const theta = Math.random() * Math.PI * 2;
    const radius = 7 + Math.random() * 4;
    x = center.x + Math.cos(theta) * radius;
    z = center.z + Math.sin(theta) * radius;
    
    // 맵 경계 내로 제한
    x = Math.max(box.min.x + margin, Math.min(box.max.x - margin, x));
    z = Math.max(box.min.z + margin, Math.min(box.max.z - margin, z));
    
    y = center.y + 1.5;
    const rayOrigin = new THREE.Vector3(x, 1000, z);
    const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0));
    const intersects = raycaster.intersectObject(landscape, true);
    if (intersects.length > 0) {
      y = intersects[0].point.y + 1.5;
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

// 진입점 - 메뉴에서 시작하므로 init/animate 직접 호출 제거

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

function createShield() {
  // 플레이어를 감싸는 파란색 투명 구체
  const geometry = new THREE.SphereGeometry(1.3, 48, 32);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x33ccff, // 밝은 파랑
    transparent: true,
    opacity: 0.32,
    metalness: 0.2,
    roughness: 0.08,
    transmission: 0.85, // 유리 느낌
    thickness: 0.5,
    ior: 1.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 999;
  return mesh;
}

function tryCreateShield() {
  if (!shieldMesh && player) {
    shieldMesh = createShield();
    shieldMesh.position.copy(player.position);
    scene.add(shieldMesh);
    console.log('실드 생성!');
  }
}

function tryRemoveShield() {
  if (shieldMesh) {
    scene.remove(shieldMesh);
    shieldMesh.geometry.dispose();
    shieldMesh.material.dispose();
    shieldMesh = null;
  }
}

// === [보스 마법 공격: 플레이어 향해 마법 발사] ===
let bossAttackTimer = 0;
let bossAttackInterval = 2.0 + Math.random() * 0.8; // 최초 간격(1.2~2.8)
let bossProjectiles = [];

// 보스가 사용할 수 있는 마법 종류(실드, 오로라볼 제외)
const bossMagicTypes = [
  { type: 'fireball', create: createFireball, color: 0xff5500, emissive: 0xff2200 },
  { type: 'iceball', create: createIceball, color: 0x99e6ff, emissive: 0x66ccff },
  { type: 'lightningball', create: createLightningBall, color: 0xffff99, emissive: 0x99e6ff }
];

function spawnBossMagic() {
  if (!boss || isPlayerDead) return;
  // 랜덤 마법 선택
  const magic = bossMagicTypes[Math.floor(Math.random() * bossMagicTypes.length)];
  // 드래곤 머리 앞 위치 계산
  const bossWorldPos = new THREE.Vector3();
  boss.getWorldPosition(bossWorldPos);
  bossBox.setFromObject(boss);
  const headY = bossBox.max.y + boss.scale.y * 1.2; // 더 위로
  const headPos = new THREE.Vector3(bossWorldPos.x, headY, bossWorldPos.z);
  const lookDir = new THREE.Vector3();
  boss.getWorldDirection(lookDir);
  // 마법 생성 위치: 드래곤 머리 위에서 더 위, lookDir 방향
  const magicStart = headPos.add(lookDir.multiplyScalar(2 * (boss.scale.x || 1)));
  const end = player.position.clone();
  const dir = end.clone().sub(magicStart).normalize();
  const projectile = magic.create(magicStart);
  // 색상/이펙트 적용
  if (projectile.mesh.material.color) projectile.mesh.material.color.set(magic.color);
  if (projectile.mesh.material.emissive) projectile.mesh.material.emissive.set(magic.emissive);
  projectile.mesh.userData.type = magic.type;
  const scale = (boss.scale.x || 1) * 4;
  projectile.mesh.scale.set(scale, scale, scale);
  projectile._delayedVelocity = dir.multiplyScalar(0.6 * (boss.scale.x || 1));
  projectile.velocity = new THREE.Vector3(0, 0, 0);
  projectile._delayTimer = 0.4;
  projectile.isBossProjectile = true;
  projectile._attachedToBoss = true; // 대기 중에는 드래곤 머리 위치를 따라감
  bossProjectiles.push(projectile);
  // 파티클 생성은 animate 루프에서만 처리 (중복 방지)
}

// === 마인크래프트 스타일 파란색 큐브맵 하늘 ===
function createSolidColorCubeTexture(color = 0x7ec0ee) {
  // color: 0x7ec0ee (마인크래프트 하늘색)
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const data = new Uint8Array([r, g, b, 255]); // RGBA
  const skyTexture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  skyTexture.needsUpdate = true;
  // 6면 모두 같은 텍스처로 큐브맵 생성
  const skybox = new THREE.CubeTexture([skyTexture, skyTexture, skyTexture, skyTexture, skyTexture, skyTexture]);
  skybox.needsUpdate = true;
  return skybox;
}

// 게임 초기화 상태 플래그
let gameInitialized = false;
let bossSpawnTimeout = null;

// 진입점에서 바로 init/animate 호출하지 않고, startGame() 함수로 분리
function startGame() {
  const menu = document.getElementById('main-menu');
  if (menu) menu.style.display = 'none';
  
  // 게임이 처음 시작되는 경우에만 init() 호출
  if (!gameInitialized) {
    init();
    animate();
    gameInitialized = true;
  } else {
    // 이미 초기화된 경우 게임 상태만 리셋
    resetGameState();
  }
  
  // 기존 타이머 취소
  if (bossSpawnTimeout) {
    clearTimeout(bossSpawnTimeout);
  }
  
  // 게임 시작 후 3초 뒤에 보스 등장 시퀀스 시작
  bossSpawnTimeout = setTimeout(() => {
    startBossSpawnSequence();
    bossSpawnTimeout = null;
  }, 3000);
}

// 게임 상태 리셋 함수 (init() 없이 게임 상태만 초기화)
function resetGameState() {
  // 기존 타이머 취소
  if (bossSpawnTimeout) {
    clearTimeout(bossSpawnTimeout);
    bossSpawnTimeout = null;
  }
  
  // 플레이어 상태 초기화
  isPlayerDead = false;
  playerHP = playerMaxHP;
  updatePlayerHpUI();
  
  // 플레이어 위치 초기화
  if (player && landscape) {
    player.position.set(0, groundY + 1, 0);
    camera.position.set(0, groundY + 8, 24);
    if (controls) {
      controls.object.position.set(0, groundY + 1.2, 0);
    }
  }
  
  // 기존 보스 제거
  if (boss) {
    scene.remove(boss);
    boss = null;
    bossBox = null;
  }
  
  // 보스 HP바 제거
  if (bossHpBarMesh) {
    scene.remove(bossHpBarMesh);
    bossHpBarMesh = null;
  }
  if (bossHpBarBgMesh) {
    scene.remove(bossHpBarBgMesh);
    bossHpBarBgMesh = null;
  }
  
  // 포털 제거
  if (bossSpawnPortal) {
    if (bossSpawnPortal.outerRing) scene.remove(bossSpawnPortal.outerRing);
    if (bossSpawnPortal.innerRing) scene.remove(bossSpawnPortal.innerRing);
    if (bossSpawnPortal.core) scene.remove(bossSpawnPortal.core);
    if (bossSpawnPortal.cylinder) scene.remove(bossSpawnPortal.cylinder);
    bossSpawnPortal = null;
  }
  
  // 보스 등장 시퀀스 상태 초기화
  bossSpawnStarted = false;
  bossSpawnPhase = 'waiting';
  bossSpawnStartTime = 0;
  bossSpawnEffects = [];
  portalParticles = [];
  
  // 보스 공격 타이머 초기화
  bossAttackTimer = 0;
  bossAttackInterval = 2.0;
  
  // 모든 파티클 제거
  fireballs.forEach(f => scene.remove(f.mesh));
  iceballs.forEach(f => scene.remove(f.mesh));
  lightningballs.forEach(f => scene.remove(f.mesh));
  bossProjectiles.forEach(f => scene.remove(f.mesh));
  explosionParticles.forEach(p => scene.remove(p.mesh));
  damageTexts.forEach(t => scene.remove(t.sprite));
  
  // 배열 초기화
  fireballs = [];
  iceballs = [];
  lightningballs = [];
  bossProjectiles = [];
  explosionParticles = [];
  damageTexts = [];
  
  // 화면 효과 초기화
  playerHitFlash = 0;
  playerShakeTime = 0;
  renderer.setClearColor(0x18132a, 1);
  
  // 하늘 색상 초기화
  const sky = scene.children.find(child => child.geometry && child.geometry.type === 'SphereGeometry');
  if (sky && sky.material) {
    sky.material.color.set(0xb3e3ff); // 원래 하늘 색상으로 복원
  }
}

// 메뉴 선택 로직
const menuItems = [
  { label: '게임시작', action: startGame },
  { label: '튜토리얼', action: () => alert('튜토리얼 준비중!') },
  { label: '스코어', action: () => alert('스코어 준비중!') },
  { label: '제작자', action: () => alert('제작자: YourName') },
];
let selectedMenuIdx = 0;

// 게임 오버 메뉴 선택 로직
const gameOverMenuItems = [
  { label: '다시 시작', action: restartGame },
  { label: '메인 메뉴', action: returnToMainMenu },
];
let selectedGameOverMenuIdx = 0;

function renderMenuSelection() {
  const items = document.querySelectorAll('.mc-menu-item');
  items.forEach((el, i) => {
    if (i === selectedMenuIdx) {
      el.classList.add('selected');
      el.innerHTML = menuItems[i].label;
    } else {
      el.classList.remove('selected');
      el.innerHTML = menuItems[i].label;
    }
  });
}

function renderGameOverMenuSelection() {
  const items = document.querySelectorAll('.mc-gameover-item');
  items.forEach((el, i) => {
    if (i === selectedGameOverMenuIdx) {
      el.classList.add('selected');
      el.innerHTML = gameOverMenuItems[i].label;
    } else {
      el.classList.remove('selected');
      el.innerHTML = gameOverMenuItems[i].label;
    }
  });
}

function handleMenuKey(e) {
  const mainMenu = document.getElementById('main-menu');
  const gameOverScreen = document.getElementById('game-over-screen');
  
  // 메인 메뉴가 활성화된 경우
  if (mainMenu && mainMenu.style.display !== 'none') {
    if (e.key === 'ArrowUp') {
      selectedMenuIdx = (selectedMenuIdx - 1 + menuItems.length) % menuItems.length;
      renderMenuSelection();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      selectedMenuIdx = (selectedMenuIdx + 1) % menuItems.length;
      renderMenuSelection();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      menuItems[selectedMenuIdx].action();
      e.preventDefault();
    }
  }
  
  // 게임 오버 화면이 활성화된 경우
  if (gameOverScreen && gameOverScreen.style.display !== 'none') {
    if (e.key === 'ArrowUp') {
      selectedGameOverMenuIdx = (selectedGameOverMenuIdx - 1 + gameOverMenuItems.length) % gameOverMenuItems.length;
      renderGameOverMenuSelection();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      selectedGameOverMenuIdx = (selectedGameOverMenuIdx + 1) % gameOverMenuItems.length;
      renderGameOverMenuSelection();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      gameOverMenuItems[selectedGameOverMenuIdx].action();
      e.preventDefault();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // 메뉴 클릭 이벤트
  document.querySelectorAll('.mc-menu-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      selectedMenuIdx = i;
      renderMenuSelection();
      menuItems[i].action();
    });
  });
  
  // 게임 오버 메뉴 클릭 이벤트
  document.querySelectorAll('.mc-gameover-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      selectedGameOverMenuIdx = i;
      renderGameOverMenuSelection();
      gameOverMenuItems[i].action();
    });
  });
  
  // 키보드 이벤트
  document.addEventListener('keydown', handleMenuKey);
  renderMenuSelection();
  renderGameOverMenuSelection();
});
