import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';


let pattern = [3];
let beatsPerSecond = 2;

// CLOCK 
let beatTime = 0;
let running = true;
let previousIntBeat = -1;

// BALL STATES
const IN_AIR = 0;
const LANDED_WAIT = 1;
const READY = 2;

// BALL OBJECTS
let balls = [
    { id: 0, state: READY, flight: null, homeHand: 0 },
    { id: 1, state: READY, flight: null, homeHand: 1 },
    { id: 2, state: READY, flight: null, homeHand: 0 }
];

// hand: 0 = R, 1 = L
let hand = 0;
let positionInPattern = 0;

function handName(h) { return h === 0 ? "R" : "L"; }
function getTrajectoryFor(throwValue, handIndex) { return `${throwValue}${handIndex === 0 ? "R" : "L"}`; }

// SITESWAP PARSING

function parseSiteswap(str) {
    if (typeof str !== 'string') return { valid: false };
    const s = str.replace(/\s+/g, '');
    if (s.length === 0) return { valid: false };

    // Accept only digits 1-9.
    if (!/^[1-9]+$/.test(s)) {
        return { valid: false };
    }

    const n = s.length;
    const values = [];
    let sum = 0;

    // Convert the string to an array 
    for (let i = 0; i < n; i++) {
        const ch = s[i];
        const v = parseInt(ch, 10);
        if (!Number.isFinite(v) || v < 0) return { valid: false };
        values.push(v);
        sum += v;
    }

    if (sum % n !== 0) {
        return { valid: false };
    }
    const ballsCount = sum / n;
    const groundState = findGroundStateRotation(values, ballsCount);
    
    if (!groundState.isGround) {
        return { valid: false, values };
    }
    
    return { valid: true, values, balls: ballsCount, 
    groundStateRotation: groundState.rotation, isGroundState: groundState.isGround };
}

function findGroundStateRotation(patternArr, numBalls) {
    const n = patternArr.length;
    let bestRotation = 0;
    let bestScore = Infinity;

    for (let rotation = 0; rotation < n; rotation++) {
        const rotated = rotatePattern(patternArr, rotation);
        const score = simulateRotation(rotated, numBalls, n);
        
        if (score !== null && score < bestScore) {
            bestScore = score;
            bestRotation = rotation;
        }
    }

    return bestScore < Infinity 
        ? { rotation: bestRotation, isGround: true }
        : { rotation: 0, isGround: false };
}

function rotatePattern(arr, rotation) {
    const rotated = [];
    for (let i = 0; i < arr.length; i++) {
        rotated.push(arr[(i + rotation) % arr.length]);
    }
    return rotated;
}

function simulateRotation(pattern, numBalls, cycleLength) {
    const ballStates = initializeBalls(Math.ceil(numBalls));
    const simBeats = cycleLength * 3; 
    
    for (let beat = 0; beat < simBeats; beat++) {
        updateBallStates(ballStates, beat);
        
        const throwValue = pattern[beat % cycleLength];
        const throwingHand = beat % 2;
        const readyBall = ballStates.find(b => b.state === 'READY' && b.hand === throwingHand);
        
        if (!readyBall) return null;
        
        readyBall.state = 'IN_AIR';
        readyBall.throwValue = throwValue;
        readyBall.landBeat = beat + throwValue;
    }
    

    return getFirstCycleScore(ballStates, cycleLength);
}

function initializeBalls(count) {
    const balls = [];
    for (let i = 0; i < count; i++) {
        balls.push({
            id: i,
            state: 'READY',
            landBeat: -1,
            throwValue: 0,
            hand: i % 2 
        });
    }
    return balls;
}

function updateBallStates(ballStates, beat) {
    for (const ball of ballStates) {
        if (ball.state === 'IN_AIR' && beat >= ball.landBeat) {
            ball.state = 'READY';
            if (ball.throwValue % 2 === 1) {
                ball.hand = 1 - ball.hand;
            }
        }
    }
}

function getFirstCycleScore(ballStates, cycleLength) {
    let maxLandTime = 0;
    for (const ball of ballStates) {
        if (ball.landBeat < cycleLength && ball.landBeat > maxLandTime) {
            maxLandTime = ball.landBeat;
        }
    }
    return maxLandTime;
}

function applySiteswapString(siteswapStr) {
    const res = parseSiteswap(siteswapStr);
    if (!res.valid) {
        return false;
    }

  
    const rotatedValues = res.groundStateRotation > 0 ? 
        res.values.slice(res.groundStateRotation).concat(res.values.slice(0, res.groundStateRotation)) :
        res.values;

  
    pattern.length = 0;
    for (const v of rotatedValues) pattern.push(v);
    positionInPattern = 0;
    hand = 0;
    previousIntBeat = -1;


    const required = Math.max(1, Math.round(res.balls));

    balls = [];
    for (let i = 0; i < required; i++) {
        const homeHand = i % 2;
        balls.push({ id: i, state: READY, flight: null, homeHand });
    }

    return true;
}

// MAIN LOOP

let lastTimestamp = performance.now();

function update(dt) {
    if (running) {
        beatTime += dt * beatsPerSecond;
    }
    const intBeat = Math.floor(beatTime);
    updateBalls();
    if (intBeat !== previousIntBeat && running) {
        throwNext(intBeat);
        previousIntBeat = intBeat;
    }
}

