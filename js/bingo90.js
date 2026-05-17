// BINGO 90 PRO - VERSION 3.0 (ANIMATOR + PAYMENT VALIDATION)
let myTickets = [];
let drawnBalls = [];
let playerRole = 'player';
let playerName = localStorage.getItem('bingo90_name') || '';
let playerStatus = 'pending';
let selectedTicketCount = 1;
let ticketPrice = 4000;
let lastProcessedWinner = null;
let autoDrawInterval = null;
let isDrawing = false;
let globalWonPrizes = { line1: false, line2: false, line3: false, full: false };
let raffleWinners = [];
let isRaffleActive = false;
let allPlayers = []; // Global for timer updates

const db_bingo90 = db.collection('games').doc('bingo90_current');

// 1. VOICE ANIMATOR
function speak(text, rate = 1, force = false) {
    if ('speechSynthesis' in window) {
        // Si no es forzado, no cancelamos para permitir que termine de hablar el anterior
        if (force) window.speechSynthesis.cancel();
        
        const msg = new SpeechSynthesisUtterance(text);
        msg.lang = 'es-ES';
        msg.rate = rate;
        msg.pitch = 1.1;
        window.speechSynthesis.speak(msg);
    }
}

function announceWinner(type, name) {
    const texts = [
        `¡Atención! Tenemos un ganador. ${name} ha completado ${type}. ¡Felicidades!`,
        `¡Bingo! ${name} acaba de ganar ${type}.`,
        `Increíble, ${name} se lleva el premio de ${type}.`
    ];
    const randomText = texts[Math.floor(Math.random() * texts.length)];
    // Damos un pequeño respiro después de cantar la balota
    setTimeout(() => {
        speak(randomText, 0.95);
    }, 1500);
}

function speakWelcome() {
    speak("¡Bienvenido a Bingo 90! Tenemos premios para la primera, segunda y tercera línea, y el gran Gordo para el cartón lleno. ¡Mucha suerte a todos!");
}

function speakBall(num) {
    // Para las balotas sí forzamos la cancelación por si salen muy rápido
    speak(num.toString(), 1.1, true);
}

// 2. CELEBRATION (CONFETTI)
function celebrate(isFull) {
    console.log("Celebrando...", isFull ? "GORDO" : "LINEA");
    if (typeof confetti === 'function') {
        if (isFull) {
            const duration = 5 * 1000;
            const animationEnd = Date.now() + duration;
            const interval = setInterval(function() {
                const timeLeft = animationEnd - Date.now();
                if (timeLeft <= 0) return clearInterval(interval);
                confetti({ particleCount: 60, spread: 360, origin: { x: Math.random(), y: Math.random() - 0.2 }, zIndex: 9999 });
            }, 250);
        } else {
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, zIndex: 9999 });
        }
    } else {
        console.warn("Confetti script not loaded yet");
    }
}

