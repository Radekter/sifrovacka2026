// ==========================================
// NOVÝ KÓD: ČÁST 1 (KONFIGURACE A HRÁČ)
// ==========================================

// --- CONFIGURACE DATABÁZE ---
const SUPABASE_URL = "https://supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jY2VsdGZvbW9iaWdwZHNocmFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMDc5NzEsImV4cCI6MjEwNTU4Mzk3MX0.MWa8_pFLcELq-S3B0UIKGrXmI-tHIep8CO-GtMEB9t4";

let _supabase = null;
let aktivniUzivatel = null;
let currentTeamData = null;
let gameTimerInterval = null;
let hintTimerInterval = null;

// Inicializace Supabase klienta
if (typeof supabase !== 'undefined') {
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
    console.error("Chyba: Supabase SDK nebylo načteno v HTML.");
}

// Přepínání sekcí webu
function showView(viewId) {
    const elementy = ['view-login', 'view-lobby', 'view-game', 'view-finish', 'view-admin'];
    elementy.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    
    const cilovyEl = document.getElementById(viewId);
    if (cilovyEl) cilovyEl.style.display = 'block';
    
    const displayEmail = aktivniUzivatel ? aktivniUzivatel.email : 'Nepřihlášen';
    const userDisplayEl = document.getElementById('user-display');
    if (userDisplayEl) userDisplayEl.innerText = `Přihlášen: ${displayEmail}`;
}

// Inicializace event listenerů po načtení stránky
document.addEventListener('DOMContentLoaded', () => {
    const btnLogin = document.getElementById('btn-login');
    const btnStartGame = document.getElementById('btn-start-game');
    const btnSubmitCode = document.getElementById('btn-submit-code');

    if (btnLogin) btnLogin.addEventListener('click', handleLogin);
    if (btnStartGame) btnStartGame.addEventListener('click', startGlobalGame);
    if (btnSubmitCode) btnSubmitCode.addEventListener('click', submitCode);
    
    showView('view-login');
});

// --- LOGIKA PŘIHLÁŠENÍ ---
async function handleLogin() {
    const email = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-password').value.trim();
    const err = document.getElementById('login-error');
    if (err) err.style.display = 'none';

    // Administrátorský režim
    if (email === 'ab' && pass === 'ab') {
        aktivniUzivatel = { email: 'Administrátor' };
        showView('view-admin');
        loadAdminDashboard();
        clearInterval(gameTimerInterval);
        gameTimerInterval = setInterval(loadAdminDashboard, 4000);
        return;
    }

    if (!_supabase) {
        alert("❌ Nelze se spojit s databází.");
        return;
    }

    try {
        const { data, error } = await _supabase.from('tymy').select('*').eq('prihlasovaci_jmeno', email).eq('heslo', pass);
        if (error || !data || data.length === 0) {
            if (err) err.style.display = 'block';
            return;
        }
        
        aktivniUzivatel = { email: email };
        currentTeamData = data[0];
        
        checkGameStatus();
        clearInterval(gameTimerInterval);
        gameTimerInterval = setInterval(checkGameStatus, 4000);
    } catch (e) {
        if (err) err.style.display = 'block';
    }
}

// --- LOGIKA HRÁČE: KONTROLA STAVU HRY ---
async function checkGameStatus() {
    if (!currentTeamData || !_supabase) return;
    try {
        const { data: config } = await _supabase.from('nastaveni_hry').select('*').eq('klic', 'cas_startu').single();
        const { data: teamUpdate } = await _supabase.from('tymy').select('*').eq('id', currentTeamData.id).single();
        if (teamUpdate) currentTeamData = teamUpdate;

        if (!config || !config.hodnota) {
            showView('view-lobby');
            return;
        }

        if (currentTeamData.aktualni_sifra_id === null || currentTeamData.aktualni_sifra_id > 4) {
            showView('view-finish');
            clearInterval(hintTimerInterval);
            return;
        }

        const { data: cipher } = await _supabase.from('sifry').select('*').eq('id', currentTeamData.aktualni_sifra_id).single();
        if (cipher) {
            showView('view-game');
            document.getElementById('game-cipher-name').innerText = cipher.nazev_sifry;
            document.getElementById('game-station-num').innerText = `${cipher.poradi}. Stanoviště`;
            
            setupHintTimer(cipher);
        }
    } catch (e) {
        console.error("Chyba herní smyčky:", e);
    }
}
// ==========================================
// NOVÝ KÓD: ČÁST 2 (NÁPOVĚDY A OPRAVENÝ ADMIN)
// ==========================================