function loop(ts) {
    const dtSec = (ts - lastTimestamp) / 1000;
    lastTimestamp = ts;
    update(dtSec);
    if (running) requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function throwNext(intBeat) {
    const throwValue = pattern[positionInPattern];
    const curveName = getTrajectoryFor(throwValue, hand);
    let ball = balls.find(b => b.state === READY && b.homeHand === hand);
    if (!ball) {
        ball = balls.find(b => b.state === READY);
    }

    const intendedLandBeat = intBeat + throwValue;
    let actualLandBeat = intBeat + throwValue - 1;
    if (throwValue === 1) {
        actualLandBeat = intBeat + 1;
    }

    if (throwValue === 2) {
        ball.state = LANDED_WAIT;
        ball.readyBeat = intendedLandBeat;
    } else {
        ball.state = IN_AIR;
        ball.flight = {
            startBeat: intBeat,
            intendedLandBeat: intendedLandBeat,
            actualLandBeat: actualLandBeat,
            value: throwValue,
            curveName: curveName
        };
        if (throwValue === 1) {
            const throwHand = hand;
            const catchHand = 1 - hand;
            const fromPos = (throwHand === 0 ? (rightHandBall ? rightHandBall.position.clone() : _getStaticHandPos(throwHand))
                                           : (leftHandBall  ? leftHandBall.position.clone()  : _getStaticHandPos(throwHand)));
            const endPos   = getArchBallPosAt(catchHand, intBeat + 1) || _getStaticHandPos(catchHand);
            ball.flight.startPos = fromPos;
            ball.flight.endPos   = endPos;
        }
    }
    

    if (throwValue % 2 === 1) {
        ball.homeHand = 1 - ball.homeHand;
    }

    positionInPattern = (positionInPattern + 1) % pattern.length;
    hand = 1 - hand;
}

// UPDATING BALLS EVERY FRAME
function updateBalls() {
    const currentTime = beatTime; 

    for (let ball of balls) {
        if (ball.state === IN_AIR) {
            const f = ball.flight;
            if (!f) continue;

            if (currentTime >= f.actualLandBeat) {
                if (currentTime >= f.intendedLandBeat) {
                    ball.state = READY;
                } else {
                    ball.state = LANDED_WAIT;
                    ball.readyBeat = f.intendedLandBeat;
                }

                ball.flight = null;
            }
        } else if (ball.state === LANDED_WAIT) {
            if (currentTime >= ball.readyBeat) {
                ball.state = READY;
                delete ball.readyBeat;
            }
        }
    }
}

// SETTINGS
function setBeatsPerSecond(v) {
    beatsPerSecond = Number(v) || beatsPerSecond;
}

function togglePause() {
    running = !running;
    if (running) {
        lastTimestamp = performance.now();
        requestAnimationFrame(loop);
    }
    return running;
}

function skipToNextBeat() {
    const newBeat = Math.floor(beatTime) + 1;
    beatTime = newBeat;
    updateBalls();
    if (newBeat !== previousIntBeat) {
        throwNext(newBeat);
        previousIntBeat = newBeat;
    }
}

function skipToPreviousBeat() {
    const currentBeat = Math.floor(beatTime);
    if (currentBeat > 0) {
        const targetBeat = currentBeat - 1;
        resetToBeginning();
        replayUpToBeat(targetBeat);
    } else {
        beatTime = 0;
    }
}


function resetToBeginning() {
    beatTime = 0;
    previousIntBeat = -1;
    positionInPattern = 0;
    hand = 0;
    for (const ball of balls) {
        ball.state = READY;
        ball.flight = null;
        delete ball.readyBeat;
        delete ball._flightProcessed;
        delete ball._flightReversed;
        ball.homeHand = (ball.id % 2);
        delete ball._carryInProgress;
        delete ball._carryHand;
    }
}

function resetEngine() {
    resetToBeginning();
    drawArchLogic();
}

function replayUpToBeat(targetBeat) {
    for (let beat = 0; beat <= targetBeat; beat++) {
        beatTime = beat;
        updateBalls();
        if (beat !== previousIntBeat) {
            throwNext(beat);
            previousIntBeat = beat;
        }
    }
}

// ARMATURE NAMES
let currentCharacterModel = null; 
let rightForeArmBone = null;
let leftForeArmBone = null;
let rightShoulderBone = null;
let leftShoulderBone = null;
let rightHandBone = null;
let leftHandBone = null;



// SCALE AND POSITON OF EVERY CHARACTER 

const CHARACTER_TRANSFORMS = {
    Ninja: {
        scale: 0.0098,
        position: { x: -0.33, y: 0, z: 0 },
    },
    Abe: {
        scale: 0.011,
        position: { x: -0.44, y: 0, z: 0 },
    },
    Clown: {
        scale: 0.0083,
        position: { x: -0.35, y: 0, z: 0 },
    },
    Dummy: {
        scale: 0.0098,
        position: { x: -0.3, y: 0, z: 0 },
    },
};

let rightShoulderBase = { x: 0, y: 0, z: 0 };
let leftShoulderBase = { x: 0, y: 0, z: 0 };
let rightForeArmBase = { x: 0, y: 0, z: 0 };
let leftForeArmBase = { x: 0, y: 0, z: 0 };


const DEFAULT_POSE = {
    rightForeArmZ: -Math.PI / 2,
    leftForeArmZ: Math.PI / 2,
    foreArmX: Math.PI / 2, 
    rightShoulder: { x: Math.PI / 2, y: 0, z: 0 },  
    leftShoulder: { x: Math.PI / 2, y: 0, z: 0 }    
};


let rightForeArmRotation; 
let leftForeArmRotation;   

let rightHandRotX;
let rightHandRotY;
let leftHandRotX;
let leftHandRotY;
let rightShoulderRotX;
let rightShoulderRotY;
let rightShoulderRotZ;
let leftShoulderRotX;
let leftShoulderRotY;
let leftShoulderRotZ;

const motionToggles = {
    shoulder: { x: false, y: false, z: false }, 
    forearm:  { x: false, y: false, z: false }   
};

function resetArmPoseToDefault() {
    const forearmOffsetRad = THREE.MathUtils.degToRad(25);
    rightForeArmRotation = DEFAULT_POSE.rightForeArmZ + forearmOffsetRad;
    leftForeArmRotation = DEFAULT_POSE.leftForeArmZ - forearmOffsetRad;
    rightHandRotX = DEFAULT_POSE.foreArmX;
    rightHandRotY = 0;
    leftHandRotX = DEFAULT_POSE.foreArmX;
    leftHandRotY = 0;
    rightShoulderRotX = DEFAULT_POSE.rightShoulder.x;
    rightShoulderRotY = DEFAULT_POSE.rightShoulder.y;
    rightShoulderRotZ = DEFAULT_POSE.rightShoulder.z;
    leftShoulderRotX = DEFAULT_POSE.leftShoulder.x;
    leftShoulderRotY = DEFAULT_POSE.leftShoulder.y;
    leftShoulderRotZ = DEFAULT_POSE.leftShoulder.z;
}
 

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);

const canvas = document.getElementById('threejs-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x87CEEB, 1); 
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


const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.zoomSpeed = 2; 


const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);


const ambientLight = new THREE.AmbientLight(0xffffff, 2);
scene.add(ambientLight);

const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(5, 10, 2);
scene.add(dir);

const centerLight = new THREE.PointLight(0xffffff, 3.0, 10);
centerLight.position.set(0, 2.5, 0);
centerLight.castShadow = true;
scene.add(centerLight);



const trajectories = {};
const pathBase = '/trajectories/';


