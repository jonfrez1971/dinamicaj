// DB Simulation (Local Storage Backup)
const DB_KEY = 'bingo_db_v1';
const defaultSchema = { usuarios: [], rondas: [], participantes: [], sorteos: [], historialGanadores: [] };

function initDB() { if (!localStorage.getItem(DB_KEY)) localStorage.setItem(DB_KEY, JSON.stringify(defaultSchema)); }
function getTable(t) { initDB(); const d = JSON.parse(localStorage.getItem(DB_KEY)); return d[t] || []; }
function saveTable(t, data) { const d = JSON.parse(localStorage.getItem(DB_KEY)); d[t] = data; localStorage.setItem(DB_KEY, JSON.stringify(d)); }
function generateId(t, f) { const table = getTable(t); return table.length ? Math.max(...table.map(r => r[f])) + 1 : 1; }

const db = {
    createUser(nombre) { const table = getTable('usuarios'); const newUser = { user_id: generateId('usuarios', 'user_id'), nombre }; table.push(newUser); saveTable('usuarios', table); return newUser; },
    getAllUsers() { return getTable('usuarios'); },
    createRonda(acumulado) { const table = getTable('rondas'); const newRonda = { ronda_id: generateId('rondas', 'ronda_id'), acumulado }; table.push(newRonda); saveTable('rondas', table); return newRonda; },
    addParticipante(r, u, c) { const table = getTable('participantes'); const n = { participante_id: generateId('participantes', 'participante_id'), ronda_id: r, user_id: u, carton: c }; table.push(n); saveTable('participantes', table); return n; },
    getHistorialGanadores() { return getTable('historialGanadores'); }
};

// DOM Elements
const startBtn = document.getElementById('startBtn');
const clearPlayersBtn = document.getElementById('clearPlayersBtn');
const playersGrid = document.getElementById('playersGrid');
const playerNameInput = document.getElementById('playerNameInput');
const currentBallEl = document.getElementById('currentBall');
const jackpotDisplay = document.getElementById('jackpotDisplay');
const roundDisplay = document.getElementById('roundDisplay');
const bingoCage = document.getElementById('bingoCage');

// Global State
let players = [];
let drawnBalls = [];
let roundNumber = 1;
let jackpot = 10000;
let isRoundFinished = false;
let participants = [];
let winnerInfo = null;
let raffleWinnerIds = [];
let lastBallSpoken = 0;
let isRaffleActive = false;
let announced4Hits = new Set();
let localAnnounced4Hits = new Set();

const isAdminMode = new URLSearchParams(window.location.search).get('admin') === 'true';
const isPlayerMode = !isAdminMode;

// Audio Context
let audioCtx;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function speakText(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-ES'; u.rate = 0.9;
        window.speechSynthesis.speak(u);
    }
}

// Procedural Audio Effects (Luxury Details)
function playPopSound() {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
}

function playCashSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.05);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(now + 0.1);
}

