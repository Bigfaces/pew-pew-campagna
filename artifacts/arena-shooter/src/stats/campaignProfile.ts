// ================================================================
// CAMPAIGN PROFILE — persistenza su localStorage
// ================================================================
// Stesso patto delle statistiche dell'Arena (stats/client.ts): il
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

import {
  CAMPAIGN_PROFILE_VERSION,
  type CampaignProfile,
  type RoomId,
} from '../sim/campaign/types';

const KEY = 'pew-pew.campaign.profile';

const ROOMS: readonly RoomId[] = ['attracco', 'corridoio', 'magazzino', 'molo'];

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
      collectedCoreIds: stringArray(p['collectedCoreIds']),
      roomsAwarded: stringArray(p['roomsAwarded']).filter((r): r is RoomId =>
        (ROOMS as readonly string[]).includes(r),
      ),
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
