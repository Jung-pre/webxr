import * as THREE from 'three';

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb3e3ff); // 밝은 하늘색 낮 배경
scene.fog = new THREE.Fog(0xb3e3ff, 40, 120);

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 8, 24);

// Light
const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(20, 30, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

export { scene, camera }; 