import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let boss;
let bossHPBar;
let bossHP = 1.0;
let bossHitEffectTimeout = null;
let bossMixer = null;

function setBoss(newBoss) {
  boss = newBoss;
}
function getBoss() {
  return boss;
}

function loadBossModel(scene, onLoaded) {
  const loader = new GLTFLoader();
  loader.load(
    '/boss/source/model.gltf', // public 폴더 기준 경로
    (gltf) => {
      boss = gltf.scene;
      boss.position.set(0, 2.5, -3.5); // 필요시 값 조정
      boss.scale.set(1.5, 1.5, 1.5); // 필요시 값 조정
      boss.castShadow = true;
      boss.receiveShadow = true;
      scene.add(boss);

      // 애니메이션 리스트 출력 및 fly 애니메이션 자동 재생
      if (gltf.animations && gltf.animations.length > 0) {
        console.log('[Boss GLTF] Animation Clips:', gltf.animations.map(a => a.name));
        bossMixer = new THREE.AnimationMixer(boss);
        const flyClip = gltf.animations.find(a => a.name.toLowerCase().includes('fly')) || gltf.animations[0];
        if (flyClip) {
          const action = bossMixer.clipAction(flyClip);
          action.reset();
          action.play();
        }
      } else {
        console.log('[Boss GLTF] No animations found.');
      }

      // HP Bar
      const hpBarBg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.32, 0.04),
        new THREE.MeshBasicMaterial({ color: 0x222222 })
      );
      hpBarBg.position.set(0, 2.72, -3.5); // HP바도 위치 맞춰 조정
      scene.add(hpBarBg);

      bossHPBar = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.02),
        new THREE.MeshBasicMaterial({ color: 0xff3333 })
      );
      bossHPBar.position.set(0, 2.72, -3.49);
      scene.add(bossHPBar);

      if (onLoaded) onLoaded(boss, gltf.animations, bossMixer);
    },
    undefined,
    (error) => {
      console.error('Error loading boss model:', error);
    }
  );
}

function updateBossHP(hp) {
  bossHP = Math.max(0, Math.min(1, hp));
  if (bossHPBar) {
    bossHPBar.scale.x = bossHP;
    bossHPBar.position.x = -(1 - bossHP) * 0.15;
  }
}

function triggerBossHitEffect() {
  if (!boss) return;
  // boss.material이 아닐 수 있으므로 traverse
  boss.traverse((child) => {
    if (child.isMesh && child.material) {
      child.material.emissive = new THREE.Color(0xffffff);
    }
  });
  if (bossHitEffectTimeout) clearTimeout(bossHitEffectTimeout);
  bossHitEffectTimeout = setTimeout(() => {
    boss.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.emissive = new THREE.Color(0x000000);
      }
    });
  }, 120);
}

function updateBossAnimation(delta) {
  if (bossMixer) bossMixer.update(delta);
}

export {
  loadBossModel,
  updateBossHP,
  triggerBossHitEffect,
  setBoss,
  getBoss,
  updateBossAnimation
}; 