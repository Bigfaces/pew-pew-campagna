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
- **Un livello è un dato, non un modulo.** Fino allo Sprint 1 la mappa era
  un file e le entità erano costanti: funzionava finché il livello era uno.
  Adesso una `LevelDef` descrive griglia, stanze, trabocchetti,
  raccoglibili, boss e uscita, e `CampaignWorld` ne prende una senza sapere
  quale. Aggiungere un livello vuol dire scrivere un dato; aggiungere un
  tipo di trabocchetto vuol dire toccare la simulazione una volta sola.
  È anche ciò che rende verificabile il level design: un test strutturale
  controlla tutte le mappe dell'atto — ogni entità su un tile calpestabile,
  le stanze che coprono le colonne senza buchi, e una visita in ampiezza
  che dimostri che dallo spawn si arriva davvero alla fine.

## 4. Trabocchetti

Pensati per essere implementabili con sola geometria/logica, senza asset:

| Trabocchetto | Meccanica | Dove sta | Stato |
| --- | --- | --- | --- |
| Porta stagna a tempo | Si chiude N secondi dopo l'attivazione di un sensore | Attracco, corridoio | fatto |
| Turret laser | Nemico stazionario, linea di mira visibile prima di sparare (tempo di reazione leggibile) | Condotti, Molo | fatto |
| Pavimento che cede | Restarci sopra troppo a lungo riporta al punto di partenza della stanza — nessuna fisica di caduta, solo un "warp" di stato | Condotti, il pozzo | fatto |
| Gas/EMP | Area che spegne minimappa e ottica finché non se ne esce, più una coda | Condotti, la camera | fatto |
| Corridoio a fuoco incrociato | Tre turret sfasate di un terzo di ciclo: si supera leggendo il ritmo, non a forza | Molo, la galleria | fatto |
| Passerelle sospese | Vuoto fra due camminamenti: restarci sopra fa cadere, e camminando non si fa in tempo. Si passa in scatto | Anello esterno, il ponte | fatto |
| Blackout di settore | Buio: resta un alone attorno a chi guarda. Non spegne la minimappa — è il contrario del gas | Refrigerante, camera fredda; e il Custode | fatto |
| Gravità alterata | Il mondo si ribalta e lo strafe si specchia con lui | Refrigerante, sala della gravità; e il Custode | fatto |

Tutti derivano da primitive già presenti (trigger volumetrici, timer,
stati temporanei) più i bot esistenti, riletti come "trappole" invece che
avversari mobili. Tre cose che il codice ha chiarito e che vale la pena
fissare qui:

- **Il drone *era* già una turret.** Non si è mai mosso: linea di vista,
  tempo di reazione, colpo, ricarica. Sono la stessa entità, e `kind`
  decide soltanto se si disegna come un rombo sospeso o come un blocco
  imbullonato. Tenerne due avrebbe raddoppiato la logica per una
  differenza di disegno.
- **Il pavimento che cede non uccide.** Costa tempo e posizione. Una morte
  lo renderebbe indistinguibile da una turret, e il punto è avere una
  minaccia che non si risolve sparando. La soglia è tarata sulla
  traversata misurata, non stimata: si passa camminando dritti, non si
  passa fermandosi a mirare. La prima taratura la metteva esattamente
  alla durata della traversata, e cedeva a chiunque — cioè era un muro
  travestito da scelta.
- **Il fuoco incrociato ha bisogno di geometria, non solo di timer.** La
  prima galleria era un tubo dritto: tutte e tre le turret vedevano tutto,
  quindi sparava sempre qualcuna e non c'era ritmo da leggere. Due chicane
  spezzano il corridoio in tre segmenti, una turret per segmento. Solo
  allora lo sfasamento conta.
- **La gravità è una riscrittura onesta.** In un gioco senza asse verticale
  la gravità non può tirare in basso: non esiste un basso. Quello che può
  fare è cambiare *dove credi che sia*. In un settore invertito il mondo si
  ribalta e lo strafe si specchia con lui; il nodo Ancoraggio toglie il
  secondo e lascia il primo, cioè la parte che disorienta senza quella che
  punisce i riflessi. Stesso criterio dei nomi dei nodi (sezione 6): si
  tiene l'intento, si butta la lettera, invece di inventare una fisica che
  il motore non ha.
- **Buio e gas tolgono informazione in modi opposti, di proposito.** Il gas
  spegne i sensori e lascia la vista; il buio spegne la vista e lascia i
  sensori. Al buio la minimappa è l'unica cosa che resta — ed è il momento
  in cui il ramo Percezione si ripaga. Due trappole che la tolgono allo
  stesso modo sarebbero la stessa trappola due volte.