// 3. JOIN & STATUS
async function joinGame() {
    const nameInput = document.getElementById('playerNameInput');
    const name = nameInput ? nameInput.value.trim() : playerName;
    if (!name) return alert("Ingresa tu nombre");
    
    playerName = name;
    localStorage.setItem('bingo90_name', name);
    document.getElementById('joinOverlay').style.display = 'none';
    
    const phone = localStorage.getItem('bingo_user_phone') || 'Sin teléfono';
    
    // Register as PENDING
    await db_bingo90.collection('players').doc(name).set({
        ticketCount: selectedTicketCount,
        phone: phone,
        status: 'pending',
        joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    speakWelcome();
    generateTickets(selectedTicketCount);
}

// 4. ADMIN APPROVAL
async function approvePlayer(name) {
    await db_bingo90.collection('players').doc(name).update({ status: 'approved' });
}

// 5. CORE SYNC
function startSync() {
    db_bingo90.onSnapshot(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        
        // 0. Sorteo de Acumulado (Anuncio)
        const raffleActive = data.isRaffleActive || false;
        raffleWinners = data.raffleWinners || [];
        
        if (raffleActive && !window.lastRaffleState) {
            const names = raffleWinners.join(' y ');
            const rDisp = document.getElementById('raffleDisplay');
            const rNames = document.getElementById('raffleNames');
            if(rDisp) rDisp.style.display = 'block';
            if(rNames) rNames.textContent = names;
            
            speak(`Atención. Iniciamos el sorteo del acumulado de cien mil pesos. Los jugadores elegidos son: ${names}. ¡Mucha suerte!`, 0.9);
            window.lastRaffleState = true;
        } else if (!raffleActive && window.lastRaffleState) {
            window.lastRaffleState = false;
        }

        if (raffleWinners.length > 0) {
            const rDisp = document.getElementById('raffleDisplay');
            const rNames = document.getElementById('raffleNames');
            if(rDisp) rDisp.style.display = 'block';
            if(rNames) rNames.textContent = raffleWinners.join(' y ');
        } else {
            const rDisp = document.getElementById('raffleDisplay');
            if(rDisp) rDisp.style.display = 'none';
        }

        // 1. Cantar balota nueva
        if (data.balls && data.balls.length > drawnBalls.length) {
            speakBall(data.balls[data.balls.length - 1]);
        }
        
        drawnBalls = data.balls || [];
        ticketPrice = data.ticketPrice || 4000;
        globalWonPrizes = data.wonPrizes || { line1: false, line2: false, line3: false, full: false };
        
        // 2. Parar auto-sorteo si ya ganaron el Gordo
        if (globalWonPrizes.full && autoDrawInterval) {
            console.log("¡Gordo detectado! Deteniendo auto-sorteo.");
            toggleAutoDraw(); 
        }

        updateDisplay(drawnBalls);
        updatePrizeUI();

        if (data.winnersHistory) {
            const uniqueWinners = []; const seen = new Set();
            data.winnersHistory.forEach(w => { if(!seen.has(w.type)) { uniqueWinners.push(w); seen.add(w.type); }});
            document.getElementById('winnersHistoryList').innerHTML = uniqueWinners.map(w => 
                `<div style="border-bottom:1px solid #333; padding:2px 0; color:#fff;"><b>${w.type}:</b> ${w.name}</div>`
            ).join('');
        }

        // 3. Mostrar y Anunciar Ganador
        if (data.lastWinner && (!lastProcessedWinner || data.lastWinner.timestamp > lastProcessedWinner)) {
            showWinOverlay(data.lastWinner.type, data.lastWinner.name);
            announceWinner(data.lastWinner.type, data.lastWinner.name);
            lastProcessedWinner = data.lastWinner.timestamp;
            celebrate(data.lastWinner.type.includes('LLENO') || data.lastWinner.type.includes('GORDO'));
        }
    });

    // Listen to Players & My Status
    db_bingo90.collection('players').onSnapshot(snap => {
        allPlayers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAdminPlayers();
    });
}

function renderAdminPlayers() {
    let totalTickets = 0;
    let adminListHTML = '';
    
    allPlayers.forEach(p => {
        if(p.status === 'approved') {
            totalTickets += (p.ticketCount || 1);
        }
        
        // My Status Check (for the local player)
        if(p.id === playerName) {
            playerStatus = p.status;
            const pendingO = document.getElementById('pendingOverlay');
            if(pendingO) pendingO.style.display = (playerStatus === 'pending') ? 'flex' : 'none';
        }

        // Admin List with Approve Buttons
        if(playerRole === 'admin') {
            let timerText = '';
            if (p.status === 'pending') {
                const now = Date.now();
                const joined = p.joinedAt?.toMillis() || p.time || now;
                const elapsed = now - joined;
                const remaining = Math.max(0, (60 * 60 * 1000) - elapsed);
                const mins = Math.floor(remaining / 60000);
                const secs = Math.floor((remaining % 60000) / 1000);
                timerText = `<span style="color:#ffaa00;">⏳ ${mins}m ${secs}s</span>`;
            }

            adminListHTML += `<div class="player-row" style="flex-direction:column; align-items:flex-start;">
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <span><b>${p.id}</b> (${p.ticketCount}) ${timerText}</span>
                    ${p.status === 'pending' ? `<button class="btn-approve" onclick="approvePlayer('${p.id}')">OK</button>` : '✅'}
                </div>
                <div style="font-size:0.6rem; color:#aaa; display:flex; gap:10px;">
                    <span>Tel: ${p.phone || 'N/A'}</span>
                    <a href="https://wa.me/${(p.phone || '').replace(/\D/g,'')}" target="_blank" style="color:var(--secondary); text-decoration:none;">📱 WhatsApp</a>
                </div>
            </div>`;
        }
    });

    if(playerRole === 'admin') document.getElementById('adminPlayersList').innerHTML = adminListHTML || 'Esperando...';

    const pool = totalTickets * ticketPrice * 0.70;
    const pLine = Math.floor(pool * 0.15); const pFull = Math.floor(pool * 0.55);
    document.getElementById('valLine1').textContent = `$${pLine.toLocaleString()}`;
    document.getElementById('valLine2').textContent = `$${pLine.toLocaleString()}`;
    document.getElementById('valLine3').textContent = `$${pLine.toLocaleString()}`;
    document.getElementById('valFull').textContent = `$${pFull.toLocaleString()}`;
}

// 6. FUNCTIONS (Tickets, Markers, etc - Maintained)
function setTickets(count) {
    selectedTicketCount = count;
    document.querySelectorAll('.ticket-selector').forEach((btn, idx) => { btn.classList.toggle('active', (idx + 1) === count); });
}

function updatePrizeUI() {
    Object.keys(globalWonPrizes).forEach(key => {
        const el = document.getElementById(`card-${key}`);
        if(el) { el.classList.toggle('won', globalWonPrizes[key]); }
    });
}

function updateDisplay(balls) {
    document.querySelectorAll('.mini-ball').forEach(b => b.classList.remove('active'));
    if(balls.length > 0) {
        document.getElementById('mainBall').textContent = balls[balls.length - 1];
        balls.forEach(b => document.getElementById(`mini-${b}`)?.classList.add('active'));
        let hits = 0;
        myTickets.forEach((t, tIdx) => {
            t.nums.forEach(n => { if(balls.includes(n)) { document.getElementById(`cell-${tIdx}-${n}`)?.classList.add('hit'); hits++; } });
        });
        document.getElementById('hitsCounter').textContent = hits;
        if(playerStatus === 'approved') checkMyPrizes(balls);
    } else {
        document.getElementById('mainBall').textContent = '--';
        document.querySelectorAll('.ticket90-cell').forEach(c => c.classList.remove('hit'));
        document.getElementById('hitsCounter').textContent = '0';
    }
}

async function checkMyPrizes(balls) {
    myTickets.forEach((ticket, tIdx) => {
        ticket.rows.forEach((rowNums, rIdx) => {
            const key = `line${rIdx + 1}`;
            if (!globalWonPrizes[key] && rowNums.length > 0 && rowNums.every(n => balls.includes(n))) claimGlobalPrize(`Línea ${rIdx + 1}`, key);
        });
        if (!globalWonPrizes.full && ticket.nums.length > 0 && ticket.nums.every(n => balls.includes(n))) {
            // Verificar si califico para el Acumulado de 100k
            const isRaffleWinner = raffleWinners.includes(playerName);
            const prizeType = isRaffleWinner ? 'ACUMULADO (100K)' : 'CARTÓN LLENO';
            claimGlobalPrize(prizeType, 'full');
        }
    });
}

async function claimGlobalPrize(type, key) {
    try {
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(db_bingo90);
            const won = doc.data().wonPrizes || {};
            if (!won[key]) {
                const winnerData = { name: playerName, type: type, timestamp: Date.now() };
                transaction.update(db_bingo90, { [`wonPrizes.${key}`]: true, lastWinner: winnerData, winnersHistory: firebase.firestore.FieldValue.arrayUnion(winnerData) });
            }
        });
    } catch (e) { }
}