// Firebase Sync
function setupFirebaseSync() {
    if (!window.db_firebase) return;

    window.db_firebase.collection("jugadores").onSnapshot((snap) => {
        const newPlayers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Sound for new player (Admin only)
        if (!isPlayerMode && newPlayers.length > players.length && players.length > 0) {
            playNewPlayerSound();
        }

        players = newPlayers;
        renderPlayers();
    }, err => console.error("Error Firebase:", err));

    window.db_firebase.collection("juego").doc("estado").onSnapshot((doc) => {
        if (doc.exists) {
            const d = doc.data();
            const newBalls = d.bolas || [];
            jackpot = d.jackpot || 10000;
            roundNumber = d.ronda || 1;
            winnerInfo = d.ganador || null;
            raffleWinnerIds = d.raffleWinnerIds || [];
            const raffleActive = d.raffleActive || false;
            const isSpinning = d.isSpinning || false;

            const rOverlay = document.getElementById('raffleOverlay');
            const rName = document.getElementById('raffleName');
            const sRName = document.getElementById('sidebarRaffleName');
            
            if (raffleActive && !window.lastRaffleState) {
                const names = raffleWinnerIds.join(' y ');
                if (rName) rName.textContent = names;
                if (sRName) sRName.textContent = names;
                if (rOverlay) rOverlay.classList.add('active');
                
                // Pequeña espera para que el Admin también lo escuche correctamente
                setTimeout(() => {
                    speakText("Atención. Sorteo del acumulado. Los elegidos para ir por el premio mayor son: " + names + ". ¡Mucha suerte!");
                }, 500);
                
                window.lastRaffleState = true;
            } else if (!raffleActive && window.lastRaffleState) {
                if (rOverlay) rOverlay.classList.remove('active');
                window.lastRaffleState = false;
            }

            if (bingoCage) {
                if (isSpinning) {
                    bingoCage.classList.add('spinning');
                    playCageSound();
                } else {
                    bingoCage.classList.remove('spinning');
                }
            }

            if (newBalls.length > drawnBalls.length) {
                const latestBall = newBalls[newBalls.length - 1];
                if (latestBall !== lastBallSpoken) {
                    speakText(latestBall.toString());
                    lastBallSpoken = latestBall;
                }
            }

            drawnBalls = newBalls;
            updateUI();
            updateMasterBoardUI();
            renderPlayers();

            // Announcement for near winners (Sync)
            const nearWinners = d.nearWinners || [];
            nearWinners.forEach(name => {
                if (!localAnnounced4Hits.has(name)) {
                    speakText(`Atentos que a ${name} le falta uno para ganar`);
                    localAnnounced4Hits.add(name);
                }
            });

            if (winnerInfo && !isRoundFinished) {
                showWinnerOverlay(winnerInfo);
            }
        }
    });
}

function syncGameState(extra = {}) {
    if (!window.db_firebase || isPlayerMode) return;
    window.db_firebase.collection("juego").doc("estado").set({
        bolas: drawnBalls,
        jackpot: jackpot,
        ronda: roundNumber,
        ganador: winnerInfo,
        raffleWinnerIds: raffleWinnerIds,
        raffleActive: isRaffleActive,
        nearWinners: Array.from(announced4Hits),
        ...extra
    });
}

function updateMasterBoardUI() {
    const mb = document.getElementById('masterBoard');
    const countDisplay = document.getElementById('ballCountDisplay');
    if (countDisplay) countDisplay.textContent = drawnBalls.length;
    
    if (!mb) return;
    mb.innerHTML = '';
    
    // Show last 10 balls
    const last10 = drawnBalls.slice(-10).reverse(); // Reverse to show newest first
    
    for (let i = 0; i < 10; i++) {
        const ball = last10[i];
        const cell = document.createElement('div');
        cell.className = 'master-cell' + (ball ? ' called' : '');
        cell.textContent = ball || '-';
        mb.appendChild(cell);
    }
}

