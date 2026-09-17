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
- **Livelli lineari, tranne dove non lo sono.** Gli Atti I e II sono
  corridoi da sinistra a destra. L'Atto III no — il GDD gli chiede
  "geometria che rompe le simmetrie viste finora" — e per poterlo scrivere
  è servito togliere un'assunzione dal modello dati: una stanza era un
  *intervallo di colonne*, cioè la linearità cablata nella struttura.
  Adesso è un rettangolo, e i limiti verticali sono facoltativi: assenti
  vuol dire "tutta l'altezza". Sei livelli su nove non hanno dovuto
  cambiare una riga, perché un corridoio è un caso particolare di
  rettangolo e non un modello diverso.
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

## 4. Trabocchetti e nemici

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

### Nemici

Fino all'Atto III compreso la campagna aveva trabocchetti e boss, e
niente in mezzo. Le turret non si muovono — il "drone" del Magazzino è
una turret disegnata diversa, vedi la nota qui sopra — quindi **sei
livelli su nove non contenevano nulla che si spostasse e sparasse**,
mentre il ciclo di stanza della sezione 3 dice "entra → leggi la
minaccia → risolvi". La parte che si muove mancava.

Dieci archetipi su tre fasce, **due o tre per livello** (un test impone
il tetto, e un altro che nessun archetipo compaia in un atto più basso
della sua fascia).

| # | Nome | Fascia | Vite | Punto debole | Vulnerabilità | Cosa insegna |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | RONZINO | I | 2 | nucleo | corto raggio | Ti viene addosso, e premia chi *non* arretra |
| 2 | VEDETTA | I | 2 | dorso | da fermo | Si pianta per sparare: più precisa e più fragile insieme |
| 3 | SALDATORE | I | 3 | testa | in avvicinamento | Colpisce toccando: la distanza è la risposta |
| 4 | RIPETITORE | II | 4 | nucleo | sfiato | Arretra: chiudere la distanza qui non funziona |
| 5 | GUARDIANO | II | 4 | dorso | — | Immune di fronte. Si risolve solo con la posizione |
| 6 | FALCO | II | 2 | testa | ottica | Più veloce di te: non si semina, si colpisce |
| 7 | CROGIOLO | II | 4 | nucleo | lungo raggio | Morendo apre una nube: ucciderlo in faccia acceca |
| 8 | ARALDO | III | 4 | nucleo | sfiato | Invisibile finché non spara — e allora è vulnerabile |
| 9 | MARTELLO | III | 5 | dorso | in avvicinamento | Carica in linea retta, senza correggere |
| 10 | ARCHIVISTA | III | 3 | testa | da fermo | Non spara: irrobustisce gli altri. Priorità di bersaglio |

**Sui "punti deboli" e sugli "elementi".** La richiesta era che ogni
nemico avesse un punto debole, o un elemento debole che gli facesse più
danni. Il gioco però ha **un'arma sola** e nessun elemento: fuoco,
ghiaccio e scariche non esistono e non hanno una sorgente. Inventarli
avrebbe voluto dire inventare anche tre munizioni per usarli.

Stesso criterio già applicato alla gravità qui sopra: si tiene
l'intento, si butta la lettera. L'intento è *"esiste un modo giusto di
colpire questo nemico, e paga molto più del modo qualunque"*, e qui
diventa due assi indipendenti che moltiplicano fra loro:

- il **punto debole** dice *dove* — dorso, nucleo, testa. È geometria,
  la cosa che un raycaster sa fare meglio. Vale ×3.
- la **vulnerabilità** dice *quando*, ed è sempre qualcosa che il
  giocatore già fa: aprire l'ottica, chiudere o tenere la distanza,
  aspettare che l'altro abbia appena sparato. Un "elemento" che il
  giocatore non può produrre sarebbe una statistica, non una scelta.
  Vale ×2.

Il colpo perfetto vale quindi **sei volte** quello qualunque. Con
`BULLET_COOLDOWN` a 1400 ms — l'otturatore manuale è il vincolo che
tara tutto il resto — è la differenza fra uno scontro di due colpi e
uno di dieci secondi. Il risultato misurato: **sette archetipi su dieci
si risolvono mirando, tre chiedono di girare attorno.**

**La mira verticale acquista un senso.** Il colpo alla testa è l'unica
cosa in tutto il gioco che dia un significato all'inclinazione della
visuale, che fino a ieri era solo una panoramica. La conversione da
inclinazione a *pendenza del tiro* la fa il controller e non la
simulazione, perché richiede la proiezione — e così il mirino indica lo
stesso punto a qualunque risoluzione e la simulazione resta senza DOM.

**Il corpo si colpisce sempre, qualunque sia l'alzo.** Chiedere anche
in verticale di stare dentro la sagoma avrebbe trasformato ogni colpo
in un tiro di precisione, e in un motore dove l'orizzonte *scorre*
invece di ruotare sarebbe stato un tiro che il giocatore non può mirare
onestamente. L'alzo decide se il colpo vale di più, non se arriva.

**Il guinzaglio.** Un nemico non lascia la stanza in cui è stato messo.
Senza quel limite bastava farsi vedere una volta per trascinarsi dietro
il livello intero, e il ciclo "entra, leggi, risolvi" diventava una
fuga unica dall'inizio alla fine.

