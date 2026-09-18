import {
  ALL_SKILL_NODES,
  LEVEL_XP_THRESHOLDS,
  SKILL_TREE,
  type ShopItemDef,
  type SkillNodeDef,
} from '../sim/campaign/constants';
import { useState } from 'react';

import { prereqMet } from '../sim/campaign/skills';
import type { CampaignHudSnapshot } from '../game/campaignGame';
import { ACT_BREAKS } from './arbiter';

const BOSS_PHASE_LABEL: Record<string, string> = {
  // Sentinella
  guard: 'IN GUARDIA',
  telegraph: 'SI PREPARA',
  charge: 'CARICA',
  recover: 'SCOPERTA',
  // Custode
  blackout: 'SPEGNE LE LUCI',
  invert: 'CAPOVOLGE',
  tell: 'SI APRE',
  exposed: 'SCOPERTO',
  // ARBITER
  modules: 'MODULI ATTIVI',
  coreSealed: 'NUCLEO SIGILLATO',
  coreOpening: 'NUCLEO IN APERTURA',
  coreOpen: 'NUCLEO SCOPERTO',
  defeated: 'ABBATTUTO',
};

const ACT_LABEL: Record<number, string> = { 1: 'I', 2: 'II', 3: 'III' };

/** 0..1 progress through the current level's XP band. `null` next
 *  threshold means the top of the table — shown as a full bar rather
 *  than a hard level cap. */
function levelProgress(xp: number, level: number, next: number | null): number {
  const floor = LEVEL_XP_THRESHOLDS[level - 1] ?? 0;
  if (next === null) return 1;
  return Math.max(0, Math.min(1, (xp - floor) / (next - floor)));
}

function XpBar({ snap }: { snap: CampaignHudSnapshot }): React.ReactElement {
  const progress = levelProgress(snap.xp, snap.level, snap.xpForNextLevel);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span>LIVELLO {snap.level}</span>
        <span className="hint" style={{ margin: 0 }}>
          {snap.xp} XP
          {snap.xpForNextLevel !== null && ` / ${snap.xpForNextLevel}`}
        </span>
      </div>
      <span className="power-bar" style={{ display: 'block', marginTop: 4 }}>
        <i style={{ width: `${progress * 100}%`, background: '#7dfc9a' }} />
      </span>
    </div>
  );
}

/** Un nodo dell'albero. I tre motivi per cui può essere non
 *  comprabile sono distinti di proposito — "già preso", "ti manca un
 *  punto" e "prima devi prendere quell'altro" sono informazioni
 *  diverse, e un unico pulsante grigio le confonderebbe tutte. */
function SkillNode({
  node,
  unlocked,
  points,
  unlockedNodes,
  onUnlock,
}: {
  node: SkillNodeDef;
  unlocked: boolean;
  points: number;
  unlockedNodes: string[];
  onUnlock: (id: string) => void;
}): React.ReactElement {
  const locked = !prereqMet(unlockedNodes, node.id);
  const affordable = points >= node.cost;
  const reqName = node.requires
    ? (ALL_SKILL_NODES.find((n) => n.id === node.requires)?.name ?? node.requires)
    : null;

  let status = '';
  if (unlocked) status = 'ATTIVO';
  else if (locked) status = `RICHIEDE ${reqName?.toUpperCase()}`;
  else if (!affordable) status = `${node.cost} PUNTO`;

  return (
    <button
      type="button"
      className="skill-node"
      data-unlocked={unlocked || undefined}
      data-locked={locked || undefined}
      disabled={unlocked || locked || !affordable}
      onClick={() => onUnlock(node.id)}
    >
      <span className="skill-node-head">
        <span className="skill-node-name">
          {unlocked ? '✓ ' : ''}
          {node.name}
        </span>
        {status && <span className="skill-node-status">{status}</span>}
      </span>
      <span className="skill-node-desc">{node.desc}</span>
    </button>
  );
}

/** Compact in-game overlay: room, the timed-door warning, boss status,
 *  and a small level/XP readout. Everything you can act on (spending
 *  skill points) lives in the pause menu instead — see
 *  CampaignPauseScreen — so the live view stays uncluttered on a
 *  small screen. */