function renderPlayers() {
    if (!playersGrid) return;
    playersGrid.innerHTML = '';
    const myName = localStorage.getItem('bingo_my_name');
    const title = document.getElementById('playersCountTitle');
    if (title) title.textContent = `Jugadores (${players.length})`;

    // Pin my card to the top
    const sorted = [...players].sort((a,b) => {
        if (a.name === myName) return -1;
        if (b.name === myName) return 1;
        return 0;
    });

    sorted.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'player-card' + (p.name === myName ? ' my-card' : '');
        const carton = p.carton || [];
        let hits = 0;
        let nums = carton.length ? carton.map(n => {
            const m = drawnBalls.includes(n);
            if (m) hits++;
            return `<div class="number-capsule ${m ? 'marked' : ''}">${n}</div>`;
        }).join('') : '<div class="number-capsule">-</div>'.repeat(5);

        const isWinnerInRaffle = raffleWinnerIds.includes(p.name);
        const isPending = p.status === 'pendiente';

        let timeText = '';
        if (isPending) {
            const now = Date.now();
            const elapsed = now - (p.time || now);
            const remaining = Math.max(0, (60 * 60 * 1000) - elapsed);
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            timeText = `<div style="font-size:0.6rem; color:#ffaa00; margin-bottom:5px;">⏳ Expira en: ${mins}m ${secs}s</div>`;
        }

        card.innerHTML = `
            <div class="card-top">
                <span class="player-card-name" style="font-size:0.85rem; font-weight:900;">
                    ${isWinnerInRaffle ? '🏆 ' : ''}${p.name === myName ? '⭐ ' : ''}${isPending ? '<span style="color:var(--accent); animation:pulse 1s infinite;">⏳ </span>' : '✅ '}${p.name}
                </span>
                ${p.name === myName ? '<span style="font-size:0.6rem; color:var(--secondary); font-weight:bold;">MI CARTÓN</span>' : ''}
                ${!isPlayerMode ? `
                    <div style="margin-left:auto; display:flex; gap:5px;">
                        <a href="https://wa.me/${(p.phone || '').replace(/\D/g,'')}" target="_blank" style="text-decoration:none; font-size:0.8rem;">📱</a>
                        <button onclick="removePlayer('${p.id}')" style="background:none; border:none; color:rgba(255,255,255,0.3); cursor:pointer; font-size:0.8rem;">🗑️</button>
                    </div>` : ''}
            </div>
            ${!isPlayerMode ? `
                <div style="font-size:0.65rem; color:#aaa; margin-bottom:5px;">Tel: ${p.phone || 'N/A'}</div>
                ${isPending ? timeText : ''}
            ` : ''}
            ${isPending ? `
                <div style="font-size:0.6rem; color:var(--accent); text-align:center; font-weight:bold; margin-bottom:5px;">
                    PAGO PENDIENTE
                    ${!isPlayerMode ? `<button onclick="validatePlayer('${p.id}')" style="display:block; margin:5px auto; background:var(--secondary); color:#000; border:none; padding:4px 8px; border-radius:5px; font-size:0.6rem; font-weight:bold; cursor:pointer;">VALIDAR ✅</button>` : ''}
                </div>` : 
                '<div style="font-size:0.6rem; color:#00ff88; text-align:center; font-weight:bold; margin-bottom:5px;">PAGO VALIDADO ✅</div>'
            }
            <div class="card-numbers">${nums}</div>
            <div class="progress-info" style="margin-top:5px;"><span>Progreso</span><span>${hits}/5</span></div>
            <div class="progress-container"><div class="progress-bar" style="width:${(hits/5)*100}%"></div></div>
        `;
        playersGrid.appendChild(card);
    });
}

async function addPlayer() {
    getAudioCtx();
    const name = playerNameInput.value.trim();
    if (!name) return alert("Por favor, escribe tu nombre.");
    
    const nameCount = players.filter(p => p.name.toLowerCase() === name.toLowerCase()).length;
    if (nameCount >= 2) {
        return alert("Ya has comprado el máximo de 2 puestos permitidos.");
    }
    
    if (players.length >= 30) return alert("Lo sentimos, la mesa está llena (Máximo 30 jugadores).");

    try {
        const phone = localStorage.getItem('bingo_user_phone') || 'Sin teléfono';
        
        // 1. REGISTRAR PRIMERO (CON AWAIT PARA ASEGURAR QUE SE GUARDE)
        await window.db_firebase.collection("jugadores").add({
            name: name,
            phone: phone,
            time: Date.now(),
            status: 'pendiente',
            carton: []
        });

        // 2. HABLAR BIENVENIDA Y SONIDO
        playCashSound();
        speakText(`Bienvenido ${name}. Por favor envía tu comprobante de Nequi por WhatsApp para entrar al sorteo.`);
        
        // 3. ABRIR WHATSAPP (Soporte/Pagos)
        window.open("https://wa.me/573215978316?text=" + encodeURIComponent(`Hola, envío mi comprobante de pago para el Bingo Spress. Mi nombre es: ${name}`), "_blank");

        // 4. PERSISTENCIA LOCAL
        localStorage.setItem('bingo_my_name', name);
        playerNameInput.value = '';
        
    } catch (err) {
        console.error("Error al registrar:", err);
        alert("Hubo un error al registrarte. Revisa tu conexión.");
    }
}

