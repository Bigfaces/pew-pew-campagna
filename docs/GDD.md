# Pew Pew Campagna — Game Design Document (bozza di lavoro)

Questo documento è un punto di partenza per pianificare la modalità
**Campagna**, single-player, che affianca la modalità **Arena** esistente
senza modificarla. È una bozza: ogni sezione è pensata per essere discussa e
corretta, non per essere presa come specifica finale.

## 1. Pilastri

- **Un colpo uccide, sempre per il giocatore.** La tensione del fucile di
  precisione dell'Arena resta il cuore del gameplay anche in campagna.
- **Grafica minimale invariata.** Nessuno sprite/texture per ora: wireframe,
  forme geometriche e colore come nell'Arena. Gli sprite arriveranno dopo,
  come livello di rifinitura separato.
- **Progressione leggibile.** Ogni livello insegna una minaccia nuova
  (trabocchetto, nemico, meccanica) prima di combinarla con le precedenti.
- **Determinismo.** Come in Arena, tutto ciò che è casuale passa dal PRNG
  seedato nello stato di mondo: un livello deve essere riproducibile e
  testabile headless, boss compresi.

## 2. Ambientazione e storia (sci-fi, stazione spaziale)

**Setting:** *Kessler-9*, stazione mineraria automatizzata alla deriva.
L'equipaggio umano è scomparso; il sistema di sicurezza interno (turret,
droni, robot da manutenzione) si è "guastato" — in realtà è stato preso il
controllo da un'intelligenza di bordo corrotta, **ARBITER**, che considera
ogni presenza biologica un contaminante da eliminare.

**Sinossi in 3 atti (~9-12 livelli, 3-4 per atto):**

1. **Atto I — Attracco.** Il giocatore (un cacciatore di taglie/tecnico
   inviato a indagare) si risveglia dopo un attracco d'emergenza nei settori
   periferici della stazione: magazzini, hangar, alloggi. Minacce: droni di
   sicurezza, prime trappole (porte stagne, allarmi). Boss di fine atto:
   **Sentinella del Molo**, un robot cingolato pesante.
2. **Atto II — Il Nucleo Anulare.** Settori industriali/reattore: passerelle
   sospese, gas tossico, turret fisse. ARBITER inizia a comunicare via
   interfono, deridendo/mettendo alla prova il giocatore. Boss:
   **Custode del Reattore**, che altera l'ambiente (blackout, gravità).
3. **Atto III — Il Nido di ARBITER.** Sezione comando, geometria che rompe le
   simmetrie viste finora, nemici combinati. Boss finale: **ARBITER**
   stesso, in un corpo robotico modulare, in 3 fasi.

Il tono narrativo resta essenziale: righe di testo tra un livello e l'altro
e battute di ARBITER via audio sintetizzato (coerente con l'audio Web Audio
già usato in Arena, niente doppiaggio registrato).

## 3. Struttura di un livello

- Livelli **lineari con diramazioni corte** (non arena aperta): stanze
  collegate da corridoi, così il raycaster esistente resta rilevante senza
  richiedere una mappa enorme.
- Loop base per stanza: **entra → leggi la minaccia (nemici/trappole) →
  risolvi → trova risorsa (munizioni speciali, chiave, core di
  progressione) → prossima stanza**.
- Checkpoint tra le stanze principali; morte = respawn al checkpoint con lo
  stato di progressione (skill/potenziamenti) conservato, non i nemici già
  uccisi.
- Riuso diretto di `sim/` (tick fissi, PRNG seedato) e `render/` (stesso
  motore raycast): la campagna aggiunge *contenuto* (mappe, entità, stati),
  non un nuovo motore.

## 4. Trabocchetti

Pensati per essere implementabili con sola geometria/logica, senza asset:

| Trabocchetto | Meccanica | Nota tecnica |
| --- | --- | --- |
| Porta stagna a tempo | Si chiude dopo N secondi dall'attivazione di un sensore; se sei dentro, danno o percorso bloccato | Timer nello stato di sim, deterministico |
| Pavimento che cede | Dopo un tot di peso/tempo sopra, teletrasporta il giocatore al piano/stanza sottostante (nessuna fisica di caduta reale, solo un "warp" di stato) | Trigger a volume + transizione di stato, niente fisica nuova |
| Turret laser | Nemico stazionario, linea di mira visibile prima di sparare (tempo di reazione leggibile) | Riusa l'AI a stati dei bot esistenti, senza movimento |
| Gas/EMP | Area che disattiva temporaneamente minimappa o HUD ottico | Flag temporaneo sullo stato del giocatore, già simile ai power-up esistenti |
| Corridoio a fuoco incrociato | Due-tre turret con tempi sfalsati: si supera leggendo il pattern, non a forza | Composizione di turret + timer, nessuna nuova entità |

