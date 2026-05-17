// Dinamicas J - Logic
const rifaGrid = document.getElementById('rifaGrid');
const selectionBar = document.getElementById('selectionBar');
const selectedNumText = document.getElementById('selectedNumText');
const activeLotteryEl = document.getElementById('activeLottery');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');

const isAdminMode = new URLSearchParams(window.location.search).get('admin') === 'true';
let selectedNumbers = []; // Now an array
let takenNumbers = {}; // { "05": { name: "Juan", status: "pagado" } }

const lotteries = [
    "Dorado Noche",     // 0: Domingo
    "L. Cundinamarca",  // 1: Lunes
    "L. Cruz Roja",     // 2: Martes
    "L. del Valle",     // 3: Miércoles
    "L. de Bogotá",     // 4: Jueves
    "L. de Medellín",   // 5: Viernes
    "L. de Boyacá"      // 6: Sábado
];

function updateLotteryInfo() {
    const day = new Date().getDay();
    activeLotteryEl.textContent = "Hoy: " + lotteries[day];
}

function initGrid() {
    rifaGrid.innerHTML = '';
    for (let i = 0; i < 100; i++) {
        const num = i.toString().padStart(2, '0');
        const box = document.createElement('div');
        box.className = 'number-box';
        box.textContent = num;
        box.id = `num-${num}`;
        
        box.onclick = () => selectNumber(num);
        rifaGrid.appendChild(box);
    }
}

function selectNumber(num) {
    if (takenNumbers[num]) {
        // ADMIN MODE: Show details
        if (isAdminMode) {
            const data = takenNumbers[num];
            let timeInfo = '';
            
            if (confirm(`Número: ${num}\nComprador: ${data.name}\nTel: ${data.phone || 'N/A'}${timeInfo}\n\n¿Deseas devolver este número al pozo?`)) {
                db.collection("rifas_activas").doc("sorteo_actual").update({
                    [`puestos.${num}`]: firebase.firestore.FieldValue.delete()
                });
            }
        }
        return;
    }

    const index = selectedNumbers.indexOf(num);
    if (index > -1) {
        selectedNumbers.splice(index, 1);
        document.getElementById(`num-${num}`).classList.remove('selected');
    } else {
        selectedNumbers.push(num);
        document.getElementById(`num-${num}`).classList.add('selected');
    }

    if (selectedNumbers.length > 0) {
        selectedNumText.textContent = selectedNumbers.join(', ');
        selectionBar.classList.add('active');
        document.getElementById('buyBtn').textContent = `Apartar ${selectedNumbers.length} Números ($${(selectedNumbers.length * 10000).toLocaleString()})`;
    } else {
        selectionBar.classList.remove('active');
    }
}

// Firebase Sync
function syncRifa() {
    db.collection("rifas_activas").doc("sorteo_actual").onSnapshot((doc) => {
        if (doc.exists) {
            takenNumbers = doc.data().puestos || {};
            updateGridStatus();
        } else {
            // Initialize if first time
            db.collection("rifas_activas").doc("sorteo_actual").set({ puestos: {} });
        }
    });
}

function updateGridStatus() {
    let count = 0;
    for (let i = 0; i < 100; i++) {
        const num = i.toString().padStart(2, '0');
        const box = document.getElementById(`num-${num}`);
        if (takenNumbers[num]) {
            box.classList.add('taken');
            box.classList.remove('selected');
            count++;
        } else {
            box.classList.remove('taken');
        }
    }
    
    // Update progress bar
    const percent = (count / 80) * 100; // 80 is the goal
    const realPercent = (count / 100) * 100;
    progressBar.style.width = Math.min(realPercent, 100) + '%';
    progressPercent.textContent = Math.floor(realPercent) + '%';
    
    if (realPercent >= 80) {
        progressBar.style.background = 'linear-gradient(to right, #00ff88, #fff)';
    }
}

document.getElementById('buyBtn').onclick = () => {
    if (selectedNumbers.length === 0) return;
    
    const name = localStorage.getItem('bingo_user_name');
    const phone = localStorage.getItem('bingo_user_phone') || 'Sin teléfono';

    if (!name) {
        alert("Por favor, regresa al inicio y regístrate primero.");
        location.href = 'inicio.html';
        return;
    }

    const newPuestos = { ...takenNumbers };
    selectedNumbers.forEach(num => {
        newPuestos[num] = { 
            name: name, 
            phone: phone,
            status: 'pendiente', 
            time: Date.now() 
        };
    });

    db.collection("rifas_activas").doc("sorteo_actual").set({
        puestos: newPuestos
    }, { merge: true }).then(() => {
        const msg = encodeURIComponent(`Hola, acabo de apartar los números ${selectedNumbers.join(', ')} para la rifa Dinamicas J. Mi nombre es ${name}.`);
        window.open(`https://wa.me/573215978316?text=${msg}`, '_blank');
        selectedNumbers = [];
        selectionBar.classList.remove('active');
        // Quitar la selección visual
        document.querySelectorAll('.number-box.selected').forEach(el => el.classList.remove('selected'));
    });
};

function clearRifa() {
    if (!isAdminMode) return;
    if (confirm("¿ESTÁS SEGURO? Esto borrará TODOS los números vendidos y reiniciará la rifa.")) {
        db.collection("rifas_activas").doc("sorteo_actual").set({ puestos: {} });
    }
}
window.clearRifa = clearRifa;

async function cleanupExpiredNumbers() {
    // Desactivado a petición del cliente para manejar limpieza manual
    return;
}

// Initialize
updateLotteryInfo();
initGrid();
syncRifa();
// cleanupExpiredNumbers(); // Desactivado
