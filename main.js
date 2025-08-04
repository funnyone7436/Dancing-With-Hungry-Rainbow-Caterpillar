import * as THREE from 'three';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

let scene, camera, renderer, balls = [], audio, spectrum, caterModel;
const NUM_BANDS = 20;
const BASE_Y = 2;
let colorMode = 0.0;
const originalColors = [];
const greenColors = [];

let lastMotionTime = performance.now();
let prevY = null, prevT = null;
const caterMeshes = [];

const canvas = document.createElement('canvas');
canvas.id = 'overlay';
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

async function main() {
  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, 5, 15);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 0);
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dir = new THREE.DirectionalLight(0xffffff, 0.5);
  dir.position.set(5, 5, 5);
  scene.add(dir);

  const greenShades = ['#60ab50', '#256435', '#249f45', '#266632', '#108864', '#249f44', '#0f8964'];
  const geo = new THREE.SphereGeometry(1.1, 18, 18);
  let lastGreenIndex = -1;

  for (let i = 1; i < NUM_BANDS; i++) {
    const originalColor = new THREE.Color().setHSL(i / NUM_BANDS, 0.8, 0.6);
    originalColors.push(originalColor.clone());

    let colorIndex;
    do {
      colorIndex = Math.floor(Math.random() * greenShades.length);
    } while (colorIndex === lastGreenIndex);
    lastGreenIndex = colorIndex;

    const greenColor = new THREE.Color(greenShades[colorIndex]);
    greenColors.push(greenColor.clone());

    const mat = new THREE.MeshStandardMaterial({ color: originalColor });
    const m = new THREE.Mesh(geo, mat);
    m.position.set((i - (NUM_BANDS - 1) / 2) * 1.2 + 5, BASE_Y, -2 * i + 2);
    scene.add(m);
    balls.push(m);
  }

  applyColorMode();

  const gltfLoader = new GLTFLoader();
  gltfLoader.load('obj/caterHead.glb', gltf => {
    caterModel = gltf.scene;
    caterModel.scale.set(4, 4, 4);
    caterModel.rotation.y = -Math.PI / 3 - Math.PI / 8;
    caterModel.position.set((0 - (NUM_BANDS - 1) / 2) * 1.2 + 6.2, BASE_Y, 2);

    caterModel.traverse(child => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone();
        child.material.emissive = child.material.color.clone();
        child.material.emissiveIntensity = 0.5;
        child.material.needsUpdate = true;
        caterMeshes.push(child);
      }
    });

    scene.add(caterModel);
  });

  const resp = await fetch('music/spectrum_20band_time.json');
  spectrum = await resp.json();

  audio = new Audio('music/happymusicKids.mp3');
  audio.loop = true;
  audio.addEventListener('loadedmetadata', () => {
    audio.play().catch(() => {
      document.body.addEventListener('click', () => audio.play(), { once: true });
    });
  });

  animate();
  setupPose();
}

function applyColorMode() {
  const switchIndex = Math.floor(colorMode * balls.length);
  balls.forEach((ball, i) => {
    if (i < switchIndex) {
      ball.material.color.copy(originalColors[i]);
    } else {
      ball.material.color.copy(greenColors[i]);
    }
  });
 // console.log('colorMode =', colorMode.toFixed(2));
}

function animate() {
  requestAnimationFrame(animate);
  const t = audio?.currentTime || 0;
  const sample = spectrum.slice().reverse().find(s => s.t <= t) || spectrum[0];

  if (sample?.bands) {
    sample.bands.forEach((v, i) => {
      if (!isFinite(v)) return;
      const targetJump = THREE.MathUtils.clamp(v * 10, 0, 6);
      const targetY = BASE_Y + targetJump;
      const scale = 1 + targetJump * 0.3 / 1.5;

      if (i === 0 && caterModel) {
        caterModel.position.y += (targetY - caterModel.position.y) * 0.2;
        const baseScale = 1.1;
        const dynamicScale = baseScale + targetJump * 0.3 / 1.5;
        caterModel.scale.setScalar(THREE.MathUtils.lerp(caterModel.scale.x, dynamicScale, 0.2));

        const baseZ = 4;
        const targetZ = baseZ - targetJump * 0.5;
        caterModel.position.z += (targetZ - caterModel.position.z) * 0.1;
      } else if (balls[i - 1]) {
        balls[i - 1].position.y += (targetY - balls[i - 1].position.y) * 0.2;
        balls[i - 1].scale.setScalar(THREE.MathUtils.lerp(balls[i - 1].scale.x, scale, 0.2));
      }
    });
  }

  const targetIntensity = 0.5 + 1.5 * colorMode;
  caterMeshes.forEach(mesh => {
    mesh.material.emissiveIntensity += (targetIntensity - mesh.material.emissiveIntensity) * 0.1;
  });

  renderer.render(scene, camera);
}

function setupPose() {
  const pose = new Pose({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.4/${f}`
  });
  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  pose.onResults(onPoseResults);

  const video = document.createElement('video');
  const cam = new Camera(video, {
    onFrame: async () => await pose.send({ image: video }),
    width: 640,
    height: 480
  });
  cam.start();

  setInterval(() => {
    const now = performance.now();
    if (now - lastMotionTime > 300) {
      colorMode = Math.max(0, colorMode - 0.8);
      applyColorMode();
    }
  }, 100);
}

function onPoseResults(res) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!res.poseLandmarks) return;

  const now = performance.now();
  const ny = res.poseLandmarks[0].y;

  if (prevY !== null) {
    const dt = (now - prevT) / 1000;
    const vy = (ny - prevY) / dt;

    if (Math.abs(vy) > 0.15) {
      const delta = Math.min(Math.abs(vy) * 0.05, 0.05);
      colorMode = Math.min(1, colorMode + delta);
      lastMotionTime = now;
      applyColorMode();
    }
  }

  prevY = ny;
  prevT = now;
}

main();
