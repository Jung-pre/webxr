import * as THREE from 'three';

class FireballEmitter {
  constructor(scene, origin, color = 0xff5500, particleScale = 1) {
    this.scene = scene;
    this.origin = origin.clone();
    this.particles = [];
    this.alive = true;
    this.particleGeometry = new THREE.SphereGeometry(0.02 * particleScale, 4, 4);
    this.particleMaterial = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.7 });
  }

  emit(position) {
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
    this.particles.forEach((p) => {
      this.scene.remove(p.mesh);
    });
    this.particles = [];
    this.finished = true;
  }
}

const fireEmitters = [];
const iceEmitters = [];
const lightningEmitters = [];

function spawnFireParticles(scene, position, fireballId, scale = 1) {
  let emitter = fireEmitters.find(e => e.ballId === fireballId);
  if (!emitter) {
    emitter = new FireballEmitter(scene, position, 0xff5500, scale);
    emitter.ballId = fireballId;
    fireEmitters.push(emitter);
  }
  emitter.emit(position);
}
function spawnIceParticles(scene, position, iceballId, scale = 1) {
  let emitter = iceEmitters.find(e => e.ballId === iceballId);
  if (!emitter) {
    emitter = new FireballEmitter(scene, position, 0x66ccff, scale);
    emitter.ballId = iceballId;
    iceEmitters.push(emitter);
  }
  emitter.emit(position);
}
function spawnLightningParticles(scene, position, lightningballId, scale = 1) {
  let emitter = lightningEmitters.find(e => e.ballId === lightningballId);
  if (!emitter) {
    emitter = new FireballEmitter(scene, position, 0xffff66, scale);
    emitter.ballId = lightningballId;
    lightningEmitters.push(emitter);
  }
  emitter.emit(position);
}

export {
  FireballEmitter,
  fireEmitters, iceEmitters, lightningEmitters,
  spawnFireParticles, spawnIceParticles, spawnLightningParticles
}; 