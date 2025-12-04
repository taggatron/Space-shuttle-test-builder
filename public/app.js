// REST polling endpoints base
const API_BASE = '/space-shuttle';
let POLL_INTERVAL_MS = 1500;
// Configurable thruster boost duration (ms). You can tweak at runtime via window.setThrusterBoostDuration(ms)
let THRUSTER_BOOST_MS = 3200;

// Parts data from screenshot (area m2, volume m3 assuming 0.1m thickness)
const PARTS = [
  { name: 'Nose tip and wing tips', area: 120, volume: 2 },
  { name: 'Main plane body (fuselage)', area: 800, volume: 80 },
  { name: 'Plane thermal insulation', area: 600, volume: 60 },
  { name: 'Jet engine', area: 200, volume: 20 }
];

// Materials (based on provided screenshot). Each has density (kg/m3) and price £/kg and thermal conductivity/insulation rating
const MATERIALS = [
  { name: 'Titanium oxide', density: 4500, price: 234, thermal: 'High', insulationRating: 3 },
  { name: 'Silicon dioxide (glass)', density: 2500, price: 130, thermal: 'Low', insulationRating: 1 },
  { name: 'Reinforced Graphite (carbon fibre)', density: 1600, price: 7250, thermal: 'Medium', insulationRating: 2 },
  { name: 'Tungsten', density: 19300, price: 343, thermal: 'High', insulationRating: 3 },
  { name: 'Borosilicate tiles', density: 144.2, price: 6000, thermal: 'Very Low', insulationRating: 0 },
  { name: 'Aluminium', density: 2700, price: 2, thermal: 'High', insulationRating: 3 }
];

const BUDGET = 100000;

let mySelections = {};
let myTeamName = null;
let myRoom = null;
let isHost = false;

// SVG part elements will be set after loading external SVG
let shuttleSvg = null;
let fuselageEl = null;
let noseEl = null;
let wingTipsEl = null;
let insulationEl = null;
let engineEl = null;
let engineEl2 = null;
let launchFlameEl = null;
let launchFlameAltMainEl = null;
let launchFlameAlt1El = null;
let launchFlameAlt2El = null;
let thrusterCoreEl = null; // path13
let thrusterFlameMainEl = null; // launchFlame-8-9
let explosionEl = null;
let shuttleState = 'idle'; // 'idle' | 'launch' | 'space' | 'reentry'
let gameRootEl = null; // for vertical shuttle positioning