**Il preavviso è la reazione.** Nessun nemico spara nell'istante in cui
ti vede: tiene la linea di vista per un tempo dichiarato, e romperla
azzera il conto. È lo stesso contratto delle turret, ed è deliberato
che sia lo stesso — il giocatore ne impara uno. Con la morte in un
colpo, quel preavviso *è* la lealtà dello scontro: la prima taratura
scendeva a 480 ms, e il banco di prova ha detto che sotto i 650 non
c'è nessuna decisione, c'è solo un dado.

**Quattro difetti trovati misurando, non leggendo.** Vale la pena
elencarli perché nessuno era visibile nel codice:

- **Il nucleo era gratis.** A metà sagoma coincideva con la quota
  dell'occhio, quindi il mirino *a riposo* ci cadeva dentro da solo: il
  colpo al punto debole toccava a chiunque sparasse dritto senza
  saperlo. Abbassato al ventre.
- **La traversata era decorativa.** Col rateo di rotazione a 0.085
  rad/tick nessuna distanza permetteva di uscire dal cono di mira. A
  0.04 il conto cambia con la distanza — da lontano il nemico tiene la
  mira, da vicino no — ed è ciò che rende aggirabili i tre archetipi
  col punto debole sul dorso.
- **Tre archetipi cadevano al primo colpo sul solo punto debole**,
  quindi la loro vulnerabilità non aveva modo di contare. Alzati di una
  vita: adesso la finestra è la differenza fra un colpo e due.
- **Il velo dell'Araldo faceva il contrario di quello per cui esiste.**
  L'opacità del canvas si sovrascrive invece di accumularsi attraverso
  `save`/`restore`, quindi il corpo era trasparente e il punto debole
  acceso a piena luce: un bersaglio *più* visibile di uno normale.

**Il bot di attraversabilità ha ripagato tre volte.** Riscritto per
combattere — mira al punto debole, tiene la distanza che la
vulnerabilità del bersaglio chiede, gira attorno a chi ha il dorso
scoperto — ha trovato due stanze sovraccariche e un errore di
piazzamento che nessuna rilettura avrebbe mostrato: la sala pompe, dove
il checkpoint è già sotto il tiro di una turret e un secondo bersaglio
mobile trasformava ogni morte in un anello; la sala della gravità, dove
lo strafe specchiato rende illeggibile un nemico che si risolve solo
aggirandolo; e la camera fredda, dove un Guardiano al buio chiedeva due
cose difficili con un senso in meno.

### Sprite

Il briefing (sezione 9) concedeva gli sprite su nemici e boss, e solo
lì. Restava da decidere *da dove* arrivano, e la strada scontata —
scaricarli — è quella che questo repo non poteva permettersi.

