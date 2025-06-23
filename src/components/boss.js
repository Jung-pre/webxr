import * as THREE from 'three';

const bossState = {
  boss: null,
  bossBox: null,
  bossOriginalMaterials: [],
  bossHitTimer: 0,
  explosionParticles: [],
  damageTexts: [],
  shakeTime: 0,

  triggerBossHitEffect(color = 0xff3333, emissive = 0xff0000) {
    if (!this.boss) return;
    this.boss.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.color.set(color);
        if (child.material.emissive) {
          child.material.emissive.set(emissive);
          child.material.emissiveIntensity = 1.5;
        }
      }
    });
    this.bossHitTimer = 0.2;
  },

  restoreBossMaterial() {
    this.bossOriginalMaterials.forEach(({ mesh, material }) => {
      mesh.material.color.copy(material.color);
      mesh.material.emissive.copy(material.emissive);
      mesh.material.emissiveIntensity = material.emissiveIntensity;
    });
  },

  spawnExplosionParticles(scene, position, color = 0xffee88, emissive = 0xffaa00) {
    for (let i = 0; i < 18; i++) {
      const geom = new THREE.SphereGeometry(0.025, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: color, emissive: emissive, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(position);
      scene.add(mesh);
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.25
      );
      this.explosionParticles.push({ mesh, velocity, life: 0.25 + Math.random() * 0.2 });
    }
  },

  spawnDamageText(scene, position, value = 10) {
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
    this.damageTexts.push({ sprite, time: 0 });
  },

  explodeBoss(scene) {
    if (!this.boss) return;
    const pos = new THREE.Vector3();
    this.boss.getWorldPosition(pos);
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
      this.explosionParticles.push({ mesh, velocity, life: 0.7 + Math.random() * 0.4 });
    }
    scene.remove(this.boss);
    this.boss = null;
    this.bossBox = null;
    this.shakeTime = 0.5;
  }
};

export default bossState; 