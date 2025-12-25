import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// connect juggling logic
import {
    applySiteswapString,
    parseSiteswap,
    setLogger,
    startEngine,
    stopEngine,
    setBeatsPerSecond,
    togglePause,
    skipToNextBeat,
    skipToPreviousBeat,
    getUpcomingLandings,
    // live bindings from logic
    balls,
    beatTime,
    pattern,
    patternIndex,
    hand
} from './logic.js';

// Bone animation variables
let currentCharacterModel = null; // Track the currently loaded character
let rightForeArmBone = null;
let leftForeArmBone = null;
let rightShoulderBone = null;
let leftShoulderBone = null;
let rightHandBone = null;
let leftHandBone = null;
let rightHandBase = { x: 0, y: 0, z: 0 };
let leftHandBase = { x: 0, y: 0, z: 0 };

function _shouldSwapSidesByCamera(rightBone, leftBone) {
    try {
        const handArcSegments = [];
        if (!rightBone || !leftBone || !camera) return false;
        const r = new THREE.Vector3();
        const l = new THREE.Vector3();
        rightBone.getWorldPosition(r);
        leftBone.getWorldPosition(l);
        // Project to NDC for reliable screen-side comparison
        const rN = r.clone().project(camera);
        const lN = l.clone().project(camera);
        // In NDC, x < 0 is left of screen, x > 0 is right of screen.
        // If the bone named Right is left of the Left bone, swap.
        return rN.x < lN.x;
    } catch (e) {
        return false;
    }
}

function _forceSwapSidesSetting() {
    try {
        const v = window.localStorage ? localStorage.getItem('forceHandSwap') : null;
        if (!v) return null;
        if (v === '1' || v === 'true') return true;
        if (v === '0' || v === 'false') return false;
        return null;
    } catch { return null; }
}
let rightForeArmBaseZ = 0;
let leftForeArmBaseZ = 0;
let rightShoulderBase = { x: 0, y: 0, z: 0 };
let leftShoulderBase = { x: 0, y: 0, z: 0 };
let rightForeArmBase = { x: 0, y: 0, z: 0 };
let leftForeArmBase = { x: 0, y: 0, z: 0 };

// Offsets from rig's base pose (radians). Default juggling pose with arms positioned for catching/throwing.
const DEFAULT_POSE = {
    // Swapped to match rig so right/left bend correctly
    rightForeArmZ: -Math.PI / 2,   // Z=-90° for right forearm
    leftForeArmZ: Math.PI / 2,     // Z=+90° for left forearm
    foreArmX: Math.PI / 2,        // X=90° for forearm bend
    rightShoulder: { x: Math.PI / 2, y: 0, z: 0 },  // X=90°, no Y rotation
    leftShoulder: { x: Math.PI / 2, y: 0, z: 0 }    // X=90°, no Y rotation
};

// Rotation offsets applied atop the rig base
let rightForeArmRotation = DEFAULT_POSE.rightForeArmZ;  // radians (Z-axis primary for throw/catch)
let leftForeArmRotation = DEFAULT_POSE.leftForeArmZ;   // radians (Z-axis primary for throw/catch)
// Hand rotation at elbow (X, Y, Z axes in radians) - X is bend, Y and Z for throw/catch motion
let rightHandRotX = DEFAULT_POSE.foreArmX;
let rightHandRotY = 0;
let rightHandRotZ = 0;
let leftHandRotX = DEFAULT_POSE.foreArmX;
let leftHandRotY = 0;
let leftHandRotZ = 0;
// Shoulder rotation values (X, Y, Z in radians)
let rightShoulderRotX = DEFAULT_POSE.rightShoulder.x;
let rightShoulderRotY = DEFAULT_POSE.rightShoulder.y;
let rightShoulderRotZ = DEFAULT_POSE.rightShoulder.z;
let leftShoulderRotX = DEFAULT_POSE.leftShoulder.x;
let leftShoulderRotY = DEFAULT_POSE.leftShoulder.y;
let leftShoulderRotZ = DEFAULT_POSE.leftShoulder.z;

// Axis motion toggles for dynamic beat-synced rotation
const motionToggles = {
    shoulder: { x: false, y: false, z: false },  // default: shoulders static
    forearm:  { x: false, y: false, z: false }   // forearms static (dynamic hand targeting handles motion)
};

// Additional fixed Z-axis offsets for forearms (degrees): R=-25°, L=+25°
const FOREARM_Z_EXTRA = {
    right: THREE.MathUtils.degToRad(-25),
    left:  THREE.MathUtils.degToRad(25)
};

// UI slider references so we can sync to defaults
const armSliderRefs = {};

function setArmSliderValue(key, radians) {
    const ref = armSliderRefs[key];
    if (!ref) return;
    
    // Get default value for this key to show offset from default
    let defaultValue = 0;
    if (key === 'rightShoulderRotX') defaultValue = DEFAULT_POSE.rightShoulder.x;
    else if (key === 'rightShoulderRotY') defaultValue = DEFAULT_POSE.rightShoulder.y;
    else if (key === 'rightShoulderRotZ') defaultValue = DEFAULT_POSE.rightShoulder.z;
    else if (key === 'leftShoulderRotX') defaultValue = DEFAULT_POSE.leftShoulder.x;
    else if (key === 'leftShoulderRotY') defaultValue = DEFAULT_POSE.leftShoulder.y;
    else if (key === 'leftShoulderRotZ') defaultValue = DEFAULT_POSE.leftShoulder.z;
    else if (key === 'rightForeArmRotation') defaultValue = DEFAULT_POSE.rightForeArmZ;
    else if (key === 'leftForeArmRotation') defaultValue = DEFAULT_POSE.leftForeArmZ;
    else if (key === 'rightHandRotX' || key === 'leftHandRotX') defaultValue = DEFAULT_POSE.foreArmX;
    
    // Show slider value relative to default (so default pose shows as 0)
    const displayRadians = (radians || 0) - defaultValue;
    const degrees = Math.round(displayRadians * 180 / Math.PI);
    ref.slider.value = degrees;
    ref.input.value = degrees;
    ref.valueDisplay.textContent = `${degrees}°`;
}

function resetArmPoseToDefault(updateUI = true) {
    rightForeArmRotation = DEFAULT_POSE.rightForeArmZ;
    leftForeArmRotation = DEFAULT_POSE.leftForeArmZ;
    // Apply requested additional Z offsets (swapped to match new defaults): Right +25°, Left -25°
    try {
        rightForeArmRotation += THREE.MathUtils.degToRad(25);
        leftForeArmRotation  += THREE.MathUtils.degToRad(-25);
    } catch (e) {}
    rightHandRotX = DEFAULT_POSE.foreArmX;
    rightHandRotY = 0;
    rightHandRotZ = 0;
    leftHandRotX = DEFAULT_POSE.foreArmX;
    leftHandRotY = 0;
    leftHandRotZ = 0;
    rightShoulderRotX = DEFAULT_POSE.rightShoulder.x;
    rightShoulderRotY = DEFAULT_POSE.rightShoulder.y;
    rightShoulderRotZ = DEFAULT_POSE.rightShoulder.z;
    leftShoulderRotX = DEFAULT_POSE.leftShoulder.x;
    leftShoulderRotY = DEFAULT_POSE.leftShoulder.y;
    leftShoulderRotZ = DEFAULT_POSE.leftShoulder.z;

    if (updateUI) {
        setArmSliderValue('rightShoulderRotX', rightShoulderRotX);
        setArmSliderValue('rightShoulderRotY', rightShoulderRotY);
        setArmSliderValue('rightShoulderRotZ', rightShoulderRotZ);
        setArmSliderValue('rightForeArmRotation', rightForeArmRotation);
        setArmSliderValue('rightHandRotX', rightHandRotX);
        setArmSliderValue('rightHandRotY', rightHandRotY);

        setArmSliderValue('leftShoulderRotX', leftShoulderRotX);
        setArmSliderValue('leftShoulderRotY', leftShoulderRotY);
        setArmSliderValue('leftShoulderRotZ', leftShoulderRotZ);
        setArmSliderValue('leftForeArmRotation', leftForeArmRotation);
        setArmSliderValue('leftHandRotX', leftHandRotX);
        setArmSliderValue('leftHandRotY', leftHandRotY);
    }
}

// Scene / camera / renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(5, 3, 0);

// use the canvas already in index.html
const canvas = document.getElementById('threejs-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x222222, 0); // keep background transparent; remove second arg for opaque
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function resizeRendererToDisplaySize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const needResize =
        canvas.width !== Math.floor(width * window.devicePixelRatio) ||
        canvas.height !== Math.floor(height * window.devicePixelRatio);
    if (needResize) {
        renderer.setSize(width, height, false);
    }
    return needResize;
}

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Simple lighting for lines/ball
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);

// Brighter ambient light to ensure everything is visible
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(5, 10, 2);
scene.add(dir);

// Center point light for focused illumination
const centerLight = new THREE.PointLight(0xffffff, 3.0, 10);
centerLight.position.set(0, 2.5, 0);
centerLight.castShadow = true;
scene.add(centerLight);

// Add fill lights to prevent pure black areas
const fillLight1 = new THREE.PointLight(0xffffff, 1.2, 8);
fillLight1.position.set(-2, 1.5, 1);
scene.add(fillLight1);

const fillLight2 = new THREE.PointLight(0xffffff, 1.2, 8);
fillLight2.position.set(2, 1.5, 1);
scene.add(fillLight2);

// Axis helper to show coordinate system (Red=X, Green=Y, Blue=Z)
const axesHelper = new THREE.AxesHelper(100); // 100 unit long
axesHelper.position.set(0, 0, 0); // Position at origin
scene.add(axesHelper);
console.log('Axes Helper added: Red=X, Green=Y, Blue=Z');

// Trajectories loading / drawing
const trajectories = {};
const pathBase = '/trajectories/';

async function loadCurveJSON(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const raw = Array.isArray(data) ? data : data.points;
        return new THREE.CatmullRomCurve3(
            raw.map(p => new THREE.Vector3(p.x, p.y, p.z)),
            false,
            'centripetal'
        );
    } catch (err) {
        console.error('Failed to load curve JSON:', url, err);
        return null;
    }
}

async function loadAllTrajectories() {
    for (let i = 1; i <= 9; i++) {
        const L = `${i}L`;
        const R = `${i}R`;
        const left = await loadCurveJSON(new URL(`${pathBase}${L}.json`, import.meta.url).href);
        const right = await loadCurveJSON(new URL(`${pathBase}${R}.json`, import.meta.url).href);
        if (left) trajectories[L] = left;
        if (right) trajectories[R] = right;
    }
}

function drawCurve(curve, color = 0x00ff00) {
    const pts = curve.getPoints(100);
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geom, mat);
    scene.add(line);
    trajectoryLines.push(line);
}

// Debug arc visuals
let handArcLines = [];
let carryArcLines = [];
let leadArcLines = [];
let allPossibleCarryArcs = [];

function drawHandArc(startPoint, endPoint, height, color = 0x22ccff) {
    const points = [];
    const steps = 50;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const eased = (t < 0.5) ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
        const lift = 4 * t * (1 - t);
        const pos = new THREE.Vector3().lerpVectors(startPoint, endPoint, eased);
        pos.y += height * lift;
        points.push(pos);
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    const line = new THREE.Line(geom, mat);
    scene.add(line);
    handArcLines.push(line);
}