- **Le passerelle sono l'unico punto in cui un nodo cambia la geometria.**
  Quelle strette chiedono lo Scatto, quelle larghe anche lo Slancio. Proprio
  per questo ogni voragine ha sempre una strada alternativa a piedi — più
  lunga, più esposta, ma percorribile da chiunque: un albero facoltativo non
  può diventare un requisito di sblocco. Lo verifica un test strutturale su
  ogni livello, e il bot di attraversabilità lo rifà camminando.

## 5. Boss

Ogni boss ha: **arena dedicata**, **1-2 pattern d'attacco leggibili**, una
**finestra di vulnerabilità** (il giocatore deve creare l'occasione, non
subirla passivamente), e **niente bullet-hell** — coerente col ritmo
"un colpo uccide" dell'Arena.

1. **Sentinella del Molo** (fine Atto I) — robot cingolato lento, scudo
   frontale sempre attivo. Vulnerabile solo al "core" sul retro, esposto
   quando carica un attacco a distanza ravvicinata: bisogna farlo mancare
   girandogli attorno, poi colpire. **Due fasi:** a metà dei danni si
   "altera" — guardia e telegrafo si accorciano e carica due volte per
   raffica invece di una. Il principio è che la seconda fase stringa il
   ritmo *e* apra di più: le pause tra le due cariche sono a loro volta
   finestre vulnerabili, quindi la percentuale di ciclo scoperta sale
   (31% → 54%, misurati da `balance:campaign`). Una seconda fase che
   fosse solo più aggressiva sarebbe soltanto più lunga da subire.
2. **Custode del Reattore** (fine Atto II) — non insegue e non si muove:
   manipola l'ambiente. Alterna due manipolazioni, blackout e inversione
   di gravità, e fra l'una e l'altra resta scoperto per una finestra
   breve, annunciata da un preavviso.

   Il contrasto con la Sentinella è il punto, ed è deliberato: lì la
   finestra si *crea* — farlo mancare, girargli dietro — ed è
   **posizionale**, solo il cono posteriore. Qui la finestra *arriva* ed è
   **temporale**: da qualsiasi angolo, ma solo adesso. Due boss che si
   battessero allo stesso modo sarebbero un boss con due skin.

   Anche le seconde fasi vanno in direzioni opposte. La Sentinella
   alterata stringe il ritmo *e* apre di più (31% → 54% di ciclo
   vulnerabile). Il Custode alterato fa il contrario: allunga le
   manipolazioni e accorcia la finestra — diventa più *avaro*, non più
   aggressivo. Entrambe le cifre le misura `balance:campaign`.

   Il preavviso non è un regalo: senza, colpire nella finestra sarebbe
   questione di trovarsi già girati dalla parte giusta per caso, cioè
   fortuna invece di lettura.
3. **ARBITER** (finale, 3 fasi) — corpo modulare: fase 1 a distanza (turret
   multiple da disattivare una a una), fase 2 ravvicinata (mobilità e
   schivata), fase 3 "nucleo" scoperto con tempo limitato. Ogni fase riusa
   una minaccia vista in atti precedenti, come test finale.

## 6. Skill tree e potenziamenti armi

**Valuta di progressione: esperienza, non più core spesi direttamente.**
Il primo passaggio (Sprint 1) faceva sbloccare un nodo a 1 core raccolto —
semplice, ma premiava solo l'esplorazione: un giocatore che uccide tutto e
ignora i core non progrediva mai. Ora ogni azione genera esperienza —
raccogliere un core, entrare in una stanza nuova, colpire il drone, colpire
o abbattere il boss — e salire di **livello** (soglie crescenti di XP
cumulativa) concede un **punto abilità**, che è ciò che sblocca un nodo. I
core restano raccoglibili e restano la fonte di XP più affidabile da
esplorazione pura, ma non sono più l'unica strada: un run aggressivo e uno
esplorativo progrediscono entrambi, verso lo stesso tipo di ricompensa.

**Rami dello skill tree** — quattro rami, dieci nodi, tutti costruiti:

