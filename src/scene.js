import { createEnvironment } from './environment.js';

export function createScene(THREE) {
  const scene = new THREE.Scene();
  // scene.background = new THREE.Color(0x222233); // SkyBox만 사용
  return scene;
}

export function createCamera(THREE) {
  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 10, 30); // y=10, z=30으로 높이고 뒤로!
  return camera;
}

export function createRenderer(THREE) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  return renderer;
}

// 환경 전체를 추가하는 함수
export function addEnvironment(scene, THREE, GLTFLoader, options = {}) {
  const environment = createEnvironment(THREE, { ...options, scene, GLTFLoader });
  scene.add(environment);
} 