function drawCarryArc(startPoint, endPoint, dipDepth, color = 0xffaa00) {
    const points = [];
    const steps = 50;
    for (let i = 0; i <= steps; i++) {
        const progress = i / steps;
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const arcFactor = Math.sin(progress * Math.PI);
        const pos = new THREE.Vector3().lerpVectors(startPoint, endPoint, eased);
        pos.y += dipDepth * arcFactor;
        points.push(pos);
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    const line = new THREE.Line(geom, mat);
    scene.add(line);
    carryArcLines.push(line);
}

function clearHandArcLines() {
    for (const line of handArcLines) {
        scene.remove(line);
        line.geometry?.dispose();
        line.material?.dispose();
    }
    handArcLines = [];
}

function clearCarryArcLines() {
    for (const line of carryArcLines) {
        scene.remove(line);
        line.geometry?.dispose();
        line.material?.dispose();
    }
    carryArcLines = [];
}

function drawLeadArc(startPoint, endPoint, height, color = 0xff00ff) {
    const points = [];
    const steps = 50;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const eased = (t < 0.5) ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
        const lift = 4 * t * (1 - t);
        const pos = new THREE.Vector3().lerpVectors(startPoint, endPoint, eased);
        pos.y += height * lift;
        points.push(pos);
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    const line = new THREE.Line(geom, mat);
    scene.add(line);
    leadArcLines.push(line);
}

function clearLeadArcLines() {
    for (const line of leadArcLines) {
        scene.remove(line);
        line.geometry?.dispose();
        line.material?.dispose();
    }
    leadArcLines = [];
}

function clearAllPossibleCarryArcs() {
    for (const line of allPossibleCarryArcs) {
        scene.remove(line);
        line.geometry?.dispose();
        line.material?.dispose();
    }
    allPossibleCarryArcs = [];
}

// Draw all possible carry arcs based on pattern logic
function drawAllPossibleCarryArcs() {
    clearAllPossibleCarryArcs();
    
    if (!pattern || pattern.length === 0 || Object.keys(trajectories).length === 0) return;
    
    const basePos = [_getStaticHandPos(0), _getStaticHandPos(1)];
    const drawnArcs = new Set(); // avoid duplicates
    
    // For each beat in the pattern
    for (let beat = 0; beat < pattern.length * 2; beat++) {
        const patternIdx = beat % pattern.length;
        const throwValue = pattern[patternIdx];
        
        if (throwValue === 0 || throwValue === 2) continue; // skip zeros and holds
        
        // Determine throwing hand for this beat
        const throwingHand = beat % 2; // 0=R, 1=L
        const throwKey = `${throwValue}${throwingHand === 0 ? 'R' : 'L'}`;
        const throwCurve = trajectories[throwKey];
        
        if (!throwCurve) continue;
        
        // Find throw and catch points on this trajectory
        const p0 = throwCurve.getPoint(0);
        const p1 = throwCurve.getPoint(1);
        const throwBase = basePos[throwingHand];
        const throwPoint = (p0.distanceToSquared(throwBase) <= p1.distanceToSquared(throwBase)) ? p0 : p1;
        const catchPoint = throwPoint === p0 ? p1 : p0;
        
        // Determine catching hand (same if even, opposite if odd)
        const catchingHand = (throwValue % 2 === 0) ? throwingHand : (1 - throwingHand);
        
        // Find the landing beat
        const landBeat = beat + throwValue;
        
        // Find what the catching hand will throw next
        // Search forward from landing beat for next throw by catching hand
        let nextThrowBeat = -1;
        let nextThrowValue = -1;
        for (let searchOffset = 0; searchOffset < pattern.length * 2; searchOffset++) {
            const searchBeat = landBeat + searchOffset;
            const searchPatternIdx = searchBeat % pattern.length;
            const searchThrowingHand = searchBeat % 2;
            
            if (searchThrowingHand === catchingHand) {
                const val = pattern[searchPatternIdx];
                if (val !== 0 && val !== 2) {
                    nextThrowBeat = searchBeat;
                    nextThrowValue = val;
                    break;
                }
            }
        }
        
        if (nextThrowValue === -1) continue;
        
        // Get the next trajectory
        const nextThrowKey = `${nextThrowValue}${catchingHand === 0 ? 'R' : 'L'}`;
        const nextThrowCurve = trajectories[nextThrowKey];
        
        if (!nextThrowCurve) continue;
        
        // Find start point of next trajectory (closest to catching hand)
        const np0 = nextThrowCurve.getPoint(0);
        const np1 = nextThrowCurve.getPoint(1);
        const nextThrowBase = basePos[catchingHand];
        const nextThrowPoint = (np0.distanceToSquared(nextThrowBase) <= np1.distanceToSquared(nextThrowBase)) ? np0 : np1;
        
        // Create unique key for this arc
        const arcKey = `${catchPoint.x.toFixed(3)},${catchPoint.y.toFixed(3)},${catchPoint.z.toFixed(3)}->${nextThrowPoint.x.toFixed(3)},${nextThrowPoint.y.toFixed(3)},${nextThrowPoint.z.toFixed(3)}`;
        
        if (drawnArcs.has(arcKey)) continue;
        drawnArcs.add(arcKey);
        
        // Draw the carry arc (U-shaped, downward dip)
        const dipDepth = -0.1;
        const color = catchingHand === 0 ? 0xff6600 : 0x00ff66; // orange for right, green for left
        
        const points = [];
        const steps = 30;
        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            const arcFactor = Math.sin(progress * Math.PI);
            const pos = new THREE.Vector3().lerpVectors(catchPoint, nextThrowPoint, eased);
            pos.y += dipDepth * arcFactor;
            points.push(pos);
        }
        
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color, linewidth: 1, transparent: true, opacity: 0.6 });
        const line = new THREE.Line(geom, mat);
        scene.add(line);
        allPossibleCarryArcs.push(line);
    }
    
    console.log(`Drew ${allPossibleCarryArcs.length} possible carry arcs based on pattern`);
}

// Fit camera to all trajectory points
function computeTrajectoriesBounds(trajectories) {
    const box = new THREE.Box3();
    const pts = [];
    for (const key of Object.keys(trajectories)) {
        const curve = trajectories[key];
        if (!curve) continue;
        pts.push(...curve.getPoints(200));
    }
    if (pts.length === 0) return null;
    box.setFromPoints(pts);
    return box;
}

function fitCameraToBox(box, camera, controls, offsetFactor = 1.2) {
    if (!box) return;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const radius = sphere.radius;

    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = camera.aspect;

    const distanceV = radius / Math.sin(fov / 2);
    const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const distanceH = radius / Math.sin(horizontalFov / 2);
    const requiredDistance = Math.max(distanceV, distanceH) * offsetFactor;

    const dir = camera.position.clone().sub(center);
    if (dir.lengthSq() < 1e-6) dir.set(1, 1, 1);
    dir.normalize();

    camera.position.copy(center).add(dir.multiplyScalar(requiredDistance));
    camera.lookAt(center);

    if (controls) {
        controls.target.copy(center);
        controls.update();
    }
}

// Ball visuals
const ballMeshes = new Map();
const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xff4444, metalness: 0.3, roughness: 0.6 });
const ballGeo = new THREE.SphereGeometry(0.04, 12, 12);

let sceneCenter = new THREE.Vector3(0, 2, 0);
const handOffset = 0.22;
const _getStaticHandPos = (h) => (h === 0
    ? sceneCenter.clone().add(new THREE.Vector3(-handOffset, -0.02, 0))
    : sceneCenter.clone().add(new THREE.Vector3(handOffset, -0.02, 0)));

// Dynamic hand positions updated each frame for catch-follow behavior
let dynamicHandPos = [_getStaticHandPos(0), _getStaticHandPos(1)];
const getHandBasePos = (h) => {
    const idx = (h === 0) ? 0 : 1;
    const p = dynamicHandPos && dynamicHandPos[idx];
    return (p ? p.clone() : _getStaticHandPos(idx));
};

function createBallMeshes() {
    // remove meshes that are not present in logic.balls
    const ids = new Set(balls.map(b => b.id));
    for (const [id, mesh] of ballMeshes) {
        if (!ids.has(id)) {
            scene.remove(mesh);
            ballMeshes.delete(id);
        }
    }
    // add missing meshes
    for (const b of balls) {
        if (!ballMeshes.has(b.id)) {
            const m = new THREE.Mesh(ballGeo, ballMaterial.clone());
            // slight color variation by id
            m.material.color.offsetHSL(0, 0, (b.id % 3) * 0.06);
            // store the material color as the "initial" color (hex)
            m.userData.initialColor = m.material.color.getHex();
            // make balls participate in scene lighting/shadows (if enabled)
            m.castShadow = true;
            m.receiveShadow = true;

            m.position.copy(sceneCenter).add(new THREE.Vector3((b.id - 1) * 0.08, 0, 0));
            scene.add(m);
            ballMeshes.set(b.id, m);
        }
    }

    // update UI showing prop count whenever meshes are (re)created
    updatePropCountUI();
}