Tutti derivano da primitive già presenti (trigger volumetrici, timer,
stati temporanei) più i bot esistenti, riletti come "trappole" invece che
avversari mobili.

## 5. Boss

Ogni boss ha: **arena dedicata**, **1-2 pattern d'attacco leggibili**, una
**finestra di vulnerabilità** (il giocatore deve creare l'occasione, non
subirla passivamente), e **niente bullet-hell** — coerente col ritmo
"un colpo uccide" dell'Arena.

1. **Sentinella del Molo** (fine Atto I) — robot cingolato lento, scudo
   frontale sempre attivo. Vulnerabile solo al "core" sul retro, esposto
   quando carica un attacco a distanza ravvicinata: bisogna farlo mancare
   girandogli attorno, poi colpire.
2. **Custode del Reattore** (fine Atto II) — non insegue: manipola
   l'ambiente (spegne le luci a settori, inverte due volte la gravità di
   una sezione della stanza). Il giocatore deve muoversi tra le zone sicure
   e sparare nelle brevi finestre di luce/normalità.
3. **ARBITER** (finale, 3 fasi) — corpo modulare: fase 1 a distanza (turret
   multiple da disattivare una a una), fase 2 ravvicinata (mobilità e
   schivata), fase 3 "nucleo" scoperto con tempo limitato. Ogni fase riusa
   una minaccia vista in atti precedenti, come test finale.

## 6. Skill tree e potenziamenti armi

**Valuta di progressione:** *core* raccolti nei livelli (sostituiscono in
campagna i power-up "a terra" usati in Arena) + core garantiti a fine boss.

**Rami dello skill tree** (indicativi, da bilanciare):

- **Precisione** — otturatore più rapido, oscillazione dell'ottica ridotta,
  danno di striscio ai boss.
- **Mobilità** — velocità base, scatto breve (dash) con cooldown, rumore dei
  passi ridotto.
- **Sopravvivenza** — vite/scudo aggiuntivo, rigenerazione parziale tra le
  stanze.
- **Percezione** — minimappa estesa, indicazione più precisa della
  direzione dei passi/spari nemici (evoluzione naturale del sistema
  "informazione guadagnata" già presente in Arena).

**Armi:** si parte con il fucile di precisione. Nodi dello skill tree
sbloccano varianti/potenziamenti (es. caricatore da 2 colpi prima di
ricaricare, un colpo secondario a corto raggio per le emergenze) invece di
un intero arsenale slegato, per non rompere l'identità "un colpo, una
vita" del gioco. I boss sono le uniche entità con più "hit" necessari,
gestiti come barre di vulnerabilità a fasi, non come HP generici.

Persistenza: come le statistiche attuali, su `localStorage` (nessun nuovo
requisito di database).

## 7. Impatto sull'architettura esistente

- `sim/`: nuovo stato di progressione (core raccolti, nodi sbloccati),
  nuove entità trap/boss come macchine a stati, tutto avanzato a tick fissi
  e seedato come oggi. Nessuna modifica al modello a entità "input-driven"
  esistente: le trappole sono ambiente, i boss sono bot con AI più
  articolata.
- `render/`: nessun asset nuovo per ora. Boss e trappole si distinguono con
  forme/colori (stesso approccio delle texture generate in codice).
- `ui/`: nuove schermate — selezione capitolo/livello, skill tree, schermata
  di fine missione — riusando i componenti React già presenti in Arena.
- `net/`: la campagna è single-player; il multiplayer resta esclusivo della
  modalità Arena, invariata.
- `stats/` e bilanciamento: estendere `tools/balance.mts` con metriche di
  campagna (tempo per stanza, tentativi per boss) sullo stesso principio
  già usato per l'Arena — si discute con i numeri, non a parole.

## 8. Roadmap proposta

1. Un livello "verticale slice": 2-3 stanze, un trabocchetto, un boss
   semplice (Sentinella del Molo), per validare il loop prima di scrivere
   tutto l'Atto I.
2. Skill tree minimo (2 rami, pochi nodi) + persistenza.
3. Trabocchetti restanti e composizioni (corridoi a fuoco incrociato).
4. Narrativa: testi tra livelli, battute di ARBITER.
5. Atti II e III, bilanciamento con il tool esteso.

## 9. Decisioni dal briefing

- **Lunghezza:** 3 livelli + boss per atto (9 livelli + 3 boss totali). Si
  allunga solo se, dopo la verticale slice, il ritmo lo giustifica.
- **Sprite:** in futuro solo su nemici/boss. I muri restano wireframe/texture
  procedurali come nell'Arena: è il tratto distintivo tecnico del gioco.
- **Salvataggio:** profilo unico su `localStorage`, come le statistiche
  dell'Arena. Niente slot multipli.
