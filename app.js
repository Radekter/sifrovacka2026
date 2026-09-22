// Spojení s vaší reálnou databází Supabase z Excelu
const SUPABASE_URL = "https://supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jY2VsdGZvbW9iaWdwZHNocmFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTYwNzcyNzMsImV4cCI6MjAzMTY1MzI3M30.7M-gT-M6fF99oXw7x_NpxgZ7h8g3Q9V2_q8w8w-8Y_o";

// Inicializace připojení
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let currentTeamData = null;

function showView(viewId) {
    ['view-login', 'view-lobby', 'view-game', 'view-finish', 'view-admin'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');
    
    if (currentUser) {
        document.getElementById('logout-btn').classList.remove('hidden');
        document.getElementById('user-display').innerText = currentUser.email === 'admin@hra.cz' ? '🛠️ Administrátor' : `🏃 ${currentUser.email}`;
    } else {
        document.getElementById('logout-btn').classList.add('hidden');
        document.getElementById('user-display').innerText = 'Nepřihlášen';
    }
}

// Výchozí zobrazení přihlašovací obrazovky
showView('view-login');

async function handleLogin() {
    const email = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-password').value.trim();
    const err = document.getElementById('login-error');
    err.classList.add('hidden');

    if (!email || !pass) {
        err.innerText = "❌ Vyplňte všechna pole.";
        err.classList.remove('hidden');
        return;
    }

    // 1. Přihlášení Administrátora
    if(email === 'admin@hra.cz' && pass === 'admin123') {
        currentUser = { email: 'admin@hra.cz' };
        showView('view-admin');
        loadAdminDashboard();
        setInterval(loadAdminDashboard, 5000);
        return;
    }

    // 2. Přihlášení herního týmu přes Supabase
    try {
        const { data, error } = await _supabase.from('tymy').select('*').eq('prihlasovaci_jmeno', email).eq('heslo', pass);
        if (error || !data || data.length === 0) {
            err.innerText = "❌ Nesprávné jméno nebo heslo.";
            err.classList.remove('hidden');
            return;
        }
        currentUser = { email: email };
        currentTeamData = data[0];
        checkGameStatus();
        setInterval(checkGameStatus, 5000);
    } catch (e) {
        err.innerText = "❌ Chyba připojení k databázi.";
        err.classList.remove('hidden');
    }
}
async function checkGameStatus() {
    if (!currentTeamData) return;
    try {
        const { data: config } = await _supabase.from('nastaveni_hry').select('*').eq('klic', 'cas_startu');
        const { data: team } = await _supabase.from('tymy').select('*').eq('id', currentTeamData.id);
        if (team && team.length > 0) currentTeamData = team[0];

        if (!config || config.length === 0) {
            showView('view-lobby');
            return;
        }

        if (currentTeamData.aktualni_sifra_id === null || currentTeamData.aktualni_sifra_id > 4) {
            showView('view-finish');
            return;
        }

        const { data: cipher } = await _supabase.from('sifry').select('*').eq('id', currentTeamData.aktualni_sifra_id);
        if(cipher && cipher.length > 0) {
            showView('view-game');
            document.getElementById('game-station-num').innerText = `${cipher[0].poradi}. Stanoviště`;
            document.getElementById('game-cipher-name').innerText = cipher[0].nazev_sifry;
            document.getElementById('hint-timer').innerText = cipher[0].napoveda_text ? `💡 Nápověda: ${cipher[0].napoveda_text}` : 'Pro toto stanoviště není nápověda.';
        }
    } catch (e) {}
}

async function submitCode() {
    const input = document.getElementById('game-input-code').value.trim().toUpperCase();
    const err = document.getElementById('game-error');
    err.classList.add('hidden');

    try {
        const { data: cipher } = await _supabase.from('sifry').select('*').eq('id', currentTeamData.aktualni_sifra_id);
        if (cipher && cipher.length > 0 && input === cipher[0].kod_stanoviste.toUpperCase()) {
            let nextIndex = currentTeamData.aktualni_sifra_id + 1;
            await _supabase.from('tymy').update({ aktualni_sifra_id: nextIndex }).eq('id', currentTeamData.id);
            document.getElementById('game-input-code').value = '';
            checkGameStatus();
        } else {
            err.classList.remove('hidden');
        }
    } catch (e) {
        err.classList.remove('hidden');
    }
}

async function loadAdminDashboard() {
    try {
        const { data: teams } = await _supabase.from('tymy').select('*');
        const tbody = document.getElementById('admin-leaderboard-body');
        if(teams && tbody) {
            tbody.innerHTML = teams.map(t => `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td class="p-3 font-bold text-slate-800">${t.nazev_tymu}</td>
                    <td class="p-3">${t.aktualni_sifra_id ? t.aktualni_sifra_id + '. šifra' : '<span class="text-blue-600 font-bold">V cíli / Lobby</span>'}</td>
                    <td class="p-3"><button onclick="forceNext(${t.id}, ${t.aktualni_sifra_id || 1})" class="bg-slate-100 border border-slate-200 text-slate-700 px-2 py-1 rounded text-xs hover:bg-slate-200 transition">Posunout ➔</button></td>
                </tr>
            `).join('');
        }
    } catch(e) {}
}

async function forceNext(teamId, currentId) {
    await _supabase.from('tymy').update({ aktualni_sifra_id: currentId + 1 }).eq('id', teamId);
    loadAdminDashboard();
}

async function startGlobalGame() {
    const nowIso = new Date().toISOString();
    await _supabase.from('nastaveni_hry').upsert({ klic: 'cas_startu', hodnota: nowIso });
    alert("🚀 Hra byla hromadně odstartována!");
}

function logout() {
    location.reload();
}