function updateBallVisuals() {
    // ensure meshes exist
    if (balls.length !== ballMeshes.size) createBallMeshes();

    // clear arc visuals each frame
    clearCarryArcLines();
    clearLeadArcLines();

    // clear carry arc visuals each frame
    clearCarryArcLines();

    const currentBeat = beatTime; // live binding from logic.js

    // Update dynamic hand targets so hands travel along upper arcs toward the next catch when not carrying
    recomputeHandTargets(currentBeat);

    // Visualize lead arcs: from this hand's next throw start to the catch point of the next incoming ball to this hand
    const landings = getUpcomingLandings();
    const minHeight = 0.12;
    const maxHeight = 0.45;
    const leadScale = 0.6;
    const basePos = [getHandBasePos(0), getHandBasePos(1)];
    for (const handIdx of [0, 1]) {
        const nextThrow = findNextThrowForHandGlobal(currentBeat, handIdx);
        const startPoint = nextThrow && nextThrow.startEndpoint ? nextThrow.startEndpoint.clone() : basePos[handIdx].clone();

        // Next incoming landing that this hand will catch (earliest landing for this hand after now)
        let landing = null;
        if (Array.isArray(landings)) {
            landing = landings.find(l => l && l.catchingHandNum === handIdx) || null;
        }
        if (!landing) continue;

        const curve = trajectories[landing.curveName];
        if (!curve) continue;
        const p0 = curve.getPoint(0);
        const p1 = curve.getPoint(1);
        
        // Determine throwing hand from curveName suffix (e.g., "8R" = right hand throws)
        const curveSuffix = (landing.curveName || '').slice(-1);
        const throwingHandForLanding = curveSuffix === 'R' ? 0 : curveSuffix === 'L' ? 1
            : ((Math.floor(landing.landBeat - landing.throwValue) % 2 === 0) ? 0 : 1);
        const throwBaseForLanding = throwingHandForLanding === 0 ? basePos[0] : basePos[1];
        
        // Start of trajectory is closest to throwing hand, end is the catch point
        const throwPointForLanding = (p0.distanceToSquared(throwBaseForLanding) <= p1.distanceToSquared(throwBaseForLanding)) ? p0.clone() : p1.clone();
        const endPoint = throwPointForLanding.equals(p0) ? p1.clone() : p0.clone();

        const dist = startPoint.distanceTo(endPoint);
        const height = THREE.MathUtils.clamp(dist * leadScale, minHeight, maxHeight);
        const color = handIdx === 0 ? 0xaa66ff : 0xff66cc;
        drawLeadArc(startPoint, endPoint, height, color);
    }

    // approximate hand positions relative to scene center
    const rightHandPos = getHandBasePos(0);
    const leftHandPos  = getHandBasePos(1);
    const getHandPos = h => (h === 0 ? rightHandPos.clone() : leftHandPos.clone());

    // find the next actual throw beat (absolute beat number) for the given hand,
    // starting search from a given absolute beat (or from next beat if omitted).
    // Returns an object { beat, value, curve, startEndpoint } where startEndpoint is the curve point
    // closest to the hand (t=0 or t=1).
    function findNextThrowForHand(fromBeatAbs, handIndex) {
        if (!pattern || pattern.length === 0) return null;
        const n = pattern.length;
        const startBeat = Math.max(Math.ceil(fromBeatAbs), Math.floor(fromBeatAbs));
        const maxLookBeats = n * 6; // search several cycles ahead
        const handPos = getHandPos(handIndex);

        for (let offset = 0; offset <= maxLookBeats; offset++) {
            const beat = startBeat + offset;
            const patternIdx = ((beat % n) + n) % n;
            const v = pattern[patternIdx];
            const throwingHand = (beat % 2 === 0) ? 0 : 1;
            if (throwingHand !== handIndex) continue;
            // a hold (2) is not a throw; skip as a "target throw" but it's relevant: if next non-hold doesn't exist pick hold's hand pos
            if (v === 2) {
                // still consider that the hand will hold here; continue searching for the next non-hold
                continue; 
            }
            const key = `${v}${handIndex === 0 ? 'R' : 'L'}`;
            const curve = trajectories[key];
            if (!curve) continue;
// pick endpoint nearer to the hand as the "start"
            const p0 = curve.getPoint(0);
            const p1 = curve.getPoint(1);
            const d0 = p0.distanceToSquared(handPos);
            const d1 = p1.distanceToSquared(handPos);
            const chosen = (d0 <= d1 ? p0.clone() : p1.clone());
            chosen.y += 0.02;
            return { beat, value: v, curve, startEndpoint: chosen };
        }

        // fallback: no non-hold trajectory found — return hand position
        return { beat: startBeat, value: 2, curve: null, startEndpoint: handPos.clone() };
    }

    // use next throw search from current beat
    const nextForRight = findNextThrowForHand(currentBeat, 0);
    const nextForLeft = findNextThrowForHand(currentBeat, 1);

    for (const b of balls) {
        const mesh = ballMeshes.get(b.id);
        if (!mesh) continue;

        // -------- IN FLIGHT --------
        if (b.flight) {
            const f = b.flight;
            // Mark that ball is in flight (for transition detection)
            b._wasInFlight = true;
            
            // prefer explicit curveName; fallback to value+hand heuristic
                        const curve = (f.curveName && trajectories[f.curveName]) ? trajectories[f.curveName] : (trajectories[`${f.value}${((f.startBeat % 2 === 0) ? 'R' : 'L')}`] || null);
            const start = f.startBeat;
            const end = f.actualLandBeat;
            const duration = Math.max(0.0001, end - start);
            let t = (currentBeat - start) / duration;
            t = Math.min(Math.max(t, 0), 1);

            const throwingHand = (Math.floor(start) % 2 === 0) ? 0 : 1;
            const throwingHandPos = getHandPos(throwingHand);

                        if (f.value === 2 || !curve) {
                // hold: snap/lerp to the start endpoint of the next non-hold trajectory for that hand
                const next = (throwingHand === 0 ? nextForRight : nextForLeft);
                const target = (next && next.startEndpoint) ? next.startEndpoint : throwingHandPos;
                mesh.position.lerp(target, 0.6);
// record for idle usage
                b._lastFlightValue = f.value;
                b._lastFlightHand = throwingHand;
                b._lastFlightStartBeat = start;
                b._lastFlightIntendedLandBeat = f.intendedLandBeat; // Store intended landing beat
            } else {
                // decide traversal direction using throwing hand proximity
                if (!b._flightProcessed) {
                    b._flightProcessed = true;
b._flightReversed = false;
                    try {
                        const p0 = curve.getPoint(0);
                        const p1 = curve.getPoint(1);
                        const d0 = p0.distanceToSquared(throwingHandPos);
                        const d1 = p1.distanceToSquared(throwingHandPos);
                        b._flightReversed = (d1 < d0);
                    } catch (e) {
                        b._flightReversed = false;
                    }
                }
                const tt = b._flightReversed ? (1 - t) : t;
                const p = curve.getPoint(tt);
                mesh.position.copy(p);

            b._lastFlightValue = f.value;
            b._lastFlightHand = throwingHand;
            b._lastFlightStartBeat = start;
            b._lastFlightIntendedLandBeat = f.intendedLandBeat; // Store intended landing beat
            }
        }

        // -------- IDLE / NOT IN FLIGHT (CARRY PHASE) --------
        else {
            // clear per-flight flags
            delete b._flightProcessed;
            delete b._flightReversed;

            // Initialize carry phase ONLY when transitioning from flight to idle
            if (b._wasInFlight && !b._carryInProgress) {
                // Ball just landed - start carry phase
                b._carryStart = currentBeat;
                b._carryStartPos = mesh.position.clone();
                b._carryInProgress = true;
                b._wasInFlight = false;
                
                // Determine the catching hand based on the intended landing beat
                // The hand that catches is determined by which beat the ball lands on
                let catchingHand;
                let nextThrowBeat;
                // Prefer curveName suffix (R/L) to identify throwing hand, then calculate catching hand
                if (b.flight && typeof b.flight.curveName === 'string' && /[RL]$/.test(b.flight.curveName)) {
                    const throwingHand = b.flight.curveName.endsWith('R') ? 0 : 1;
                    const throwValue = b._lastFlightValue || 0;
                    nextThrowBeat = Math.floor(b._lastFlightStartBeat || currentBeat) + throwValue;
                    // Catching hand: same as throwing hand if even value, opposite if odd
                    catchingHand = (throwValue % 2 === 0) ? throwingHand : (1 - throwingHand);
                } else if (typeof b._lastFlightIntendedLandBeat === 'number') {
                    // Catching hand is determined by intended landing beat (beat % 2)
                    // Beat 0, 2, 4... = right hand (0), Beat 1, 3, 5... = left hand (1)
                    nextThrowBeat = Math.floor(b._lastFlightIntendedLandBeat);
                    catchingHand = nextThrowBeat % 2;
                } else if (typeof b._lastFlightHand === 'number' && typeof b._lastFlightValue === 'number') {
                    // Fallback: calculate from throw hand + value
                    const throwHand = b._lastFlightHand;
                    const throwValue = b._lastFlightValue;
                    nextThrowBeat = Math.floor(b._lastFlightStartBeat) + throwValue;
                    catchingHand = (throwValue % 2 === 0) ? throwHand : (1 - throwHand);
                } else {
                    catchingHand = typeof b.inHand === 'number' ? b.inHand : hand;
                    nextThrowBeat = Math.floor(currentBeat);
                }
                
                // Find the trajectory that THIS ball will travel next
                // Look at the pattern to see what value will be thrown at nextThrowBeat
                let targetPos = getHandPos(catchingHand);
                if (pattern && pattern.length > 0 && typeof nextThrowBeat === 'number') {
                    const patternIdx = ((nextThrowBeat % pattern.length) + pattern.length) % pattern.length;
                    const nextThrowValue = pattern[patternIdx];
                    // Use the catching hand (which will throw next) instead of beat parity
                    const throwHand = catchingHand;
                    
                    // Get the trajectory for this throw
                    const trajectoryKey = `${nextThrowValue}${throwHand === 0 ? 'R' : 'L'}`;
                    const nextCurve = trajectories[trajectoryKey];
                    
                    if (nextCurve) {
                        // Find which end of the trajectory is the start (closer to throwing hand)
                        const throwHandPos = getHandPos(throwHand);
                        try {
                            const p0 = nextCurve.getPoint(0);
                            const p1 = nextCurve.getPoint(1);
                            const d0 = p0.distanceToSquared(throwHandPos);
                            const d1 = p1.distanceToSquared(throwHandPos);
                            targetPos = (d0 <= d1 ? p0.clone() : p1.clone());
                        } catch (e) {
                            targetPos = getHandPos(catchingHand);
                        }
                    }
                }
                
                b._carryEndPos = targetPos;
                b._carryHand = catchingHand;
            }
            
            // If carry is in progress, animate it
            if (b._carryInProgress && b._carryStartPos && b._carryEndPos) {
                // Calculate carry progress (0 to 1)
                // Longer duration = ball arrives closer to throw time = less waiting
                const carryDuration = 0.65; // duration in beats (almost full beat cycle)
                const elapsed = currentBeat - b._carryStart;
                const progress = Math.min(Math.max(elapsed / carryDuration, 0), 1);
                
                // Smooth easing (ease-in-out for smooth motion)
                const eased = progress < 0.5 
                    ? 2 * progress * progress 
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                
                // Create downward parabolic arc (U-shape)
                // Ball dips down in the middle of the path
                const dipDepth = -0.1; // negative = downward dip
                const arcFactor = Math.sin(progress * Math.PI); // 0 → 1 → 0

                // Draw lower arc visual
                drawCarryArc(b._carryStartPos, b._carryEndPos, dipDepth);
                
                // Interpolate base position
                const basePos = new THREE.Vector3().lerpVectors(
                    b._carryStartPos, 
                    b._carryEndPos, 
                    eased
                );
                
                // Add downward arc (U-shape)
                basePos.y += dipDepth * arcFactor;
                
                // Apply position
                mesh.position.copy(basePos);
                
                // When carry is complete, finish carry phase
                if (progress >= 1) {
                    mesh.position.copy(b._carryEndPos);
                    b._carryInProgress = false;
                }
            } else if (!b._carryInProgress) {
                // No carry in progress, keep moving slowly toward next throw position
                const targetHand = (typeof b._carryHand === 'number') ? b._carryHand : 
                                  (typeof b._lastFlightHand === 'number' ? b._lastFlightHand : hand);
                const next = (targetHand === 0 ? nextForRight : nextForLeft);
                const target = (next && next.startEndpoint) ? next.startEndpoint : getHandPos(targetHand);
                // Continue slow drift to reduce waiting appearance
                mesh.position.lerp(target, 0.15);
            }
        }
    }
}

// Determine hand targets for catches: hands move toward trajectory endpoints, arriving slightly before landing.
function recomputeHandTargets(currentBeat) {
    if (typeof THREE === 'undefined') {
        dynamicHandPos = [_getStaticHandPos(0), _getStaticHandPos(1)];
        return;
    }

    const base0 = _getStaticHandPos(0);
    const base1 = _getStaticHandPos(1);
    const result = [base0.clone(), base1.clone()];

    try {
        // 1) Identify current carrying ball per hand (if any)
        const carryByHand = { 0: null, 1: null };
        for (const b of balls) {
            if (b && b._carryInProgress && typeof b._carryHand === 'number') {
                const mesh = ballMeshes.get(b.id);
                if (mesh && carryByHand[b._carryHand] == null) {
                    carryByHand[b._carryHand] = mesh;
                }
            }
        }

        // 2) Get upcoming landings so we know where the next lower-arc starts
        const landings = getUpcomingLandings();
        const nextLanding = { 0: null, 1: null };
        for (const landing of landings) {
            const handNum = landing.catchingHandNum;
            if (!nextLanding[handNum]) nextLanding[handNum] = landing;
        }

        // Parameters
const arriveLead = 0.05;     // arrive slightly before landing
const height = 0.12;         // arc lift

for (const handIdx of [0, 1]) {
  if (carryByHand[handIdx]) {
    // Follow carried ball slightly under it
    result[handIdx].copy(carryByHand[handIdx].position);
    result[handIdx].y -= 0.02;
    continue;
  }

  // Find next landing for this hand
  const landing = nextLanding[handIdx];
  if (!landing) {
    // fallback to base
    result[handIdx].copy(handIdx === 0 ? base0 : base1);
    continue;
  }

  const curve = trajectories[landing.curveName];
  if (!curve) {
    result[handIdx].copy(handIdx === 0 ? base0 : base1);
    continue;
  }

    // Determine throw and catch points based on curveName suffix
  const p0 = curve.getPoint(0);
  const p1 = curve.getPoint(1);
  // Extract throwing hand from curveName (e.g., "8R" = right hand throws)
  const curveSuffix = (landing.curveName || '').slice(-1);
  const throwingHand = curveSuffix === 'R' ? 0 : curveSuffix === 'L' ? 1
      : ((Math.floor(landing.landBeat - landing.throwValue) % 2 === 0) ? 0 : 1);
  const throwBase = (throwingHand === 0 ? base0 : base1);
  
  // Start of trajectory is closest to throwing hand, end is the catch point
  const throwPoint = (p0.distanceToSquared(throwBase) <= p1.distanceToSquared(throwBase)) ? p0.clone() : p1.clone();
  const catchPoint = (throwPoint.equals(p0)) ? p1.clone() : p0.clone();
  handArcSegments.push({ start: catchPoint.clone(), end: throwPoint.clone(), height, handIdx });

  // Timing
  const throwBeat = landing.landBeat - landing.throwValue;
  const arrivalBeat = landing.landBeat - arriveLead;
  const duration = Math.max(0.02, arrivalBeat - throwBeat);
  const t = THREE.MathUtils.clamp((currentBeat - throwBeat) / duration, 0, 1);

  // Shape
  const eased = (t < 0.5) ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
  const lift = 4 * t * (1 - t); // parabola: 0 → 1 → 0

    // Position along positive arc, reversed (start from other end)
    const pos = new THREE.Vector3().lerpVectors(catchPoint, throwPoint, eased);
  pos.y += height * lift;

    result[handIdx].copy(pos);
}
                // publish positions
                dynamicHandPos = [result[0].clone(), result[1].clone()];
                // visualize hand arcs
        clearHandArcLines();
        for (const seg of handArcSegments) {
            const color = seg.handIdx === 0 ? 0x22ccff : 0x33ff66;
            drawHandArc(seg.start, seg.end, seg.height, color);
        }
    } catch (e) {
        console.warn('recomputeHandTargets failed, using static hands', e);
        dynamicHandPos = [base0.clone(), base1.clone()];
    }
}

