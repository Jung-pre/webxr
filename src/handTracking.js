import * as THREE from 'three';

const JOINT_RADIUS = 0.01;
const JOINT_COLOR = 0xffaa00;

let handJoints = [[], []]; // [ [jointMeshes for hand0], [jointMeshes for hand1] ]

export function setupHandTracking(renderer, scene) {
  if (!navigator.xr) {
    console.warn('WebXR not supported');
    return;
  }

  renderer.xr.addEventListener('sessionstart', () => {
    const session = renderer.xr.getSession();
    if (!session) return;

    // Remove old joint meshes if any
    handJoints.forEach(jointArr => {
      jointArr.forEach(mesh => scene.remove(mesh));
    });
    handJoints = [[], []];

    for (let i = 0; i < 2; i++) {
      const hand = renderer.xr.getHand ? renderer.xr.getHand(i) : null;
      if (!hand) continue;
      for (let j = 0; j < 25; j++) {
        const jointMesh = new THREE.Mesh(
          new THREE.SphereGeometry(JOINT_RADIUS, 8, 8),
          new THREE.MeshStandardMaterial({ color: JOINT_COLOR })
        );
        jointMesh.visible = false;
        scene.add(jointMesh);
        handJoints[i].push(jointMesh);
      }
    }
  });

  renderer.setAnimationLoop(() => {
    const session = renderer.xr.getSession();
    if (!session || !session.inputSources) return;
    session.inputSources.forEach((source, handIdx) => {
      if (source.hand) {
        for (let i = 0; i < 25; i++) {
          const joint = source.hand.get(`joint${i}`);
          if (joint && joint.transform) {
            const { position } = joint.transform;
            if (!handJoints[handIdx][i]) continue;
            handJoints[handIdx][i].position.set(position.x, position.y, position.z);
            handJoints[handIdx][i].visible = true;
          } else if (handJoints[handIdx][i]) {
            handJoints[handIdx][i].visible = false;
          }
        }
      } else {
        // Hide all joints if hand not available
        if (handJoints[handIdx]) {
          handJoints[handIdx].forEach(mesh => mesh.visible = false);
        }
      }
    });
  });

  // Feature detection fallback
  if (!window.XRHand) {
    console.warn('WebXR Hand Input API not supported in this browser.');
  }
} 