export function CampaignHud({ snap }: { snap: CampaignHudSnapshot }): React.ReactElement {
  return (
    <div className="hud">
      {/* One centred column rather than a second corner panel: two
          independently-positioned boxes at the same top offset is
          exactly what used to collide on phone-width screens (see
          ui.css .campaign-hud-top) — sharing one column is immune to
          that by construction, whatever either box's content length. */}
      {/* Con la minimappa accesa la colonna smette di stare al centro
          e si sposta a sinistra: restare centrata e basta stringersi
          costerebbe il doppio dello spazio riservato (una colonna
          centrata perde larghezza da entrambi i lati per liberarne uno
          solo), e su un telefono non ne resterebbe abbastanza per
          leggere una riga. */}
      <div
        className="hud-top campaign-hud-top"
        data-minimap={snap.minimapReserve > 0 || undefined}
        style={
          snap.minimapReserve > 0
            ? { maxWidth: `calc(100vw - 24px - ${snap.minimapReserve}px)` }
            : undefined
        }
      >
        {/* Il nome arriva già pronto dallo snapshot: le stanze sono
            dato del livello, e una tabella qui sarebbe una seconda
            lista da aggiornare a ogni livello aggiunto — che è
            esattamente il modo in cui una stanza nuova finirebbe per
            chiamarsi `undefined`. */}
        <div className="hud-clock">
          {ACT_LABEL[snap.levelAct] ?? snap.levelAct} · {snap.levelOrdinal}/
          {snap.levelCount} · {snap.room}
        </div>
        {snap.door.armed && (
          <div className="hud-clock" data-urgent>
            PORTA IN CHIUSURA · {(snap.door.closeTimerMs / 1000).toFixed(1)}s
          </div>
        )}
        {snap.bossActive && snap.bossPhase !== 'defeated' && (
          <div
            className="hud-clock"
            style={snap.bossEnraged ? { color: '#ff7a2f', borderColor: '#ff7a2f' } : undefined}
          >
            {snap.bossName}
            {snap.bossEnraged ? ' ALTERAT' + (snap.bossName === 'SENTINELLA' ? 'A' : 'O') : ''}
            {snap.bossStage !== null && ` · FASE ${snap.bossStage}/3`} —{' '}
            {BOSS_PHASE_LABEL[snap.bossPhase] ?? snap.bossPhase} · {snap.bossDamageTaken}/
            {snap.bossHitsToDefeat}
          </div>
        )}
        <div className="hud-clock">
          LIVELLO {snap.level} · {snap.xp}
          {snap.xpForNextLevel !== null && `/${snap.xpForNextLevel}`} XP
          {snap.availableSkillPoints > 0 &&
            ` · ${snap.availableSkillPoints} ${snap.availableSkillPoints > 1 ? 'PUNTI' : 'PUNTO'} (ESC)`}
        </div>
        {snap.shieldCharges > 0 && (
          <div className="hud-clock" style={{ color: '#44ccff', borderColor: '#44ccff' }}>
            SCUDO{snap.shieldCharges > 1 ? ` ×${snap.shieldCharges}` : ''}
          </div>
        )}
        {/* A differenza di scudo e scatto, il Trasponditore è innato:
            l'indicatore resta anche a zero cariche, perché "non te ne
            restano" è un'informazione che serve — sapere di dover
            raccoglierne una per terra prima di poter piazzare l'esca —
            non qualcosa da nascondere come se l'arma non esistesse. */}
        {/* Il magenta non è una scelta estetica: è la tinta con cui la
            scena disegna l'esca (BEACON_COLOR in render/campaignScene),
            e l'indicatore e l'oggetto devono essere la stessa cosa. La
            prima versione di questa riga era ambra, che nella scena
            confina con due colori già in uso — e due tinte diverse per
            la stessa arma si vedono benissimo su uno schermo mentre nel
            codice non si notano. */}
        <div
          className="hud-clock"
          style={
            snap.beaconCharges > 0
              ? { color: '#ff4fd8', borderColor: '#ff4fd8' }
              : { color: 'var(--dim)' }
          }
        >
          TRASPONDITORE {snap.beaconCharges > 0 ? `×${snap.beaconCharges}` : '—'}
        </div>
        {/* Finché l'esca è viva restano al massimo 2600ms in tutto — il
            tempo di un solo colpo — quindi la finestra si legge come una
            barra che si svuota e non come un numero da inseguire: niente
            cifre, solo un "quanto resta" leggibile con la coda
            dell'occhio. Il pulse è lo stesso keyframe di .hud-hint /
            .hud-clock[data-urgent] già in ui.css, richiamato per nome
            invece che duplicato — qui però segnala un'occasione da
            sfruttare, non un pericolo, perciò niente rosso. Quando
            beaconWindow torna null la riga scompare di netto: la
            finestra chiusa non merita una dissolvenza che la faccia
            sembrare ancora un poco aperta. */}
        {snap.beaconWindow !== null && (
          <div
            className="hud-clock"
            style={{
              color: '#ff4fd8',
              borderColor: '#ff4fd8',
              animation: 'pulse 1s ease-in-out infinite',
            }}
          >
            <span style={{ display: 'block', fontSize: 10, letterSpacing: '0.1em' }}>
              ESCA ATTIVA
            </span>
            <span className="power-bar" style={{ display: 'block', width: 64, marginTop: 4 }}>
              <i style={{ width: `${snap.beaconWindow * 100}%`, background: '#ff4fd8' }} />
            </span>
          </div>
        )}
        {/* Solo col nodo Scatto sbloccato: un indicatore per una
            meccanica che non possiedi è rumore. */}
        {snap.dashReady !== null && (
          <div className="hud-clock" data-ready={snap.dashReady >= 1 || undefined}>
            SCATTO{snap.dashReady >= 1 ? ' PRONTO' : ` ${Math.round(snap.dashReady * 100)}%`}
          </div>
        )}
        {snap.blinded && (
          <div className="hud-clock" style={{ color: '#9bff8c', borderColor: '#9bff8c' }}>
            SENSORI CIECHI
          </div>
        )}
        {snap.dark && (
          <div className="hud-clock" style={{ color: '#8fa8d8', borderColor: '#8fa8d8' }}>
            BUIO
          </div>
        )}
        {snap.gravityInverted && (
          <div className="hud-clock" style={{ color: '#b07adf', borderColor: '#b07adf' }}>
            GRAVITÀ INVERTITA
          </div>
        )}
        {snap.muted && <div className="hud-muted">AUDIO MUTO · M</div>}
      </div>

      {/* La lettura del bersaglio sta sotto il mirino e non nella
          colonna in alto: è l'unica informazione della HUD che cambia
          in base a dove stai guardando *adesso*, e cercarla in un
          angolo vorrebbe dire staccare gli occhi da quello che stai
          inquadrando. Esiste solo col nodo Lettura Termica. */}
      {snap.scanned && (
        <div className="campaign-scan">
          <span className="campaign-scan-name">{snap.scanned.name}</span>
          <span className="power-bar campaign-scan-bar">
            <i style={{ width: `${snap.scanned.hp * 100}%` }} />
          </span>
          <span className="campaign-scan-weak">{snap.scanned.weakSpot}</span>
          {snap.scanned.vulnerability !== '—' && (
            <>
              <span className="campaign-scan-sep">·</span>
              <span
                className="campaign-scan-vuln"
                data-open={snap.scanned.windowOpen || undefined}
              >
                {snap.scanned.vulnerability}
              </span>
            </>
          )}
          {snap.scanned.hardened && <span className="campaign-scan-hard">CORAZZATO</span>}
        </div>
      )}

      {snap.arbiter && <div className="arbiter-line">ARBITER — {snap.arbiter}</div>}

      {/* Sopra la riga di ARBITER e non al suo posto: le due possono
          capitare insieme — si raccoglie un nucleo mentre lui parla — e
          farle contendere lo stesso posto vorrebbe dire perdere proprio
          quella che spiega cosa è appena successo. */}
      {snap.pickup && <div className="pickup-line">{snap.pickup}</div>}

      {!snap.pointerLocked && (
        <div className="hud-hint campaign-hud-hint">
          CLICCA PER CATTURARE IL MOUSE &nbsp;·&nbsp; Q / E PER GIRARE SENZA
        </div>
      )}
    </div>
  );
}