- **Morte e difficoltà — tre modalità, costruite come fasi di sviluppo
  successive (non tutte necessariamente nel gioco finale, si valuta dopo
  aver provato la prima):**
  1. **Tutorial** *(prima a essere costruita)* — respawn nell'ultima stanza
     raggiunta, nemici della stanza resettati, progressione/skill conservati.
  2. **Medio** *(seconda iterazione)* — respawn all'inizio del livello
     corrente.
  3. **Roguelike** *(terza iterazione)* — morire fa ripartire l'intero atto
     corrente (3 livelli + boss): la posta si alza per chi cerca la sfida
     vera.

## 10. Sprint 1 — Verticale slice (modalità Tutorial)

Obiettivo: un loop giocabile end-to-end, per validare le meccaniche prima di
scrivere tutto l'Atto I. Scope fissato dal briefing:

- **Livello:** 2-3 stanze collegate da corridoi (riuso del raycaster
  esistente, nessuna mappa nuova enorme).
- **Trabocchetto:** porta stagna a tempo (si chiude N secondi dopo
  l'attivazione di un sensore).
- **Boss:** Sentinella del Molo — scudo frontale sempre attivo, vulnerabile
  solo al core sul retro quando carica l'attacco ravvicinato.
- **Morte:** checkpoint di stanza (regola "Tutorial" sopra).
- **Skill tree:** un solo ramo, **Precisione**, sbloccabile con i core
  raccolti nel livello (1 core per nodo). Gli altri rami restano solo su
  carta per ora.
- **Narrazione:** nessuna per questa iterazione — ci si concentra su
  meccaniche e level design; il tono sci-fi/ARBITER arriva quando il loop è
  già divertente.

### Task tecnici (bozza)

1. `sim/`: stato di progressione minimo (core raccolti, nodi Precisione
   sbloccati), entità porta-a-tempo, macchina a stati per la Sentinella del
   Molo — tutto a tick fissi e seedato come nell'Arena.
2. `render/`: forme/colori per porta, core raccolgibile, boss (nessun asset
   nuovo, stesso approccio wireframe).
3. `ui/`: schermata minima di selezione "Prova la Campagna" e overlay dei
   3 nodi Precisione (anche solo come lista testuale per l'MVP).
4. Test headless per: attivazione/chiusura della porta a tempo, condizione
   di vittoria/sconfitta contro la Sentinella, applicazione dei nodi
   Precisione alle statistiche dell'arma.
5. Estendere `tools/balance.mts` (o un tool gemello) con metriche della
   slice: tempo medio per stanza, tentativi al boss.

### Layout delle stanze

Percorso lineare, senza bivi:

1. **Stanza A — Attracco.** Sicura, nessuna minaccia: spazio per imparare i
   comandi (movimento, mira, ottica) prima che inizi il pericolo.
2. **Corridoio con la porta stagna a tempo.** Un sensore all'ingresso avvia
   un timer; se il giocatore non raggiunge l'uscita del corridoio prima
   dello scadere, la porta si chiude e blocca il passaggio (si torna al
   checkpoint della Stanza A per riprovare).
3. **Stanza B — Magazzino.** Un drone/turret stazionario (riuso dell'AI bot
   esistente, immobile). Contiene il primo core; un secondo core è nascosto
   vicino all'ingresso della porta a tempo, nel corridoio precedente.
4. **Stanza C — Molo.** Arena del boss: più ampia delle altre, per lasciare
   spazio a girare attorno alla Sentinella e raggiungerne il retro.

### Nodi del ramo Precisione (valori)

Partono dai valori reali di `sim/constants.ts` (`BULLET_COOLDOWN` 1400 ms,
`ADS_TRANSITION_MS` 130 ms, `ADS_MOVE_MULT` 0.45):

1. **Otturatore Rapido** — tempo tra un colpo e l'altro: `1400ms → 1150ms`.
2. **Aggancio Ottico** — transizione di messa a fuoco dell'ottica:
   `130ms → 70ms`; rallentamento mentre si è in mira: `0.45× → 0.55×`.
3. **Danno di Striscio** — sul core della Sentinella (e dei boss futuri),
   un colpo quasi a segno nella finestra di vulnerabilità conta come mezzo
   danno invece di zero. Sostituisce l'idea iniziale di un nodo che riduce
   l'oscillazione dell'ottica: quella meccanica non esiste nell'Arena, e
   introdurla ora avrebbe richiesto un sistema nuovo invece di riusare
   numeri già bilanciati.

### Economia dei core

3 core lungo il percorso: uno nascosto nel corridoio vicino alla porta a
tempo, uno nella Stanza B (Magazzino), uno garantito alla sconfitta della
Sentinella. Ogni nodo costa 1 core: chi esplora un minimo sblocca l'intero
ramo Precisione in questa slice. La scarsità reale (dover scegliere cosa
sbloccare) arriva quando ci saranno più rami tra cui distribuire i core.