function getArchBallPosAt(hand, beat) {
    const twoBeatCycle = (beat % 2.0);
    if (hand === 0) {
        if (twoBeatCycle < 1) {
            return getPositionOnCurve(rightHandUpperArchPoints, twoBeatCycle / 1);
        } else {
            return getPositionOnCurve(rightHandLowerArchPoints, (twoBeatCycle - 1) / 1);
        }
    } else {
        if (twoBeatCycle < 1) {
            return getPositionOnCurve(leftHandLowerArchPoints, twoBeatCycle / 1);
        } else {
            return getPositionOnCurve(leftHandUpperArchPoints, (twoBeatCycle - 1) / 1);
        }
    }
}

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
    line.visible = trajectoriesVisible; 
    scene.add(line);
    trajectoryLines.push(line);
}

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
const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.6 });
const ballGeo = new THREE.SphereGeometry(0.04, 12, 12);

let debugMode = false;

let tentVisible = true;
const tentMeshes = [];

let rightHandBall = null;
let leftHandBall = null;
const archBallRadius = 0.0175;

let rightHandUpperArchPoints = [];
let rightHandLowerArchPoints = [];
let leftHandUpperArchPoints = [];
let leftHandLowerArchPoints = [];


const ballTrails = new Map();  
let trailLength = 300; 

function createArchBalls() {
    if (!rightHandBall) {
        const geo = new THREE.SphereGeometry(archBallRadius, 12, 12);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.5 });
        rightHandBall = new THREE.Mesh(geo, mat);
        rightHandBall.castShadow = true;
        rightHandBall.receiveShadow = true;
        rightHandBall.visible = debugMode; 
        scene.add(rightHandBall);
    }
    
    if (!leftHandBall) {
        const geo = new THREE.SphereGeometry(archBallRadius, 12, 12);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.5 });
        leftHandBall = new THREE.Mesh(geo, mat);
        leftHandBall.castShadow = true;
        leftHandBall.receiveShadow = true;
        leftHandBall.visible = debugMode; 
        scene.add(leftHandBall);
    }
}

function getPositionOnCurve(points, progress) {
    if (points.length === 0) return new THREE.Vector3();
    if (points.length === 1) return points[0].clone();
    const idx = progress * (points.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, points.length - 1);
    const t = idx - i0;
    const p = points[i0].clone().lerp(points[i1], t);
    return p;
}

function updateBallTrails() {
    if (!running) return;
    for (const b of balls) {
        const trail = ballTrails.get(b.id);
        const mesh = ballMeshes.get(b.id);
        if (!trail || !mesh) continue;
        
        if (beatTime > 0.1) {
            const ballColor = mesh.material.color;
            
            trail.positions.push(mesh.position.clone());
            
            if (trail.positions.length > trail.maxLength) {
                trail.positions.shift();
            }
        }
        
        if (trail.positions.length >= 2) {
            if (trail.line) {
                trail.container.remove(trail.line);
                trail.line.geometry.dispose();
                trail.line.material.dispose();
            }
            
            const curve = new THREE.CatmullRomCurve3(trail.positions);
            
            const tubularSegments = Math.max(32, Math.round(64 * (trail.maxLength / 300)));
            const radialSegments = Math.max(8, Math.round(16 * (trail.maxLength / 300)));
            
            const tubeGeo = new THREE.TubeGeometry(curve, tubularSegments, 0.005, radialSegments, false);
            const tubeMat = new THREE.MeshStandardMaterial({ 
                color: mesh.material.color,
                transparent: true,
                opacity: 0.6,
                emissive: mesh.material.color,
                emissiveIntensity: 0.2
            });
            trail.line = new THREE.Mesh(tubeGeo, tubeMat);
            
            const setting = propSettings[b.id];
            trail.line.visible = !!(setting && setting.trail);
            
            trail.container.add(trail.line);
        }
    }
}

function clearBallTrails() {

    for (const [ballId, trail] of ballTrails) {
        trail.positions = [];
        if (trail.line) {
            trail.container.remove(trail.line);
            trail.line.geometry.dispose();
            trail.line.material.dispose();
            trail.line = null;
        }
    }
}

function sampleNegativeArcPoints(startPos, endPos, dipDepth = -0.12, samples = 64) {
    const pts = [];
    for (let i = 0; i <= samples; i++) {
        const progress = i / samples;
        const eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const arcFactor = Math.sin(progress * Math.PI);
        const p = new THREE.Vector3().lerpVectors(startPos, endPos, eased);
        p.y += dipDepth * arcFactor;
        pts.push(p);
    }
    return pts;
}

let sceneCenter = new THREE.Vector3(0, 2, 0);
const handOffset = 0.22;
const _getStaticHandPos = (h) => (h === 0
    ? sceneCenter.clone().add(new THREE.Vector3(-handOffset, -0.02, 0))
    : sceneCenter.clone().add(new THREE.Vector3(handOffset, -0.02, 0)));

let dynamicHandPos = [_getStaticHandPos(0), _getStaticHandPos(1)];
const getHandBasePos = (h) => {
    const idx = (h === 0) ? 0 : 1;
    const p = dynamicHandPos && dynamicHandPos[idx];
    return (p ? p.clone() : _getStaticHandPos(idx));
};

const getHandBoneWorldPos = (handIndex) => {
    const bone = (handIndex === 0) ? rightHandBone : leftHandBone;
    if (!bone) return getHandBasePos(handIndex);
    try {
        const worldPos = new THREE.Vector3();
        bone.getWorldPosition(worldPos);
        worldPos.y += 0.03;
        return worldPos;
    } catch (e) {
        return getHandBasePos(handIndex);
    }
};

let betweenArchLines = [];

function clearBetweenTrajectoryArches() {
    try {
        while (betweenArchLines.length > 0) {
            const line = betweenArchLines.pop();
            if (line) {
                scene.remove(line);
                if (line.geometry) line.geometry.dispose();
                if (line.material) line.material.dispose();
            }
        }
    } catch {}
}

function clearAllArches() {
    clearBetweenTrajectoryArches();
}

