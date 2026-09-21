// ================================================================
// CAMPAIGN PROFILE — persistenza su localStorage
// ================================================================
// Stesso patto delle statistiche che aveva l'Arena (ora rimossa): il
// browser è l'unico archivio, e può rifiutarsi di esserlo — in
// navigazione privata ogni accesso lancia. Qui un salvataggio che
// fallisce non è un errore da mostrare: si continua a giocare, la
// progressione semplicemente non sopravvive alla sessione.
//
// Quello che viene riletto è testo arbitrario dal disco dell'utente,
// quindi va validato campo per campo prima di diventare stato di
// gioco: un `xp: "molto"` salvato a mano non deve poter entrare nella
// simulazione.
// ================================================================

import { ALL_LEVELS, FIRST_LEVEL_ID } from '../sim/campaign/levels';
import { isValidShopItem } from '../sim/campaign/skills';
import {
  CAMPAIGN_DIFFICULTIES,
  CAMPAIGN_PROFILE_VERSION,
  type CampaignDifficulty,
  type CampaignProfile,
} from '../sim/campaign/types';

const KEY = 'pew-pew.campaign.profile';

/** Dove vive la scelta di difficoltà fatta *prima* che esista un
 *  profilo: un personaggio nuovo non ha ancora una `CampaignProfile`
 *  da cui leggerla, ma il menu deve poter offrire la scelta comunque.
 *  Una volta che il profilo esiste, è lui la fonte di verità (vedi
 *  CampaignProfile.difficulty) — questa chiave conta solo per il
 *  prossimo run che comincia da zero. */
const DIFFICULTY_KEY = 'pew-pew.campaign.difficulty';

/** GDD.md sezione 22. Due chiavi, non una: "l'interruttore è acceso" e
 *  "l'ho già vista" sono due domande diverse, e la seconda deve poter
 *  tornare a 'no' (riaccendere l'interruttore da spento) senza toccare
 *  la prima. Stesso trattamento difensivo di DIFFICULTY_KEY qui sopra
 *  — in navigazione privata localStorage lancia, e il gioco deve
 *  continuare lo stesso, solo senza ricordare la scelta. */
const LEGEND_ENABLED_KEY = 'pew-pew.campaign.legenda.attiva';
const LEGEND_SHOWN_KEY = 'pew-pew.campaign.legenda.vista';

const VALID_DIFFICULTIES: ReadonlySet<string> = new Set(CAMPAIGN_DIFFICULTIES);

function isCampaignDifficulty(value: unknown): value is CampaignDifficulty {
  return typeof value === 'string' && VALID_DIFFICULTIES.has(value);
}

/** Le chiavi `livello/stanza` che possono legittimamente comparire in
 *  un profilo. Validare contro i livelli veri invece che contro una
 *  lista scritta a mano vuol dire che aggiungere un livello non lascia
 *  qui un elenco che dimentica la stanza nuova e le toglie il bonus in
 *  silenzio. */
const ROOM_KEYS: ReadonlySet<string> = new Set(
  ALL_LEVELS.flatMap((l) => l.rooms.map((r) => `${l.id}/${r.id}`)),
);

const LEVEL_IDS: ReadonlySet<string> = new Set(ALL_LEVELS.map((l) => l.id));

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** null quando non c'è niente di salvato, quando il salvataggio è di
 *  una versione che non conosciamo, o quando è illeggibile. In tutti e
 *  tre i casi la risposta giusta è la stessa: si riparte puliti. */