function startNewRound() {
    if (isPlayerMode) return;
    if (players.length === 0) return alert("¡Agrega al menos un jugador para empezar!");
    
    startBtn.disabled = true;
    drawnBalls = [];
    isRoundFinished = false;
    winnerInfo = null;
    announced4Hits = new Set();
    localAnnounced4Hits = new Set();

    // Acumulado Logic: Incrementar $10.000 por ronda
    jackpot += 10000;
    
    // Create internal DB record
    const currentRound = db.createRonda(jackpot);
    roundNumber = currentRound.ronda_id;

    // Reset players in Firebase and assign random cards
    participants = [];
    
    // Use a small delay for each player to avoid UI freeze
    players.forEach((pObj, index) => {
        const carton = [];
        while(carton.length < 5) {
            const n = Math.floor(Math.random() * 90) + 1;
            if(!carton.includes(n)) carton.push(n);
        }
        carton.sort((a,b) => a - b);
        
        window.db_firebase.collection("jugadores").doc(pObj.id).update({ 
            carton: carton, 
            status: 'jugando' 
        });

        const user = db.createUser(pObj.name);
        const p = db.addParticipante(roundNumber, user.user_id, carton);
        participants.push({...p, name: pObj.name, cardId: pObj.id});
    });

    // Raffle for the Jackpot
    const eligible = [...participants];
    const selected = [];
    while(selected.length < 2 && eligible.length > 0) {
        const idx = Math.floor(Math.random() * eligible.length);
        selected.push(eligible.splice(idx, 1)[0]);
    }
    
    raffleWinnerIds = selected.map(p => p.name);
    isRaffleActive = true;
    syncGameState();

    setTimeout(() => {
        isRaffleActive = false;
        syncGameState();
        spinCageAndDraw();
    }, 6000);
}

// Procedural Cage Effect
function createCageBalls() {
    if (!bingoCage) return;
    bingoCage.innerHTML = '';
    for (let i = 0; i < 20; i++) {
        const ball = document.createElement('div');
        ball.className = 'cage-ball';
        ball.style.left = Math.random() * 80 + 10 + '%';
        ball.style.top = Math.random() * 80 + 10 + '%';
        ball.style.animationDelay = Math.random() * 0.5 + 's';
        bingoCage.appendChild(ball);
    }
}

function playCageSound() {
    const ctx = getAudioCtx();
    const duration = 2.0;
    const startTime = ctx.currentTime;
    
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, startTime);
    filter.frequency.exponentialRampToValueAtTime(100, startTime + duration);
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    noise.start(startTime);
    noise.stop(startTime + duration);
}

function spinCageAndDraw() {
    if (isRoundFinished || drawnBalls.length >= 90) return;
    syncGameState({ isSpinning: true });
    setTimeout(() => {
        syncGameState({ isSpinning: false });
        drawBall();
    }, 2000);
}

function drawBall() {
    if (isRoundFinished || isPlayerMode) return;
    let ball;
    do { ball = Math.floor(Math.random()*90)+1; } while (drawnBalls.includes(ball));
    drawnBalls.push(ball);
    playPopSound();
    syncGameState();
    checkWinners();
    if (!isRoundFinished) setTimeout(spinCageAndDraw, 4500);
}

function checkWinners() {
    if (isPlayerMode || isRoundFinished) return;
    
    const winners = [];
    const baseTotal = (players.length * 4000) * 0.7;

    participants.forEach(p => {
        const hits = (p.carton || []).filter(n => drawnBalls.includes(n)).length;
        
        // 4 hits announcement
        if (hits === 4 && !announced4Hits.has(p.name) && !isRoundFinished) {
            announced4Hits.add(p.name);
            syncGameState();
        }

        if (hits === 5) {
            winners.push(p);
        }
    });

    if (winners.length > 0) {
        isRoundFinished = true;
        
        // Determinar si alguno de los ganadores tenía el sorteo del acumulado
        const jackpotWinners = winners.filter(w => raffleWinnerIds.includes(w.name));
        const hasJackpotWinner = jackpotWinners.length > 0;
        
        // El premio fijo se divide entre todos los que hicieron Bingo
        const prizePerWinner = baseTotal / winners.length;
        
        // El acumulado se divide solo entre los ganadores que estaban en el sorteo (si hay)
        let jackpotPrizePerWinner = 0;
        if (hasJackpotWinner) {
            jackpotPrizePerWinner = jackpot / jackpotWinners.length;
            jackpot = 10000; // Reset jackpot
        }

        const names = winners.map(w => w.name).join(' y ');
        const totalPrize = hasJackpotWinner ? (prizePerWinner + jackpotPrizePerWinner) : prizePerWinner;

        winnerInfo = { 
            names: winners.map(w => w.name),
            prizePerWinner: Math.floor(prizePerWinner),
            jackpotPrizePerWinner: Math.floor(jackpotPrizePerWinner),
            totalPrize: Math.floor(totalPrize),
            isJackpot: hasJackpotWinner,
            multipleWinners: winners.length > 1
        };
        
        syncGameState();
        showWinnerOverlay(winnerInfo);
    }
}