//HAND MOVEMENT
function drawArchLogic() {
    clearBetweenTrajectoryArches();
    if (!trajectories) return;
    
    const samples = 64;
    const riseHeight = 0.1;   
    const dipDepth = -0.1;    

    const curve8R = trajectories['8R'];
    if (curve8R) {
        try {
            const startPos = curve8R.getPoint(1).clone();
            const endPos = curve8R.getPoint(0).clone();
            
            const pts = [];
            for (let i = 0; i <= samples; i++) {
                const progress = i / samples;
                const eased = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                const arcFactor = Math.sin(progress * Math.PI);
                const p = new THREE.Vector3().lerpVectors(startPos, endPos, eased);
                p.y += riseHeight * arcFactor;
                pts.push(p);
            }
            
            rightHandUpperArchPoints = pts;
            
            const geom = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0xff00ff, linewidth: 3, transparent: true, opacity: 0.85 });
            const line = new THREE.Line(geom, mat);
            line.visible = debugMode;
            scene.add(line);
            betweenArchLines.push(line);
        } catch (e) {  }
    }

    if (curve8R) {
        try {
            const startPos = curve8R.getPoint(0).clone();
            const endPos = curve8R.getPoint(1).clone();
            const pts = sampleNegativeArcPoints(startPos, endPos, dipDepth, samples);
            rightHandLowerArchPoints = pts;
            
            const geom = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0xff00ff, linewidth: 3, transparent: true, opacity: 0.85 });
            const line = new THREE.Line(geom, mat);
            line.visible = debugMode;
            scene.add(line);
            betweenArchLines.push(line);
        } catch (e) {  }
    }
    const curve8L = trajectories['8L'];
    if (curve8L) {
        try {
            const startPos = curve8L.getPoint(1).clone();
            const endPos = curve8L.getPoint(0).clone();
            
            const pts = [];
            for (let i = 0; i <= samples; i++) {
                const progress = i / samples;
                const eased = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                const arcFactor = Math.sin(progress * Math.PI);
                const p = new THREE.Vector3().lerpVectors(startPos, endPos, eased);
                p.y += riseHeight * arcFactor;
                pts.push(p);
            }
            
            leftHandUpperArchPoints = pts;
            
            const geom = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3, transparent: true, opacity: 0.85 });
            const line = new THREE.Line(geom, mat);
            line.visible = debugMode;
            scene.add(line);
            betweenArchLines.push(line);
        } catch (e) { /* silent */ }
    }

    if (curve8L) {
        try {
            const startPos = curve8L.getPoint(0).clone();
            const endPos = curve8L.getPoint(1).clone();
            const pts = sampleNegativeArcPoints(startPos, endPos, dipDepth, samples);
            leftHandLowerArchPoints = pts;
            
            const geom = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3, transparent: true, opacity: 0.85 });
            const line = new THREE.Line(geom, mat);
            line.visible = debugMode;
            scene.add(line);
            betweenArchLines.push(line);
        } catch (e) { /* silent */ }
    }
}

function createBallMeshes() {
    const ids = new Set(balls.map(b => b.id));
    for (const [id, mesh] of ballMeshes) {
        if (!ids.has(id)) {
            scene.remove(mesh);
            ballMeshes.delete(id);
            
            const trail = ballTrails.get(id);
            if (trail && trail.container) {
                scene.remove(trail.container);
                ballTrails.delete(id);
            }
        }
    }
    for (const b of balls) {
        if (!ballMeshes.has(b.id)) {
            const m = new THREE.Mesh(ballGeo, ballMaterial.clone());
            m.castShadow = true;
            m.receiveShadow = true;

            m.position.copy(sceneCenter).add(new THREE.Vector3((b.id - 1) * 0.08, 0, 0));
            scene.add(m);
            ballMeshes.set(b.id, m);
            
            const container = new THREE.Group();
            scene.add(container);
            ballTrails.set(b.id, { container, positions: [], maxLength: trailLength });
        }
    }

    updatePropCountUI();
    try { renderPropSettingsUI(); } catch (e) {}
}

function updateBallVisuals() {
    if (balls.length !== ballMeshes.size) createBallMeshes();

    const currentBeat = beatTime; 

    recomputeHandTargets(currentBeat);

    for (const b of balls) {
        const mesh = ballMeshes.get(b.id);
        if (!mesh) continue;

        if (b.flight) {
            const f = b.flight;
            
            const start = f.startBeat;
            const end = f.actualLandBeat;

            const durationBeats = Math.max(0.0001, end - start);
            let t = (currentBeat - start) / durationBeats;
            t = Math.min(Math.max(t, 0), 1);

            const throwingHand = (Math.floor(start) % 2 === 0) ? 0 : 1;
            const throwingHandPos = _getStaticHandPos(throwingHand);

            if (f.value === 2) {
            } else if (f.value === 1) {
                let fromPos, toPos;
                if (f.startPos && f.endPos) {
                    fromPos = f.startPos.clone();
                    toPos   = f.endPos.clone();
                } else {
                    if (throwingHand === 0) {
                        fromPos = rightHandBall ? rightHandBall.position.clone() : _getStaticHandPos(0);
                        toPos   = leftHandBall  ? leftHandBall.position.clone()  : _getStaticHandPos(1);
                    } else {
                        fromPos = leftHandBall  ? leftHandBall.position.clone()  : _getStaticHandPos(1);
                        toPos   = rightHandBall ? rightHandBall.position.clone() : _getStaticHandPos(0);
                    }
                }
                const p = fromPos.lerp(toPos, t);
                mesh.position.copy(p);
            } else {
                const curve = (f.curveName && trajectories[f.curveName]) ? trajectories[f.curveName] : null;
                if (!curve) {
                    continue;
                }
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
            }
        }
        else {
            delete b._flightProcessed;
            delete b._flightReversed;

            const assignedHand = b.homeHand;
            
            const archBall = (assignedHand === 0) ? rightHandBall : leftHandBall;
            if (archBall) {
                mesh.position.copy(archBall.position);
            } else {
                const handBonePos = getHandBoneWorldPos(assignedHand);
                mesh.position.copy(handBonePos);
            }
        }
    }
}

function recomputeHandTargets(currentBeat) {
    dynamicHandPos = [_getStaticHandPos(0), _getStaticHandPos(1)];
}

