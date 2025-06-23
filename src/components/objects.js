import * as THREE from 'three';

function createFireball(position) {
  const geometry = new THREE.SphereGeometry(0.4, 16, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff2200 });
  const fireball = new THREE.Mesh(geometry, material);
  fireball.position.copy(position);
  fireball.castShadow = true;
  return fireball;
}

function createIceball(position) {
  const geometry = new THREE.SphereGeometry(0.4, 16, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x2288ff });
  const iceball = new THREE.Mesh(geometry, material);
  iceball.position.copy(position);
  iceball.castShadow = true;
  return iceball;
}

function createLightningBall(position) {
  const geometry = new THREE.SphereGeometry(0.4, 16, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0xffff66, emissive: 0xffff00 });
  const lightningball = new THREE.Mesh(geometry, material);
  lightningball.position.copy(position);
  lightningball.castShadow = true;
  return lightningball;
}

export { createFireball, createIceball, createLightningBall }; 