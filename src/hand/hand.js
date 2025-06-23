// Mediapipe 및 hand 관련 함수 분리

import * as THREE from 'three';

// === 진짜 전역 배열로 보장 ===
window._jointLabels = window._jointLabels || [[], []];
window._jointLines = window._jointLines || [[], []];

const jointLabels = window._jointLabels;
const jointLines = window._jointLines;

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],      // 엄지
  [0,5],[5,6],[6,7],[7,8],     // 검지
  [0,9],[9,10],[10,11],[11,12],// 중지
  [0,13],[13,14],[14,15],[15,16],// 약지
  [0,17],[17,18],[18,19],[19,20],// 소지
  [5,9],[9,13],[13,17],[5,17]  // 손바닥
];

function createTextSprite(text, color = '#ffff00') {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 64px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#222222';
  ctx.strokeText(text, 64, 64);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 64);
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 8;
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.12, 0.06, 1);
  return sprite;
}

function initHandSpheres(scene) {
  for (let hand = 0; hand < 2; hand++) {
    jointLabels[hand].length = 0;
    jointLines[hand].length = 0;
  }
  for (let hand = 0; hand < 2; hand++) {
    for (let i = 0; i < 21; i++) {
      // 숫자 라벨만 생성
      const label = createTextSprite(i.toString(), hand === 0 ? '#ffff00' : '#00aaff');
      label.visible = false;
      label.scale.set(0.12, 0.06, 1);
      scene && scene.add(label);
      jointLabels[hand].push(label);
    }
    // 연결선(Line)들
    for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
      if (jointLines[hand][c]) {
        scene && scene.remove(jointLines[hand][c]);
      }
      const mat = new THREE.LineBasicMaterial({ color: hand === 0 ? 0xffcc00 : 0x00ffff });
      const points = [new THREE.Vector3(), new THREE.Vector3()];
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geom, mat);
      line.visible = false;
      scene && scene.add(line);
      jointLines[hand][c] = line;
    }
  }
}

function updateHandSpheres(scene, allLandmarks) {
  for (let hand = 0; hand < 2; hand++) {
    const landmarks = allLandmarks[hand];
    if (landmarks) {
      for (let i = 0; i < 21; i++) {
        if (!jointLabels[hand][i]) continue;
        const lm = landmarks[i];
        const ndcX = ((1 - lm.x) - 0.5) * 2;
        const ndcY = -(lm.y - 0.5) * 2;
        const ndcZ = 0.7 - lm.z * 1.5;
        const ndc = new THREE.Vector3(ndcX, ndcY, ndcZ);
        ndc.unproject(scene.camera || scene.userData.camera || scene);
        jointLabels[hand][i].position.copy(ndc);
        jointLabels[hand][i].visible = true;
      }
      for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
        const line = jointLines[hand][c];
        if (!line) continue;
        const [a, b] = HAND_CONNECTIONS[c];
        if (!jointLabels[hand][a] || !jointLabels[hand][b]) continue;
        // 라벨의 위치를 연결선의 양 끝점으로 사용 (jointLabels의 position)
        line.geometry.setFromPoints([
          jointLabels[hand][a].position,
          jointLabels[hand][b].position
        ]);
        line.visible = true;
      }
    } else {
      for (let i = 0; i < 21; i++) {
        if (jointLabels[hand][i]) jointLabels[hand][i].visible = false;
      }
      for (let c = 0; c < jointLines[hand].length; c++) {
        if (jointLines[hand][c]) jointLines[hand][c].visible = false;
      }
    }
  }
}

function hideHandSpheres() {
  for (let hand = 0; hand < 2; hand++) {
    for (let i = 0; i < 21; i++) {
      if (jointLabels[hand][i]) jointLabels[hand][i].visible = false;
    }
    for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
      if (jointLines[hand][c]) jointLines[hand][c].visible = false;
    }
  }
}

function initMediaPipe(onResultsCallback) {
  // ... 기존 코드 복사 ...
}

function detectGesture(landmarks) {
  // ... 기존 코드 복사 ...
}

export {
  initHandSpheres,
  updateHandSpheres,
  hideHandSpheres,
  initMediaPipe,
  detectGesture,
  jointLabels,
  jointLines,
  createTextSprite
}; 