**Perché non asset scaricati.** Il progetto non ha un solo file
binario, e non è un dettaglio estetico: la build a file singolo
(`vite.config.ts`, l'`.html` che si apre col doppio clic) esiste
*grazie* a questo, perché inlinea ogni byte. Un set di sprite
scaricati finirebbe lì dentro in base64 e quel file passerebbe da
~360 kB a qualche megabyte. Ci sarebbero anche le licenze da portarsi
dietro — CC0 per Kenney e Quaternius, BSD per Freedoom, miste e
virali su OpenGameArt — e una cartella di asset da tenere allineata al
codice che li usa.

**Si cuociono.** Stessa tecnica che il gioco usa già per i muri
(`render/textures.ts`) e per i suoni (Web Audio): si disegnano una
volta all'avvio dentro canvas fuori schermo e poi si copiano con
`drawImage`. Zero asset, zero rete, build a file singolo intatta, e
`imageSmoothingEnabled = false` era già impostato — lo scaling nearest
a queste dimensioni è il look giusto, non un compromesso.

**Otto direzioni senza disegnarle otto volte.** Un corpo è una lista
di **scatole** in spazio modello (x avanti, y a destra, z da 0 ai
piedi a 1 alla cima); il forno le proietta a ogni angolo e le ordina
per profondità. Disegnare otto direzioni a mano avrebbe voluto dire
ottanta immagini per dieci archetipi, e ogni ritocco moltiplicato per
otto.

Ed è una direzione che **serve**: da quando tre archetipi hanno il
punto debole sul dorso, capire da che parte guarda un nemico non è un
vezzo — è l'informazione che decide se il colpo vale uno o tre. Ogni
bipede ha quindi una visiera davanti e uno zaino dietro: due sagome
diverse, non lo stesso rettangolo girato. E `rel`, l'angolo dalla
faccia del nemico a chi guarda, è *la stessa quantità* che
`resolveEnemyHit` usa per decidere il dorso: non è un risparmio di
codice, è la ragione per cui quello che vedi è quello che colpisci.

**La regola si vede nel corpo.** La piastra del Guardiano è una
scatola vera montata davanti al torace — non più solo un pannello che
compare quando lo guardi in faccia, ma il motivo per cui è sagomato
così. Stessa cosa per l'anello dell'Archivista (la sua minaccia è
un'area, e l'area va dichiarata dal corpo), per l'ariete del Martello,
e per il nucleo sulla schiena della Sentinella, che adesso si vede
girandole attorno invece di doverlo imparare morendo.

**I boss tengono il colore della fase.** Prima il loro corpo *era* un
rettangolo del colore della fase, e quel colore è il loro telegrafo
principale. Sostituirlo con una sagoma dettagliata li avrebbe resi
più belli e meno leggibili, che è lo scambio sbagliato: adesso lo
sprite viene velato dal colore della fase, così si vede da che parte è
girato *e* in che fase sta. Archi posteriori, finestre del nucleo e
anelli dei moduli restano disegnati sopra, invariati.

**Quattro difetti, e nessuno era visibile leggendo il codice.**

- **Metà di ogni sprite era nera.** `shade()` si applica due volte —
  una dalla pianta del corpo per fare le parti chiare e scure, una dal
  forno per l'ombreggiatura — e la seconda riceveva la stringa
  `rgb(...)` prodotta dalla prima. `parseInt` dava NaN, gli
  scorrimenti davano 0: teste, gambe e zaini di tutti e tredici i
  corpi. Nero è un colore plausibile per un robot, e nessuna
  rilettura l'avrebbe segnalato.
- **Otto corpi su tredici sbordavano dal fotogramma**, e sbordare non
  dà errore: il nemico si porta dietro un pezzo di sé girato da
  un'altra parte. I rotori dei volanti sembravano una barra continua
  invece di quattro bracci. Adesso lo impone un test.
- **I volanti riempivano un terzo del loro fotogramma.** Sensato
  pensando "tanto galleggia", sbagliato in pratica: `floatZ` li
  solleva già, e l'unico effetto era un Falco grande come un puntino
  con il segno del punto debole che galleggiava sopra il vuoto.
- **Il velo di fase dei boss tingeva anche il muro dietro.**
  `source-atop` compone contro *tutto* il canvas di destinazione, non
  contro l'ultima cosa disegnata, e a quel punto i muri sono già lì.
  Si risolve con un buffer grande quanto un fotogramma, dove il
  ritaglio è per costruzione.

**Due test guardano quello che nessuna rilettura vede**: che nessuna
scatola esca dal fotogramma, e che sotto ogni punto debole ci sia
davvero del corpo — se un archetipo ha la debolezza sulla testa e
nella banda alta non c'è nessuna scatola, si mira dove non c'è niente
da colpire. Entrambi hanno trovato difetti veri la prima volta che
sono stati eseguiti.

**L'economia dell'esperienza è stata ritarata.** Le taglie dei nemici
hanno quasi raddoppiato l'XP disponibile (da ~2000 a ~3800 per chi
esplora): con la vecchia tabella l'albero si riempiva entro la fine
dell'Atto II e chi tirava dritto arrivava comunque a 14 nodi su 14 —
le due cose che le invarianti 1b e 2b esistono apposta per impedire.
Adesso chi esplora sale 2 → 3 → 5 → 6 → 8 → 9 → 11 → 12 → 14, chi tira
dritto chiude a 11.

### Narrativa e finale

Il punto 4 della roadmap chiedeva «testi fra un livello e l'altro», ed
era l'ultima riga del GDD rimasta scoperta. Adesso ci sono tre battute
distinte, e la distinzione è deliberata:

1. **Le ultime parole di ARBITER**, durante l'abbattimento, sui
   sottotitoli. Il gioco è ancora vivo mentre le si legge.
2. **L'`outro` del livello**, che risponde al suo `intro`: lo chiude, o
   lo lascia peggio di come l'aveva trovato.
3. **La schermata d'atto**, che ferma il gioco. Per gli Atti I e II sta
   fra un atto e il successivo; per il III **è il finale della
   campagna**.

Sovrapporle sarebbe stato più semplice e avrebbe sprecato il momento:
tre notizie diverse dette insieme diventano una sola.

**Il finale.** Prima, abbattere ARBITER mostrava un pannello con
scritto «FINE DELL'ATTO III» e un riepilogo di statistiche — dopo nove
livelli e tre boss. Adesso chiude il motivo aperto dalla prima riga del
primo livello, «il registro è tutto ciò che mi resta»: nel finale non
parla ARBITER, che è già stato abbattuto, parla **il registro**, e
passa la penna al giocatore. Le statistiche restano, ma sotto il testo
e separate da un filo — è la differenza fra "qui c'è ancora un
riepilogo" e "il riepilogo *è* lo schermo".

**Una regola che vale per tutto il resto**: quando mostrarle e in che
ordine vive in `game/`, non nella simulazione. `CampaignWorld` non sa
che esista una schermata d'atto, ed è la stessa disciplina che regge il
passaggio di livello.

### Voce audio

La campagna prendeva in prestito i suoni dell'Arena, e in un punto il
codice lo ammetteva: lo scatto usava il suono del respawn perché «la
campagna non ha ancora una voce propria per questo gesto». Il colpo di
un nemico usava il *fucile del giocatore* — cioè il suono che dice
"hai sparato tu" per dire "ti hanno sparato". E la cosa più importante
non suonava affatto: **il colpo al punto debole era identico a quello
al corpo**, mentre vale sei volte tanto.

Adesso la campagna ha `audio/campaignVoice.ts`, istanza separata con il
suo contesto: `audio/engine.ts` è dell'Arena, che è multiplayer, e si
tocca il meno possibile. Il prezzo è che ciclo di vita e ascoltatore
vanno aggiornati due volte, e il prezzo è giusto.