// --- LOGIKA HRÁČE: ODPOČET NÁPOVĚDY ---
async function setupHintTimer(cipher) {
    clearInterval(hintTimerInterval);
    
    const { data: log } = await _supabase
        .from('logy_postupu')
        .select('cas_otevreni')
        .eq('tym_id', currentTeamData.id)
        .eq('sifra_id', cipher.id)
        .maybeSingle();

    let casOtevreni = log && log.cas_otevreni ? new Date(log.cas_otevreni) : new Date();

    if (!log || !log.cas_otevreni) {
        const nyni = new Date().toISOString();
        await _supabase.from('logy_postupu').insert([
            { tym_id: currentTeamData.id, sifra_id: cipher.id, cas_otevreni: nyni }
        ]);
        casOtevreni = new Date(nyni);
    }

    const minutyDoNapovedy = cipher.cas_do_napovedy_minuty || 15;
    const casOdemceni = new Date(casOtevreni.getTime() + minutyDoNapovedy * 60000);

    hintTimerInterval = setInterval(() => {
        const zbyvaMilisekund = casOdemceni - new Date();
        const timerElement = document.getElementById('hint-timer');
        const textElement = document.getElementById('hint-text');

        if (!timerElement) return;

        if (zbyvaMilisekund <= 0) {
            clearInterval(hintTimerInterval);
            timerElement.innerText = "💡 Nápověda je k dispozici:";
            if (textElement) {
                textElement.innerText = cipher.napoveda_text || "Pro tuto šifru není nápověda zadána.";
                textElement.style.display = "block";
            }
        } else {
            const minuty = Math.floor(zbyvaMilisekund / 60000);
            const sekundy = Math.floor((zbyvaMilisekund % 60000) / 1000);
            timerElement.innerText = `Nápověda se odemkne za: ${minuty}:${sekundy < 10 ? '0' : ''}${sekundy}`;
            if (textElement) textElement.style.display = "none";
        }
    }, 1000);
}

// --- LOGIKA HRÁČE: ODESLÁNÍ KÓDU STANOVIŠTĚ ---
async function submitCode() {
    const inputCode = document.getElementById('game-input-code').value.trim().toUpperCase();
    const errorElement = document.getElementById('game-error');
    if (errorElement) errorElement.style.display = 'none';

    if (!inputCode) return;

    try {
        const { data: cipher } = await _supabase.from('sifry').select('*').eq('id', currentTeamData.aktualni_sifra_id).single();
        
        if (cipher && cipher.kod_stanoviste.toUpperCase() === inputCode) {
            const nyni = new Date().toISOString();
            
            await _supabase.from('logy_postupu')
                .update({ cas_vyreseni: nyni })
                .eq('tym_id', currentTeamData.id)
                .eq('sifra_id', cipher.id);

            const dalsiSifraId = currentTeamData.aktualni_sifra_id + 1;
            await _supabase.from('tymy')
                .update({ aktualni_sifra_id: dalsiSifraId })
                .eq('id', currentTeamData.id);

            const codeInputEl = document.getElementById('game-input-code');
            if (codeInputEl) codeInputEl.value = '';
            
            alert('🎉 Správně! Postupujete na další stanoviště.');
            checkGameStatus();
        } else {
            if (errorElement) errorElement.style.display = 'block';
        }
    } catch (e) {
        console.error("Chyba při odesílání kódu:", e);
    }
}

// --- LOGIKA ORGANIZÁTORA: ŽIVÝ DASHBOARD (ZABEZPEČENÁ VERZE) ---
async function loadAdminDashboard() {
    if (!_supabase) return;
    try {
        const { data: tymy, error } = await _supabase
            .from('tymy')
            .select(`
                nazev_tymu,
                sifry (
                    nazev_sifry
                )
            `);

        if (error) throw error;

        const leaderboardBody = document.getElementById('admin-leaderboard-body');
        if (!leaderboardBody) return;
        
        leaderboardBody.innerHTML = '';

        if (!tymy || tymy.length === 0) {
            leaderboardBody.innerHTML = `
                <tr>
                    <td colspan="3" style="padding: 15px; text-align: center; color: #64748b; font-style: italic;">
                        V databázi zatím nejsou žádné týmy.
                    </td>
                </tr>`;
            return;
        }

        tymy.forEach(tym => {
            const radek = document.createElement('tr');
            const poziceText = tym.sifry ? tym.sifry.nazev_sifry : '⏳ Na Startu / Čeká v lobby';
            
            radek.innerHTML = `
                <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 14px; text-align: left; font-weight: bold; color: #1e293b;">
                    ${tym.nazev_tymu}
                </td>
                <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 14px; text-align: left; color: #475569;">
                    ${poziceText}
                </td>
                <td style="padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 14px; text-align: left;">
                    <button style="width: auto; margin: 0; padding: 5px 10px; font-size: 11px; background: #64748b; color: white; border: none; border-radius: 4px; cursor: pointer;" onclick="alert('Tým: ${tym.nazev_tymu}')">Detail</button>
                </td>
            `;
            leaderboardBody.appendChild(radek);
        });
    } catch (e) {
        console.error('Chyba administrátorského panelu při vykreslování:', e.message || e);
    }
}

// --- LOGIKA ORGANIZÁTORA: HROMADNÝ START ---
async function startGlobalGame() {
    if (!_supabase) return;
    if (!confirm('Opravdu chcete hromadně odstartovat hru pro všechny týmy?')) return;

    try {
        const nyni = new Date().toISOString();
        
        const { error: configError } = await _supabase
            .from('nastaveni_hry')
            .update({ hodnota: nyni })
            .eq('klic', 'cas_startu');

        if (configError) throw configError;

        await _supabase
            .from('tymy')
            .update({ aktualni_sifra_id: 1 })
            .is('aktualni_sifra_id', null);

        alert('⚡ Hra byla úspěšně odstartována všem přihlášeným týmům!');
        loadAdminDashboard();
    } catch (e) {
        alert('Chyba při startu hry: ' + e.message);
    }
}
