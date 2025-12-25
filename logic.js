// ==============================================
//   JUGGLING ENGINE (module with logger + siteswap validation)
// ==============================================

// -------- SETTINGS --------
export let pattern = [3];
export let beatsPerSecond = 2.5;
export const dwellBeats = 0.7;

// -------- CLOCK --------
export let beatTime = 0;
let running = true;
let previousIntBeat = -1;

// -------- BALL STATES --------
export const IN_AIR = 0;
export const LANDED_WAIT = 1;
export const READY = 2;

// -------- BALLS --------
export let balls = [
    { id: 0, state: READY, flight: null, wait: 0 },
    { id: 1, state: READY, flight: null, wait: 0 },
    { id: 2, state: READY, flight: null, wait: 0 }
];

// hand: 0 = R, 1 = L
export let hand = 0;
export let patternIndex = 0;

// logger callback (UI can set this)
let _logger = (...args) => { console.log(...args); };
export function setLogger(cb) {
    if (typeof cb === 'function') _logger = cb;
    else _logger = (...a) => { console.log(...a); };
}
function log(...args) { console.log(...args); try { _logger(args.map(a=>String(a)).join(' ')); } catch(e){} }

// --------------- HELPERS ---------------
export function handName(h) { return h === 0 ? "R" : "L"; }
export function getTrajectoryFor(throwValue, hand) { return `${throwValue}${hand === 0 ? "R" : "L"}`; }
export function roundTo(n, digits = 6) { const p = Math.pow(10, digits); return Math.round(n * p) / p; }
export function fmtBeat(b) { return (roundTo(b, 3)).toString(); }

// --------------- SITESWAP PARSING / VALIDATION ---------------
function charToValue(ch) {
    if (!ch || ch.length !== 1) return NaN;
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 48;            // '0' - '9'
    if (code >= 97 && code <= 122) return 10 + (code - 97);    // 'a' - 'z'
    if (code >= 65 && code <= 90) return 10 + (code - 65);     // 'A' - 'Z'
    return NaN;
}

export function parseSiteswap(str) {
    if (typeof str !== 'string') return { valid: false, error: 'Not a string' };
    const s = str.replace(/\s+/g, '');
    if (s.length === 0) return { valid: false, error: 'Empty pattern' };

    // NEW RULE: any letter or '0' is invalid per request.
    // Accept only digits 1-9. (This rejects '0' and any letters.)
    if (!/^[1-9]+$/.test(s)) {
        // give a helpful error message
        return { valid: false, error: "Invalid characters: only digits 1-9 allowed (no '0' or letters)" };
    }

    const n = s.length;
    const values = [];
    let sum = 0;

    for (let i = 0; i < n; i++) {
        const ch = s[i];
        // safe to parse as integer now (1-9)
        const v = parseInt(ch, 10);
        if (!Number.isFinite(v) || v < 0) return { valid: false, error: `Invalid char '${s[i]}' at pos ${i}` };
        values.push(v);
        sum += v;
    }

    const seen = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
        const target = (i + values[i]) % n;
        if (seen[target]) {
            return { valid: false, error: `Collision at beat ${i} -> target ${target}`, values };
        }
        seen[target] = true;
    }

    const ballsCount = sum / n;
    return { valid: true, values, balls: ballsCount };
}

export function applySiteswapString(siteswapStr) {
    const res = parseSiteswap(siteswapStr);
    if (!res.valid) {
        log('Siteswap invalid:', res.error);
        return false;
    }

    // update global pattern and reset pattern index/hand
    pattern.length = 0;
    for (const v of res.values) pattern.push(v);
    patternIndex = 0;
    hand = 0;
    previousIntBeat = -1;

    // determine balls required (round to nearest integer; valid siteswaps give integer)
    const required = Math.max(1, Math.round(res.balls));

    balls = [];
    for (let i = 0; i < required; i++) {
        balls.push({ id: i, state: READY, flight: null, wait: 0 });
    }

    log(`Applied siteswap "${siteswapStr}" → pattern [${pattern.join(',')}], props required: ${required}`);
    return true;
}

// ========================================
// MAIN LOOP
// ========================================
export function startEngine() { if (!engineRunning) { engineRunning = true; lastTs = performance.now(); requestAnimationFrame(loop); } }
export function stopEngine() { engineRunning = false; }

let engineRunning = true;
let lastTs = performance.now();

function update(dt) {
    if (running) {
        beatTime += dt * beatsPerSecond;
        beatTime = roundTo(beatTime, 6); // quantize
    }
    const intBeat = Math.floor(beatTime);
    updateBalls();
    if (intBeat !== previousIntBeat && running) {
        onBeat(intBeat);
        previousIntBeat = intBeat;
    }
}