function wireUI() {
    const input = document.querySelector('.siteswapinput');

    function setCorrectedNotationMessage(text) {
        const el = document.getElementById('correctedNotationMsg');
        if (!el) return;
        const body = text ? `Correct order: ${text}` : 'Correct order:';
        el.textContent = body;
        el.style.display = 'block';
    }
    function updateCorrectedNotationFromLogic() {
        try {
            const notation = Array.isArray(pattern) ? pattern.join('') : '';
            setCorrectedNotationMessage(notation);
        } catch (e) {
            setCorrectedNotationMessage('');
        }
    }

    let _lastInvalidTs = 0;
    let _removeTimer = null;

    function markInputInvalid(isInvalid, message) {
        if (!input) return;
        if (_removeTimer) { clearTimeout(_removeTimer); _removeTimer = null; }

        if (isInvalid) {
            _lastInvalidTs = Date.now();
            input.style.border = '2px solid #b71c1c';
            input.style.background = '#ffb4bfff';      
            input.style.color = '#000';
            input.style.boxShadow = '0 0 12px rgba(183,28,28,0.18)';
            input.setAttribute('aria-invalid', 'true');
            input.title = message ? message : '';
            input.style.transition = 'background 160ms ease, box-shadow 160ms ease, border 160ms ease';
        } else {
            const elapsed = Date.now() - (_lastInvalidTs || 0);
            const minMs = 500;
            if (elapsed < minMs) {
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
                input.style.border = '';
                input.style.background = '';
                input.style.color = '';
                input.style.boxShadow = '';
                input.removeAttribute('aria-invalid');
                input.title = '';
            }
        }
    }
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
                markInputInvalid(true, '');
                setCorrectedNotationMessage('');
                return false;
            } else {
                markInputInvalid(false);
                return true;
            }
        } catch (e) {
            markInputInvalid(true, String(e));
            setCorrectedNotationMessage('');
            return false;
        }
    }


    if (input) {
        input.addEventListener('input', validateInput);
        input.addEventListener('blur', validateInput);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
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


    updateCorrectedNotationFromLogic();

    const rnd = document.querySelector('.btn') || document.querySelector('#RandomButton') || document.querySelector('.RandomButton');
    if (rnd) {
  const randMaxThrow = document.getElementById('randMaxThrow');
  const randMaxThrowValue = document.getElementById('randMaxThrowValue');
  if (randMaxThrow && randMaxThrowValue) {
    randMaxThrow.addEventListener('input', () => { randMaxThrowValue.textContent = randMaxThrow.value; });
  }

  function generateRandomSiteswap(minLen = 3, maxLen = 7, maxThrow = 9) {
    maxThrow = Math.max(3, Math.floor(maxThrow));
    const len = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
    
    const pickThrow = () => Math.floor(Math.random() * maxThrow) + 1;
    
    let s = '';
    let sum = 0;
    for (let i = 0; i < len; i++) {
      const throw_val = pickThrow();
      s += String(throw_val);
      sum += throw_val;
    }
    
    const requiredSum = len * 3;
    if (sum < requiredSum) {
      const deficit = requiredSum - sum;
      const arr = s.split('').map(Number);
      
      for (let i = 0; i < deficit; i++) {
        const pos = Math.floor(Math.random() * len);
        if (arr[pos] < maxThrow) {
          arr[pos]++;
        } else {
          const canInc = arr.findIndex(v => v < maxThrow);
          if (canInc !== -1) arr[canInc]++;
        }
      }
      s = arr.join('');
    }
    
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
        if (ok) { 
          accepted = cand; 
          clearAllArches();
          resetEngine();
          clearBallTrails();
          createBallMeshes();
          try { drawArchLogic(); } catch (e) { }
          updateCorrectedNotationFromLogic();
          break; 
        }
      } catch (e) {
      }
    }

    if (!accepted) {
      const fallback = ['333', '441', '531', '522'][Math.floor(Math.random() * 4)];
      if (input) input.value = fallback;
      markInputInvalid(false);
      try { 
        applySiteswapString(fallback); 
        clearAllArches();
        resetEngine();
        createBallMeshes();
        try { drawArchLogic(); } catch (e) { }
        updateCorrectedNotationFromLogic();
      } catch (e) { }
    }
  });
}
    const reset = document.querySelector('.btn.secondary') || document.querySelector('.ResetBtn');
    if (reset) {
        reset.addEventListener('click', () => {
            resetEngine();
            clearBallTrails();
            
            for (const b of balls) {
                delete propSettings[b.id];
            }
            
            if (speed) {
                speed.value = 1.0;
                const raw = 1.0;
                const v = Math.max(0.01, Math.min(2, raw));
                setBeatsPerSecond(v);
                if (speedValue) speedValue.textContent = v.toFixed(2) + '×';
            }
            
            if (trailLengthSlider) {
                trailLengthSlider.value = 250;
                trailLength = 250;
                if (trailLengthValue) trailLengthValue.textContent = '250';
                for (const trail of ballTrails.values()) {
                    trail.maxLength = 250;
                    if (trail.positions.length > 250) {
                        trail.positions = trail.positions.slice(-250);
                    }
                }
            }
            
            if (randMaxThrow) {
                randMaxThrow.value = 9;
                if (randMaxThrowValue) randMaxThrowValue.textContent = '9';
            }
            
            resetSceneToInitial();
            setCameraFront();
            try { renderPropSettingsUI(true); } catch (e) {}

        });
    }

    const doSave = () => {
        if (!validateInput()) {
            if (input) input.focus();
            return;
        }
        const s = (input && input.value.trim()) || '';
        if (!s) return;
        
        const ok = applySiteswapString(s);
        if (ok) {
            resetEngine();
            clearBallTrails();
            
            try { drawArchLogic(); } catch (e) { }
            
            createBallMeshes();
            updateCorrectedNotationFromLogic();
        } else {
            markInputInvalid(true, '');
        }
    };

    const save = Array.from(document.querySelectorAll('.btn.secondary, .SaveBtn')).find(el => /save/i.test(el.textContent));
    if (save) {
        save.addEventListener('click', doSave);
    }
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doSave();
            }
        });
    }
    const speed = document.getElementById('speed') || document.querySelector('.speed-slider');
    const speedValue = document.getElementById('speedValue');
    if (speed) {
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
function normalizeSliderValue() {
    const rawInit = Number(speed.value);
    let clamped;
    if (!Number.isFinite(rawInit)) {
        clamped = 1.00;
    } else {
        clamped = Math.max(0.01, Math.min(2, Math.round(rawInit * 100) / 100));
    }

    speed.value = 1;
}
normalizeSliderValue();
applySpeed();
    }

    const trailLengthSlider = document.getElementById('trailLengthSlider');
    const trailLengthValue = document.getElementById('trailLengthValue');
    if (trailLengthSlider && trailLengthValue) {
        trailLengthSlider.addEventListener('input', () => {
            const val = Number(trailLengthSlider.value);
            trailLength = val;
            trailLengthValue.textContent = val;
            for (const trail of ballTrails.values()) {
                trail.maxLength = val;
                
                if (trail.positions.length > val) {
                    trail.positions = trail.positions.slice(-val);
                }
            }
        });
    }

    const pauseBtn = document.querySelector('.toggle-pause-button');
    const updatePauseButtonIcon = (running) => {
        if (pauseBtn) pauseBtn.textContent = running ? '⏸️' : '▶️';
    };
    const togglePauseAndSync = () => {
        const running = togglePause();
        updatePauseButtonIcon(running);
        return running;
    };
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            togglePauseAndSync();
        });
        updatePauseButtonIcon(true);
    }
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            togglePauseAndSync();
        }
    });

    const prevBtn = document.querySelector('.previous-throw-button');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            skipToPreviousBeat();
        });
    }
    const nextBtn = document.querySelector('.next-throw-button');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            skipToNextBeat();
        });
    }

    const trajCheckbox = document.getElementById('showTrajectoriesCheckbox');
    if (trajCheckbox) {
        trajCheckbox.addEventListener('change', (e) => setTrajectoriesVisible(!!e.target.checked));
    }

    const tentCheckbox = document.getElementById('showTentCheckbox');
    if (tentCheckbox) {
        tentCheckbox.checked = tentVisible;
        tentCheckbox.addEventListener('change', (e) => setTentVisible(!!e.target.checked));
    }

    const debugCheckbox = document.getElementById('debugModeCheckbox');
    if (debugCheckbox) {
        debugCheckbox.checked = debugMode;
        debugCheckbox.addEventListener('change', (e) => {
            debugMode = e.target.checked;
            updateDebugModeVisibility();
        });
    }

}

