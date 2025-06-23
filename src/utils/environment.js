// 판타지 마법 전쟁터 환경 생성 모듈

function loadTexture(THREE, url, fallbackColor = 0x3ba635) {
  try {
    return new THREE.TextureLoader().load(url);
  } catch {
    return null;
  }
}

function createBattlefieldGround(THREE, {
  width = 100,
  height = 100,
  widthSegments = 128,
  heightSegments = 128,
  displacementScale = 2,
  grassTex = '/grass.jpg',
  normalTex = '/grass-normal.jpg',
  bumpTex = '/grass-bump.jpg',
} = {}) {
  const geometry = new THREE.PlaneGeometry(width, height, widthSegments, heightSegments);
  // vertex displacement (간단한 noise + 랜덤)
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const noise = Math.sin(x * 0.15) * Math.cos(y * 0.18) + (Math.random() - 0.5) * 0.5;
    pos.setZ(i, noise * displacementScale);
  }
  geometry.computeVertexNormals();

  // 텍스처 로딩
  const map = loadTexture(THREE, grassTex);
  const normalMap = loadTexture(THREE, normalTex);
  const bumpMap = loadTexture(THREE, bumpTex);

  // 머티리얼
  const material = new THREE.MeshStandardMaterial({
    color: 0x4a2a6a, // 보랏빛 어두운 판타지 느낌
    map: map || undefined,
    normalMap: normalMap || undefined,
    bumpMap: bumpMap || undefined,
    bumpScale: 0.2,
    roughness: 0.7,
    metalness: 0.2,
    flatShading: false,
  });
  if (map) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(8, 8);
  }
  if (normalMap) {
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.repeat.set(8, 8);
  }
  if (bumpMap) {
    bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(8, 8);
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function createSkyBox(THREE, { night = false } = {}) {
  // SkyBox 텍스처가 있으면 사용, 없으면 색상만
  // night=true면 어두운/보랏빛, 아니면 낮하늘
  const color = night ? 0x1a1033 : 0x6a8edb;
  const skyGeo = new THREE.SphereGeometry(300, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
  });
  return new THREE.Mesh(skyGeo, skyMat);
}

function createLights(THREE, { night = false } = {}) {
  // DirectionalLight(햇빛), AmbientLight(전체)
  const sunColor = night ? 0x8888ff : 0xffffff;
  const sun = new THREE.DirectionalLight(sunColor, night ? 0.7 : 1.1);
  sun.position.set(30, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  const ambient = new THREE.AmbientLight(night ? 0x442266 : 0x8888aa, night ? 0.7 : 0.5);
  return { sun, ambient };
}

function createFog(THREE, scene, { night = false } = {}) {
  // 보랏빛/어두운 안개
  const fogColor = night ? 0x2a1a3a : 0x8a9ad6;
  scene.fog = new THREE.Fog(fogColor, 30, 120);
}

// (선택) GroundShadow (Three.js 0.150+ 필요, 없으면 생략)
function createGroundShadow(THREE, ground) {
  // TODO: ground shadow mesh 추가 (성능상 생략 가능)
}

// 전체 환경 생성
export function createEnvironment(THREE, scene, {
  night = true, // true면 밤, false면 낮
  withShadow = false,
} = {}) {
  // 바닥
  const ground = createBattlefieldGround(THREE);
  scene.add(ground);
  // 하늘
  const sky = createSkyBox(THREE, { night });
  scene.add(sky);
  // 광원
  const { sun, ambient } = createLights(THREE, { night });
  scene.add(sun);
  scene.add(ambient);
  // 안개
  createFog(THREE, scene, { night });
  // 그림자(선택)
  if (withShadow) {
    createGroundShadow(THREE, ground);
  }
} 