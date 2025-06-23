import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

function setupXR(renderer) {
  document.body.appendChild(VRButton.createButton(renderer));
  renderer.xr.enabled = true;
}

export { setupXR }; 