export function loadCampaignProfile(): CampaignProfile | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const p = parsed as Record<string, unknown>;
    if (p['version'] !== CAMPAIGN_PROFILE_VERSION) return null;
    if (typeof p['xp'] !== 'number' || !Number.isFinite(p['xp']) || p['xp'] < 0) {
      return null;
    }

    return {
      version: CAMPAIGN_PROFILE_VERSION,
      xp: Math.floor(p['xp']),
      unlockedNodes: stringArray(p['unlockedNodes']),
      // Un id di livello che non riconosciamo riporta all'inizio
      // dell'atto invece di rifiutare tutto il profilo: perdere il
      // punto in cui si era arrivati è meno grave che perdere anche
      // XP e nodi.
      levelId:
        typeof p['levelId'] === 'string' && LEVEL_IDS.has(p['levelId'])
          ? p['levelId']
          : FIRST_LEVEL_ID,
      completedLevels: stringArray(p['completedLevels']).filter((l) => LEVEL_IDS.has(l)),
      collectedCoreIds: stringArray(p['collectedCoreIds']),
      roomsAwarded: stringArray(p['roomsAwarded']).filter((r) => ROOM_KEYS.has(r)),
      // Una difficoltà illeggibile riparte da Tutorial invece di
      // buttare il resto del personaggio, stessa logica di levelId
      // qui sopra: xp e nodi valgono più di una regola di morte.
      difficulty: isCampaignDifficulty(p['difficulty']) ? p['difficulty'] : 'tutorial',
      // L'unica lista filtrata contro gli id noti insieme a
      // completedLevels e roomsAwarded — e l'unica delle tre per cui
      // il filtro è una questione di correttezza e non di ordine.
      //
      // `unlockedNodes` qui sopra NON è filtrata, di proposito: un id
      // sconosciuto costa zero in pointsSpent perché un profilo
      // salvato da una versione precedente può contenere un nodo che
      // non esiste più, e farlo costare infinito bloccherebbe
      // l'albero di quel giocatore per sempre. Applicata a un
      // acquisto, la stessa clemenza regalerebbe l'acquisto: un id
      // inventato costerebbe zero e varrebbe un innesto. Da qui le due
      // liste separate in CampaignProfile, e questo filtro.
      purchases: stringArray(p['purchases']).filter((id) => isValidShopItem(id)),
    };
  } catch {
    return null;
  }
}

export function saveCampaignProfile(profile: CampaignProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Non-fatal: la partita in corso continua, non verrà ricordata.
  }
}

export function clearCampaignProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Idem.
  }
}

/** Ricorda la scelta fatta nel menu, per quando comincerà il prossimo
 *  personaggio nuovo — vedi DIFFICULTY_KEY qui sopra. */
export function saveCampaignDifficultyChoice(difficulty: CampaignDifficulty): void {
  try {
    localStorage.setItem(DIFFICULTY_KEY, difficulty);
  } catch {
    // Non-fatal: si può sempre scegliere di nuovo al prossimo avvio.
  }
}

/** Tutorial come default: è la modalità già rodata, e un giocatore che
 *  non ha mai visto il selettore non deve trovarsi catapultato in
 *  Roguelike senza averlo scelto. */
export function loadCampaignDifficultyChoice(): CampaignDifficulty {
  try {
    const raw = localStorage.getItem(DIFFICULTY_KEY);
    if (isCampaignDifficulty(raw)) return raw;
  } catch {
    // Fallthrough al default sotto.
  }
  return 'tutorial';
}

/** Attiva di default: il difetto che questa schermata risolve (il
 *  punto debole non insegnato a nessuno, vedi GDD.md sezione 22) è
 *  peggiore del fastidio di vederla una volta. Chi non la vuole la
 *  spegne dal menu. */
export function loadLegendEnabled(): boolean {
  try {
    const raw = localStorage.getItem(LEGEND_ENABLED_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

export function saveLegendEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LEGEND_ENABLED_KEY, String(enabled));
  } catch {
    // Non-fatal: la scelta semplicemente non sopravvive alla sessione.
  }
}

/** Non ancora mostrata, di default: un profilo nuovo — o uno che
 *  esisteva prima di questa chiave — deve poter vedere la schermata la
 *  prima volta buona, non saltarla per un valore mancante letto come
 *  "già fatto". */
export function loadLegendShown(): boolean {
  try {
    return localStorage.getItem(LEGEND_SHOWN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveLegendShown(shown: boolean): void {
  try {
    localStorage.setItem(LEGEND_SHOWN_KEY, String(shown));
  } catch {
    // Non-fatal: nel peggiore dei casi la si rivede alla prossima sessione.
  }
}