- **Precisione** — *Otturatore Rapido* (ricarica più breve), *Aggancio
  Ottico* (l'ottica si apre quasi subito e rallenta meno il passo), *Danno
  di Striscio* (mezzo danno anche fuori dal cono posteriore del boss).
- **Mobilità** — *Scatto* (uno strappo breve, direzione fissata alla
  partenza, con cooldown), *Passo Lungo* (velocità base più alta), *Scatto
  Evasivo* (durante lo scatto sei intoccabile: la carica si attraversa).
- **Sopravvivenza** — *Piastra Aggiuntiva* (lo scudo assorbe due colpi),
  *Riserva di Bordo* (entrare in una stanza nuova ricarica lo scudo già
  raccolto).
- **Percezione** — *Scanner di Settore* (minimappa del settore), *Lettura
  Termica* (la minimappa segna anche droni, boss, core e scudo).

**I nomi non sono quelli promessi nella prima stesura, e il motivo conta.**
Il piano iniziale elencava "passo silenzioso" e "rigenerazione parziale tra
le stanze". Nessuno dei due descrive una meccanica che questo gioco ha: il
drone trova il giocatore con la linea di vista e non con l'udito, e non
esiste una barra di vita da rigenerare, perché un colpo uccide. Tenere quei
nomi avrebbe voluto dire inventare meccaniche per far tornare le etichette.
Sono stati riscritti su ciò che la simulazione fa davvero, tenendo l'intento
di ciascuno: "silenzioso" era *non farsi prendere*, e quello lo fa lo
Scatto; "rigenerazione" era *un errore che non finisce il run*, e quello lo
fa la Riserva di Bordo. "Minimappa estesa" non aveva niente da estendere —
la Campagna non ha mai avuto una minimappa — quindi il primo nodo *è* la
minimappa e il secondo aggiunge i contatti, cioè la parte che si chiamava
"estesa", stavolta guadagnata.

**Secondo anello, aperto dall'Atto II** — un nodo per ramo, ognuno
risposta a una minaccia che l'atto introduce:

- **Precisione — Mira Stabile** (dietro Aggancio Ottico): l'ottica regge
  nel gas e a gravità invertita.
- **Mobilità — Slancio** (dietro Scatto): scatto più veloce, quindi le
  passerelle larghe diventano passabili.
- **Sopravvivenza — Ancoraggio** (dietro Riserva di Bordo): la gravità
  invertita non specchia più i comandi.
- **Percezione — Sensori Inerziali** (dietro Lettura Termica): lo scanner
  regge dentro il contaminante.

È la progressione che un atto nuovo merita: prima arriva il problema, poi
il ramo che se ne occupa offre la risposta. Nodi che migliorano numeri già
buoni si comprano per abitudine; nodi che sbloccano una strada si
scelgono.

Una nota su Slancio, perché sembrava ovvio e non lo era: moltiplica la
*velocità* dello scatto, non la durata. Sul vuoto non conta quanto dura lo
scatto, conta quanti millisecondi si passano sospesi — allungare la durata
farebbe arrivare più lontano ma non più in fretta, e una passerella larga
resterebbe impossibile lo stesso.

**Prerequisiti.** Quattro nodi stanno dietro un altro: Scatto Evasivo richiede
Scatto, Lettura Termica richiede Scanner di Settore. Sono i due che
cambiano *come* si gioca invece di spostare un numero, e stanno dietro
quello che introduce la meccanica su cui si appoggiano. È anche ciò che
rende l'albero un albero invece di una lista della spesa. Un prerequisito
sta sempre nello stesso ramo del nodo che lo richiede — il menu mostra un
ramo per volta, e mandare a cercare un nodo fuori schermata sarebbe una
trappola.

**Quanto ci vuole a riempirlo.** Quattordici nodi, quindici livelli:
nessun punto resta senza un nodo su cui finire. L'Atto I paga il primo
anello (dieci punti), l'Atto II il secondo; chi esplora arriva a 3 → 6 →
10 → 11 → 12 → 14 punti a fine di ciascun livello, chi tira dritto a
1 → 2 → 7 → 8 → 9 → 10 — cioè ogni livello paga qualcosa a chiunque. Le due cose tirano in
direzioni opposte di proposito: un albero comprabile tutto subito non è un
albero, e uno che non lascia scegliere niente al primo run non è una
progressione. Sono invarianti verificate da `pnpm run balance:campaign`,
non affermazioni di questo documento.

**Nodi che non toccano la simulazione.** I due di Percezione cambiano solo
cosa il giocatore vede. Restano comunque stato della sim (`unlockedNodes`):
è il renderer a chiedere, non a decidere.

**Armi:** si parte con il fucile di precisione. Nodi dello skill tree
sbloccano varianti/potenziamenti (es. caricatore da 2 colpi prima di
ricaricare, un colpo secondario a corto raggio per le emergenze) invece di
un intero arsenale slegato, per non rompere l'identità "un colpo, una
vita" del gioco. I boss sono le uniche entità con più "hit" necessari,
gestiti come barre di vulnerabilità a fasi, non come HP generici.

Persistenza: come le statistiche attuali, su `localStorage` (nessun nuovo
requisito di database). Si salva il **personaggio, non la partita**: XP,
nodi sbloccati, core già presi e stanze già pagate sopravvivono; la
posizione, i timer e i danni al boss no. Rientrare rigioca il livello
dall'Attracco con il personaggio che ci si è costruiti — il livello dura
due minuti, e un salvataggio a metà carica del boss sarebbe peggio del
problema che risolve. Core e stanze sono segnati come già riscossi
proprio perché rigiocare non diventi un ciclo di XP infinito. Dal menu di
pausa si può azzerare tutto.

### Potenziamenti vs progressione permanente

L'Arena ha tre power-up temporanei (scudo, fuoco rapido, velocità): si
raccolgono a terra, durano una manciata di secondi o un colpo, e
scompaiono. Lo skill tree della Campagna è l'opposto: una scelta fatta una
volta, che resta per tutta la partita. Confonderli — far sì che un
"potenziamento" trovato per terra sia in realtà permanente, o viceversa —
toglierebbe peso a entrambe le decisioni: quella di spendere un punto
abilità (irreversibile, va pensata) e quella di raccogliere qualcosa in
un corridoio (immediata, va solo notata).

Per questo la Campagna tiene i due sistemi separati e visivamente distinti
(i core/l'esperienza sono verde-ciano, i potenziamenti tattici sono blu
come lo scudo dell'Arena) invece di far convergere tutto nello stesso
albero. Il primo esempio concreto è lo **scudo tattico**: un pickup fisso
nel Magazzino, prima del Molo, che assorbe un colpo (del drone o da
contatto col boss) e si consuma — niente XP, nessuna scelta permanente, si
può riprendere dopo la morte nello stesso tentativo. Serve da "prova
generale": prima di affrontare la Sentinella, il gioco offre esplicitamente
una seconda chance a chi la va a cercare.

Il piano per gli atti successivi è estendere questa stessa idea invece di
inventarne un'altra: fuoco rapido temporaneo prima di una stanza con più
nemici, un boost di velocità per superare un corridoio a fuoco incrociato
in tempo. Sempre pickup fissi legati a una minaccia specifica (non un
drop casuale), sempre consumabili, sempre distinti dai nodi permanenti.

## 7. Impatto sull'architettura esistente

- `sim/`: stato di progressione (XP, nodi sbloccati, livello raggiunto),
  entità trap/boss come macchine a stati, tutto avanzato a tick fissi e
  seedato come oggi. Nessuna modifica al modello a entità "input-driven"
  esistente: le trappole sono ambiente, i boss sono bot con AI più
  articolata. Un `CampaignWorld` simula **un** livello: passare al
  successivo vuol dire costruirne un altro con lo stesso profilo, non
  ripulire questo. I timer, i danni al boss e le posizioni di un livello
  non hanno senso nel seguente, e azzerarli uno a uno sarebbe una lista da
  ricordare di aggiornare a ogni trabocchetto aggiunto.
- `render/`: nessun asset nuovo per ora. Boss e trappole si distinguono con
  forme/colori (stesso approccio delle texture generate in codice).
- `ui/`: nuove schermate — selezione capitolo/livello, skill tree, schermata
  di fine missione — riusando i componenti React già presenti in Arena.
- `net/`: la campagna è single-player; il multiplayer resta esclusivo della
  modalità Arena, invariata.
- `stats/` e bilanciamento: `tools/balance-campaign.mts` cammina l'atto
  sulle definizioni dei livelli — non su una lista di tappe scritta a mano,
  che racconterebbe l'atto che c'era quando è stata scritta — e verifica
  quattro invarianti sull'economia dei punti abilità. Stesso principio
  dell'Arena: si discute con i numeri, non a parole.
- Verificabilità del level design: oltre ai test strutturali (sezione 3),
  un bot attraversa ogni livello camminando e sparando alle turret. È un
  giocatore mediocre di proposito — niente scatto, niente copertura — e
  proprio per questo è la soglia giusta: se ce la fa lui, il livello è
  attraversabile. È il test che ha bocciato la prima galleria e la prima
  camera del gas, che dal codice sembravano entrambe a posto.

## 8. Roadmap proposta

1. Un livello "verticale slice" *(fatto)* — poi diventato l'Atto I
   completo: tre livelli, il boss alla fine del terzo.
2. Skill tree *(fatto)* — quattro rami su due anelli, quattordici nodi,
   persistenza su `localStorage`.
3. Trabocchetti restanti e composizioni *(fatto)* — tutti e otto,
   corridoio a fuoco incrociato e passerelle compresi.
4. Narrativa: battute di ARBITER *(fatto per la slice, sezione 10)*; testi
   tra un livello e l'altro ancora da scrivere.
5. Atto II *(fatto)* — Il Nucleo Anulare, tre livelli e il Custode.
6. Atto III, bilanciamento con il tool esteso.

## 9. Decisioni dal briefing

- **Lunghezza:** 3 livelli + boss per atto (9 livelli + 3 boss totali). Si
  allunga solo se, dopo la verticale slice, il ritmo lo giustifica.
- **Skill tree:** il briefing aveva fissato *un ramo, 2-3 nodi* per la
  slice, ed è quello che lo Sprint 1 ha consegnato. Gli altri tre rami sono
  arrivati subito dopo, una volta che il loop reggeva: la decisione del
  briefing era sullo scope della prima iterazione, non un tetto.
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

## 10. Stato della campagna (modalità Tutorial)

*Nato come "verticale slice": un livello solo, per validare il loop prima
di scriverne nove. Il loop ha retto, e la slice è diventata il primo dei
tre livelli dell'atto.*

**Stato: Atti I e II completi e giocabili.** Sei livelli concatenati —
Attracco, Condotti, Molo, Anello Esterno, Condotte del Refrigerante,
Nucleo — raggiungibili da "CAMPAGNA (BETA)" nel menu principale, con
controlli touch oltre a tastiera/mouse, ottica e progressione salvata in
locale. Tutti e otto i trabocchetti della sezione 4 esistono, i due boss
hanno le loro seconde fasi (sezione 5), ARBITER commenta il run e
nell'Atto II comincia a parlare al giocatore invece che catalogarlo, e lo
skill tree ha due anelli: quattro rami, quattordici nodi, quattro
prerequisiti (sezione 6).

**L'astrazione ha retto.** L'Atto II era il banco di prova dell'idea che un
livello sia solo un dato, e la risposta è netta: i tre livelli nuovi sono
tre oggetti in `levels.ts` e non hanno richiesto una riga in
`CampaignWorld`. Quello che *ha* richiesto codice sono state le meccaniche
nuove — passerelle, buio, gravità, il Custode — che è esattamente la
divisione che si voleva: aggiungere un livello è dato, aggiungere un tipo
di minaccia è lavoro, e si paga una volta sola.

Resta l'Atto III (sezione 2), che secondo il GDD deve ricombinare le
minacce viste invece di aggiungerne: se è vero, dovrebbe essere quasi
tutto dato.

Obiettivo: un loop giocabile end-to-end, per validare le meccaniche prima di
scrivere tutto l'Atto I. Scope fissato dal briefing:

- **Livelli:** sei, lineari, di 3-4 stanze ciascuno (riuso del raycaster
  esistente, nessuna mappa enorme). Raggiungere l'uscita di un livello
  apre il successivo; l'ultimo livello di ogni atto finisce col boss
  invece che con un'uscita.
- **Trabocchetti:** tutti e otto della sezione 4, distribuiti sui sei
  livelli.
- **Boss:** Sentinella del Molo alla fine dell'Atto I, Custode del
  Reattore alla fine del II. Vulnerabilità posizionale il primo, temporale
  il secondo; entrambi con una seconda fase a metà danni (sezione 5).
- **Morte:** checkpoint di stanza (regola "Tutorial" sopra).
- **Skill tree:** quattro rami su due anelli (sezione 6), quattordici
  nodi, sbloccabili con punti abilità guadagnati salendo di livello
  (esperienza da core, stanze, turret, boss). Il primo anello si compra
  nell'Atto I, il secondo nell'Atto II.
- **Potenziamento tattico:** uno scudo raccoglibile nel Magazzino, prima
  del Molo — assorbe un colpo e si consuma, distinto dallo skill tree
  (sezione 6, "Potenziamenti vs progressione permanente").
- **Narrazione:** il briefing l'aveva rimandata, e la sequenza era quella
  giusta — il loop è arrivato per primo. Ora che regge, ARBITER parla:
  battute brevi a sottotitolo, una sola volta ciascuna (prima morte per
  causa, ingresso in una stanza, porta sigillata, core, scudo, drone
  abbattuto, alterazione del boss, vittoria). Vivono in `ui/arbiter.ts`,
  nello strato di presentazione e non nella sim: il testo cambia spesso,
  la simulazione deve restare deterministica e testabile senza di esso.
  I testi tra un livello e l'altro restano da scrivere.

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