// Global helper to find the next throw start for a given hand from an absolute beat
function findNextThrowForHandGlobal(fromBeatAbs, handIndex) {
    if (!pattern || pattern.length === 0) return null;
    const n = pattern.length;
    const startBeat = Math.max(Math.ceil(fromBeatAbs), Math.floor(fromBeatAbs));
    const maxLookBeats = n * 6;
    const handPos = getHandBasePos(handIndex);

    for (let offset = 0; offset <= maxLookBeats; offset++) {
        const beat = startBeat + offset;
        const patternIdx = ((beat % n) + n) % n;
        const v = pattern[patternIdx];
        const throwingHand = (beat % 2 === 0) ? 0 : 1;
        if (throwingHand !== handIndex) continue;
        if (v === 2) continue;
        const key = `${v}${handIndex === 0 ? 'R' : 'L'}`;
        const curve = trajectories[key];
        if (!curve) continue;
        const p0 = curve.getPoint(0);
        const p1 = curve.getPoint(1);
        const d0 = p0.distanceToSquared(handPos);
        const d1 = p1.distanceToSquared(handPos);
        const chosen = (d0 <= d1 ? p0.clone() : p1.clone());
        chosen.y += 0.02;
        return { beat, value: v, curve, startEndpoint: chosen };
    }

    return { beat: startBeat, value: 2, curve: null, startEndpoint: handPos.clone() };
}

// UI wiring: Random / Save / Reset buttons, speed slider
function wireUI() {
    // siteswap input: do NOT create an Apply button (removed per request)
    const input = document.querySelector('.siteswapinput');

    // keep track of last invalid time so the red fill persists at least 500ms
    let _lastInvalidTs = 0;
    let _removeTimer = null;

    // helper: visually mark input invalid/valid
    function markInputInvalid(isInvalid, message) {
        if (!input) return;

        // clear any pending removal timer so we don't remove too early
        if (_removeTimer) { clearTimeout(_removeTimer); _removeTimer = null; }

        if (isInvalid) {
            _lastInvalidTs = Date.now();
            input.style.border = '2px solid #b71c1c';
            input.style.background = '#ffebee';       // fill whole rectangle red/pinkish
            input.style.color = '#000';
            input.style.boxShadow = '0 0 12px rgba(183,28,28,0.18)';
            input.setAttribute('aria-invalid', 'true');
            input.title = message || 'Invalid siteswap';
            // ensure visible transition
            input.style.transition = 'background 160ms ease, box-shadow 160ms ease, border 160ms ease';
        } else {
            const elapsed = Date.now() - (_lastInvalidTs || 0);
            const minMs = 500;
            if (elapsed < minMs) {
                // schedule removal so red fill lasts at least 500ms total
                _removeTimer = setTimeout(() => {
                    input.style.border = '';
                    input.style.background = '';
                    input.style.color = '';
                    input.style.boxShadow = '';
                    input.removeAttribute('aria-invalid');
                    input.title = '';
                    _removeTimer = null;
                }, minMs - elapsed);
            } else {
                // remove immediately
                input.style.border = '';
                input.style.background = '';
                input.style.color = '';
                input.style.boxShadow = '';
                input.removeAttribute('aria-invalid');
                input.title = '';
            }
        }
    }

    // validate current input value using parseSiteswap; returns boolean
    function validateInput() {
        if (!input) return true;
        const s = input.value.trim();
        if (s.length === 0) {
            markInputInvalid(false);
            return true;
        }
        try {
            const res = parseSiteswap(s);
            if (!res.valid) {
                markInputInvalid(true, res.error);
                return false;
            } else {
                markInputInvalid(false);
                return true;
            }
        } catch (e) {
            markInputInvalid(true, String(e));
            return false;
        }
    }

    // live validation while user types
    if (input) {
        input.addEventListener('input', validateInput);
        input.addEventListener('blur', validateInput);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                // trigger Save (Apply) if present and valid
                e.preventDefault();
                if (validateInput()) {
                    const saveBtn = Array.from(document.querySelectorAll('.btn.secondary, .SaveBtn')).find(el => /save/i.test(el.textContent));
                    if (saveBtn) saveBtn.click();
                } else {
                    input.focus();
                }
            }
        });
    }

    // Random button + max-throw slider (no 1/2 in generated notation)
    const rnd = document.querySelector('.btn') || document.querySelector('#RandomButton') || document.querySelector('.RandomButton');
    if (rnd) {
  const parent = rnd.parentElement || document.body;
  const randControls = document.createElement('div');
  randControls.style.cssText = 'display:inline-flex;gap:8px;align-items:center;margin-left:8px;font-size:12px';
  const label = document.createElement('label');
  label.textContent = 'Max Throw:';
  const range = document.createElement('input');
  range.type = 'range';
  range.id = 'randMaxThrow';
  range.min = '5';   
  range.max = '9';
  range.step = '1';
  range.value = '9';
  range.style.width = '120px';
  const val = document.createElement('span');
  val.id = 'randMaxThrowValue';
  val.textContent = range.value;
  range.addEventListener('input', () => { val.textContent = range.value; });
  randControls.appendChild(label);
  randControls.appendChild(range);
  randControls.appendChild(val);
  try { parent.insertBefore(randControls, rnd.nextSibling); } catch (e) { document.body.appendChild(randControls); }

  // generate candidate using throws only from 3..maxThrow (no 1 or 2)
  function generateRandomSiteswap(minLen = 3, maxLen = 7, maxThrow = 9) {
    maxThrow = Math.max(3, Math.floor(maxThrow));
    const len = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
    // weight smaller throws higher
    const weights = [];
    for (let v = 3; v <= maxThrow; v++) weights.push(1 / v);
    const total = weights.reduce((a, b) => a + b, 0);
    const pickThrow = () => {
      let r = Math.random() * total;
      for (let i = 0, v = 3; v <= maxThrow; v++, i++) {
        if (r < weights[i]) return v;
        r -= weights[i];
      }
      return maxThrow;
    };
    let s = '';
    for (let i = 0; i < len; i++) s += String(pickThrow());
    return s;
  }

  rnd.addEventListener('click', () => {
    const maxAttempts = 200;
    let accepted = null;
    const maxThrow = Math.max(3, Math.min(36, Number(document.getElementById('randMaxThrow')?.value || 9)));

    for (let i = 0; i < maxAttempts; i++) {
      const cand = generateRandomSiteswap(3, 7, maxThrow);
      if (input) input.value = cand;
      markInputInvalid(false);
      try {
        const ok = applySiteswapString(cand);
        if (ok) { accepted = cand; createBallMeshes(); console.log('Random siteswap accepted:', cand); break; }
      } catch (e) {
        // ignore and retry
      }
    }

    if (!accepted) {
      const fallback = ['333', '555', '777'][Math.floor(Math.random() * 3)]; // no 1/2
      if (input) input.value = fallback;
      markInputInvalid(false);
      try { applySiteswapString(fallback); createBallMeshes(); } catch (e) { console.warn('Fallback apply failed', e); }
      console.warn('Random generator failed to produce a working pattern; used fallback:', fallback);
    }
  });
}

    // Reset: revert to default '441'
    const reset = document.querySelector('.btn.secondary') || document.querySelector('.ResetBtn');
    if (reset) {
        reset.addEventListener('click', () => {
            // reset camera + visibility (do NOT change materials)
            resetSceneToInitial();

            // reset camera to the default Front view
            setCameraFront();

            // refresh the Prop Settings UI but DO NOT apply colors back to meshes
            try { renderPropSettingsUI(false); } catch (e) {}

            console.log('Reset: restored balls (visibility) and camera to default front view (materials preserved).');
        });
    }

    // Save button now acts as Apply (and also saves)
    const save = Array.from(document.querySelectorAll('.btn.secondary, .SaveBtn')).find(el => /save/i.test(el.textContent));
    if (save) {
        save.addEventListener('click', () => {
            if (!validateInput()) {
                // keep focus on input so user can fix it
                if (input) input.focus();
                console.log('Attempted to apply invalid siteswap');
                return;
            }
            const s = (input && input.value.trim()) || '';
            if (!s) return;
            const ok = applySiteswapString(s);
            if (ok) {
                localStorage.setItem('siteswap_saved', s);
                createBallMeshes();
                console.log('Siteswap applied and saved:', s);
            } else {
                // applySiteswapString may fail dwell-aware check — mark invalid and show message
                markInputInvalid(true, 'Rejected by engine (dwell/conflict)');
                console.log('Siteswap apply failed');
            }
        });
    }

    // Speed slider
    const speed = document.getElementById('speed') || document.querySelector('.speed-slider');
    const speedValue = document.getElementById('speedValue');
    if (speed) {
        // enforce fine-grained slider range for low speeds
        try {
            speed.min = '0.01';
            speed.max = '2';
            speed.step = '0.01';
        } catch (e) {}

        const applySpeed = () => {
            const raw = parseFloat(speed.value);
            const v = Number.isFinite(raw) ? Math.max(0.01, Math.min(2, raw)) : 1;
            setBeatsPerSecond(v);
            if (speedValue) speedValue.textContent = v.toFixed(2) + '×';
        };

        speed.addEventListener('input', applySpeed);

        // Normalize/force initial slider value to exactly 1.00 to avoid tiny artifacts
function normalizeSliderValue() {
    const rawInit = Number(speed.value);
    let clamped;
    if (!Number.isFinite(rawInit)) {
        clamped = 1.00;
    } else {
        clamped = Math.max(0.01, Math.min(2, Math.round(rawInit * 100) / 100));
    }
    // Snap to exact 1.00 if very close (prevents 1.01 from floating-point artifacts)
    if (Math.abs(clamped - 1.00) < 0.005) clamped = 1.00;
    speed.value = 1;
}
normalizeSliderValue();
applySpeed();
    }

    // Pause/play button
    const pauseBtn = document.querySelector('.toggle-pause-button');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            const isRunning = togglePause();
            pauseBtn.textContent = isRunning ? '⏸️' : '▶️';
            console.log(isRunning ? 'Animation resumed' : 'Animation paused');
        });
        // Set initial icon
        pauseBtn.textContent = '⏸️';
    }

    // Previous beat button
    const prevBtn = document.querySelector('.previous-throw-button');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            skipToPreviousBeat();
        });
    }

    // Next beat button
    const nextBtn = document.querySelector('.next-throw-button');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            skipToNextBeat();
        });
    }

    // --- Trajectories toggle under the speed slider ---
    (function addTrajectoriesToggleBelowSpeed() {
        try {
            // wrapper to keep spacing consistent
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'margin-top:8px;display:flex;flex-direction:column;gap:8px;font-size:13px';

            // Trajectories toggle
            const trajDiv = document.createElement('div');
            trajDiv.style.cssText = 'display:flex;align-items:center;gap:8px;';
            
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = 'showTrajectoriesCheckbox';
            cb.checked = (typeof trajectoriesVisible !== 'undefined') ? !!trajectoriesVisible : true;
            cb.addEventListener('change', (e) => setTrajectoriesVisible(!!e.target.checked));

            const lbl = document.createElement('label');
            lbl.htmlFor = 'showTrajectoriesCheckbox';
            lbl.style.cssText = 'cursor:pointer;user-select:none';
            lbl.textContent = 'Show Trajectories';

            trajDiv.appendChild(cb);
            trajDiv.appendChild(lbl);
            wrapper.appendChild(trajDiv);

            // All Possible Carry Arcs toggle
            const carryDiv = document.createElement('div');
            carryDiv.style.cssText = 'display:flex;align-items:center;gap:8px;';
            
            const carryCb = document.createElement('input');
            carryCb.type = 'checkbox';
            carryCb.id = 'showAllCarryArcsCheckbox';
            carryCb.checked = false;
            carryCb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    drawAllPossibleCarryArcs();
                } else {
                    clearAllPossibleCarryArcs();
                }
            });

            const carryLbl = document.createElement('label');
            carryLbl.htmlFor = 'showAllCarryArcsCheckbox';
            carryLbl.style.cssText = 'cursor:pointer;user-select:none';
            carryLbl.textContent = 'Show All Possible Carry Arcs';

            carryDiv.appendChild(carryCb);
            carryDiv.appendChild(carryLbl);
            wrapper.appendChild(carryDiv);

            // Insert the wrapper directly after the speed element if possible
            const parent = speed.parentElement || document.body;
            if (parent && parent.contains(speed)) {
                parent.insertBefore(wrapper, speed.nextSibling);
            } else {
                parent.appendChild(wrapper);
            }
        } catch (e) {
            console.warn('Failed to add trajectories toggle below speed slider', e);
        }
    })();

    // --- Arm Control Sliders ---
    (function addArmControlSliders() {
        try {
            const controlPanel = document.querySelector('.control-panel');
            if (!controlPanel) return;

            const armSection = document.createElement('div');
            armSection.style.cssText = 'margin-top:16px;padding:12px;background:#f0f0f0;border-radius:6px;';

            const title = document.createElement('div');
            title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:10px;color:#333;';
            title.textContent = 'Arm Controls';
            armSection.appendChild(title);

            // Button container for reset and mirror
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';
            
            const resetBtn = document.createElement('button');
            resetBtn.textContent = 'Reset Arm Pose';
            resetBtn.style.cssText = 'padding:6px 10px;font-size:12px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;';
            resetBtn.addEventListener('click', () => resetArmPoseToDefault(true));
            btnContainer.appendChild(resetBtn);

            const mirrorBtn = document.createElement('button');
            mirrorBtn.textContent = 'Copy Right → Left';
            mirrorBtn.style.cssText = 'padding:6px 10px;font-size:12px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;';
            mirrorBtn.addEventListener('click', () => {
                leftShoulderRotX = rightShoulderRotX;
                leftShoulderRotY = -rightShoulderRotY;  // invert Y for opposite side
                leftShoulderRotZ = -rightShoulderRotZ;  // invert Z for opposite side
                leftForeArmRotation = rightForeArmRotation;
                leftHandRotX = rightHandRotX;
                leftHandRotY = -rightHandRotY;  // invert Y for opposite side
                leftHandRotZ = -rightHandRotZ;  // invert Z for opposite side
                
                setArmSliderValue('leftShoulderRotX', leftShoulderRotX);
                setArmSliderValue('leftShoulderRotY', leftShoulderRotY);
                setArmSliderValue('leftShoulderRotZ', leftShoulderRotZ);
                setArmSliderValue('leftForeArmRotation', leftForeArmRotation);
                setArmSliderValue('leftHandRotX', leftHandRotX);
                setArmSliderValue('leftHandRotY', leftHandRotY);
            });
            btnContainer.appendChild(mirrorBtn);
            
            armSection.appendChild(btnContainer);

            // Helper function to create a slider for a rotation axis
            function createAxisSlider(label, key, onChangeCallback) {
                const container = document.createElement('div');
                container.style.cssText = 'margin-bottom:8px;display:flex;align-items:center;gap:8px;font-size:12px;';

                const lbl = document.createElement('label');
                lbl.style.cssText = 'width:80px;color:#555;';
                lbl.textContent = label;
                container.appendChild(lbl);

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = '-180';
                slider.max = '180';
                slider.step = '1';
                slider.value = '0';
                slider.style.cssText = 'flex:1;cursor:pointer;';
                container.appendChild(slider);

                const numberInput = document.createElement('input');
                numberInput.type = 'number';
                numberInput.min = '-180';
                numberInput.max = '180';
                numberInput.step = '1';
                numberInput.value = '0';
                numberInput.style.cssText = 'width:56px;padding:2px 4px;font-size:12px;border:1px solid #ccc;border-radius:4px;';
                container.appendChild(numberInput);

                const valueDisplay = document.createElement('span');
                valueDisplay.style.cssText = 'width:40px;text-align:right;color:#333;font-weight:500;';
                valueDisplay.textContent = '0°';
                container.appendChild(valueDisplay);

                // Get default value for this key
                let defaultValue = 0;
                if (key === 'rightShoulderRotX') defaultValue = DEFAULT_POSE.rightShoulder.x;
                else if (key === 'rightShoulderRotY') defaultValue = DEFAULT_POSE.rightShoulder.y;
                else if (key === 'rightShoulderRotZ') defaultValue = DEFAULT_POSE.rightShoulder.z;
                else if (key === 'leftShoulderRotX') defaultValue = DEFAULT_POSE.leftShoulder.x;
                else if (key === 'leftShoulderRotY') defaultValue = DEFAULT_POSE.leftShoulder.y;
                else if (key === 'leftShoulderRotZ') defaultValue = DEFAULT_POSE.leftShoulder.z;
                else if (key === 'rightForeArmRotation') defaultValue = DEFAULT_POSE.rightForeArmZ;
                else if (key === 'leftForeArmRotation') defaultValue = DEFAULT_POSE.leftForeArmZ;
                else if (key === 'rightHandRotX' || key === 'leftHandRotX') defaultValue = DEFAULT_POSE.foreArmX;

                slider.addEventListener('input', (e) => {
                    const degrees = parseInt(e.target.value);
                    const radians = degrees * Math.PI / 180 + defaultValue; // Add default back
                    valueDisplay.textContent = degrees + '°';
                    numberInput.value = String(degrees);
                    onChangeCallback(radians);
                });

                numberInput.addEventListener('input', (e) => {
                    const degrees = Math.max(-180, Math.min(180, parseInt(e.target.value) || 0));
                    numberInput.value = String(degrees);
                    slider.value = degrees;
                    valueDisplay.textContent = degrees + '°';
                    const radians = degrees * Math.PI / 180 + defaultValue; // Add default back
                    onChangeCallback(radians);
                });

                // store for later syncing to defaults
                armSliderRefs[key] = { slider, input: numberInput, valueDisplay };

                return container;
            }

            // Right Shoulder
            const rightShoulderLabel = document.createElement('div');
            rightShoulderLabel.style.cssText = 'font-weight:500;font-size:12px;color:#333;margin-top:8px;margin-bottom:6px;';
            rightShoulderLabel.textContent = 'Right Shoulder';
            armSection.appendChild(rightShoulderLabel);

            armSection.appendChild(createAxisSlider('  X:', 'rightShoulderRotX', (val) => rightShoulderRotX = val));
            armSection.appendChild(createAxisSlider('  Y:', 'rightShoulderRotY', (val) => rightShoulderRotY = val));
            armSection.appendChild(createAxisSlider('  Z:', 'rightShoulderRotZ', (val) => rightShoulderRotZ = val));

            // Right Elbow
            const rightElbowLabel = document.createElement('div');
            rightElbowLabel.style.cssText = 'font-weight:500;font-size:12px;color:#333;margin-top:8px;margin-bottom:6px;';
            rightElbowLabel.textContent = 'Right Elbow';
            armSection.appendChild(rightElbowLabel);

            armSection.appendChild(createAxisSlider('  Z:', 'rightForeArmRotation', (val) => rightForeArmRotation = val));
            armSection.appendChild(createAxisSlider('  X:', 'rightHandRotX', (val) => rightHandRotX = val));
            armSection.appendChild(createAxisSlider('  Y:', 'rightHandRotY', (val) => rightHandRotY = val));

            // Left Shoulder
            const leftShoulderLabel = document.createElement('div');
            leftShoulderLabel.style.cssText = 'font-weight:500;font-size:12px;color:#333;margin-top:8px;margin-bottom:6px;';
            leftShoulderLabel.textContent = 'Left Shoulder';
            armSection.appendChild(leftShoulderLabel);

            armSection.appendChild(createAxisSlider('  X:', 'leftShoulderRotX', (val) => leftShoulderRotX = val));
            armSection.appendChild(createAxisSlider('  Y:', 'leftShoulderRotY', (val) => leftShoulderRotY = val));
            armSection.appendChild(createAxisSlider('  Z:', 'leftShoulderRotZ', (val) => leftShoulderRotZ = val));

            // Left Elbow
            const leftElbowLabel = document.createElement('div');
            leftElbowLabel.style.cssText = 'font-weight:500;font-size:12px;color:#333;margin-top:8px;margin-bottom:6px;';
            leftElbowLabel.textContent = 'Left Elbow';
            armSection.appendChild(leftElbowLabel);

            armSection.appendChild(createAxisSlider('  Z:', 'leftForeArmRotation', (val) => leftForeArmRotation = val));
            armSection.appendChild(createAxisSlider('  X:', 'leftHandRotX', (val) => leftHandRotX = val));
            armSection.appendChild(createAxisSlider('  Y:', 'leftHandRotY', (val) => leftHandRotY = val));

            // --- Axis Motion Toggles ---
            const motionTitle = document.createElement('div');
            motionTitle.style.cssText = 'font-weight:600;font-size:13px;margin-top:12px;margin-bottom:8px;color:#333;';
            motionTitle.textContent = 'Axis Motion (Beat-Synced)';
            armSection.appendChild(motionTitle);

            function createToggleRow(labelText, groupKey) {
                const row = document.createElement('div');
                row.style.cssText = 'margin-bottom:8px;display:flex;align-items:center;gap:12px;font-size:12px;';

                const lbl = document.createElement('label');
                lbl.style.cssText = 'width:120px;color:#555;';
                lbl.textContent = labelText;
                row.appendChild(lbl);

                const mkToggle = (axis) => {
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = !!motionToggles[groupKey][axis];
                    cb.addEventListener('change', (e) => {
                        motionToggles[groupKey][axis] = !!e.target.checked;
                    });
                    const wrap = document.createElement('label');
                    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;';
                    const txt = document.createElement('span');
                    txt.textContent = axis.toUpperCase();
                    wrap.appendChild(cb);
                    wrap.appendChild(txt);
                    return wrap;
                };

                row.appendChild(mkToggle('x'));
                row.appendChild(mkToggle('y'));
                row.appendChild(mkToggle('z'));

                return row;
            }

            armSection.appendChild(createToggleRow('Animate Shoulders:', 'shoulder'));
            armSection.appendChild(createToggleRow('Animate Forearms:', 'forearm'));

            controlPanel.appendChild(armSection);
        } catch (e) {
            console.warn('Failed to add arm control sliders', e);
        }
    })();

    // Arm and hand sliders removed to keep character in authored pose.
}

