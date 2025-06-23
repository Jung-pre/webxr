import * as THREE from 'three';

let player;

function createPlayer(scene) {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x55ff55, transparent: true, opacity: 0 });
  player = new THREE.Mesh(geometry, material);
  player.position.set(0, 2, 0);
  player.castShadow = true;
  player.receiveShadow = true;
  scene.add(player);
}

export { createPlayer, player }; 