const partsTableBody = document.querySelector('#partsTable tbody');
const totalMassEl = document.getElementById('totalMass');
const totalCostEl = document.getElementById('totalCost');
const budgetVal = document.getElementById('budgetVal');
const timerEl = document.getElementById('timer');
const restartTimerBtn = document.getElementById('restartTimerBtn');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomNameInput = document.getElementById('roomNameInput');
const teamNameInput = document.getElementById('teamName');
const roomsListEl = document.getElementById('roomsList');
const currentRoomEl = document.getElementById('currentRoom');
const playersInRoomEl = document.getElementById('playersInRoom');
const readyBtn = document.getElementById('readyBtn');
const startBtn = document.getElementById('startBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const summarySection = document.getElementById('summary');
const summaryTable = document.getElementById('summaryTable');
const summaryProgressContainer = document.getElementById('summaryProgressContainer');
const summaryProgressBar = document.getElementById('summaryProgressBar');
const summaryStageEls = document.querySelectorAll('#summaryStages .summary-stage');
const selectorsSection = document.getElementById('selectors');
const launchPadEl = document.getElementById('launchPad');

budgetVal.textContent = BUDGET;

function createSelectors() {
  partsTableBody.innerHTML = '';
  PARTS.forEach(part => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${part.name}</td>
      <td>${part.area}</td>
      <td>${part.volume}</td>
      <td><select data-part="${part.name}"></select></td>
      <td class="mass">0</td>
      <td class="cost">0</td>
    `;
    partsTableBody.appendChild(tr);
    const select = tr.querySelector('select');
    MATERIALS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(m);
      opt.textContent = `${m.name} (£${m.price}/kg)`;
      select.appendChild(opt);
    });
    select.addEventListener('change', onSelectChange);
    // default select to Aluminium (last)
    select.selectedIndex = MATERIALS.length-1;
    onSelectChange({ target: select });
  });
}

// Load external SVG file and inject into the DOM, then bind elements
async function loadShuttleSvg() {
  try {
    const res = await fetch('/assets/shuttle.svg');
    if (!res.ok) throw new Error('Failed to load SVG');
    const svgText = await res.text();
    const container = document.getElementById('shuttleContainer');
    if (!gameRootEl) {
      gameRootEl = document.querySelector('main') || document.body;
    }
    container.innerHTML = svgText;
    // now bind elements
    shuttleSvg = container.querySelector('svg');
    fuselageEl = container.querySelector('#part-fuselage');
    noseEl = container.querySelector('#part-nose');
    // prefer the element with id 'part-wingtips' for material mapping
    wingTipsEl = container.querySelector('#part-wingtips') || container.querySelector('#wing-left');
    insulationEl = container.querySelector('#part-insulation');
    engineEl = container.querySelector('#part-engine');
    // also colour secondary engine block if present
    engineEl2 = container.querySelector('#part-engine-8');
    // main center flame plus extra lobes
    launchFlameEl = container.querySelector('#launchFlame');
    launchFlameAltMainEl = container.querySelector('#launchFlame-8-0-2');
    launchFlameAlt1El = container.querySelector('#launchFlame-8');
    launchFlameAlt2El = container.querySelector('#launchFlame-8-0');
    // main thruster core and flame
    thrusterCoreEl = container.querySelector('#path13');
    thrusterFlameMainEl = container.querySelector('#launchFlame-8-9');
    explosionEl = container.querySelector('#explosion');
    // ensure explosion starts fully invisible
    if (explosionEl) {
      explosionEl.style.opacity = '0';
    }
    // apply any current selections to recolour the SVG
    updateShuttleColours();
  } catch (err) {
    console.error('Error loading shuttle SVG', err);
  }
}

function onSelectChange(e) {
  const select = e.target;
  const partName = select.dataset.part;
  const material = JSON.parse(select.value);
  const part = PARTS.find(p => p.name === partName);
  const mass = Math.round(part.volume * material.density);
  const cost = Math.round(mass * material.price);
  // update row
  const row = select.closest('tr');
  row.querySelector('.mass').textContent = mass;
  row.querySelector('.cost').textContent = cost;
  mySelections[partName] = material;
  updateTotals();
}

function updateTotals() {
  let totalMass = 0, totalCost = 0;
  PARTS.forEach(part => {
    const mat = mySelections[part.name];
    if (mat) {
      totalMass += Math.round(part.volume * mat.density);
      totalCost += Math.round(part.volume * mat.density * mat.price);
    }
  });
  totalMassEl.textContent = totalMass;
  totalCostEl.textContent = totalCost;
  // send update to server via REST if in a room
  if (myTeamName && myRoom) {
    fetch(`${API_BASE}/rooms/${encodeURIComponent(myRoom)}/update-selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: getPlayerId(), selections: mySelections, totalCost, totalMass }),
    }).catch(() => {});
  }
  updateShuttleColours();
}

function updateShuttleColours() {
  // map materials to colours heuristically
  const partMat = (name) => mySelections[name];
  const bodyMat = partMat('Main plane body (fuselage)');
  const noseMat = partMat('Nose tip and wing tips');
  const insulationMat = partMat('Plane thermal insulation');
  const engineMat = partMat('Jet engine');

  if (bodyMat && fuselageEl) fuselageEl.style.fill = materialColour(bodyMat);
  if (noseMat) {
    if (noseEl) noseEl.style.fill = materialColour(noseMat);
    if (wingTipsEl) wingTipsEl.style.fill = materialColour(noseMat);
  }
  if (insulationMat) {
    if (insulationEl) insulationEl.style.stroke = insulationMat.insulationRating >= 1 ? '#ffd27f' : '#555';
  }
  if (engineMat) {
    if (engineEl) engineEl.style.fill = materialColour(engineMat);
    if (engineEl2) engineEl2.style.fill = materialColour(engineMat);
  }
}

