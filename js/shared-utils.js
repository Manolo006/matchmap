/* ============================================================================
 * MatchMap - Shared Utilities & Database Sanitization (js/shared-utils.js)
 * ============================================================================ */

function normalizeText(value) {
    return (value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getQueryTokens(rawQuery, minLen = 2) {
    return normalizeText(rawQuery)
        .split(' ')
        .filter(token => token.length >= minLen);
}

function getRegionLogoPath(regionName) {
    const region = normalizeText(regionName);
    if (!region) {
        return null;
    }

    const regionLogoMap = {
        'abruzzo': 'img/abruzzo.png',
        'basilicata': 'img/basilicata.png',
        'calabria': 'img/calabria.png',
        'campania': 'img/campania.png',
        'emilia romagna': 'img/emilia_romania.png',
        'friuli venezia giulia': 'img/friuli.png',
        'lazio': 'img/lazio.png',
        'liguria': 'img/liguria.png',
        'lombardia': 'img/lombardia.png',
        'marche': 'img/marche.png',
        'molise': 'img/molise.png',
        'piemonte': 'img/piemonte.png',
        'puglia': 'img/puglia.png',
        'sardegna': 'img/sardegna.png',
        'sicilia': 'img/sicilia.png',
        'toscana': 'img/toscana.png',
        'trentino alto adige': 'img/trentino_alto_adige.png',
        'umbria': 'img/umbria.png',
        'valle d aosta': 'img/valle_daosta.png',
        'veneto': 'img/veneto.png'
    };

    return regionLogoMap[region] || null;
}

function debounce(fn, delay = 180) {
    let timer = null;
    return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            fn.apply(this, args);
        }, delay);
    };
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function extractCoordinatesFromMapsUrl(url) {
    const value = String(url || '').trim();
    if (!value) {
        return null;
    }
    let match = value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
    if (match) {
        return { lat: Number(match[1]), lng: Number(match[2]) };
    }
    match = value.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (match) {
        return { lat: Number(match[1]), lng: Number(match[2]) };
    }
    match = value.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (match) {
        return { lat: Number(match[1]), lng: Number(match[2]) };
    }
    return null;
}

const CITY_ONLY_ALIAS_BLACKLIST = new Set([
    'civitavecchia', 'civitavecchia rm', 'civitavecchia campo dell oro rm',
    'cerveteri', 'cerveteri rm', 'cerveteri due casette rm',
    'ladispoli', 'ladispoli rm', 'ladispoli campi di vaccina snc rm', 'ladispoli mar s nicola rm',
    'tarquinia', 'tarquinia vt',
    'bracciano', 'bracciano rm',
    'tolfa', 'tolfa rm',
    'fiumicino', 'fiumicino rm',
    'cesano di roma', 'cesano di roma rm',
    'santa marinella', 'santa marinella rm',
    'montalto di castro', 'montalto di castro vt',
    'oriolo romano', 'oriolo romano vt',
    'passoscuro', 'passoscuro rm',
    'palidoro', 'palidoro rm', 'palidoro ladispoli rm',
    'viterbo', 'viterbo pilastro', 'viterbo pilastro vt',
    'anguillara', 'anguillara sabazia', 'anguillaraloc pratoviale', 'anguillaraloc pratoviale rm',
    'anguillaraloc pratoviale anguillara sabazia rm', 'a'
]);

function filterCleanAliases(aliases) {
    const raw = Array.isArray(aliases) ? aliases : [];
    const seen = new Set();
    const out = [];
    raw.forEach(item => {
        const str = String(item || '').trim();
        const norm = normalizeText(str);
        if (!norm || norm.length < 3 || CITY_ONLY_ALIAS_BLACKLIST.has(norm) || seen.has(norm)) {
            return;
        }
        seen.add(norm);
        out.push(str);
    });
    return out;
}