// Camera view helpers
function setCameraFront() {
    camera.position.set(2, 2, 0);
    controls.target.set(0, 1.8, 0);
    camera.fov = 45;  // restore default FOV
    camera.near = 0.1;  // restore default near plane
    camera.updateProjectionMatrix();
    controls.update();
    renderer.render(scene, camera);
}

function setCameraSide() {
    camera.position.set(0, 2, 2.5);
    controls.target.set(0, 2, 0);
    camera.fov = 45;  // restore default FOV
    camera.near = 0.1;  // restore default near plane
    camera.updateProjectionMatrix();
    controls.update();
    renderer.render(scene, camera);
}

function setCameraPOV() {
    camera.position.set(-0.3, 1.64, 0);
    controls.target.set(0, 1.64, 0);  // closer target so you can orbit around head area
    camera.fov = 100;
    camera.near = 0.23;
    camera.updateProjectionMatrix();
    controls.update();
    renderer.render(scene, camera);
}

// View selector (Front / Side / POV)
const viewSelector = document.querySelector('.ViewSelector');
if (viewSelector) {
    // ensure initial selection corresponds to front view
    if (!viewSelector.value) viewSelector.value = 'Front View';
    viewSelector.addEventListener('change', (e) => {
        const v = (e.target.value || '').toLowerCase();
        if (v.includes('front')) setCameraFront();
        else if (v.includes('side')) setCameraSide();
        else if (v.includes('pov')) setCameraPOV();
    });
}

// Character selector (dynamically created)
(function addCharacterSelector() {
    try {
        const container = document.createElement('div');
        container.style.cssText = 'margin-top:8px;display:flex;align-items:center;gap:8px;font-size:13px';

        const label = document.createElement('label');
        label.textContent = 'Character:';
        label.style.cssText = 'font-weight:500';
        container.appendChild(label);

        const select = document.createElement('select');
        select.id = 'characterSelector';
        select.style.cssText = 'padding:4px 8px;border-radius:4px;background:#333;color:#fff;border:1px solid #555;cursor:pointer';
        
        const dummyOption = document.createElement('option');
        dummyOption.value = 'Dummy';
        dummyOption.textContent = 'Dummy';
        dummyOption.selected = true;
        select.appendChild(dummyOption);

        const clownOption = document.createElement('option');
        clownOption.value = 'Clown';
        clownOption.textContent = 'Clown';
        select.appendChild(clownOption);

        select.addEventListener('change', (e) => {
            loadCharacter(e.target.value);
        });

        container.appendChild(select);

        // Insert after view selector or speed slider
        const parent = viewSelector ? viewSelector.parentElement : document.querySelector('#speed')?.parentElement;
        if (parent && viewSelector) {
            parent.insertBefore(container, viewSelector.nextSibling);
        } else if (parent) {
            parent.appendChild(container);
        }
    } catch (e) {
        console.warn('Failed to add character selector', e);
    }
})();