function setCameraFront() {
    camera.position.set(2, 1.5, 0);
    controls.target.set(0, 1.5, 0);
    camera.fov = 50; 
    camera.near = 0.01;
    camera.updateProjectionMatrix();
    
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    
    controls.update();
    renderer.render(scene, camera);
}

function setCameraSide() {
    camera.position.set(0, 1.7, 2);
    controls.target.set(0, 1.7, 0);
    camera.fov = 45;  
    camera.near = 0.1; 
    camera.updateProjectionMatrix();
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    
    controls.update();
}

function setCameraPOV() {
    let charX = -0.3;
    let charZ = 0;
    if (currentCharacterModel) {
        charX = currentCharacterModel.position.x;
        charZ = currentCharacterModel.position.z;
    }
    
    camera.position.set(charX, 1.64, charZ);
    
    const forward = new THREE.Vector3(1, 0, 0); 
    controls.target.copy(camera.position).add(forward);
    
    camera.fov = 130;  
    camera.near = 0.23;
    camera.updateProjectionMatrix();
    
    controls.enablePan = false;  
    controls.enableZoom = false; 
    controls.enableRotate = true;  
    controls.minDistance = 0;  
    controls.maxDistance = Infinity;  
    
    controls.update();
}
const viewSelector = document.querySelector('.ViewSelector');
if (viewSelector) {
    if (!viewSelector.value) viewSelector.value = 'Front View';
    viewSelector.addEventListener('change', (e) => {
        const v = (e.target.value || '').toLowerCase();
        if (v.includes('front')) setCameraFront();
        else if (v.includes('side')) setCameraSide();
        else if (v.includes('pov')) setCameraPOV();
    });
}

(function setupCharacterSelector() {
    try {
        const select = document.getElementById('characterSelector');
        if (select) {
            select.addEventListener('change', (e) => {
                loadCharacter(e.target.value);
            });
        }
    } catch (e) {
        console.error('Failed to setup character selector:', e);
    }
})();

const clock = new THREE.Clock();