function setThrusterMode(mode) {
  const setClasses = (el, onCls, spaceCls, offCls) => {
    if (!el) return;
    el.classList.remove(onCls, spaceCls, offCls, 'hidden');
    if (mode === 'boost') el.classList.add(onCls);
    else if (mode === 'space') el.classList.add(spaceCls);
    else el.classList.add(offCls);
  };
  setClasses(thrusterCoreEl, 'thruster-core-boost', 'thruster-core-space', 'thruster-core-off');
  setClasses(thrusterFlameMainEl, 'thruster-flame-boost', 'thruster-flame-space', 'thruster-flame-off');
  // add subtle white flicker glow only during boost
  if (thrusterCoreEl) {
    thrusterCoreEl.classList.toggle('thruster-core-flicker', mode === 'boost');
  }
}

// Expose a small API to adjust boost duration without redeploying
window.setThrusterBoostDuration = function(ms) {
  const n = Number(ms);
  if (!isNaN(n) && n >= 0) THRUSTER_BOOST_MS = n;
};

function materialColour(mat) {
  switch (mat.name) {
    case 'Titanium oxide': return '#cfd4e6';
    case 'Silicon dioxide (glass)': return '#91c4ff';
    case 'Reinforced Graphite (carbon fibre)': return '#444b57';
    case 'Tungsten': return '#b1b4c2';
    case 'Borosilicate tiles': return '#ffe0a3';
    case 'Aluminium': return '#d8e4ff';
    default: return '#e6eefc';
  }
}

createRoomBtn.addEventListener('click', async () => {
  const room = roomNameInput.value && roomNameInput.value.trim();
  myTeamName = teamNameInput.value || ('Team-' + Math.random().toString(36).slice(2,6));
  if (!room) return alert('Enter a room name');
  const resp = await fetch(`${API_BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName: room, playerId: getPlayerId(), teamName: myTeamName }),
  });
  const data = await resp.json();
  if (resp.ok) onJoinedRoom(room, data.players, data.hostId);
});

joinRoomBtn.addEventListener('click', async () => {
  const room = roomNameInput.value && roomNameInput.value.trim();
  myTeamName = teamNameInput.value || ('Team-' + Math.random().toString(36).slice(2,6));
  if (!room) return alert('Enter a room name');
  const resp = await fetch(`${API_BASE}/rooms/${encodeURIComponent(room)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: getPlayerId(), teamName: myTeamName }),
  });
  const data = await resp.json();
  if (resp.ok) onJoinedRoom(room, data.players, data.hostId);
});

readyBtn.addEventListener('click', async () => {
  if (!myRoom) return;
  await fetch(`${API_BASE}/rooms/${encodeURIComponent(myRoom)}/toggle-ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: getPlayerId() }),
  });
  // optimistic UI: will be corrected by polling
});

startBtn.addEventListener('click', async () => {
  if (!myRoom) return;
  const resp = await fetch(`${API_BASE}/rooms/${encodeURIComponent(myRoom)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: getPlayerId() }),
  });
  const data = await resp.json();
  if (data && data.gameStarted) {
    startLocalTimer(data.gameEndTime);
    readyBtn.classList.add('hidden');
    startBtn.classList.add('hidden');
    setThrusterMode('off');
    if (fuselageEl) fuselageEl.classList.remove('fragment-body');
    if (noseEl) noseEl.classList.remove('fragment-nose');
    if (wingTipsEl) wingTipsEl.classList.remove('fragment-wings');
    playLaunchSequence();
  }
});