Come per gli sprite, **niente file audio**: tutto sintetizzato, tabelle
di parametri come dati puri separati dal motore che li suona — che è
ciò che rende verificabile senza far suonare niente. Le distanze
misurate sulle coppie che devono essere inconfondibili: punto debole
contro corpo, 2,15× di frequenza di picco e quasi il doppio di
guadagno; piastra del Guardiano contro colpo andato a segno, 0,25× —
un tonfo che sta quattro volte più in basso. Sono le due lezioni che il
gioco deve insegnare senza scriverle.

Tre cose decise cablando, che le tabelle da sole non dicevano:

- **Chi colpisce toccando non spara.** Saldatore e Martello prendono un
  tonfo d'impatto, non il colpo a distanza: dargli lo stesso suono
  renderebbe illeggibile la differenza fra "mi ha inquadrato da
  lontano" e "mi è arrivato addosso".
- **Il sigillo di una porta si sente dalla porta**, non da dove stai
  tu. L'evento porta solo un id, ma il livello sa dove sta: in un
  corridoio con due paratie, sapere quale si è chiusa è mezza
  informazione tattica.
- **La gravità suona in entrambi i versi.** Il ripristino è un cambio
  di regole tanto quanto l'inversione, e sentirlo solo a metà lasciava
  il giocatore a indovinare quando poteva fidarsi di nuovo dei comandi.

**Un limite noto, dichiarato**: gravità invertita e ripristinata sono
due sweep incrociate con gli strati scambiati. Picco, guadagno e durata
sono per forza identici; quello che cambia è quale delle due parte per
prima, con venti millisecondi di scarto. È la distinzione più fragile
del set, e va ascoltata prima di darla per buona.

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
3. **ARBITER** (finale, 3 fasi) — corpo modulare. Le tre fasi non sono tre
   macchine nuove: sono le tre che il gioco ha già insegnato, rimesse in
   fila.

   1. **Moduli.** Quattro turret gli girano attorno, sfasate a quarti. Il
      corpo è intoccabile finché ne resta una viva. Sono turret vere, non
      una barriera con un altro nome: si abbattono come tutte le altre, e
      girare l'arena per spegnerle insegna lo spazio in cui si
      combatteranno le altre due fasi. È il corridoio a fuoco incrociato
      dell'Atto I, stavolta in cerchio.
   2. **Caccia.** La macchina della Sentinella, identica — non una copia:
      gira *lo stesso* metodo. Guardia, telegrafo, carica, cono
      posteriore. Il giocatore la riconosce e sa già cosa fare, che è
      esattamente il punto di un test finale.
   3. **Nucleo.** Il Custode: manipolazione, preavviso, finestra. Solo che
      qui mancare la finestra non costa una pausa — richiude il nucleo e
      riporta alla caccia. Non si perde vita, si perde il terreno
      guadagnato, che è l'unica posta che abbia senso alzare per un boss
      finale.

   `damageTaken` (il totale, quello che la HUD mostra) e il progresso di
   fase divergono ogni volta che una finestra viene mancata. È voluto: il
   primo dice quanto gli hai fatto, il secondo quanto ti manca *adesso*.

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
nessun punto resta senza un nodo su cui finire. La curva è tarata su chi
esplora e ripulisce, che guadagna qualcosa in ognuno dei nove livelli
(2 → 3 → 5 → 6 → 7 → 9 → 10 → 12 → 14) e arriva in fondo con l'albero
pieno; chi tira dritto chiude con 8 nodi su 14.

Quella differenza è il premio dell'esplorazione visto dall'altro lato, ed
è deliberato che una tabella sola non possa essere fitta in basso per chi
corre e larga in alto per chi cerca: chiedere a entrambi lo stesso ritmo
vorrebbe dire rinunciare al divario. Le due cose tirano in
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
4. Narrativa *(fatto)* — battute di ARBITER, outro per livello, tre
   schermate d'atto e il finale della campagna (sezione 4).
5. Atto II *(fatto)* — Il Nucleo Anulare, tre livelli e il Custode.
6. Atto III *(fatto)* — Il Nido di ARBITER, tre livelli e il boss finale.
7. Nemici mobili *(fatto)* — dieci archetipi su tre fasce, due o tre per
   livello, con punti deboli e vulnerabilità (sezione 4).
8. Sprite direzionali *(fatto)* — dieci nemici e tre boss, otto
   direzioni ciascuno, cotti in codice all'avvio (sezione 4).
9. Modalità Medio e Roguelike *(fatto)* — le fasi 2 e 3 previste dal
   briefing (sezione 9).
10. Finale, testi narrativi e voce audio della campagna *(fatto)* —
    sezione 4.

## 9. Decisioni dal briefing

- **Lunghezza:** 3 livelli + boss per atto (9 livelli + 3 boss totali). Si
  allunga solo se, dopo la verticale slice, il ritmo lo giustifica.
- **Skill tree:** il briefing aveva fissato *un ramo, 2-3 nodi* per la
  slice, ed è quello che lo Sprint 1 ha consegnato. Gli altri tre rami sono
  arrivati subito dopo, una volta che il loop reggeva: la decisione del
  briefing era sullo scope della prima iterazione, non un tetto.