async function drawBall() {
    if(isDrawing || drawnBalls.length >= 90) return;
    isDrawing = true;
    try {
        let n; do { n = Math.floor(Math.random() * 90) + 1; } while (drawnBalls.includes(n));
        await db_bingo90.update({ balls: firebase.firestore.FieldValue.arrayUnion(n) });
    } finally { isDrawing = false; }
}

async function startRaffle() {
    if (drawnBalls.length > 0) return alert("El juego ya inició. No puedes sortear el acumulado ahora.");
    
    // Obtener jugadores aprobados
    const snap = await db_bingo90.collection('players').where('status', '==', 'approved').get();
    const players = [];
    snap.forEach(d => players.push(d.id));
    
    if (players.length === 0) return alert("No hay jugadores aprobados en la mesa.");
    
    // Regla: 1 por cada 15. Mínimo 1.
    const countToSelect = Math.max(1, Math.floor(players.length / 15));
    const selected = [];
    const pool = [...players];
    
    while(selected.length < countToSelect && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        selected.push(pool.splice(idx, 1)[0]);
    }
    
    await db_bingo90.update({ 
        isRaffleActive: true, 
        raffleWinners: selected,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Desactivar el estado del sorteo después de un tiempo para que el anuncio termine
    setTimeout(async () => {
        await db_bingo90.update({ isRaffleActive: false });
    }, 10000);
}

function toggleAutoDraw() {
    const btn = document.getElementById('autoDrawBtn');
    if (autoDrawInterval) { clearInterval(autoDrawInterval); autoDrawInterval = null; btn.textContent = "AUTO-SORTEO"; btn.style.background = "#ffcc00"; }
    else { btn.textContent = "DETENER"; btn.style.background = "#ff4444"; autoDrawInterval = setInterval(drawBall, 5000); }
}

function generateTickets(count) {
    myTickets = []; const container = document.getElementById('ticketsGrid'); if(!container) return; container.innerHTML = '';
    for(let i=0; i<count; i++) {
        const grid = generateBingo90Ticket(); const id = Math.floor(Math.random()*9000+1000);
        myTickets.push({ id: id, grid: grid, rows: grid.map(r => r.filter(n => n!==0)), nums: grid.flat().filter(n => n!==0) });
        renderTicketUI(grid, i, id);
    }
}

function renderTicketUI(grid, idx, id) {
    const tDiv = document.createElement('div'); tDiv.className = 'ticket90'; tDiv.innerHTML = `<div class="ticket-header">ID #${id}</div>`;
    grid.forEach(row => {
        const rDiv = document.createElement('div'); rDiv.className = 'ticket90-row';
        row.forEach(num => {
            const cell = document.createElement('div'); cell.className = num === 0 ? 'ticket90-cell empty' : 'ticket90-cell';
            cell.textContent = num === 0 ? '' : num; if(num !== 0) cell.id = `cell-${idx}-${num}`; rDiv.appendChild(cell);
        });
        tDiv.appendChild(rDiv);
    });
    document.getElementById('ticketsGrid').appendChild(tDiv);
}

function generateBingo90Ticket() {
    let grid = Array(3).fill().map(() => Array(9).fill(0));
    const ranges = [[1,9],[10,19],[20,29],[30,39],[40,49],[50,59],[60,69],[70,79],[80,90]];
    for(let col=0; col<9; col++) { let row = Math.floor(Math.random()*3); grid[row][col] = Math.floor(Math.random()*(ranges[col][1]-ranges[col][0]+1))+ranges[col][0]; }
    let rem = 6; while(rem > 0) {
        let r = Math.floor(Math.random()*3), c = Math.floor(Math.random()*9);
        if(grid[r][c]===0 && grid[r].filter(n=>n!==0).length < 5) {
            let n; do { n = Math.floor(Math.random()*(ranges[c][1]-ranges[c][0]+1))+ranges[c][0]; }
            while(grid[0][c]===n || grid[1][c]===n || grid[2][c]===n);
            grid[r][c] = n; rem--;
        }
    }
    return grid;
}

function showWinOverlay(type, name) { document.getElementById('winType').textContent = `¡${type}!`; document.getElementById('winUser').textContent = name; document.getElementById('winOverlay').classList.add('active'); }
function closeOverlay() { document.getElementById('winOverlay').classList.remove('active'); }

async function updatePrice() { const newPrice = parseInt(document.getElementById('ticketPriceInput').value); if (newPrice > 0) await db_bingo90.update({ ticketPrice: newPrice }); }

document.getElementById('resetBtn')?.addEventListener('click', async () => {
    if(!confirm("¿Nueva ronda?")) return; if(autoDrawInterval) toggleAutoDraw();
    const snap = await db_bingo90.collection('players').get(); snap.forEach(d => d.ref.delete());
    await db_bingo90.set({ 
        balls: [], 
        lastWinner: null, 
        ticketPrice: ticketPrice, 
        winnersHistory: [], 
        wonPrizes: { line1: false, line2: false, line3: false, full: false }, 
        raffleWinners: [],
        isRaffleActive: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp() 
    });
});

async function cleanupExpiredPlayers() {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const snap = await db_bingo90.collection('players').where('status', '==', 'pending').get();
    
    snap.forEach(doc => {
        const data = doc.data();
        const joinedAt = data.joinedAt?.toMillis() || data.time; // Handle both types of timestamps
        if (joinedAt && (now - joinedAt > oneHour)) {
            console.log("Eliminando jugador expirado (90):", doc.id);
            doc.ref.delete();
        }
    });
}

window.onload = () => {
    const isAdmin = new URLSearchParams(window.location.search).get('admin') === 'true';
    if(isAdmin) { playerRole = 'admin'; playerName = "Admin"; document.getElementById('adminPanel').style.display = 'block'; document.getElementById('joinOverlay').style.display = 'none'; }
    
    // Auto-fill name
    const nInput = document.getElementById('playerNameInput');
    if (nInput) {
        nInput.value = localStorage.getItem('bingo_user_name') || localStorage.getItem('bingo_my_name') || '';
    }

    const board = document.getElementById('miniBoard'); if(board) { board.innerHTML = ''; for(let i=1; i<=90; i++) { const d = document.createElement('div'); d.className = 'mini-ball'; d.id = `mini-${i}`; d.textContent = i; board.appendChild(d); } }
    startSync();
    cleanupExpiredPlayers();
    setInterval(cleanupExpiredPlayers, 300000); // Cada 5 min
    setInterval(renderAdminPlayers, 1000); // Re-render timers
};