leaveRoomBtn.addEventListener('click', async () => {
  if (!myRoom) return;
  await fetch(`${API_BASE}/rooms/${encodeURIComponent(myRoom)}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: getPlayerId() }),
  });
  myRoom = null;
  currentRoomEl.textContent = '(none)';
  readyBtn.classList.add('hidden');
  startBtn.classList.add('hidden');
  leaveRoomBtn.classList.add('hidden');
  playersInRoomEl.innerHTML = '';
});

async function pollRoomsList() {
  try {
    const resp = await fetch(`${API_BASE}/rooms`);
    const data = await resp.json();
    roomsListEl.textContent = (data.rooms || []).join(', ');
  } catch {}
}

function onJoinedRoom(roomName, players, hostId) {
  myRoom = roomName;
  currentRoomEl.textContent = roomName;
  readyBtn.classList.remove('hidden');
  leaveRoomBtn.classList.remove('hidden');
  isHost = (hostId === getPlayerId());
  if (isHost) startBtn.classList.remove('hidden'); else startBtn.classList.add('hidden');
  renderPlayers(players);
}

function renderPlayers(players) {
  playersInRoomEl.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.textContent = `${p.teamName} ${p.ready ? '✓' : ''}`;
    playersInRoomEl.appendChild(div);
  });
}

// game start handled in startBtn click via REST response

let timerInterval = null;
function startLocalTimer(gameEndTime) {
  clearInterval(timerInterval);
  function tick() {
    const remaining = Math.max(0, Math.round((gameEndTime - Date.now())/1000));
    const mm = String(Math.floor(remaining/60)).padStart(2,'0');
    const ss = String(remaining%60).padStart(2,'0');
    timerEl.textContent = `${mm}:${ss}`;
    if (remaining <= 0) {
      clearInterval(timerInterval);
      // snap shuttle to upright launch attitude with a quick flash, then fire bright flames
      if (shuttleSvg) {
        shuttleSvg.classList.remove('shuttle-rotate-space','shuttle-rotate-reentry','shuttle-launch-flash');
        // force reflow so flash animation can restart
        void shuttleSvg.offsetWidth;
        shuttleSvg.classList.add('shuttle-rotate-launch','shuttle-launch-flash');
      }
      if (gameRootEl) {
        gameRootEl.classList.remove('shuttle-y-space','shuttle-y-reentry');
        gameRootEl.classList.add('shuttle-y-launch');
      }
      shuttleState = 'launch';
      playLaunchSequence(true);
      // start launch pad shrinking to simulate climbing away from pad
      if (launchPadEl) {
        launchPadEl.classList.remove('shrink-away');
        // force reflow so animation restarts each game
        void launchPadEl.offsetWidth;
        launchPadEl.classList.add('shrink-away');
      }
      // kick thrusters to boost, then taper to space idle
      setThrusterMode('boost');
      setTimeout(() => setThrusterMode('space'), THRUSTER_BOOST_MS);
      // when countdown finishes, swap layout: bring summary up next to shuttle
      swapSummaryAndSelectors();
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

// Local-only restart of countdown display (does not change server end time)
if (restartTimerBtn) {
  restartTimerBtn.addEventListener('click', () => {
    clearInterval(timerInterval);
    timerEl.textContent = '--:--';
  });
}

async function pollSummary() {
  if (!myRoom) return;
  try {
    const resp = await fetch(`${API_BASE}/rooms/${encodeURIComponent(myRoom)}/summary`);
    const data = await resp.json();
    if (resp.ok && Array.isArray(data.summary) && data.summary.length) {
      showSummary(data.summary);
      playOutcomeAnimation(data.summary);
    }
  } catch {}
}

// summary updates will be fetched via polling

// polling loop
function getPlayerId() {
  if (!window.__playerId) {
    window.__playerId = 'p-' + Math.random().toString(36).slice(2,10);
  }
  return window.__playerId;
}

setInterval(() => {
  pollRoomsList();
  if (myRoom) {
    fetch(`${API_BASE}/rooms/${encodeURIComponent(myRoom)}/state`).then(r => r.json()).then(data => {
      if (!data || !data.players) return;
      renderPlayers(data.players);
      isHost = (data.hostId === getPlayerId());
      if (isHost) startBtn.classList.remove('hidden'); else startBtn.classList.add('hidden');
      // if server indicates game running, keep timer aligned
      if (data.gameRunning && data.gameEndTime) {
        startLocalTimer(data.gameEndTime);
      }
    }).catch(() => {});
    pollSummary();
  }
}, POLL_INTERVAL_MS);

socket.on('teamPartialUpdate', (payload) => {
  // optional UI hook for showing team's partial totals
});

function showSummary(summary) {
  summarySection.classList.remove('hidden');
  summaryTable.innerHTML = '';
  const table = document.createElement('table');
  table.style.width = '100%';
  const hdr = document.createElement('tr');
  hdr.innerHTML = '<th>Team</th><th>Mass (kg)</th><th>Cost (£)</th><th>Outcome</th>';
  table.appendChild(hdr);
  summary.forEach(team => {
    const tr = document.createElement('tr');
    const outcome = computeOutcomeLabel(team);
    tr.innerHTML = `<td>${team.teamName}</td><td>${Math.round(team.totalMass)}</td><td>£${Math.round(team.totalCost)}</td><td>${outcome}</td>`;
    table.appendChild(tr);
  });
  summaryTable.appendChild(table);
  // reset and show progress bar when summary is visible
  if (summaryProgressContainer && summaryProgressBar) {
    summaryProgressContainer.classList.remove('hidden');
    summaryProgressBar.classList.remove('summary-progress-anim');
    summaryProgressBar.style.width = '0%';
  }
  // reset stage highlights
  if (summaryStageEls) {
    summaryStageEls.forEach(el => el.classList.remove('summary-stage-active'));
  }
}

function computeOutcomeLabel(team) {
  const parts = team.selections || {};
  const mass = team.totalMass || 0;
  const insulation = parts['Plane thermal insulation'] || null;
  const insulationRating = insulation ? insulation.insulationRating : 0;
  const takeoff = mass <= 50000;
  const reentry = insulationRating >= 1;
  if (!takeoff) return 'Failed on takeoff (Too heavy)';
  if (!reentry) return 'Burnt on re-entry (Insufficient insulation)';
  return 'Successful launch and re-entry';
}

function animateResults(summary) {
  let idx = 0;
  const next = () => {
    if (idx >= summary.length) return;
    const team = summary[idx++];
    drawShuttle();
    const el = document.createElement('div');
    el.textContent = team.teamName;
    el.style.padding = '8px 12px';
    el.style.background = '#0f69ff';
    el.style.color = 'white';
    el.style.borderRadius = '6px';
    document.getElementById('resultArea').innerHTML = '';
    document.getElementById('resultArea').appendChild(el);
    if (team.totalMass > 50000) {
      el.classList.add('launch-fail');
    } else if ((team.selections['Plane thermal insulation']||{}).insulationRating < 1) {
      el.classList.add('launch-success');
      setTimeout(() => {
        el.classList.remove('launch-success');
        el.classList.add('burn');
      }, 1800);
    } else {
      el.classList.add('launch-success');
    }
    setTimeout(next, 3000);
  }
  next();
}

function playLaunchSequence(withGlow = false) {
  if (!shuttleSvg) return;
  shuttleSvg.classList.remove('explode','reentry-glow');
  // Just show a brief engine flame without moving the shuttle
  const showFlame = (el, delay = 0, visibleMs = 1400) => {
    if (!el) return;
    setTimeout(() => {
      el.classList.remove('hidden');
      if (withGlow) {
        el.classList.add('flame-glow');
      }
      setTimeout(() => {
        el.classList.add('hidden');
        if (withGlow) {
          el.classList.remove('flame-glow');
        }
      }, visibleMs);
    }, delay);
  };
  showFlame(launchFlameEl, 0);
  showFlame(launchFlameAltMainEl, 40);
  showFlame(launchFlameAlt1El, 90);
  showFlame(launchFlameAlt2El, 140);
}

function playOutcomeAnimation(summary) {
  if (!summary || !summary.length) return;
  if (!shuttleSvg) return;
  // show our team's outcome if possible, else first team
  const mine = summary.find(t => t.teamName === myTeamName) || summary[0];
  const parts = mine.selections || {};
  const mass = mine.totalMass || 0;
  const insulation = parts['Plane thermal insulation'] || null;
  const insulationRating = insulation ? insulation.insulationRating : 0;

  shuttleSvg.classList.remove('explode','reentry-glow','space-drift','launch-sequence');
  if (launchFlameEl) launchFlameEl.classList.add('hidden');
  if (launchFlameAltMainEl) launchFlameAltMainEl.classList.add('hidden');
  if (launchFlameAlt1El) launchFlameAlt1El.classList.add('hidden');
  if (launchFlameAlt2El) launchFlameAlt2El.classList.add('hidden');
  if (explosionEl) {
    explosionEl.classList.add('hidden');
    explosionEl.style.opacity = '0';
  }
  if (fuselageEl) fuselageEl.classList.remove('fragment-body');
  if (noseEl) noseEl.classList.remove('fragment-nose');
  if (wingTipsEl) wingTipsEl.classList.remove('fragment-wings');
  // clear any previous random fragments on other pieces
  if (shuttleSvg) {
    shuttleSvg.querySelectorAll('.fragment-random').forEach(el => {
      el.classList.remove('fragment-random');
    });
  }

  const tooHeavy = mass > 50000;
  const badInsulation = insulationRating < 1;
  // track outcome type for summary colouring
  window.__lastOutcomeType = (tooHeavy || badInsulation) ? 'fail' : 'success';

  // move from launch attitude into space orientation before resolving outcome
  if (shuttleSvg) {
    shuttleSvg.classList.remove('shuttle-rotate-launch','shuttle-rotate-reentry');
    // remain essentially upright in space (smoothly, but small delta from launch)
    shuttleSvg.classList.add('shuttle-rotate-space');
  }
  shuttleState = 'space';
  // ensure thrusters are in space idle during the space phase
  setThrusterMode('space');

  if (tooHeavy) {
    // takeoff failure: show brief upright ascent, then tip down and explode near pad
    setTimeout(() => {
      if (shuttleSvg) {
        shuttleSvg.classList.remove('shuttle-rotate-space');
        shuttleSvg.classList.add('shuttle-rotate-reentry');
        shuttleState = 'reentry';
      }
      if (gameRootEl) {
        gameRootEl.classList.remove('shuttle-y-space');
        gameRootEl.classList.add('shuttle-y-reentry');
      }
      setThrusterMode('off');
      if (explosionEl) {
        explosionEl.classList.remove('hidden');
        explosionEl.style.display = 'inline';
        explosionEl.style.opacity = '1';
        explosionEl.classList.add('explode');
        // ensure explosion ends invisible and animation class is cleared
        setTimeout(() => {
          explosionEl.classList.remove('explode');
          explosionEl.style.opacity = '0';
        }, 1000);
      }
      // add fragment effect on main parts (staggered slightly)
      if (fuselageEl) fuselageEl.classList.add('fragment-body');
      if (noseEl) setTimeout(() => noseEl.classList.add('fragment-nose'), 80);
      if (wingTipsEl) setTimeout(() => wingTipsEl.classList.add('fragment-wings'), 140);
      // apply random fragment effect to all other visible pieces
      addRandomFragments();
    }, 4500);
    startSummaryProgress(4500);
  } else if (badInsulation) {
    // survives launch, stays upright in space, then tips down for re-entry and burns
    setTimeout(() => {
      if (shuttleSvg) {
        shuttleSvg.classList.remove('shuttle-rotate-space');
        shuttleSvg.classList.add('shuttle-rotate-reentry');
        shuttleState = 'reentry';
        shuttleSvg.classList.add('reentry-glow');
      }
      if (gameRootEl) {
        gameRootEl.classList.remove('shuttle-y-space');
        gameRootEl.classList.add('shuttle-y-reentry');
      }
      setThrusterMode('off');
      setTimeout(() => {
        if (shuttleSvg) shuttleSvg.classList.remove('reentry-glow');
        if (explosionEl) {
          explosionEl.classList.remove('hidden');
          explosionEl.style.display = 'inline';
          explosionEl.style.opacity = '1';
          explosionEl.classList.add('explode');
          // ensure explosion ends invisible and animation class is cleared
          setTimeout(() => {
            explosionEl.classList.remove('explode');
            explosionEl.style.opacity = '0';
          }, 1000);
        }
        if (fuselageEl) fuselageEl.classList.add('fragment-body');
        if (noseEl) setTimeout(() => noseEl.classList.add('fragment-nose'), 80);
        if (wingTipsEl) setTimeout(() => wingTipsEl.classList.add('fragment-wings'), 140);
        addRandomFragments();
      }, 4500); // re-entry glow duration
    }, 4500);   // upright-in-space duration
    // keep overall summary timeline aligned with longer re-entry sequence
    startSummaryProgress(4500 + 4500);
  } else {
    // successful: stay upright in space, then gentle re-entry glow
    setTimeout(() => {
      setThrusterMode('off');
      if (shuttleSvg) shuttleSvg.classList.add('reentry-glow');
      setTimeout(() => {
        if (shuttleSvg) shuttleSvg.classList.remove('reentry-glow');
      }, 6000);
    }, 4500); // time spent upright in space before re-entry
    // slow successful mission timeline by about 3x
    startSummaryProgress(4500 + 6000);
  }
}

function addRandomFragments() {
  if (!shuttleSvg) return;
  const exclude = new Set();
  if (fuselageEl) exclude.add(fuselageEl);
  if (noseEl) exclude.add(noseEl);
  if (wingTipsEl) exclude.add(wingTipsEl);
  // apply to all shuttle-part children that aren't main body/nose/wings
  shuttleSvg.querySelectorAll('.shuttle-part').forEach(el => {
    if (exclude.has(el)) return;
    el.classList.add('fragment-random');
  });
}

function startSummaryProgress(totalMs) {
  if (!summaryProgressContainer || !summaryProgressBar) return;
  summaryProgressContainer.classList.remove('hidden');
  summaryProgressBar.classList.remove('summary-progress-anim');
  // force reflow so animation can restart
  void summaryProgressBar.offsetWidth;
  // slow overall animation so stages are clearer
  const seconds = Math.max(1.5, (totalMs || 18000) / 1000);
  summaryProgressBar.style.animationDuration = `${seconds}s`;
  summaryProgressBar.classList.add('summary-progress-anim');
  // schedule stage highlights: Takeoff ~25%, Space ~60%, Re-entry ~100%
  if (summaryStageEls && summaryStageEls.length) {
    summaryStageEls.forEach(el => {
      el.classList.remove('summary-stage-active','summary-stage-success','summary-stage-fail');
    });
    const takeoff = Array.from(summaryStageEls).find(el => el.dataset.stage === 'takeoff');
    const space = Array.from(summaryStageEls).find(el => el.dataset.stage === 'space');
    const reentry = Array.from(summaryStageEls).find(el => el.dataset.stage === 'reentry');
    if (takeoff) setTimeout(() => takeoff.classList.add('summary-stage-active'), seconds * 0.1 * 1000);
    if (space) setTimeout(() => space.classList.add('summary-stage-active'), seconds * 0.45 * 1000);
    if (reentry) {
      setTimeout(() => {
        reentry.classList.add('summary-stage-active');
        // colour-code final stage by last outcome: success (green) vs fail (red)
        const lastOutcome = window.__lastOutcomeType;
        if (lastOutcome === 'success') {
          reentry.classList.add('summary-stage-success');
        } else if (lastOutcome === 'fail') {
          reentry.classList.add('summary-stage-fail');
        }
      }, seconds * 0.8 * 1000);
    }
  }
}

function swapSummaryAndSelectors() {
  if (!selectorsSection || !summarySection) return;
  const gameArea = document.getElementById('gameArea');
  if (!gameArea) return;
  // Ensure layout inside gameArea is: summary | visual
  const visual = document.getElementById('visual');
  if (!visual) return;
  // reset any previous swap animation classes
  summarySection.classList.remove('summary-swap-in');
  selectorsSection.classList.remove('selectors-swap-down');
  // Insert summary before visual so shuttle animation remains visible on the right
  gameArea.insertBefore(summarySection, visual);
  // Keep selectors visible below the main game area
  const main = document.querySelector('main');
  if (main && selectorsSection.parentElement !== main) {
    main.insertBefore(selectorsSection, gameArea.nextSibling);
  }
  // stretch selectors to full width once below
  selectorsSection.classList.add('selectors-fullwidth');
  // trigger swap animations
  void summarySection.offsetWidth; // force reflow for restart
  summarySection.classList.add('summary-swap-in');
  selectorsSection.classList.add('selectors-swap-down');
  summarySection.classList.remove('hidden');
}

// initialize
createSelectors();
loadShuttleSvg();

// (roomPlayersUpdate handler defined earlier with hostSocket payload)