- **Sprite:** solo su nemici/boss *(fatto — vedi sezione 4)*. I muri
  restano wireframe/texture procedurali come nell'Arena: è il tratto
  distintivo tecnico del gioco. Nemmeno gli sprite sono asset: si
  cuociono in codice all'avvio come le texture, e il repo resta senza
  un solo file binario.
- **Salvataggio:** profilo unico su `localStorage`, come le statistiche
  dell'Arena. Niente slot multipli.
- **Morte e difficoltà — tre modalità, costruite come fasi di sviluppo
  successive (non tutte necessariamente nel gioco finale, si valuta dopo
  aver provato la prima):**
  1. **Tutorial** *(fatta)* — respawn nell'ultima stanza raggiunta,
     nemici della stanza resettati, progressione/skill conservati.
  2. **Medio** *(fatta)* — respawn all'inizio del livello corrente, e si
     resetta **tutto** il livello: trabocchetti, nemici e boss, non solo
     quelli di una stanza.
  3. **Roguelike** *(fatta)* — morire fa ripartire l'intero atto corrente
     (3 livelli + boss): la posta si alza per chi cerca la sfida vera.

  **Tre decisioni che valgono per tutte e tre.**

  - **Il personaggio si conserva sempre**, Roguelike compreso: xp,
    livello, nodi. È coerente con `CampaignProfile`, che è
    deliberatamente *il personaggio, non la partita*.
  - **Morire non deve poter rifarmare esperienza.** In Roguelike i core
    già raccolti restano raccolti e le stanze già pagate restano pagate:
    se tornassero disponibili, morire diventerebbe un modo per
    guadagnare XP, e una modalità difficile che premia il morire è
    rotta. È la ragione per cui il riavvio d'atto porta avanti il
    profilo intero e cambia solo `levelId`.
  - **La simulazione dice, il controller costruisce.** `CampaignWorld`
    simula un livello per volta, quindi non può ricostruire un atto da
    sé: alla morte in Roguelike segnala `actRestart` e basta. È la
    stessa divisione che regge il passaggio di livello.

  **La difficoltà è del personaggio, non della sessione.** Il selettore
  nel menu vale solo per un profilo nuovo; un personaggio già avviato
  usa la propria. Cambiare le regole di morte a metà campagna
  contraddirebbe il punto sopra — e chi vuole cambiare modalità ha
  "azzera la progressione", che è la stessa cosa detta onestamente.

## 10. Stato della campagna (modalità Tutorial)

*Nato come "verticale slice": un livello solo, per validare il loop prima
di scriverne nove. Il loop ha retto, e la slice è diventata il primo dei
tre livelli dell'atto.*

**Stato: campagna completa.** Nove livelli concatenati in tre atti —
Attracco, Condotti, Molo · Anello Esterno, Condotte del Refrigerante,
Nucleo · Plancia, Archivio, Nido — raggiungibili da "CAMPAGNA (BETA)" nel
menu principale, con controlli touch oltre a tastiera/mouse, ottica e
progressione salvata in locale. Tutti e otto i trabocchetti della sezione
4 esistono, i tre boss hanno le loro fasi (sezione 5), ARBITER commenta il
run — nell'Atto II comincia a parlare al giocatore invece che catalogarlo,
nel III parla di sé — e lo skill tree ha due anelli: quattro rami,
quattordici nodi, quattro prerequisiti (sezione 6).

**Cosa ha retto e cosa no, atto per atto.** L'idea che un livello sia solo
un dato è stata messa alla prova due volte, e le due risposte sono
diverse in un modo istruttivo.

L'Atto II non ha richiesto una riga in `CampaignWorld` per i suoi tre
livelli: sono tre oggetti in `levels.ts`. Il codice l'hanno richiesto le
*meccaniche* nuove — passerelle, buio, gravità, il Custode — che è la
divisione che si voleva.

L'Atto III ha richiesto una modifica al modello: le stanze erano
intervalli di colonne, e quella semplificazione *era* la linearità.
Chiedere una geometria non lineare senza toccarla era impossibile. La
modifica è stata piccola e i sei livelli precedenti non sono cambiati,
ma vale la pena dirlo chiaro: l'astrazione reggeva finché i livelli si
somigliavano. Il primo che non somigliava agli altri ha trovato il punto
in cui il modello faceva un'assunzione invece di una descrizione.

ARBITER invece non ha richiesto niente di strutturale, ed era il test
vero: le sue tre fasi girano le macchine della Sentinella e del Custode,
non loro imitazioni. Se avesse dovuto riscriverle sarebbe stato il segno
che erano scritte male.

Obiettivo: un loop giocabile end-to-end, per validare le meccaniche prima di
scrivere tutto l'Atto I. Scope fissato dal briefing:

- **Livelli:** nove, di 3-5 stanze ciascuno (riuso del raycaster
  esistente, nessuna mappa enorme). Raggiungere l'uscita di un livello
  apre il successivo; l'ultimo livello di ogni atto finisce col boss
  invece che con un'uscita. I primi sei sono lineari, quelli dell'Atto III
  no: la Plancia si sale, l'Archivio si gira attorno.