// Main init / animation
const clock = new THREE.Clock();

async function init() {
    // start render loop early
    animate();

    await loadAllTrajectories();

    // draw all loaded trajectories
    for (const key of Object.keys(trajectories)) {
        const curve = trajectories[key];
        if (!curve) continue;
        const color = key.endsWith('L') ? 0xffaa00 : 0x0099ff;
        drawCurve(curve, color);
    }

    const bounds = computeTrajectoriesBounds(trajectories);
    if (bounds) {
        fitCameraToBox(bounds, camera, controls, 1.15);
        const center = new THREE.Vector3();
        bounds.getCenter(center);
        sceneCenter.copy(center);
    }

    // create visual balls to match logic.balls
    createBallMeshes();

    // wire UI / controls
    wireUI();

    // Start with a consistent authored arm pose and synced sliders
    resetArmPoseToDefault(true);

    // setup fullscreen button after UI
    setupFullscreenButton();

    // update UI prop count once more in case wireUI changed DOM
    updatePropCountUI();

    // ensure engine running
    try { startEngine(); } catch(e){}
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();
// keep renderer size in sync
    if (resizeRendererToDisplaySize()) {
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
    }

// Apply shoulder and forearm rotations for juggling pose
    const currentBeat = beatTime; // from logic.js
    // Target range -25°..+20° (span 45°). Amplitude 22.5°, bias -2.5°.
    const armAmplitude = THREE.MathUtils.degToRad(22.5);
    const armBias = THREE.MathUtils.degToRad(-2.5);
    // Per-axis phases (all per-beat turnarounds): sin(π·beat) → 0.5, 1.5, 2.5...
    const phaseY = Math.sin(currentBeat * Math.PI);
    const phaseXZ = Math.sin(currentBeat * Math.PI);
    const rightPhaseY = phaseY;
    const leftPhaseY = phaseY;
    const rightPhaseXZ = phaseXZ;
    const leftPhaseXZ = phaseXZ;

    // Removed proximity-based catch offsets; hand following now handled by arc targets

    if (rightShoulderBone) {
        const sDyn = motionToggles.shoulder;
        const dynX = sDyn.x ? (armBias + rightPhaseXZ * armAmplitude) : 0;
        const dynY = sDyn.y ? (armBias + rightPhaseY  * armAmplitude) : 0;
        const dynZ = sDyn.z ? (armBias + rightPhaseXZ * armAmplitude) : 0;

        rightShoulderBone.rotation.x = rightShoulderBase.x + rightShoulderRotX + dynX;
        rightShoulderBone.rotation.y = rightShoulderBase.y + rightShoulderRotY + dynY;
        rightShoulderBone.rotation.z = rightShoulderBase.z + rightShoulderRotZ + dynZ;
        rightShoulderBone.updateMatrixWorld(true);
    }
    if (leftShoulderBone) {
        const sDyn = motionToggles.shoulder;
        const dynX = sDyn.x ? (armBias + leftPhaseXZ * armAmplitude) : 0;
        const dynY = sDyn.y ? (armBias + leftPhaseY  * armAmplitude) : 0;
        const dynZ = sDyn.z ? (armBias + leftPhaseXZ * armAmplitude) : 0;

        leftShoulderBone.rotation.x = leftShoulderBase.x + leftShoulderRotX + dynX;
        leftShoulderBone.rotation.y = leftShoulderBase.y + leftShoulderRotY + dynY;
        leftShoulderBone.rotation.z = leftShoulderBase.z + leftShoulderRotZ + dynZ;
        leftShoulderBone.updateMatrixWorld(true);
    } else {
        // Debug: log once if bone is missing
        if (!window._leftShoulderWarned) {
            console.warn('leftShoulderBone is null/undefined in animate()');
            window._leftShoulderWarned = true;
        }
    }

    // Forearm dynamic motion (optional per toggles)

    // Determine which hand is currently carrying a ball for aiming
    let carryMeshRight = null, carryMeshLeft = null;
    try {
        for (const b of balls) {
            if (b && b._carryInProgress && typeof b._carryHand === 'number') {
                const m = ballMeshes.get(b.id);
                if (!m) continue;
                if (b._carryHand === 0 && !carryMeshRight) carryMeshRight = m;
                if (b._carryHand === 1 && !carryMeshLeft) carryMeshLeft = m;
            }
        }
    } catch (e) {}

    const alignForearmToTarget = (forearmBone, handBone, targetMesh, bias = { x: 0, y: -0.06, z: 0 }) => {
        if (!forearmBone || !targetMesh) return;
        try {
            const origin = new THREE.Vector3();
            const effectorPos = new THREE.Vector3();
            const targetPos = targetMesh.position.clone();
            targetPos.add(new THREE.Vector3(bias.x || 0, bias.y || 0, bias.z || 0));
            forearmBone.getWorldPosition(origin);
            // Prefer the actual child of the forearm as the effector to avoid side offsets from mismatched bones
            let effectorBone = null;
            const childHandRegex = /(hand|wrist)/i;
            if (Array.isArray(forearmBone.children)) {
                effectorBone = forearmBone.children.find(c => c.isBone && childHandRegex.test(c.name || ''))
                    || forearmBone.children.find(c => c.isBone);
            }
            if (!effectorBone && handBone) effectorBone = handBone;
            if (!effectorBone || !effectorBone.getWorldPosition) return;
            effectorBone.getWorldPosition(effectorPos);
            const currentDir = effectorPos.sub(origin).normalize();
            const targetDir = targetPos.sub(origin).normalize();
            if (currentDir.lengthSq() < 1e-8 || targetDir.lengthSq() < 1e-8) return;

            const alignQuat = new THREE.Quaternion().setFromUnitVectors(currentDir, targetDir);
            const parentQuat = new THREE.Quaternion();
            if (forearmBone.parent) forearmBone.parent.getWorldQuaternion(parentQuat);
            const parentInv = parentQuat.clone().invert();
            const worldQuat = new THREE.Quaternion();
            forearmBone.getWorldQuaternion(worldQuat);
            const newWorld = alignQuat.multiply(worldQuat);
            const newLocal = parentInv.multiply(newWorld);
            forearmBone.quaternion.copy(newLocal);
            forearmBone.updateMatrixWorld(true);
        } catch (e) { /* ignore align errors */ }
    };

    if (rightForeArmBone) {
        const fDyn = motionToggles.forearm;
        const dynX = fDyn.x ? (armBias + rightPhaseXZ * armAmplitude) : 0;
        const dynY = fDyn.y ? (armBias + rightPhaseY  * armAmplitude) : 0;
        const dynZ = fDyn.z ? (armBias + rightPhaseXZ * armAmplitude) : 0;

        // When carrying, aim the forearm toward the ball (lower arc)
        rightForeArmBone.rotation.z = rightForeArmBase.z + rightForeArmRotation + dynZ;
        rightForeArmBone.rotation.x = rightForeArmBase.x + rightHandRotX + dynX;
        rightForeArmBone.rotation.y = rightForeArmBase.y + rightHandRotY + dynY;
        rightForeArmBone.updateMatrixWorld(true);

        // Align forearm axis (elbow->hand) to point toward the carried ball if present
        if (carryMeshRight) {
            alignForearmToTarget(rightForeArmBone, rightHandBone, carryMeshRight);
        }
    }
    if (leftForeArmBone) {
        const fDyn = motionToggles.forearm;
        const dynX = fDyn.x ? (armBias + leftPhaseXZ * armAmplitude) : 0;
        const dynY = fDyn.y ? (armBias + leftPhaseY  * armAmplitude) : 0;
        const dynZ = fDyn.z ? (armBias + leftPhaseXZ * armAmplitude) : 0;

        // When carrying, aim the forearm toward the ball (lower arc)
        leftForeArmBone.rotation.z = leftForeArmBase.z + leftForeArmRotation + dynZ;
        leftForeArmBone.rotation.x = leftForeArmBase.x + leftHandRotX + dynX;
        leftForeArmBone.rotation.y = leftForeArmBase.y + leftHandRotY + dynY;
        leftForeArmBone.updateMatrixWorld(true);

        if (carryMeshLeft) {
            alignForearmToTarget(leftForeArmBone, leftHandBone, carryMeshLeft);
        }
    }

    // --- Debug: log forearm dynamic deltas and rotations at a throttled interval ---
    if (!window.__armMotionDbg) window.__armMotionDbg = { t: 0 };
    window.__armMotionDbg.t += delta;
    if (window.__armMotionDbg.t >= 0.5) { // log twice per second
        window.__armMotionDbg.t = 0;
        try {
            const rY = rightForeArmBone ? rightForeArmBone.rotation.y : null;
            const lY = leftForeArmBone ? leftForeArmBone.rotation.y : null;
            const rZ = rightForeArmBone ? rightForeArmBone.rotation.z : null;
            const lZ = leftForeArmBone ? leftForeArmBone.rotation.z : null;
            console.log('[ArmMotionDBG] beat=', currentBeat.toFixed(2), 'phaseY=', phaseY.toFixed(3), 'phaseXZ=', phaseXZ.toFixed(3),
                'forearmY:', { right: rY?.toFixed(3), left: lY?.toFixed(3) },
                'forearmZ:', { right: rZ?.toFixed(3), left: lZ?.toFixed(3) },
                'toggles:', motionToggles);
        } catch (e) {}
    }

// update ball visuals according to logic state
    updateBallVisuals();

    // Hands remain static; no IK target driving

    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();

function inspectArmature(root) {
  const skinned = [];
  const bones = [];

  root.traverse(node => {
    if (node.isSkinnedMesh) skinned.push(node);
    if (node.isBone) bones.push(node);
  });

  console.log(`Inspecting armature: skinned meshes=${skinned.length}, bones=${bones.length}`);

  skinned.forEach((m, i) => {
    const boneNames = m.skeleton ? m.skeleton.bones.map(b => b.name) : [];
    console.log(`SkinnedMesh[${i}] name="${m.name}" bones:`, boneNames);
  });

  if (bones.length) console.log('Bone list:', bones.map(b => b.name));
  if (skinned.length === 0 && bones.length === 0) console.log('No armature found.');
  return { skinned, bones };
}
// Call inside your loader callback, e.g.:
// gltfLoader.load(url, (gltf) => {
//   scene.add(gltf.scene);
//   inspectArmature(gltf.scene);
// }, ...);


import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js';

let rightIKTarget, leftIKTarget;
let rightIKSolver, leftIKSolver;
let model;

function setupIK(r, l) {

    rightIKTarget = new THREE.Object3D();
    leftIKTarget = new THREE.Object3D();

    scene.add(rightIKTarget);
    scene.add(leftIKTarget);

    // Right arm chain
    const rightIK = [{
        target: rightIKTarget,
        effector: r.rightHand,
        links: [
            { index: r.rightForeArm },
            { index: r.rightArm },
            { index: r.rightShoulder }
        ]
    }];

    // Left arm chain
    const leftIK = [{
        target: leftIKTarget,
        effector: l.leftHand,
        links: [
            { index: l.leftForeArm },
            { index: l.leftArm },
            { index: l.leftShoulder }
        ]
    }];

    rightIKSolver = new CCDIKSolver(model, rightIK);
    leftIKSolver = new CCDIKSolver(model, leftIK);
}

function updatePropCountUI() {
    const count = Array.isArray(balls) ? balls.length : 0;

    // Primary target: explicit element
    const el = document.getElementById('prop-count');
    if (el) {
        el.textContent = String(count);
        return;
    }

    // Fallback: find the Prop Settings header and add/update a badge
    const header = Array.from(document.querySelectorAll('.rounded-box p, .panel p, .panel div'))
        .find(node => node && /prop settings/i.test(node.textContent));
    if (header) {
        // try to find an existing badge we added earlier
        let badge = header.querySelector('.prop-count-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'prop-count-badge';
           
            badge.style.cssText = 'display:inline-block;margin-left:8px;padding:2px 8px;background:#1976d2;color:#fff;border-radius:8px;font-weight:600;font-size:12px';
            header.appendChild(badge);
        }
        badge.textContent = String(count);
        return;
    }

    // Last fallback: show in document title
    try { document.title = `JUGGLR — ${count} props`; } catch(e) {}
}

// ---------------- Prop Settings UI (dynamic rows per ball) ----------------
const propSettings = {}; // keyed by ball id { color, trail, show }

function ensurePropSetting(id) {
    if (!propSettings[id]) {
        // Expanded vibrant palette (cycles if more props than entries)
        const defaultColors = [
            '#FF3B30', '#FF9500', '#FFD60A', '#4CD964', '#00C853', '#5AC8FA',
            '#007AFF', '#5856D6', '#D500F9', '#FF2D55', '#FF6B00', '#FFCC00',
            '#00BFA5', '#00BCD4', '#7C4DFF', '#FFC400',
            '#00E676', '#F50057', '#1DE9B6', '#2979FF', '#8BC34A', '#FF4081',
            '#9C27B0', '#3F51B5'
        ];
        propSettings[id] = {
            color: defaultColors[id % defaultColors.length],
            trail: false,
            show: true
        };
    }
    return propSettings[id];
}

function applyPropSettingToBall(id) {
    const setting = propSettings[id];
    const mesh = ballMeshes.get(id);
    if (!mesh || !setting) return;
    try {
        mesh.material.color.set(setting.color);
    } catch (e) {}
    mesh.visible = !!setting.show;
    // trail is stored but not visually implemented here yet.
}

function renderPropSettingsUI(applyToMeshes = true) {
    // Look for the prop settings table's tbody inside .rounded-box
    const roundedBox = document.querySelector('.rounded-box');
    if (!roundedBox) return;
    const table = roundedBox.querySelector('table');
    if (!table) return;
    let tbody = table.querySelector('tbody');
    if (!tbody) {
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
    }

    // Rebuild tbody to match balls array
    tbody.innerHTML = '';
    for (const b of balls) {
        ensurePropSetting(b.id);
        const s = propSettings[b.id];

        const tr = document.createElement('tr');
        // Index cell
        const tdIndex = document.createElement('td');
        tdIndex.textContent = String(b.id + 1); // human-friendly
        tr.appendChild(tdIndex);

        // Color cell
        const tdColor = document.createElement('td');
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = s.color || '#ffffff';
        colorInput.style.width = '40px';
        colorInput.addEventListener('input', (e) => {
            s.color = e.target.value;
            applyPropSettingToBall(b.id);
        });
        tdColor.appendChild(colorInput);
        tr.appendChild(tdColor);

        // Trail cell
        const tdTrail = document.createElement('td');
        const trailInput = document.createElement('input');
        trailInput.type = 'checkbox';
        trailInput.checked = !!s.trail;
        trailInput.addEventListener('change', (e) => {
            s.trail = !!e.target.checked;
            // no visual trail implemented yet; placeholder if you add rendering later
        });
        tdTrail.appendChild(trailInput);
        tr.appendChild(tdTrail);

        // Show cell
        const tdShow = document.createElement('td');
        const showInput = document.createElement('input');
        showInput.type = 'checkbox';
        showInput.checked = !!s.show;
        showInput.addEventListener('change', (e) => {
            s.show = !!e.target.checked;
            applyPropSettingToBall(b.id);
        });
        tdShow.appendChild(showInput);
        tr.appendChild(tdShow);

        tbody.appendChild(tr);

        // Optionally apply setting to current ball mesh
        if (applyToMeshes) applyPropSettingToBall(b.id);
    }
}

// ensure UI updates whenever meshes are (re)created
const _oldCreateBallMeshes = createBallMeshes;
createBallMeshes = function () {
    _oldCreateBallMeshes();
    renderPropSettingsUI();
};



// Fisher-Yates shuffle
function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
    return a;
}