async function init() {
    await loadAllTrajectories();

    for (const key of Object.keys(trajectories)) {
        const curve = trajectories[key];
        if (!curve) continue;
        const color = key.endsWith('L') ? 0x00ff00 : 0xff00ff;
        drawCurve(curve, color);
    }

    try { drawArchLogic(); } catch (e) { }

    animate();

    const bounds = computeTrajectoriesBounds(trajectories);
    if (bounds) {
        fitCameraToBox(bounds, camera, controls, 1.15);
        const center = new THREE.Vector3();
        bounds.getCenter(center);
        sceneCenter.copy(center);
    }
    createBallMeshes();
    wireUI();
    resetArmPoseToDefault(true);
    setupFullscreenButton();
    updatePropCountUI();
    try { setCameraFront(); } catch (e) { }
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();
    if (resizeRendererToDisplaySize()) {
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
    }


    const currentBeat = beatTime; 
    const armAmplitude = THREE.MathUtils.degToRad(22.5);
    const armBias = THREE.MathUtils.degToRad(-2.5);
   
    const phaseY = Math.sin(currentBeat * Math.PI);
    const phaseXZ = Math.sin(currentBeat * Math.PI);
    const rightPhaseY = phaseY;
    const leftPhaseY = phaseY;
    const rightPhaseXZ = phaseXZ;
    const leftPhaseXZ = phaseXZ;

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
    }

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
        } catch (e) {}
    };

    if (rightForeArmBone) {
        const fDyn = motionToggles.forearm;
        const dynX = fDyn.x ? (armBias + rightPhaseXZ * armAmplitude) : 0;
        const dynY = fDyn.y ? (armBias + rightPhaseY  * armAmplitude) : 0;
        const dynZ = fDyn.z ? (armBias + rightPhaseXZ * armAmplitude) : 0;

        rightForeArmBone.rotation.z = rightForeArmBase.z + rightForeArmRotation + dynZ;
        rightForeArmBone.rotation.x = rightForeArmBase.x + rightHandRotX + dynX;
        rightForeArmBone.rotation.y = rightForeArmBase.y + rightHandRotY + dynY;
        rightForeArmBone.updateMatrixWorld(true);
        if (rightHandBall) {
            alignForearmToTarget(rightForeArmBone, rightHandBone, rightHandBall);
        }
    }
    if (leftForeArmBone) {
        const fDyn = motionToggles.forearm;
        const dynX = fDyn.x ? (armBias + leftPhaseXZ * armAmplitude) : 0;
        const dynY = fDyn.y ? (armBias + leftPhaseY  * armAmplitude) : 0;
        const dynZ = fDyn.z ? (armBias + leftPhaseXZ * armAmplitude) : 0;

        leftForeArmBone.rotation.z = leftForeArmBase.z + leftForeArmRotation + dynZ;
        leftForeArmBone.rotation.x = leftForeArmBase.x + leftHandRotX + dynX;
        leftForeArmBone.rotation.y = leftForeArmBase.y + leftHandRotY + dynY;
        leftForeArmBone.updateMatrixWorld(true);

        if (leftHandBall) {
            alignForearmToTarget(leftForeArmBone, leftHandBone, leftHandBall);
        }
    }
    try {
        createArchBalls();
        const twoBeatCycle = (currentBeat % 2.0);
        const upperArchDuration = 1; 
        const lowerArchDuration = 1; 
        
        if (rightHandBall && (rightHandUpperArchPoints.length > 0 || rightHandLowerArchPoints.length > 0)) {
            if (twoBeatCycle < upperArchDuration) {

                const localProgress = twoBeatCycle / upperArchDuration;
                rightHandBall.position.copy(getPositionOnCurve(rightHandUpperArchPoints, localProgress));
            } else {

                const localProgress = (twoBeatCycle - upperArchDuration) / lowerArchDuration;
                rightHandBall.position.copy(getPositionOnCurve(rightHandLowerArchPoints, localProgress));
            }
        }
        

        if (leftHandBall && (leftHandLowerArchPoints.length > 0 || leftHandUpperArchPoints.length > 0)) {
            if (twoBeatCycle < lowerArchDuration) {
                const localProgress = twoBeatCycle / lowerArchDuration;
                leftHandBall.position.copy(getPositionOnCurve(leftHandLowerArchPoints, localProgress));
            } else {
                const localProgress = (twoBeatCycle - lowerArchDuration) / upperArchDuration;
                leftHandBall.position.copy(getPositionOnCurve(leftHandUpperArchPoints, localProgress));
            }
        }
        updateBallTrails();
    } catch (e) {}


    updateBallVisuals();

    if (viewSelector && viewSelector.value && viewSelector.value.toLowerCase().includes('pov')) {
        if (currentCharacterModel) {
            const charX = currentCharacterModel.position.x;
            const charZ = currentCharacterModel.position.z;
            camera.position.x = charX;
            camera.position.z = charZ;
            camera.position.y = 1.64;  
            
            const lookDistance = 1.0;
            const forward = new THREE.Vector3(0, 0, -1);
            forward.applyQuaternion(camera.quaternion);
            controls.target.copy(camera.position).add(forward.multiplyScalar(lookDistance));
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();


let model;

function updatePropCountUI() {
    const count = Array.isArray(balls) ? balls.length : 0;
    const el = document.getElementById('prop-count');
    if (el) {
        el.textContent = String(count);
        return;
    }

    const header = Array.from(document.querySelectorAll('.rounded-box p, .panel p, .panel div'))
        .find(node => node && /ball settings/i.test(node.textContent));
    if (header) {
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
}

const propSettings = {}; 

function ensurePropSetting(id) {
    if (!propSettings[id]) {
        const defaultColors = [
            '#FF3B30', '#FF9500', '#FFD60A', '#4CD964', '#5AC8FA',
            '#007AFF', '#4E00CC', '#D500F9', '#FF00D0',
        ];
        propSettings[id] = {
            color: defaultColors[id % defaultColors.length],
            show: true,
            trail: false
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
    
    const trail = ballTrails.get(id);
    if (trail && trail.line) {
        trail.line.visible = !!setting.trail;
    }
}

function renderPropSettingsUI(applyToMeshes = true) {
    let tbody = document.getElementById('ballSettingsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    for (const b of balls) {
        ensurePropSetting(b.id);
        const s = propSettings[b.id];

        const tr = document.createElement('tr');
        const tdIndex = document.createElement('td');
        tdIndex.textContent = String(b.id + 1); 
        tr.appendChild(tdIndex);

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

        const tdTrail = document.createElement('td');
        const trailInput = document.createElement('input');
        trailInput.type = 'checkbox';
        trailInput.checked = !!s.trail;
        trailInput.addEventListener('change', (e) => {
            s.trail = !!e.target.checked;
            applyPropSettingToBall(b.id);
        });
        tdTrail.appendChild(trailInput);
        tr.appendChild(tdTrail);

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


        if (applyToMeshes) applyPropSettingToBall(b.id);
    }
}

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
            
            fullScene.traverse(node => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                    if (node.material && node.material.isMeshStandardMaterial) {
                        node.material.metalness = node.material.metalness || 0;
                        node.material.roughness = node.material.roughness || 1;
                    }

                    const n = (node.name || '').toLowerCase();
                    if (n.includes('tent')) {
                        tentMeshes.push(node);
                        node.visible = tentVisible;
                    }
                }
            });

            scene.add(fullScene);
            fullScene.visible = tentVisible; 
            try {
                const box = new THREE.Box3().setFromObject(fullScene);
                if (!box.isEmpty()) {
                    const c = new THREE.Vector3();
                    box.getCenter(c);
                    sceneCenter.copy(c);
                    fullScene.scale=500;
                }
            } catch (e) {}
        }
    );
} catch (e) {}