- **Trabocchetti:** tutti e otto della sezione 4, distribuiti sui nove
  livelli. L'Atto III non ne aggiunge: li ricombina, che è quello che il
  GDD gli chiede. Se avesse avuto bisogno di una trappola inedita per
  essere interessante, vorrebbe dire che le otto precedenti non erano
  abbastanza.
- **Boss:** Sentinella del Molo (Atto I), Custode del Reattore (II),
  ARBITER (III). Vulnerabilità posizionale il primo, temporale il secondo,
  entrambe più i moduli il terzo (sezione 5).
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

---

## 11. Il Trasponditore (arma secondaria)

### Perché non è una seconda canna

Il gioco ha avuto per tutta la sua vita **un'arma sola**: il fucile a
otturatore, 1400 ms fra un colpo e l'altro. Non è una limitazione rimasta
lì per pigrizia, è la costante su cui è tarato tutto il resto — i tempi di
reazione dei nemici (650–950 ms) sono lunghi *perché* un colpo mancato
costa un secondo e mezzo di silenzio, e i punti deboli moltiplicano ×3
*perché* senza di loro un nemico da 4 HP sarebbe quattro colpi, cioè quasi
sei secondi fermi a sparare.

Aggiungere una seconda canna avrebbe voluto dire ritarare tutto questo. E
avrebbe scavalcato il sistema costruito nella sezione 4: punto debole ×3,
vulnerabilità ×2, colpo perfetto ×6. Un'arma che uccide compete col
fucile; un'arma che **crea le condizioni** che quel sistema già premia lo
moltiplica.

### Cosa fa

Si pianta un identificativo rubato — le macchine di ARBITER si riconoscono
per segnale, ed è la finzione che il *registro* apre fin dal primo livello.
Per 2600 ms quel punto del pavimento è più il giocatore del giocatore: chi
lo vede si volta verso di esso, cioè **mostra la schiena**, che è dove il
moltiplicatore del punto debole vive già.

Non fa un solo punto di danno.

| | |
|---|---|
| Tasto | `F` (da telefono, il pulsante ESCA) |
| Tiro | hitscan lungo la mira, si pianta sul primo muro o a 6 tile |
| Raggio del richiamo | 5 tile, **con linea di vista**: non si insegue un segnale che non si vede |
| Durata | 2600 ms |
| Cariche | 2 a inizio livello, tetto 3, altre se ne raccolgono per terra |
| Costo | 1 carica **più il tempo di un colpo** |

### L'aritmetica che lo tiene onesto

Lanciare mette l'arma in ricarica come se si fosse sparato: **si hanno due
mani sole**. Da lì discende tutto, e `balance:campaign` lo ricalcola invece
di crederci sulla parola:

```
lancio a 0 ms  →  fucile pronto a 1400  →  secondo colpo a 2800
```

A 2600 ms il secondo colpo cade **fuori** dalla finestra. Un'esca vale
esattamente un colpo — e sono l'aritmetica e non una regola scritta a parte
a impedire che il Trasponditore sia un interruttore che spegne il
Guardiano. Con Otturatore Rapido (1150 ms) i colpi diventano due, ed è
voluto: è il ramo Precisione che si ripaga su un'arma che non è il fucile.

Il conto, misurato:

| nemico | di fronte | alla schiena | esche (base / Otturatore) |
|---|---|---|---|
| Guardiano | **mai** | 2 colpi | 2 / 1 |
| Martello | 5 colpi | 2 colpi, **1 se carica** (×6) | 2 / 1 |
| Vedetta | 2 colpi | 1 colpo | 1 / 1 |

Il Guardiano è il caso che giustifica l'arma: immune di fronte, e con la
sola arma base **un'esca non basta** a chiuderlo. Apre una possibilità,
non spegne un nemico.

### Cosa fa a ciascun archetipo — tutto emergente

Nessuno di questi effetti è scritto da qualche parte: sono conseguenze del
cambiare bersaglio a un'IA che esisteva già.

- **Guardiano** — si volta. L'unico modo affidabile di aprirlo dove non
  c'è una via per aggirarlo.
- **Martello** — carica *l'esca*, e mentre avanza è `scoperto`: schiena ×3
  per scoperto ×2 fa ×6, cioè un colpo solo.
- **Crogiolo** — lo si tira via e lo si uccide dove la sua nube non
  chiude la strada. L'esca come attrezzo di pulizia.
- **Archivista** — le scorte escono dalla bolla dei 5 tile e tornano a
  incassare danno pieno invece di 0.4×.
- **Ripetitore** — smette di arretrare.
- **Chiunque venga richiamato** apre comunque le bocchette quando "spara"
  all'esca, quindi la vulnerabilità `sfiatato` diventa sfruttabile. È una
  conseguenza, non una funzione: nessuno l'ha progettata.
- **Araldo** — **niente**. Buco lasciato apposta: il nemico più tardo
  della campagna resta un problema aperto anche a chi ha comprato tutto,
  finché non prende il nodo Eco.

Un nemico richiamato non fa male al giocatore — né a contatto, né con la
carica, né a distanza. Sta sparando all'esca.

## 12. Terzo anello dello skill tree (Atto III)

L'albero aveva due anelli: il primo aperto dall'Atto I, il secondo
dall'Atto II. **L'Atto III non apriva niente** — l'albero smetteva di
crescere esattamente dove il gioco diventa più duro, e si riempiva tutto
entro il secondo atto.

