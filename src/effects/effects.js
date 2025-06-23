import * as THREE from 'three';

class FireballEmitter {
  constructor(scene, origin, color = 0xff5500) {
    this.scene = scene;
    this.origin = origin;
    this.color = color;
    this.particles = [];
    this.active = true;
  }

  emit(position) {
    const geometry = new THREE.SphereGeometry(0.04, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: this.color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.particles.push({ mesh, life: 1.0 });
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.mesh.material.opacity *= 0.92;
      p.life -= 0.04;
      if (p.life <= 0 || p.mesh.material.opacity < 0.05) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  isFinished() {
    return this.particles.length === 0;
  }

  stop() {
    this.active = false;
  }

  dispose() {
    this.particles.forEach(p => this.scene.remove(p.mesh));
    this.particles = [];
  }
}

function createFireball(position) {
  const geometry = new THREE.SphereGeometry(0.12, 24, 24);
  const material = new THREE.MeshStandardMaterial({ color: 0xff4500 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.userData.type = 'fireball';
  return { mesh, velocity: new THREE.Vector3(0, 0, 0), active: true };
}

function createIceball(position) {
  const geometry = new THREE.SphereGeometry(0.12, 24, 24);
  const material = new THREE.MeshStandardMaterial({ color: 0x99e6ff });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.userData.type = 'iceball';
  return { mesh, velocity: new THREE.Vector3(0, 0, 0), active: true };
}

function createLightningBall(position) {
  const geometry = new THREE.SphereGeometry(0.12, 24, 24);
  const material = new THREE.MeshStandardMaterial({ color: 0xffff99 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.userData.type = 'lightningball';
  return { mesh, velocity: new THREE.Vector3(0, 0, 0), active: true };
}

function createAuroraBall(position) {
  const geometry = new THREE.SphereGeometry(0.18, 32, 32);
  const material = new THREE.MeshStandardMaterial({ color: 0x99e6ff, emissive: 0x99e6ff, emissiveIntensity: 2.5 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.userData.type = 'auroraball';
  return { mesh, velocity: new THREE.Vector3(0, 0, 0), active: true };
}

function triggerBlinkTeleport(player, targetPosition) {
  if (!player || !targetPosition) return;
  player.position.copy(targetPosition);

  // Make the player face the boss
  const boss = getBoss();
  if (boss) {
    const bossPosition = new THREE.Vector3();
    boss.getWorldPosition(bossPosition);
    player.lookAt(bossPosition);
  }
}

export {
  FireballEmitter,
  createFireball,
  createIceball,
  createLightningBall,
  createAuroraBall,
  triggerBlinkTeleport
}; 