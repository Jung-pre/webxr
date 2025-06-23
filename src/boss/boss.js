import * as THREE from 'three';

let boss;
let bossHPBar;
let bossHP = 1.0;
let bossHitEffectTimeout = null;

function setBoss(newBoss) {
  boss = newBoss;
}
function getBoss() {
  return boss;
}

function createBoss(scene) {
  // 보스(구체)
  boss = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xff3333, roughness: 0.3, metalness: 0.2 })
  );
  boss.position.set(0, 1.1, -1.2);
  boss.castShadow = true;
  boss.receiveShadow = true;
  scene.add(boss);

  // HP Bar
  const hpBarBg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.04),
    new THREE.MeshBasicMaterial({ color: 0x222222 })
  );
  hpBarBg.position.set(0, 1.32, -1.2);
  scene.add(hpBarBg);

  bossHPBar = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xff3333 })
  );
  bossHPBar.position.set(0, 1.32, -1.19);
  scene.add(bossHPBar);
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
  boss.material.emissive = new THREE.Color(0xffffff);
  if (bossHitEffectTimeout) clearTimeout(bossHitEffectTimeout);
  bossHitEffectTimeout = setTimeout(() => {
    boss.material.emissive = new THREE.Color(0x000000);
  }, 120);
}

export {
  createBoss,
  updateBossHP,
  triggerBossHitEffect,
  setBoss,
  getBoss
}; 