- **Scatto Angolare** (Mobilità, dietro Scatto) — lo scatto si può
  sterzare mentre è in corso, ~0.1 rad/tick, cioè circa sessanta gradi in
  tutto. È abbastanza per girare attorno a un nemico e finirgli dietro —
  che è il solo motivo per cui esiste — e non abbastanza per invertire la
  rotta, il che renderebbe lo scatto una corsa sterzabile invece di uno
  strappo da puntare prima. È l'unico nodo di movimento che si paga in
  danno invece che in metri.
- **Piastra Reattiva** (Sopravvivenza, dietro Piastra Aggiuntiva) — quando
  lo scudo assorbe un colpo, il fucile torna pronto all'istante. Ribalta il
  momento peggiore del gioco: incassare smetteva di essere solo una
  perdita e paga la finestra che l'attaccante ha appena aperto su di sé.
  È difesa scritta nell'unica valuta che questo gioco abbia, il tempo fra
  due colpi.
- **Eco** (Percezione, dietro Sensori Inerziali) — l'esca svela anche chi
  si occulta. Sta in Percezione e non fra i nodi dell'arma perché quello
  che fa è *vedere*.

### Diciassette nodi, quattordici punti

`LEVEL_XP_THRESHOLDS` **non** è stata alzata, ed è la decisione, non una
dimenticanza. Finché i punti bastavano per ogni nodo, l'albero era una
lista della spesa che si riempiva da sola entro l'Atto II — difetto già
corretto una volta ritarando le soglie. Tre nodi che non si possono avere
sono ciò che trasforma una lista in una build, e una seconda partita in una
partita diversa.

L'invariante è sorvegliata da un test: i punti devono coprire **esattamente**
i primi due anelli, e i tre id del terzo devono esistere davvero. Se un
giorno qualcuno alzasse la tabella per "finire l'albero", è quella riga a
fermarlo.

---

## 13. Sviluppi futuri (da valutare, non pianificati)

Idee raccolte ma **non** progettate né messe in roadmap. Stanno qui perché
un'idea dimenticata costa più di una riga di documento, non perché siano
state approvate.

### Un negozio

Una spesa che non sia l'albero. L'albero è progressione permanente e
irreversibile per scelta (vedi sezione 6); un negozio sarebbe l'altra metà —
consumabili, cariche di Trasponditore, scudi — comprati con una valuta che
si perde alla morte. La domanda aperta non è come farlo, è **con quale
valuta**: l'XP paga già i nodi, e una moneta che paga due cose diverse
finisce per rendere obbligatoria la più forte delle due.

### Ricompense dai boss, per le modalità avanzate

Abbattere un boss oggi paga XP e basta, uguale in tutte e tre le modalità.
In Medio e soprattutto in Roguelike — dove la morte costa l'atto intero —
un boss potrebbe lasciare qualcosa che vale il rischio: una carica in più
di scudo per l'atto successivo, un nodo prestato fino alla fine del run,
una scorta di Trasponditore.

La cautela da tenere presente: una ricompensa che rende *più facile* il
seguito toglie proprio la tensione che la Roguelike esiste per creare. Se
si fa, probabilmente va nella direzione opposta — una ricompensa che apre
una **possibilità** invece di alzare una statistica.

---

### Cosa dicono le misure (revisione del 17 settembre)

Le due idee qui sopra restano non progettate. Quello che segue non è un
progetto: sono le cifre che un progetto dovrà rispettare, misurate sul
codice invece che stimate. Le ricalcola `balance:campaign` e i test.

**Non esiste XP di scorta.** Chi ripulisce tutto chiude la campagna con
3830 XP; la soglia del quattordicesimo punto è 3750. Il margine è di 80
XP — il due per cento. Il quattordicesimo punto non arriva a fine gioco:
arriva *dentro* lo scontro con ARBITER. Un negozio che spendesse "quello
che avanza" non avrebbe niente da spendere. Le due strade praticabili
sono quindi una valuta propria (che vuole drop, HUD, piazzamento nei
livelli: superficie vera) oppure il punto abilità stesso — l'unica cosa
in questo gioco che sia già scarsa.

**L'albero converge.** A quattordici punti su diciassette nodi esistono
157 build legali, ma due giocatori qualsiasi ne condividono in media
l'84%. Nessun nodo viene davvero sacrificato: il più scartato, Eco, resta
comunque preso nel 69% delle build. Con quattordici punti si completano
tre rami interi su quattro — "essere un giocatore di mobilità" non è una
scelta disponibile, perché si è tutti e quattro i rami.

**La varietà ha un massimo, ed è a metà strada.** Le build legali sono
1522 a nove punti (60% di sovrapposizione) e scendono a 157 a quattordici
(84%). Il punto più alto della curva — nove punti — cade esattamente alla
fine del Nucleo, cioè alla fine dell'Atto II. Il personaggio è più sé
stesso lì che alla fine.

**L'inversione.** Chi tira dritto chiude la campagna con sette punti:
1217 build possibili, 50% di sovrapposizione. Chi ripulisce tutto ne ha
quattordici: 157 build, 84%. Esplorare ogni stanza rende il personaggio
*meno* riconoscibile, non più. È il contrario di quello che la
progressione promette.

