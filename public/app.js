const socket = io();

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

const partsTableBody = document.querySelector('#partsTable tbody');
const totalMassEl = document.getElementById('totalMass');
const totalCostEl = document.getElementById('totalCost');
const budgetVal = document.getElementById('budgetVal');
const timerEl = document.getElementById('timer');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const teamNameInput = document.getElementById('teamName');
const teamsList = document.getElementById('teamsList');
const summarySection = document.getElementById('summary');
const summaryTable = document.getElementById('summaryTable');
const shuttleCanvas = document.getElementById('shuttleCanvas');
const ctx = shuttleCanvas.getContext('2d');

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
  // emit update to server
  if (myTeamName) {
    socket.emit('updateSelection', { selections: mySelections, totalCost, totalMass });
  }
}

joinBtn.addEventListener('click', () => {
  myTeamName = (teamNameInput.value || ('Team-' + Math.random().toString(36).slice(2,6)));
  socket.emit('join', { teamName: myTeamName, selections: mySelections });
  joinBtn.disabled = true;
  teamNameInput.disabled = true;
});

startBtn.addEventListener('click', () => {
  socket.emit('startGame');
});

socket.on('teamsUpdate', (teams) => {
  teamsList.textContent = 'Teams: ' + teams.map(t => t.teamName).join(', ');
  // enable start if we are host? Server will enable start by telling clients when they are host
  // simple approach: if myTeamName is first in list, enable start on client
});

socket.on('teamPartialUpdate', (payload) => {
  // could display small updates
});

socket.on('gameStarted', ({ gameStartTime, gameEndTime, durationMs }) => {
  // compute offset to sync timer
  startLocalTimer(gameEndTime);
  startBtn.disabled = true;
});

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
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

socket.on('gameOver', ({ summary }) => {
  // show summary screen to all users
  showSummary(summary);
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
  // animate each team's shuttle sequentially
  animateResults(summary);
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
  // simple canvas draw + CSS-based animation
  let idx = 0;
  const next = () => {
    if (idx >= summary.length) return;
    const team = summary[idx++];
    drawShuttle();
    // create floating element to animate
    const el = document.createElement('div');
    el.textContent = team.teamName;
    el.style.padding = '8px 12px';
    el.style.background = '#0f69ff';
    el.style.color = 'white';
    el.style.borderRadius = '6px';
    document.getElementById('resultArea').innerHTML = '';
    document.getElementById('resultArea').appendChild(el);
    // determine animation
    if (team.totalMass > 50000) {
      // fail on takeoff
      el.classList.add('launch-fail');
    } else if ((team.selections['Plane thermal insulation']||{}).insulationRating < 1) {
      // launch but burn on reentry
      el.classList.add('launch-success');
      setTimeout(() => {
        el.classList.remove('launch-success');
        el.classList.add('burn');
      }, 1800);
    } else {
      // full success
      el.classList.add('launch-success');
    }
    setTimeout(next, 3000);
  }
  next();
}

function drawShuttle() {
  ctx.clearRect(0,0,shuttleCanvas.width, shuttleCanvas.height);
  // draw a simple shuttle silhouette
  ctx.fillStyle = '#e6eefc';
  ctx.beginPath();
  ctx.moveTo(50,220);
  ctx.quadraticCurveTo(180,40,420,220);
  ctx.lineTo(350,220);
  ctx.lineTo(330,260);
  ctx.lineTo(270,260);
  ctx.lineTo(250,220);
  ctx.closePath();
  ctx.fill();
  // window
  ctx.fillStyle = '#00172b';
  ctx.fillRect(230,170,40,20);
}

// initialize
createSelectors();
drawShuttle();

// mark first connected as host (simple heuristic): enable start on first connection
socket.on('connect', () => {
  // small delay then ask server for teams list
  setTimeout(() => socket.emit('join', { teamName: teamNameInput.value || null, selections: mySelections }), 200);
});