/** Pause + progression menu. Doubles as the "crea il menu" ask: this
 *  is where the skill tree actually lives, not crammed into the live
 *  HUD. Tutti e quattro i rami sono costruiti — vedi GDD.md sezione
 *  6; fino allo Sprint 1 tre di loro erano solo etichette spente. */
/** I comandi, come li ha la campagna.
 *
 *  Esiste una lista in ui/Screens.tsx, ma vive solo sulle due
 *  schermate dell'Arena e si è fermata a prima che la campagna avesse
 *  uno scatto e un'arma secondaria: nessuna delle quattro schermate
 *  della campagna mostrava un comando, e il tasto del Trasponditore
 *  non era scritto in nessun posto che il giocatore potesse leggere.
 *  Su telefono non si notava — ci sono i pulsanti a schermo — ma chi
 *  gioca con la tastiera raccoglieva un'esca al secondo livello senza
 *  avere modo di sapere come lanciarla.
 *
 *  Le due righe condizionate dicono anche *quando* valgono, invece di
 *  comparire e sparire: un comando che appare a metà partita si nota
 *  meno di uno che c'è sempre e spiega cosa gli manca. */
export const CAMPAIGN_CONTROLS: readonly (readonly [string, string])[] = [
  ['W A S D', 'Movimento — avanti, indietro, laterale'],
  ['MOUSE', 'Mira — clicca una volta per catturare il puntatore'],
  ['Q / E', 'Rotazione — funziona sempre, anche senza mouse'],
  // Diceva «un colpo uccide». Non è vero, ed è la mezza frase che il
  // primo tester ha riassunto con «spari a dei nemici che non
  // muoiono»: al corpo il fucile fa 1, e un nemico di prima fascia
  // ne ha 2. Uccide in un colpo solo al punto debole (×3), che è la
  // regola centrale del gioco e non veniva detta da nessuna parte.
  ['CLICK SIN.', 'Sparo — otturatore manuale, uno alla volta. Al corpo serve il doppio'],
  ['PUNTO DEBOLE', 'Vale tre volte: dietro, il nucleo o la testa — la HUD dice quale'],
  ['CLICK DES.', 'Ottica — tieni premuto per mirare col cannocchiale'],
  ['MAIUSC', 'Scatto — dal nodo Scatto in poi, nella direzione in cui vai'],
  ['F', 'Trasponditore — lancia un\'esca, se ne hai una carica'],
  ['ESC', 'Pausa'],
  ['M', 'Muto'],
];