// --- Load SceneWithOutDummy environment and Dummy character ---
let fullScene = null;
let gltfModel = null;

try {
    const gltfLoader = new GLTFLoader();
    const sceneUrl = new URL('./Models/SceneWithOutDummy.glb', import.meta.url).href;
    gltfLoader.load(
        sceneUrl,
        (gltf) => {
            fullScene = gltf.scene;
            fullScene.name = 'SceneWithOutDummy';
            // Make meshes cast/receive shadow if desired
            fullScene.traverse(node => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                    if (node.material && node.material.isMeshStandardMaterial) {
                        node.material.metalness = node.material.metalness || 0;
                        node.material.roughness = node.material.roughness || 1;
                    }
                }
            });

            scene.add(fullScene);
            console.log('Loaded SceneWithOutDummy.glb');

            // update sceneCenter so hand/trajectory logic can use model location
            try {
                const box = new THREE.Box3().setFromObject(fullScene);
                if (!box.isEmpty()) {
                    const c = new THREE.Vector3();
                    box.getCenter(c);
                    sceneCenter.copy(c);
                }
            } catch (e) {
                // ignore if bounds fail
            }

            // print armature info to console for debugging
            inspectArmature(fullScene);
        },
        (xhr) => {
            // optional progress
            // console.log(`SceneWithOutDummy.glb ${(xhr.loaded / (xhr.total || 1) * 100).toFixed(0)}%`);
        },
        (err) => {
            console.error('Failed to load SceneWithOutDummy.glb:', err);
        }
    );
} catch (e) {
    console.warn('GLTF loader failed to start for SceneWithOutDummy.glb', e);
}