function showWinnerOverlay(info) {
    isRoundFinished = true;
    const wOverlay = document.getElementById('winnerOverlay');
    const wName = document.getElementById('winnerName');
    const wPrize = document.getElementById('winnerPrize');
    
    const namesText = info.names.join(' y ');
    if (wName) wName.textContent = namesText;
    
    let prizeDetail = `Premio: $${info.totalPrize.toLocaleString()}`;
    if (info.multipleWinners) {
        prizeDetail = `Premio por ganador: $${info.totalPrize.toLocaleString()}`;
    }
    if (wPrize) wPrize.textContent = prizeDetail;
    
    // Add WhatsApp Button for payment
    const existingWA = document.getElementById('waPaymentBtn');
    if (existingWA) existingWA.remove();

    const waBtn = document.createElement('button');
    waBtn.id = 'waPaymentBtn';
    waBtn.className = 'btn';
    waBtn.style.background = '#0088cc';
    waBtn.style.marginTop = '20px';
    waBtn.style.color = 'white';
    waBtn.innerHTML = '📱 COBRAR PREMIO (Telegram)';
    waBtn.onclick = () => {
        const msg = encodeURIComponent(`Hola, gané en el Bingo Spress (Ronda #${roundNumber}). Mi nombre es: ${localStorage.getItem('bingo_my_name') || 'Ganador'}.`);
        window.open(`https://t.me/Bingojonzu`, '_blank');
    };
    wPrize.after(waBtn);

    if (wOverlay) {
        wOverlay.classList.add('active');
        if (info.isJackpot) {
            wOverlay.classList.add('jackpot-win');
            if (info.multipleWinners) {
                speakText(`¡ATENCIÓN! Hubo varios ganadores. El premio fijo se divide. Ganadores: ${namesText}. El acumulado se reparte entre los favorecidos.`);
            } else {
                speakText(`¡ATENCIÓN! Bingo y ganador del acumulado: ${namesText}. Premio total: ${info.totalPrize} pesos.`);
            }
            startConfetti();
        } else {
            wOverlay.classList.remove('jackpot-win');
            if (info.multipleWinners) {
                speakText(`Hubieron ${info.names.length} ganadores en la ronda por lo tanto el premio fijo se divide. Felicidades a ${namesText}.`);
            } else {
                speakText(`¡Bingo! Ganador: ${namesText}.`);
            }
        }
    }
}

function startConfetti() {
    // Simple procedural confetti
    const colors = ['#8a2be2', '#00f0ff', '#ff007f', '#ffcc00'];
    for (let i = 0; i < 50; i++) {
        const confetto = document.createElement('div');
        confetto.className = 'confetto';
        confetto.style.left = Math.random() * 100 + 'vw';
        confetto.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetto.style.width = Math.random() * 10 + 5 + 'px';
        confetto.style.height = Math.random() * 10 + 5 + 'px';
        confetto.style.animationDuration = Math.random() * 3 + 2 + 's';
        confetto.style.animationDelay = Math.random() * 2 + 's';
        document.body.appendChild(confetto);
        setTimeout(() => confetto.remove(), 5000);
    }
}