function loadCharacter(characterName) {
    if (currentCharacterModel) {
        scene.remove(currentCharacterModel);
        currentCharacterModel = null;
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
                characterModel.traverse(node => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                    }
                });

                scene.add(characterModel);
                const t = CHARACTER_TRANSFORMS[characterName];
                const defaultScale = 0.0098;
                const defaultPos = { x: -0.26, y: 0, z: 0 };
                const defaultRot = { x: 0, y: Math.PI / 2, z: 0 };
                const sc = (t && typeof t.scale === 'number') ? t.scale : defaultScale;
                characterModel.scale.set(sc, sc, sc);
                const pos = (t && t.position) ? t.position : defaultPos;
                characterModel.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
                const rot = (t && t.rotation) ? t.rotation : defaultRot;
                characterModel.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);

                // FINDING BONES
                let skinned = null; 
                characterModel.traverse(n => { if (!skinned && n.isSkinnedMesh) skinned = n; });
                if (skinned) { gltfModel = skinned; model = skinned; }

                rightForeArmBone = null;
                leftForeArmBone = null;
                rightShoulderBone = null;
                leftShoulderBone = null;
                rightHandBone = null;
                leftHandBone = null;

                if (skinned && skinned.skeleton) {
                    const bones = skinned.skeleton.bones;

                    const findBoneByExactName = (names) => bones.find(b =>
                    names.includes(b.name || '')) || null;

                    // Forearms
                    const explicitRightForeArm = findBoneByExactName([
                        'mixamorig8RightForeArm', 
                        'mixamorigRightForeArm'
                    ]);
                    const explicitLeftForeArm  = findBoneByExactName([
                        'mixamorigLeftForeArm',
                        'mixamorig8LeftForeArm'
                        ]);
                    // Upper arms
                    const explicitRightArm = findBoneByExactName([
                        'mixamorigRightArm',
                        'mixamorig8RightArm'
                    ]);
                    const explicitLeftArm  = findBoneByExactName([
                        'mixamorigLeftArm',
                        'mixamorig8LeftArm'
                    ]);
                    // Hands
                    const explicitRightHand = findBoneByExactName([
                        'mixamorig8RightHand',
                        'mixamorigRightHand'
                    ]);
                    const explicitLeftHand = findBoneByExactName([
                        'mixamorig8LeftHand',
                        'mixamorigLeftHand'
                    ]);

                    if (explicitRightHand) rightHandBone = explicitRightHand;
                    if (explicitLeftHand) leftHandBone = explicitLeftHand;

                    if (explicitRightForeArm) rightForeArmBone = explicitRightForeArm;
                    if (explicitLeftForeArm) leftForeArmBone = explicitLeftForeArm;


                    if (explicitRightArm) rightShoulderBone = explicitRightArm;
                    if (explicitLeftArm) leftShoulderBone = explicitLeftArm;
                    if (explicitRightHand) rightHandBone = explicitRightHand;
                    if (explicitLeftHand) leftHandBone = explicitLeftHand;

                    if (rightForeArmBone) {
                        rightForeArmBase.x = rightForeArmBone.rotation.x || 0;
                        rightForeArmBase.y = rightForeArmBone.rotation.y || 0;
                        rightForeArmBase.z = rightForeArmBone.rotation.z || 0;
                        rightForeArmBone.userData = rightForeArmBone.userData || {};
                        rightForeArmBone.userData.baseY = rightForeArmBone.position.y;
                    }
                    if (leftForeArmBone) {
                        leftForeArmBase.x = leftForeArmBone.rotation.x || 0;
                        leftForeArmBase.y = leftForeArmBone.rotation.y || 0;
                        leftForeArmBase.z = leftForeArmBone.rotation.z || 0;
                        leftForeArmBone.userData = leftForeArmBone.userData || {};
                        leftForeArmBone.userData.baseY = leftForeArmBone.position.y;
                    }

                    if (rightShoulderBone) {
                        rightShoulderBase = {
                            x: rightShoulderBone.rotation.x || 0,
                            y: rightShoulderBone.rotation.y || 0,
                            z: rightShoulderBone.rotation.z || 0
                        };
                    }
                    if (leftShoulderBone) {
                        leftShoulderBase = {
                            x: leftShoulderBone.rotation.x || 0,
                            y: leftShoulderBone.rotation.y || 0,
                            z: leftShoulderBone.rotation.z || 0
                        };
                    }

                    resetArmPoseToDefault();

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
                            } else {
                            }
                        } else {
                        }
                    } catch (e) {}

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
                    }
                }

                inspectArmature(characterModel);
            },
        (xhr) => {
        },
        (err) => {
        }
    );
    } catch (e) {
    }
}
loadCharacter('Ninja');

const trajectoryLines = [];
let trajectoriesVisible = false;

function setTrajectoriesVisible(visible) {
    trajectoriesVisible = !!visible;
    for (const ln of trajectoryLines) {
        ln.visible = trajectoriesVisible;
    }
}

function toggleTrajectories() {
    setTrajectoriesVisible(!trajectoriesVisible);
}

function setTentVisible(visible) {
    tentVisible = !!visible;
    if (fullScene) {
        try { fullScene.visible = tentVisible; } catch (e) {}
    }
    for (const m of tentMeshes) {
        try { m.visible = tentVisible; } catch (e) {}
    }
    const cb = document.getElementById('showTentCheckbox');
    if (cb) cb.checked = tentVisible;
}

function updateDebugModeVisibility() {
    if (rightHandBall) rightHandBall.visible = debugMode;
    if (leftHandBall) leftHandBall.visible = debugMode;
    
    for (const line of betweenArchLines) {
        if (line) line.visible = debugMode;
    }
    
    setTrajectoriesVisible(debugMode);
    const trajCheckbox = document.getElementById('showTrajectoriesCheckbox');
    if (trajCheckbox) trajCheckbox.checked = debugMode;
}

// T= toggle trajectories, Space= toggle pause, Left/Right Arrows = skip beats
window.addEventListener('keydown', (e) => {
    if (!e.repeat && (e.key === 't' || e.key === 'T')) {
        toggleTrajectories();
    }
    if (!e.repeat && (e.key === ' ' || e.code === 'Space')) {
        e.preventDefault(); 
        togglePauseAndSync();
    }
    if (!e.repeat && (e.key === 'ArrowLeft' || e.code === 'ArrowLeft')) {
        e.preventDefault();
        skipToPreviousBeat();
    }
    if (!e.repeat && (e.key === 'ArrowRight' || e.code === 'ArrowRight')) {
        e.preventDefault();
        skipToNextBeat();
    }
});


let initialCameraPos = null;
let initialControlsTarget = null;

function resetSceneToInitial() {
    if (initialCameraPos) {
        camera.position.copy(initialCameraPos);
    } else {
        camera.position.set(5, 2, 0);
    }
    if (initialControlsTarget) {
        controls.target.copy(initialControlsTarget);
    } else {
        controls.target.set(0, 2, 0);
    }
    controls.update();
    for (const [id, mesh] of ballMeshes) {
        try {
            mesh.visible = true;
            if (propSettings[id]) {
                propSettings[id].show = true;
            } else {
                ensurePropSetting(id);
            }
        } catch (e) {}
    }

    renderer.render(scene, camera);
}

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
function update(dt) {
    if (running) {
        beatTime += dt * beatsPerSecond;
    }
    const intBeat = Math.floor(beatTime);
    updateBalls();
    if (intBeat !== previousIntBeat && running) {
        throwNext(intBeat);
        previousIntBeat = intBeat;
    }
}
    btn.addEventListener('click', () => {
        toggleFullscreenFor(panel);
        if (exitBtn) exitBtn.style.display = 'inline-flex'; 
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
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            controls.update();
        } catch (e) {}
        syncButtons();
    });
    syncButtons();
}
setupFullscreenButton();