// --- Dynamic character loading ---
function loadCharacter(characterName) {
    // Remove existing character if present
    if (currentCharacterModel) {
        scene.remove(currentCharacterModel);
        currentCharacterModel = null;
        // Clear bone references
        rightForeArmBone = null;
        leftForeArmBone = null;
        rightShoulderBone = null;
        leftShoulderBone = null;
    }

    try {
        const fbxLoader = new FBXLoader();
        const characterUrl = new URL(`./Models/characters/${characterName}.fbx`, import.meta.url).href;
        fbxLoader.load(
            characterUrl,
            (fbx) => {
                const characterModel = fbx;
                characterModel.name = characterName;
                currentCharacterModel = characterModel;
                
                // Make meshes cast/receive shadow and preserve materials
                characterModel.traverse(node => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                    }
                });

                // Add to scene
                scene.add(characterModel);
                // Scale models; clown slightly smaller for better proportion
                const baseScale = 0.0098;
                const scale = (characterName === 'Clown') ? 0.0083 : baseScale;
                characterModel.scale.set(scale, scale, scale);
                // Move down on Y axis
                characterModel.position.x = -0.257;
                // Face 90° left relative to default orientation
                characterModel.rotation.y = Math.PI / 2;
                console.log(`Loaded ${characterName}.fbx`);

                // Fix materials - ensure proper colors and textures
                characterModel.traverse(node => {
                    if (node.isMesh && node.material) {
                        const materials = Array.isArray(node.material) ? node.material : [node.material];
                        
                        materials.forEach((mat, idx) => {
                            if (mat) {
                                // Convert old material types to StandardMaterial
                                if (mat.isMeshPhongMaterial || mat.isMeshLambertMaterial) {
                                    const newMat = new THREE.MeshStandardMaterial({
                                        color: mat.color && mat.color.getHex() !== 0x000000 ? mat.color : 0xffffff,
                                        map: mat.map,
                                        normalMap: mat.normalMap,
                                        roughness: 0.7,
                                        metalness: 0.1
                                    });
                                    if (Array.isArray(node.material)) {
                                        node.material[idx] = newMat;
                                    } else {
                                        node.material = newMat;
                                    }
                                } 
                                // For materials that are black but have no texture, give them white so they can be lit
                                else if (mat.color && mat.color.getHex() === 0x000000 && !mat.map) {
                                    mat.color.setHex(0xffffff);
                                }
                                
                                mat.needsUpdate = true;
                            }
                        });
                    }
                });

                // expose the first SkinnedMesh (if any) for bone animation
                let skinned = null;
                characterModel.traverse(n => { if (!skinned && n.isSkinnedMesh) skinned = n; });
                if (skinned) { gltfModel = skinned; model = skinned; }

                // Find forearm and upper arm bones for arm animation
                if (skinned && skinned.skeleton) {
                    const bones = skinned.skeleton.bones;

                    // Helper: prefer exact mixamorig8 names, fallback to regex
                    const findBoneByNames = (names) => {
                        const lower = names.map(n => n.toLowerCase());
                        return bones.find(b => lower.includes((b.name || '').toLowerCase()));
                    };

                    // Explicit Mixamo names for this rig (match exact capitalization)
                    const explicitRightForeArm = findBoneByNames(['mixamorig8:RightForeArm', 'mixamorig8:rightforearm', 'mixamorig8:right forearm']);
                    const explicitLeftForeArm = findBoneByNames(['mixamorig8:LeftForeArm', 'mixamorig8:leftforearm', 'mixamorig8:left forearm']);
                    const explicitRightArm = findBoneByNames(['mixamorig8:RightArm', 'mixamorig8:rightarm', 'mixamorig8:right arm']);
                    const explicitLeftArm = findBoneByNames(['mixamorig8:LeftArm', 'mixamorig8:leftarm', 'mixamorig8:left arm']);
                    const explicitRightHand = findBoneByNames(['mixamorig8:RightHand', 'mixamorig8:righthand', 'mixamorig8:right hand']);
                    const explicitLeftHand = findBoneByNames(['mixamorig8:LeftHand', 'mixamorig8:lefthand', 'mixamorig8:left hand']);

                    console.log('=== Bone Detection Debug ===');
                    console.log('Total bones in skeleton:', bones.length);
                    console.log('Explicit bones found:');
                    console.log('  explicitRightArm:', explicitRightArm?.name);
                    console.log('  explicitLeftArm:', explicitLeftArm?.name);
                    console.log('  explicitRightForeArm:', explicitRightForeArm?.name);
                    console.log('  explicitLeftForeArm:', explicitLeftForeArm?.name);
                    console.log('All bone names:', bones.map(b => b.name).filter(n => /arm/i.test(n)));

                    // Regex fallbacks - exclude forearm from arm search
                    const forearmRegex = /(forearm|lowerarm|lower_arm)/i;
                    const shoulderRegex = /(shoulder|upperarm|upper_arm)/i;
                    const handRegex = /(hand|wrist)/i;
                    // Match "arm" but NOT "forearm" - use negative lookbehind
                    const armRegex = /(?<!fore)arm(?!ature)/i;
                    const forearmBones = bones.filter(b => forearmRegex.test(b.name || ''));
                    const armBones = bones.filter(b => {
                        const name = b.name || '';
                        return armRegex.test(name) && !forearmRegex.test(name);
                    });
                    const shoulderBones = bones.filter(b => shoulderRegex.test(b.name || ''));
                    const handBones = bones.filter(b => handRegex.test(b.name || ''));

                    // Forearms
                    if (explicitRightForeArm) rightForeArmBone = explicitRightForeArm;
                    if (explicitLeftForeArm) leftForeArmBone = explicitLeftForeArm;

                    if ((!rightForeArmBone || !leftForeArmBone) && forearmBones.length >= 2) {
                        const rightRegex = /(right|r[_-]?)/i;
                        const leftRegex = /(left|l[_-]?)/i;
                        const rightBone = forearmBones.find(b => rightRegex.test(b.name || ''));
                        const leftBone = forearmBones.find(b => leftRegex.test(b.name || ''));

                        if (rightBone && leftBone && rightBone !== leftBone) {
                            rightForeArmBone = rightForeArmBone || rightBone;
                            leftForeArmBone = leftForeArmBone || leftBone;
                        } else {
                            rightForeArmBone = rightForeArmBone || forearmBones[0];
                            leftForeArmBone = leftForeArmBone || forearmBones[1];
                        }
                    }

                    // Upper arms / shoulders
                    if (explicitRightArm) rightShoulderBone = explicitRightArm;
                    if (explicitLeftArm) leftShoulderBone = explicitLeftArm;
                    if (explicitRightHand) rightHandBone = explicitRightHand;
                    if (explicitLeftHand) leftHandBone = explicitLeftHand;

                    const rightRegex = /(right|r[_-]?)/i;
                    const leftRegex = /(left|l[_-]?)/i;

                    // Prefer arm bones over shoulder bones for slider control
                    if ((!rightShoulderBone || !leftShoulderBone) && armBones.length >= 2) {
                        const rightBone = armBones.find(b => rightRegex.test(b.name || ''));
                        const leftBone = armBones.find(b => leftRegex.test(b.name || ''));
                        if (rightBone && leftBone && rightBone !== leftBone) {
                            rightShoulderBone = rightShoulderBone || rightBone;
                            leftShoulderBone = leftShoulderBone || leftBone;
                        } else {
                            rightShoulderBone = rightShoulderBone || armBones[0];
                            leftShoulderBone = leftShoulderBone || armBones[1];
                        }
                    }

                    if ((!rightShoulderBone || !leftShoulderBone) && shoulderBones.length >= 2) {
                        const rightBone = shoulderBones.find(b => rightRegex.test(b.name || ''));
                        const leftBone = shoulderBones.find(b => leftRegex.test(b.name || ''));

                        if (rightBone && leftBone && rightBone !== leftBone) {
                            rightShoulderBone = rightShoulderBone || rightBone;
                            leftShoulderBone = leftShoulderBone || leftBone;
                        } else {
                            rightShoulderBone = rightShoulderBone || shoulderBones[0];
                            leftShoulderBone = leftShoulderBone || shoulderBones[1];
                        }
                    }

                    // Hands fallback via regex
                    if ((!rightHandBone || !leftHandBone) && handBones.length >= 2) {
                        const rightRegex2 = /(right|r[_-]?)/i;
                        const leftRegex2 = /(left|l[_-]?)/i;
                        const rHB = handBones.find(b => rightRegex2.test(b.name || ''));
                        const lHB = handBones.find(b => leftRegex2.test(b.name || ''));
                        if (rHB && lHB && rHB !== lHB) {
                            rightHandBone = rightHandBone || rHB;
                            leftHandBone = leftHandBone || lHB;
                        } else {
                            rightHandBone = rightHandBone || handBones[0];
                            leftHandBone = leftHandBone || handBones[1];
                        }
                    }
                    
                    // Optional: auto-swap left/right if naming is inverted relative to screen
                    try {
                        let swap = false;
                        const forced = _forceSwapSidesSetting();
                        if (forced === true || forced === false) {
                            swap = !!forced;
                        } else if (rightHandBone && leftHandBone) {
                            swap = _shouldSwapSidesByCamera(rightHandBone, leftHandBone);
                        }
                        if (swap) {
                            console.warn('Swapping left/right bone mappings to match screen orientation');
                            [rightHandBone, leftHandBone] = [leftHandBone, rightHandBone];
                            [rightForeArmBone, leftForeArmBone] = [leftForeArmBone, rightForeArmBone];
                            [rightShoulderBone, leftShoulderBone] = [leftShoulderBone, rightShoulderBone];
                        }
                    } catch (e) { console.warn('Auto-swap check failed:', e); }

                    // Store base rotations and positions for all found bones
                    if (rightForeArmBone) {
                        rightForeArmBaseZ = rightForeArmBone.rotation.z || 0;
                        rightForeArmBase.x = rightForeArmBone.rotation.x || 0;
                        rightForeArmBase.y = rightForeArmBone.rotation.y || 0;
                        rightForeArmBase.z = rightForeArmBone.rotation.z || 0;
                        rightForeArmBone.userData = rightForeArmBone.userData || {};
                        rightForeArmBone.userData.baseY = rightForeArmBone.position.y;
                        console.log('Found right forearm bone:', rightForeArmBone.name);
                    }
                    if (leftForeArmBone) {
                        leftForeArmBaseZ = leftForeArmBone.rotation.z || 0;
                        leftForeArmBase.x = leftForeArmBone.rotation.x || 0;
                        leftForeArmBase.y = leftForeArmBone.rotation.y || 0;
                        leftForeArmBase.z = leftForeArmBone.rotation.z || 0;
                        leftForeArmBone.userData = leftForeArmBone.userData || {};
                        leftForeArmBone.userData.baseY = leftForeArmBone.position.y;
                        console.log('Found left forearm bone:', leftForeArmBone.name);
                    }

                    if (rightHandBone) {
                        rightHandBase = {
                            x: rightHandBone.rotation.x || 0,
                            y: rightHandBone.rotation.y || 0,
                            z: rightHandBone.rotation.z || 0
                        };
                        console.log('Found right hand bone:', rightHandBone.name);
                    }
                    if (leftHandBone) {
                        leftHandBase = {
                            x: leftHandBone.rotation.x || 0,
                            y: leftHandBone.rotation.y || 0,
                            z: leftHandBone.rotation.z || 0
                        };
                        console.log('Found left hand bone:', leftHandBone.name);
                    }

                    if (rightShoulderBone) {
                        rightShoulderBase = {
                            x: rightShoulderBone.rotation.x || 0,
                            y: rightShoulderBone.rotation.y || 0,
                            z: rightShoulderBone.rotation.z || 0
                        };
                        console.log('✓ Right shoulder bone:', rightShoulderBone.name, 'base:', rightShoulderBase);
                    } else {
                        console.warn('✗ Right shoulder bone NOT found!');
                    }
                    if (leftShoulderBone) {
                        leftShoulderBase = {
                            x: leftShoulderBone.rotation.x || 0,
                            y: leftShoulderBone.rotation.y || 0,
                            z: leftShoulderBone.rotation.z || 0
                        };
                        console.log('✓ Left shoulder bone:', leftShoulderBone.name, 'base:', leftShoulderBase);
                    } else {
                        console.warn('✗ Left shoulder bone NOT found!');
                    }

                    console.log('=== Final bone assignments ===');
                    console.log('rightShoulderBone:', rightShoulderBone?.name || 'NONE');
                    console.log('leftShoulderBone:', leftShoulderBone?.name || 'NONE');
                    console.log('rightForeArmBone:', rightForeArmBone?.name || 'NONE');
                    console.log('leftForeArmBone:', leftForeArmBone?.name || 'NONE');
                    console.log('rightHandBone:', rightHandBone?.name || 'NONE');
                    console.log('leftHandBone:', leftHandBone?.name || 'NONE');

                    // Reset offsets to default pose now that bases are captured
                    resetArmPoseToDefault(true);

                    // Setup IK if we have required bones
                    try {
                        if (model && rightHandBone && leftHandBone && rightForeArmBone && leftForeArmBone && rightShoulderBone && leftShoulderBone) {
                            const idxOf = (b) => model.skeleton.bones.indexOf(b);
                            const rIdx = {
                                rightHand: idxOf(rightHandBone),
                                rightForeArm: idxOf(rightForeArmBone),
                                rightArm: idxOf(rightShoulderBone),
                                rightShoulder: idxOf(rightShoulderBone)
                            };
                            const lIdx = {
                                leftHand: idxOf(leftHandBone),
                                leftForeArm: idxOf(leftForeArmBone),
                                leftArm: idxOf(leftShoulderBone),
                                leftShoulder: idxOf(leftShoulderBone)
                            };
                            // Validate indices
                            if (Object.values(rIdx).every(i => i >= 0) && Object.values(lIdx).every(i => i >= 0)) {
                                setupIK({
                                    rightHand: rIdx.rightHand,
                                    rightForeArm: rIdx.rightForeArm,
                                    rightArm: rIdx.rightArm,
                                    rightShoulder: rIdx.rightShoulder
                                }, {
                                    leftHand: lIdx.leftHand,
                                    leftForeArm: lIdx.leftForeArm,
                                    leftArm: lIdx.leftArm,
                                    leftShoulder: lIdx.leftShoulder
                                });
                                console.log('IK setup completed.');
                            } else {
                                console.warn('IK setup skipped: invalid bone indices');
                            }
                        } else {
                            console.warn('IK setup skipped: missing bones or model');
                        }
                    } catch (e) { console.warn('Failed to setup IK:', e); }

                    // update sceneCenter so hand/trajectory logic can use model location
                    try {
                        if (fullScene) {
                            const box = new THREE.Box3().setFromObject(fullScene);
                            if (!box.isEmpty()) {
                                const c = new THREE.Vector3();
                                box.getCenter(c);
                                sceneCenter.copy(c);
                            }
                        }
                    } catch (e) {
                        // ignore if bounds fail
                    }
                }

                // print armature info to console for debugging
                inspectArmature(characterModel);
            },
        (xhr) => {
            // optional progress
        },
        (err) => {
            console.error(`Failed to load ${characterName}.fbx:`, err);
        }
    );
    } catch (e) {
        console.warn(`FBX loader failed to start for ${characterName}.fbx`, e);
    }
}

// Load default character (Dummy)
loadCharacter('Dummy');

// keep references to the visual Line objects so we can hide/show trajectories
const trajectoryLines = [];
let trajectoriesVisible = true;

function setTrajectoriesVisible(visible) {
    trajectoriesVisible = !!visible;
    for (const ln of trajectoryLines) {
        ln.visible = trajectoriesVisible;
    }
}

function toggleTrajectories() {
    setTrajectoriesVisible(!trajectoriesVisible);
}

// keyboard toggle: press 'T' to show/hide trajectories
window.addEventListener('keydown', (e) => {
    if (!e.repeat && (e.key === 't' || e.key === 'T')) {
        toggleTrajectories();
    }
});

// snapshot of initial view (filled after init finishes)
let initialCameraPos = null;
let initialControlsTarget = null;

function resetSceneToInitial() {
    // restore camera + controls target if we have initial snapshots
    if (initialCameraPos) {
        camera.position.copy(initialCameraPos);
    } else {
        // fallback: default camera
        camera.position.set(5, 3, 0);
    }
    if (initialControlsTarget) {
        controls.target.copy(initialControlsTarget);
    } else {
        controls.target.set(0, 2, 0);
    }
    controls.update();

    // reset ball visuals: restore visibility (but DO NOT change material colors)
    for (const [id, mesh] of ballMeshes) {
        try {
            // Do NOT modify mesh.material.color or mesh.material.emissive here.

            // restore visibility (like on fresh load)
            mesh.visible = true;

            // update propSettings so UI reflects reset visibility
            if (propSettings[id]) {
                propSettings[id].show = true;
            } else {
                ensurePropSetting(id);
            }
        } catch (e) {
            console.warn('Failed to reset ball', id, e);
        }
    }

    // re-render a frame to apply changes immediately
    renderer.render(scene, camera);
}

// Fullscreen toggle setup
function toggleFullscreenFor(el) {
    const doc = document;
    const isFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;
    if (!isFs) {
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
    } else {
        if (doc.exitFullscreen) doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
        else if (doc.msExitFullscreen) doc.msExitFullscreen();
    }
}

function setupFullscreenButton() {
    const panel = document.querySelector('.animation-panel');
    const btn = document.getElementById('fullscreen-btn');
    const exitBtn = document.getElementById('exit-fullscreen-btn');
    if (!panel || !btn) return;

    const syncButtons = () => {
        const isFs = !!document.fullscreenElement;
        btn.textContent = '⤢';
        btn.title = isFs ? 'Exit Fullscreen' : 'Toggle Fullscreen';
        if (exitBtn) exitBtn.style.display = isFs ? 'inline-flex' : 'none';
        btn.style.display = isFs ? 'none' : 'inline-flex';
    };

    btn.addEventListener('click', () => {
        toggleFullscreenFor(panel);
        if (exitBtn) exitBtn.style.display = 'inline-flex'; // ensure visible immediately
    });

    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            const doc = document;
            if (doc.exitFullscreen) doc.exitFullscreen();
            else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
            else if (doc.msExitFullscreen) doc.msExitFullscreen();
        });
    }

    document.addEventListener('fullscreenchange', () => {
        const panel = document.querySelector('.animation-panel');
        const isFs = !!document.fullscreenElement;

        const w = panel.clientWidth;
        const h = panel.clientHeight;

        try {
            // Sync renderer/camera to current panel size
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            controls.update();
        } catch (e) {}

        // Extra: some browsers report sizes late — schedule a second pass
        setTimeout(() => {
            const ww = panel.clientWidth;
            const hh = panel.clientHeight;
            renderer.setSize(ww, hh, false);
            camera.aspect = ww / hh;
            camera.updateProjectionMatrix();
            controls.update();
        }, 50);

        // If you changed canvas style for fullscreen, undo it here
        const canvas = document.getElementById('threejs-canvas');
        if (!isFs) {
            canvas.style.width = '100%';
            canvas.style.height = '100%';
        }
        
        syncButtons();
    });

    syncButtons();
}

setupFullscreenButton();