**Nessuno dei diciassette nodi costa niente.** Sono tutti guadagno puro.
Non c'è un solo compromesso nell'albero — ed è la cosa che un negozio, o
una ricompensa da boss, potrebbe portare senza aggiungere una riga di
economia.

**`unlockedNodes` non può ospitare gli acquisti.** Al caricamento del
profilo `completedLevels` e `roomsAwarded` vengono filtrate contro gli id
noti; `unlockedNodes` no, e `pointsSpent` fa costare zero un id
sconosciuto. È deliberato e giusto: un profilo salvato da una versione
precedente può contenere un nodo che non esiste più, e farlo costare
infinito bloccherebbe l'albero di quel giocatore per sempre. Ma la stessa
permissività, applicata a un acquisto, regalerebbe l'acquisto. Gli
acquisti vogliono una lista propria, con la sua validazione.

**La cucitura per innestarli esiste già.** Ogni effetto dell'albero passa
per le funzioni pure di `skills.ts`, e i ventiquattro punti di chiamata
hanno tutti la stessa forma: `fn(state.unlockedNodes)`. Qualunque cosa
modifichi le capacità del giocatore dovrebbe entrare da lì e non da
`world.ts`, che è già il file più grande della campagna.

**Il momento esiste già.** `beginActBreak` mette in pausa fra un atto e
l'altro, salva il profilo e mostra una schermata. Sono due occasioni per
run — dopo la Sentinella e dopo il Custode — e coincidono con due dei tre
boss. Negozio e ricompensa da boss sono lo stesso istante, non due
sistemi.

**In Roguelike la morte riavvia l'atto, non la campagna.** Una ricompensa
permanente presa nell'Atto I sopravvive quindi a ogni morte successiva:
è un cricchetto che sale e non scende mai. È la ragione meccanica —
non solo estetica — della cautela già scritta sopra. Distinguere
*margine* (piastre, invulnerabilità: riducono il costo di un errore) da
*opzioni* (una carica d'esca in più, un lancio nuovo: non allungano la
vita, allargano le risposte) dà una regola verificabile invece di un
gusto.

**L'Arena è intatta, ma per disciplina e non per costruzione.** Confronto
file per file fra questo repo e `arena-boom-shooter` al suo HEAD pulito
(022e384): il cuore della simulazione multigiocatore è identico byte per
byte — `sim/constants.ts`, `sim/world.ts`, `sim/bots.ts`, `sim/sim.test.ts`,
`render/scene.ts`, `render/particles.ts`, `net/session.ts`, `net/net.test.ts`,
`audio/engine.ts`, `tools/balance.mts`. Differiscono solo il guscio
(`App.tsx` +79/−6, `Screens.tsx` +51/−0, `ui.css` +418/−0: tutte aggiunte
per la campagna) e un solo file di gioco, `render/overlay.ts`, dove
`renderScope` è passata da leggere un `Entity` a ricevere un
`{cooldownMs, maxCooldownMs}`. Il chiamante Arena passa esattamente i
valori che la funzione calcolava da sé: comportamento invariato,
interfaccia allargata per riuso.

La cosa da sapere è che **questo non è un fork git ma una copia**: le due
storie non hanno un antenato comune, quindi niente fa fluire una correzione
dall'uno all'altro. Sono già divergenti in un punto, e la divergenza è un
miglioramento che l'Arena *non* ha. Finché la campagna resta il solo ramo
vivo non è un problema; il giorno in cui si toccasse anche l'Arena,
riportare a mano quella firma sarebbe la prima cosa da fare.

**Il file rischioso non è quello grosso.** `world.ts` è il file più grande
della campagna — 1880 righe — ma ha **un solo import esterno**
(`sim/constants.ts`): tutto il resto viene da dentro `campaign/`. È grande
e isolato, e le sue quattro superfici pubbliche (`step`, `toProfile`,
`tryUnlockNode`, `getTile`) sono tutte chiamate direttamente da un test.

Il file da tenere d'occhio è `campaignGame.ts`. Ha **undici import
esterni** — è il vero punto di giunzione fra simulazione, scena, audio,
HUD e salvataggio — è cresciuto del **17,6% della sua dimensione attuale
negli ultimi otto commit** (la crescita relativa più alta dopo `types.ts`,
e in righe nette quasi quanto `world.ts`: +234 contro +238 nella stessa
finestra), e ha **zero test diretti**: la suite gira senza jsdom e la
classe usa `canvas` e `document`.

È anche, per costruzione, il file in cui vivrebbe la schermata di un
negozio. Chi lo tocca lavora senza rete. Le due risposte possibili sono
aggiungere jsdom alla suite, oppure continuare con lo schema già usato per
`campaignNarrative.ts`: estrarre la logica in funzioni pure testabili e
lasciare nella classe solo l'innesto sul DOM. La seconda è coerente con
quello che il progetto fa già, e non costa una dipendenza.

L'accoppiamento è comunque a senso unico e verificato: **nessun file
dell'arena importa niente dalla campagna**, in nessun punto. Sette moduli
sono condivisi dai due lati, e tre di questi (`sim/constants.ts`,
`sim/raycast.ts`, `render/scene.ts`) sono nella lista da non toccare:
sono quelli su cui una modifica per la campagna diventa automaticamente
una modifica all'arena.