function repairCorruptedLuoghiDatabase(rawList) {
    const input = Array.isArray(rawList) ? rawList.filter(Boolean).map(x => ({ ...x })) : [];
    let changed = false;
    const out = [];

    for (const item of input) {
        const nomeNorm = normalizeText(item.nome || '');
        const lat = Number(item.lat);
        const lng = Number(item.lng);

        // 1. Scarta i pin duplicati/errati creati fuori dal Lazio (es. Anguillara in Calabria/Puglia) o duplicati di campi già esistenti con fatto:true
        if (!item.fatto) {
            const isOutOfLazio = Number.isFinite(lat) && Number.isFinite(lng) && (lat < 41.0 || lat > 42.9 || lng < 11.3 || lng > 14.0);
            const isDuplicateOfExisting =
                nomeNorm.includes('salvo d acquisto') ||
                nomeNorm.includes('sale angelo') ||
                nomeNorm.includes('capparella ferdinando') ||
                nomeNorm.includes('rossi vincenzo') ||
                nomeNorm.includes('fontana angelo');
            if (isOutOfLazio || isDuplicateOfExisting) {
                changed = true;
                continue;
            }
            if (nomeNorm.includes('virtus marina') && nomeNorm.includes('lombardi')) {
                if (item.nome !== 'Virtus Marina di San Nicola | A. Lombardi') {
                    item.nome = 'Virtus Marina di San Nicola | A. Lombardi';
                    item.team = 'Virtus Marina di San Nicola';
                    item.comune = 'Marina di San Nicola';
                    item.indirizzo = 'Via della Luna, Marina di San Nicola RM';
                    changed = true;
                }
            }
        }

        // 2. Ripristina Leocon / Evergreen | Di Ianne Luca (rimuovi Dopolavoro e Civitavecchia Calcio 1920 finiti qui per errore)
        if (nomeNorm.includes('leocon') && nomeNorm.includes('di ianne')) {
            if (nomeNorm.includes('dopolavoro') || nomeNorm.includes('civitavecchia calcio')) {
                item.nome = 'Leocon / Evergreen | Di Ianne Luca';
                item.team = 'Leocon / Evergreen';
                item.logoUrl = 'https://www.tuttocampo.it/Lazio/TerzaCategoria/GironeARoma/Squadra/Leocon/1204237/Scheda, https://www.tuttocampo.it/Lazio/SecondaCategoria/GironeC/Squadra/EvergreenCivitavecchia/1244966/Scheda';
                item.designazioneS4y = ["a CIVITAVECCHIA (RM) sull'impianto DI IANNE LUCA SINTEX sito in VIA GIULIO BIANCONE SNC"];
                item.aliases = [
                    'LEOCON',
                    'EVERGREEN CIVITAVECCHIA',
                    'DI IANNE LUCA SINTEX',
                    'VIA GIULIO BIANCONE SNC',
                    'CIVITAVECCHIA (RM), DI IANNE LUCA SINTEX, VIA GIULIO BIANCONE SNC'
                ];
                changed = true;
            }
        }

        // 3. Ripristina Tarquinia (rimuovi Dopolavoro Football Club finito lì per una singola gara ospitata)
        if (nomeNorm.startsWith('tarquinia') && nomeNorm.includes('dopolavoro')) {
            item.nome = 'Tarquinia';
            item.team = '';
            item.logoUrl = 'https://www.tuttocampo.it/Lazio/Promozione/GironeA/Squadra/TarquiniaCalcio/932915/Scheda';
            item.aliases = [
                'TARQUINIA CALCIO',
                'BONELLI LIVIANO SINTEX',
                'VIA RAFFAELLO SANZIO SNC',
                'TARQUINIA (VT), BONELLI LIVIANO SINTEX, VIA RAFFAELLO SANZIO SNC'
            ];
            changed = true;
        }

        // 4. Ripristina Città di Cerveteri | Enrico Galli (rimuovi DM 84 Cerveteri e Daniele Mataloni)
        if (nomeNorm.includes('citta di cerveteri') && nomeNorm.includes('enrico galli') && nomeNorm.includes('dm 84')) {
            item.nome = 'Città di Cerveteri | Enrico Galli';
            item.team = '';
            item.logoUrl = 'https://www.tuttocampo.it/Lazio/Promozione/GironeA/Squadra/CittadiCerveteri/77986/Scheda';
            item.designazioneS4y = ["a CERVETERI (RM) sull'impianto GALLI ENRICO A SINTEX sito in VIA SETTEVENEPALO"];
            item.aliases = [
                'CITTA DI CERVETERI',
                'GALLI ENRICO A SINTEX',
                'VIA SETTEVENEPALO',
                'CERVETERI (RM), GALLI ENRICO A SINTEX, VIA SETTEVENEPALO'
            ];
            changed = true;
        }

        // 5. Collega correttamente le designazioni S4Y ai campi originali già presenti
        if (nomeNorm.includes('borgo pallidoro') || (nomeNorm === 'borgo palidoro')) {
            const wantS4y = [
                "a PALIDORO (RM) sull'impianto FONTANA ANGELO A ERBA sito in VIA FILIPPO CUGGIANI 21/23",
                "a PALIDORO (RM) sull'impianto FONTANA ANGELO A TERRA sito in VIA FILIPPO CUGGIANI 21/23",
                "a PALIDORO - LADISPOLI (RM) sull'impianto FONTANA ANGELO A TERRA sito in VIA FILIPPO CUGGIANI 21/23"
            ];
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = wantS4y;
                item.comune = item.comune || 'Palidoro';
                item.aliases = ['BORGO PALIDORO', 'FONTANA ANGELO A TERRA', 'VIA FILIPPO CUGGIANI 21/23'];
                changed = true;
            }
        } else if (nomeNorm.includes('campo di anguillara') || nomeNorm.includes('ferdinando capparella')) {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a ANGUILLARALOC.PRATOVIALE (RM) sull'impianto CAPPARELLA FERDINANDO A ERBA sito in STR.VICINALE DEI VIGNALI",
                    "a ANGUILLARALOC.PRATOVIALE - ANGUILLARA SABAZIA (RM) sull'impianto CAPPARELLA FERDINANDO A ERBA sito in STR.VICINALE DEI VIGNALI"
                ];
                item.comune = item.comune || 'Anguillara Sabazia';
                item.aliases = ['ANGUILLARA CALCIO', 'CAPPARELLA FERDINANDO A ERBA', 'STR.VICINALE DEI VIGNALI'];
                changed = true;
            }
        } else if (nomeNorm.includes('tamagnini vittorio')) {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a CIVITAVECCHIA CAMPO DELL''ORO (RM) sull'impianto TAMAGNINI VITTORIO SINTEX sito in LARGO MARTIRI DI VIA FANI SNC"
                ];
                item.comune = item.comune || 'Civitavecchia';
                item.aliases = ['CIVITAVECCHIA CALCIO 1920', 'QUARTIERE CAMPO DELL ORO', 'TAMAGNINI VITTORIO SINTEX', 'LARGO MARTIRI DI VIA FANI SNC'];
                changed = true;
            }
        } else if (nomeNorm.includes('dopolavoro ferroviario')) {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a CIVITAVECCHIA (RM) sull'impianto DOPOLAVORO FERROVIARIO SINTEX sito in VIA BACCELLI"
                ];
                item.comune = item.comune || 'Civitavecchia';
                item.aliases = ['DOPOLAVORO FOOTBALL CLUB', 'CSL SOCCER 21 8.0', 'DOPOLAVORO FERROVIARIO SINTEX', 'VIA BACCELLI'];
                changed = true;
            }
        } else if (nomeNorm.includes('accademy ladispoli') || nomeNorm === 'academy ladispoli') {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a LADISPOLI CAMPI DI VACCINA SNC (RM) sull'impianto SALE ANGELO SINTEX sito in CAMPI DI VACCINA SNC"
                ];
                item.comune = item.comune || 'Ladispoli';
                item.aliases = ['ACADEMY LADISPOLI SRL', 'SALE ANGELO SINTEX', 'CAMPI DI VACCINA SNC'];
                changed = true;
            }
        } else if (nomeNorm.includes('daniele mataloni')) {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a CERVETERI DUE CASETTE (RM) sull'impianto COMUNALE DANIELE MATALONI sito in VIA DELLE PISCINE 36"
                ];
                item.comune = item.comune || 'Cerveteri';
                item.aliases = ['DM 84 CERVETERI', 'COMUNALE DANIELE MATALONI', 'VIA DELLE PISCINE 36'];
                changed = true;
            }
        } else if (nomeNorm === 'club calcio passoscuro') {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a PASSOSCURO (RM) sull'impianto SALVO D''ACQUISTO A ERBA sito in VIA S.CARLO A PALIDORO 360"
                ];
                item.comune = item.comune || 'Passoscuro';
                item.aliases = ['CLUB CALCIO PASSOSCURO', 'SALVO D ACQUISTO A ERBA', 'VIA S.CARLO A PALIDORO 360'];
                changed = true;
            }
        } else if (nomeNorm === 'viterbese') {
            if (!Array.isArray(item.designazioneS4y) || !item.designazioneS4y.length) {
                item.designazioneS4y = [
                    "a VITERBO PILASTRO (VT) sull'impianto ROSSI VINCENZO SINTEX sito in VIA CARLO MINCIOTTI N. 4"
                ];
                item.comune = item.comune || 'Viterbo';
                item.aliases = ['VITERBESE S.S.D. A R.L.', 'ROSSI VINCENZO SINTEX', 'VIA CARLO MINCIOTTI N. 4'];
                changed = true;
            }
        }

        if (Array.isArray(item.aliases)) {
            const cleanedAliases = filterCleanAliases(item.aliases);
            if (cleanedAliases.length !== item.aliases.length) {
                item.aliases = cleanedAliases;
                changed = true;
            }
        }

        out.push(item);
    }

    return { list: out, changed };
}