function CampaignControls(): React.ReactElement {
  return (
    <div className="field">
      <label>COMANDI</label>
      <dl className="controls">
        {CAMPAIGN_CONTROLS.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CampaignPauseScreen({
  snap,
  onUnlock,
  onResume,
  onQuit,
  onReset,
}: {
  snap: CampaignHudSnapshot;
  onUnlock: (id: string) => void;
  onResume: () => void;
  onQuit: () => void;
  onReset: () => void;
}): React.ReactElement {
  const owned = snap.unlockedNodes.length;
  return (
    <div className="overlay">
      <div className="panel" style={{ maxWidth: 560 }}>
        <h1 className="title" style={{ fontSize: 32 }}>
          IN PAUSA
        </h1>
        <p className="subtitle">KESSLER-9 ASPETTA</p>

        <div className="field">
          <label>PROGRESSIONE</label>
          <XpBar snap={snap} />
          <p className="hint">
            Core raccolti: {snap.coresCollected} · Nodi: {owned}/{ALL_SKILL_NODES.length} ·
            Punti disponibili: {snap.availableSkillPoints}
            <br />
            La progressione resta salvata in questo browser; la posizione no —
            uscire e rientrare rigioca il livello dall'Attracco.
          </p>
        </div>

        {SKILL_TREE.map((branch) => (
          <div className="field" key={branch.id}>
            <label>{branch.name}</label>
            <p className="hint" style={{ marginTop: 0 }}>
              {branch.tagline}
            </p>
            {branch.nodes.map((n) => (
              <SkillNode
                key={n.id}
                node={n}
                unlocked={snap.unlockedNodes.includes(n.id)}
                points={snap.availableSkillPoints}
                unlockedNodes={snap.unlockedNodes}
                onUnlock={onUnlock}
              />
            ))}
          </div>
        ))}

        <CampaignControls />

        <button className="btn" type="button" onClick={onResume}>
          RIPRENDI
        </button>
        <button className="btn secondary" type="button" onClick={onQuit}>
          ABBANDONA LA MISSIONE
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={onReset}
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
        >
          AZZERA LA PROGRESSIONE
        </button>
      </div>
    </div>
  );
}

/** Le frasi di un passaggio d'atto, scaglionate invece che tutte
 *  insieme: un `animationDelay` per riga (vedi `.act-break-line` in
 *  ui.css) invece di un timer React — niente stato da inizializzare
 *  né da ripulire se lo schermo cambia a metà rivelazione, lo stesso
 *  schema che già usa `.arbiter-line` per il proprio fade-in.
 *  Condivisa fra CampaignActBreakScreen e CampaignEndScreen: sono due
 *  schermate diverse (una prosegue, l'altra chiude la campagna) che
 *  raccontano allo stesso modo. */
function ActBreakLines({ lines }: { lines: readonly string[] }): React.ReactElement {
  return (
    <div className="act-break-lines">
      {lines.map((line, i) => (
        <p key={i} className="act-break-line" style={{ animationDelay: `${i * 900}ms` }}>
          {line}
        </p>
      ))}
    </div>
  );
}

/** Una riga del Banco così come la prepara il chiamante: l'innesto
 *  stesso più le tre domande a cui il modulo puro ha già risposto —
 *  "l'ho già preso?", "mi bastano i punti?", "posso comprarlo
 *  adesso?". Questo file non ricalcola nessuna delle tre: disegna
 *  soltanto, sullo stesso principio per cui CampaignHud non ricalcola
 *  `unlocked`/`locked` dei nodi, li legge.
 *
 *  Il tipo arriva da game/campaignShop.ts e non è ridichiarato qui.
 *  Due dichiarazioni identiche di una stessa forma compilano entrambe
 *  finché restano identiche, e smettono di farlo in silenzio il giorno
 *  in cui una delle due cresce di un campo. Ri-esportato perché
 *  App.tsx costruisce le righe e le passa a questa schermata: chi usa
 *  la schermata trova il tipo dov'è la schermata. */
export type { ShopRow } from '../game/campaignShop';
import type { ShopRow } from '../game/campaignShop';

const NO_SHOP_ROWS: readonly ShopRow[] = [];
function noopPurchase(): void {}

/** Una scheda d'innesto. `owned` e `!affordable` sono due motivi
 *  diversi per lo stesso pulsante spento, e si leggono diversi di
 *  proposito — la stessa ragione per cui SkillNode qui sopra separa
 *  "già preso" da "non ti bastano i punti": collassarli in un solo
 *  grigio nasconderebbe se conviene aspettare un punto o lasciar
 *  perdere quella scheda per sempre. */
function ShopCard({
  row,
  onPurchase,
}: {
  row: ShopRow;
  onPurchase: (id: string, giveBack?: string) => void;
}): React.ReactElement {
  const { item, owned, affordable, buyable, refundCandidates } = row;
  // La seconda moneta del Banco: senza un punto libero si può rendere
  // un nodo. Non è un ripiego — chi spende i punti appena li guadagna
  // arriva al varco del secondo atto con zero punti in tasca, e senza
  // questa via quel Banco non si aprirebbe mai.
  const puoRendere = !owned && !affordable && refundCandidates.length > 0;
  const [resoAperto, setResoAperto] = useState(false);

  let label: string;
  if (owned) label = 'INNESTATO';
  else if (affordable) label = `INNESTA · ${item.cost} PUNTO`;
  else if (puoRendere) label = resoAperto ? 'ANNULLA' : 'RENDI UN NODO';
  else label = 'PUNTI INSUFFICIENTI';

  return (
    <div
      className="shop-card"
      data-owned={owned || undefined}
      data-affordable={affordable}
      data-reso={puoRendere || undefined}
    >
      <div className="shop-card-head">
        <span className="shop-card-name">
          {owned ? '✓ ' : ''}
          {item.name}
        </span>
        <span className="shop-card-cost">{item.cost} PUNTO</span>
      </div>
      <p className="shop-card-gives">▲ {item.gives}</p>
      <p className="shop-card-takes">▼ {item.takes}</p>
      <button
        type="button"
        className="shop-card-btn"
        data-owned={owned || undefined}
        data-reso={puoRendere || undefined}
        disabled={!buyable && !puoRendere}
        onClick={() => {
          if (buyable) onPurchase(item.id);
          else if (puoRendere) setResoAperto((v) => !v);
        }}
      >
        {label}
      </button>
      {resoAperto && puoRendere && (
        <div className="shop-refund">
          <p className="shop-refund-hint">Quale nodo rendi al Banco?</p>
          {refundCandidates.map((nodeId) => (
            <button
              key={nodeId}
              type="button"
              className="shop-refund-btn"
              onClick={() => {
                setResoAperto(false);
                onPurchase(item.id, nodeId);
              }}
            >
              {ALL_SKILL_NODES.find((n) => n.id === nodeId)?.name ?? nodeId}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Schermata d'atto: ferma il gioco fra la fine dell'Atto I o II e
 *  l'inizio del successivo. Non usata per l'Atto III — quello è
 *  CampaignEndScreen più sotto, perché lì non c'è un "prosegui" ma un
 *  "torna al menu", e sovrapporre le due scelte in un solo componente
 *  con un flag `isFinale` si è rivelato più confuso che utile: due
 *  pulsanti diversi restano due componenti, non un ramo. Il pulsante
 *  non aspetta la rivelazione delle righe: bloccarlo avrebbe imposto
 *  il proprio ritmo di lettura a chi il testo lo ha già letto una
 *  volta.
 *
 *  `shopRows` e `onPurchase` sono opzionali apposta: senza il Banco
 *  ancora innestato in App.tsx questo componente deve continuare a
 *  compilare e a funzionare esattamente come prima, righe vuote
 *  comprese. Una lista vuota non mostra la sezione — comprare resta
 *  sempre facoltativo, non blocca mai PROSEGUI. */
export function CampaignActBreakScreen({
  snap,
  onContinue,
  shopRows = NO_SHOP_ROWS,
  onPurchase = noopPurchase,
}: {
  snap: CampaignHudSnapshot;
  onContinue: () => void;
  shopRows?: readonly ShopRow[];
  onPurchase?: (id: string, giveBack?: string) => void;
}): React.ReactElement {
  const brk = ACT_BREAKS.find((b) => b.actCompleted === snap.actBreakActCompleted);
  return (
    <div className="overlay">
      <div className="panel">
        <p className="subtitle">
          FINE DELL’ATTO {ACT_LABEL[snap.actBreakActCompleted ?? 1]}
        </p>
        <ActBreakLines lines={brk?.lines ?? []} />
        {shopRows.length > 0 && (
          <div className="field shop-bench">
            <label>BANCO DI RICONFIGURAZIONE</label>
            <p className="hint" style={{ marginTop: 0 }}>
              Non c'è hardware nuovo da comprare: si rilavora quello che hai già, e ogni
              innesto dà e toglie insieme. Punti disponibili: {snap.availableSkillPoints}
            </p>
            <div className="shop-grid">
              {shopRows.map((row) => (
                <ShopCard key={row.item.id} row={row} onPurchase={onPurchase} />
              ))}
            </div>
          </div>
        )}
        <button className="btn" type="button" onClick={onContinue}>
          PROSEGUI
        </button>
      </div>
    </div>
  );
}

/** Fine della campagna: sostituisce il vecchio pannello "ARBITER
 *  ABBATTUTO / FINE DELL'ATTO III". Il testo è il terzo ACT_BREAKS —
 *  il finale della storia, non un riassunto di statistiche — e le
 *  statistiche restano ma sotto quel testo, separate da un filo (vedi
 *  `.act-break-stats` in ui.css): sono un riepilogo che il testo si
 *  merita di avere sotto, non qualcosa a cui il testo fa da titolo. */
export function CampaignEndScreen({
  snap,
  onMenu,
}: {
  snap: CampaignHudSnapshot;
  onMenu: () => void;
}): React.ReactElement {
  const brk = ACT_BREAKS.find((b) => b.actCompleted === snap.actBreakActCompleted);
  return (
    <div className="overlay">
      <div className="panel">
        <p className="subtitle">FINE DELLA CAMPAGNA</p>
        <ActBreakLines lines={brk?.lines ?? []} />
        <p className="hint act-break-stats">
          Livello {snap.level} · {snap.xp} XP · Core raccolti: {snap.coresCollected} · Nodi
          sbloccati: {snap.unlockedNodes.length} / {ALL_SKILL_NODES.length}
        </p>
        <button className="btn" type="button" onClick={onMenu}>
          TORNA AL MENU
        </button>
      </div>
    </div>
  );
}