function loop(ts) {
    const dtSec = (ts - lastTs) / 1000;
    lastTs = ts;
    update(dtSec);
    if (engineRunning) requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ========================================
// BEAT EVENT
// ========================================
function onBeat(intBeat) {
    const throwValue = pattern[patternIndex];
    const curveName = getTrajectoryFor(throwValue, hand);

    const ball = balls.find(b => b.state === READY);

    if (!ball) {
        log(`Beat ${intBeat}: NO BALL READY`);
    } else {
        const intendedLandBeat = intBeat + throwValue;
        const actualLandBeat = intendedLandBeat - dwellBeats;

        log(`Beat ${intBeat}: ${handName(hand)} throws ball ${ball.id} with value ${throwValue}`);
        log(`    → Intended landing beat: ${fmtBeat(intendedLandBeat)}, actual landing time: ${fmtBeat(actualLandBeat)}`);

        ball.state = IN_AIR;
        ball.flight = {
            startBeat: intBeat,
            intendedLandBeat: intendedLandBeat,
            actualLandBeat: actualLandBeat,
            value: throwValue,
            curveName: curveName
        };
    }

    patternIndex = (patternIndex + 1) % pattern.length;
    hand = 1 - hand;
}

// ========================================
// BALL STATE UPDATE
// ========================================
function updateBalls() {
    const currentTime = beatTime; // in beats

    for (let ball of balls) {
        if (ball.state === IN_AIR) {
            const f = ball.flight;
            if (!f) continue;

            if (currentTime + 1e-9 >= f.actualLandBeat) {
                log(`    >>> Ball ${ball.id} lands (intended beat = ${fmtBeat(f.intendedLandBeat)}, actual = ${fmtBeat(f.actualLandBeat)})`);

                if (currentTime + 1e-9 >= f.intendedLandBeat) {
                    ball.state = READY;
                    log(`    ... Ball ${ball.id} READY (land+dwells elapsed)`);
                } else {
                    ball.state = LANDED_WAIT;
                    ball.readyBeat = f.intendedLandBeat;
                    log(`    ... Ball ${ball.id} LANDed, will be READY at beat ${fmtBeat(ball.readyBeat)}`);
                }

                ball.flight = null;
            }
        } else if (ball.state === LANDED_WAIT) {
            if (currentTime + 1e-9 >= ball.readyBeat) {
                ball.state = READY;
                delete ball.readyBeat;
                log(`    ... Ball ${ball.id} READY (wait finished at beat ${fmtBeat(currentTime)})`);
            }
        }
    }
}

// -------- SETTINGS --------
export function setBeatsPerSecond(v) {
    beatsPerSecond = Number(v) || beatsPerSecond;
    log(`beatsPerSecond = ${beatsPerSecond}`);
}

export function togglePause() {
    running = !running;
    log(`Animation ${running ? 'resumed' : 'paused'}`);
    return running;
}

export function isPaused() {
    return !running;
}

export function skipToNextBeat() {
    const newBeat = Math.floor(beatTime) + 1;
    beatTime = newBeat;
    updateBalls(); // Update ball states before triggering beat
    if (newBeat !== previousIntBeat) {
        onBeat(newBeat);
        previousIntBeat = newBeat;
    }
    log(`Skipped to beat ${newBeat}`);
}

export function skipToPreviousBeat() {
    const currentBeat = Math.floor(beatTime);
    if (currentBeat > 0) {
        const targetBeat = currentBeat - 1;
        // Reset to beginning and replay up to target beat
        resetToBeginning();
        replayUpToBeat(targetBeat);
        log(`Skipped to beat ${targetBeat}`);
    } else {
        beatTime = 0;
        log(`Already at beat 0`);
    }
}

// Helper function to reset simulation to initial state
function resetToBeginning() {
    beatTime = 0;
    previousIntBeat = -1;
    patternIndex = 0;
    hand = 0;
    // Reset all balls to READY state
    for (const ball of balls) {
        ball.state = READY;
        ball.flight = null;
        ball.wait = 0;
        delete ball.readyBeat;
    }
}

// Helper function to replay pattern up to a specific beat
function replayUpToBeat(targetBeat) {
    for (let beat = 0; beat <= targetBeat; beat++) {
        beatTime = beat;
        if (beat !== previousIntBeat) {
            onBeat(beat);
            previousIntBeat = beat;
        }
        // Simulate ball updates at this beat
        updateBalls();
    }
}

// Get upcoming ball landings sorted by catching hand
export function getUpcomingLandings() {
    const landings = [];
    
    for (const ball of balls) {
        if (ball.state === IN_AIR && ball.flight) {
            const intendedLandBeat = ball.flight.intendedLandBeat;
            const catchingHand = Math.floor(intendedLandBeat) % 2; // 0 = Right, 1 = Left
            
            landings.push({
                ballId: ball.id,
                landBeat: intendedLandBeat,
                catchingHand: handName(catchingHand),
                catchingHandNum: catchingHand,
                throwValue: ball.flight.value,
                curveName: ball.flight.curveName
            });
        }
    }
    
    // Sort by catching hand (R first), then by landing beat
    landings.sort((a, b) => {
        if (a.catchingHandNum !== b.catchingHandNum) {
            return a.catchingHandNum - b.catchingHandNum;
        }
        return a.landBeat - b.landBeat;
    });
    
    return landings;
}