function updateUI() {
    jackpotDisplay.textContent = '$' + jackpot.toLocaleString();
    roundDisplay.textContent = '#' + roundNumber;
    if (drawnBalls.length > 0) {
        currentBallEl.textContent = drawnBalls[drawnBalls.length - 1];
        currentBallEl.style.opacity = 1;
    }
}

function validatePlayer(id) {
    if (isPlayerMode) return;
    window.db_firebase.collection("jugadores").doc(id).update({ status: 'pagado' })
    .then(() => {
        playCashSound();
        speakText("Pago validado correctamente");
    });
}
window.validatePlayer = validatePlayer;

function playNewPlayerSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(now + 0.2);
}

function removePlayer(id) {
    if (isPlayerMode) return;
    if (confirm("¿Eliminar?")) window.db_firebase.collection("jugadores").doc(id).delete();
}
window.removePlayer = removePlayer;

function clearAllPlayers() {
    if (isPlayerMode) return;
    if (confirm("¿ESTÁS SEGURO? Esto borrará a TODOS los jugadores de la mesa.")) {
        players.forEach(p => {
            window.db_firebase.collection("jugadores").doc(p.id).delete();
        });
        alert("Mesa limpia.");
    }
}
window.clearAllPlayers = clearAllPlayers;

function resetGameState() {
    if (isPlayerMode) return;
    if (confirm("¿Reiniciar el estado del juego? Esto detendrá cualquier sorteo o raffle activo.")) {
        isRaffleActive = false;
        drawnBalls = [];
        isRoundFinished = false;
        winnerInfo = null;
        syncGameState({ isSpinning: false, raffleActive: false, nearWinners: [] });
        alert("Juego reiniciado.");
        location.reload();
    }
}
window.resetGameState = resetGameState;

function cleanupExpiredPlayers() {
    if (!window.db_firebase) return;
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    window.db_firebase.collection("jugadores")
        .where("status", "==", "pendiente")
        .get()
        .then(snap => {
            snap.forEach(doc => {
                const data = doc.data();
                if (data.time && (now - data.time > oneHour)) {
                    console.log("Eliminando jugador expirado:", data.name);
                    doc.ref.delete();
                }
            });
        });
}

function init() {
    if (!isAdminMode) {
        const sBtn = document.getElementById('startBtn');
        const cBtn = document.getElementById('clearPlayersBtn');
        const rBtn = document.getElementById('resetGameBtn');
        if (sBtn) sBtn.style.display = 'none';
        if (cBtn) cBtn.style.display = 'none';
        if (rBtn) rBtn.style.display = 'none';
    }

    startBtn?.addEventListener('click', () => { getAudioCtx(); startNewRound(); });
    document.getElementById('addPlayerBtn')?.addEventListener('click', addPlayer);
    document.getElementById('clearPlayersBtn')?.addEventListener('click', clearAllPlayers);
    document.getElementById('resetGameBtn')?.addEventListener('click', resetGameState);
    
    document.getElementById('nextRoundBtn')?.addEventListener('click', () => {
        const overlay = document.getElementById('winnerOverlay');
        if (overlay) overlay.classList.remove('active');
        isRoundFinished = false;
        if (!isPlayerMode) {
            winnerInfo = null; drawnBalls = [];
            announced4Hits = new Set();
            localAnnounced4Hits = new Set();
            syncGameState();
            startBtn.disabled = false;
        }
    });

    setupFirebaseSync();
    createCageBalls();
    updateMasterBoardUI(); // Initialize with empty slots
    cleanupExpiredPlayers();
    setInterval(cleanupExpiredPlayers, 300000); // Check every 5 minutes
    setInterval(renderPlayers, 1000); // Refresh timers every second

    // Auto-fill name from registration
    if (playerNameInput) {
        const storedName = localStorage.getItem('bingo_user_name') || localStorage.getItem('bingo_my_name') || '';
        playerNameInput.value = storedName;
    }

    // Welcome Animator for Spress
    setTimeout(() => {
        speakText("¡Bienvenidos a Bingo Spress! Gana quien complete su línea de 5 números primero. El acumulado crece en 10 mil pesos en cada ronda. ¡Mucha suerte!");
    }, 1500);
}

window.addEventListener('DOMContentLoaded', init);
