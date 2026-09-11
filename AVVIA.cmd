@echo off
setlocal enabledelayedexpansion
title Arena Sniper
cd /d "%~dp0"

rem ================================================================
rem  Avvia il gioco in modalita' completa (singolo giocatore + online)
rem  Doppio click su questo file. Per chiudere: chiudi questa finestra.
rem ================================================================

rem Versione di Node usata dal progetto, e l'impronta che nodejs.org
rem pubblica per il suo pacchetto Windows. Cambiando versione vanno
rem cambiate tutte e due: https://nodejs.org/dist/vXX.YY.ZZ/SHASUMS256.txt
rem
rem NODE_HOME e' di proposito una delle cartelle che la ricerca qui
rem sotto gia' controlla: cosi' la strada del "gia' installato" e quella
rem dello "scaricato adesso" finiscono nello stesso posto, e al secondo
rem avvio non c'e' piu' niente da scaricare.
set "NODE_VER=24.18.0"
set "NODE_PKG=node-v%NODE_VER%-win-x64"
set "NODE_SHA=0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821"
if not defined NODE_ROOT set "NODE_ROOT=%USERPROFILE%\tools"
set "NODE_HOME=%NODE_ROOT%\%NODE_PKG%"

rem Node normalmente e' nel PATH. Se non lo e' (finestra aperta prima
rem dell'installazione, oppure Node installato in modalita' portable)
rem cerchiamo le posizioni consuete prima di arrendersi. Niente percorsi
rem legati a un singolo computer: questo file deve funzionare anche a
rem chi scarica il progetto.
where node >nul 2>&1
if errorlevel 1 (
  set "NODE_FOUND="
  rem Nota: nessun percorso con parentesi nel nome della variabile
  rem (tipo ProgramFiles^(x86^)): dentro un blocco cmd le rompe.
  for %%d in (
    "%ProgramFiles%\nodejs"
    "%LOCALAPPDATA%\Programs\nodejs"
    "%NODE_HOME%"
  ) do (
    if not defined NODE_FOUND if exist "%%~d\node.exe" (
      set "PATH=%%~d;%PATH%"
      set "NODE_FOUND=1"
    )
  )
  rem Ultima possibilita': una cartella node-* dentro NODE_ROOT, cosi'
  rem viene trovata anche una versione diversa da quella qui sopra.
  if not defined NODE_FOUND (
    for /d %%d in ("%NODE_ROOT%\node-*") do (
      if not defined NODE_FOUND if exist "%%~d\node.exe" (
        set "PATH=%%~d;%PATH%"
        set "NODE_FOUND=1"
      )
    )
  )
  if not defined NODE_FOUND (
    echo.
    echo  [i] Node.js non c'e' su questo computer.
    echo.
    echo      Serve solo per le partite ONLINE. Per giocare contro i bot
    echo      non serve niente: chiudi questa finestra e fai doppio click
    echo      su  docs\index.html  ^(funziona anche senza rete^).
    echo.
    echo      Altrimenti posso procurarmelo da solo: scarico da
    echo      nodejs.org la versione portable ^(37 MB^) e la estraggo in
    echo        %NODE_HOME%
    echo      Non tocca il resto del sistema e non chiede permessi di
    echo      amministratore. Per disfare tutto: cancella quella cartella.
    echo.
    rem Si prosegue solo su una S esplicita: choice restituisce 0 se
    rem viene interrotto, e un Ctrl+C non deve valere come un si'.
    choice /c SN /m "Vuoi che lo scarichi ora"
    if not !errorlevel! equ 1 (
      rem Con un doppio click la finestra sparisce appena il file
      rem finisce, quindi senza questa pausa il suggerimento qui sopra
      rem lampeggia e se ne va prima che si possa leggerlo.
      echo.
      echo      Va bene. Per giocare subito contro i bot apri:
      echo        %~dp0docs\index.html
      echo.
      pause
      exit /b 1
    )
    call :fetch_node
    if errorlevel 1 (
      echo.
      echo  [X] Non sono riuscito a procurarmi Node.
      echo      Puoi installarlo a mano da https://nodejs.org ^(versione 20
      echo      o superiore^), oppure giocare subito senza installare nulla
      echo      aprendo:  docs\index.html
      echo.
      pause
      exit /b 1
    )
  )
)

rem pnpm arriva con Node tramite corepack, ma va abilitato una volta.
where pnpm >nul 2>&1
if errorlevel 1 (
  echo  [i] Abilito pnpm tramite corepack...
  call corepack enable >nul 2>&1
)

rem Una porta occupata fa fallire Vite ^(strictPort^). Meglio dirlo
rem subito che mostrare uno stack trace.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":5173 "') do (
  echo.
  echo  [!] La porta 5173 e' gia' occupata dal processo %%p.
  echo      Probabilmente un server avviato in precedenza e' rimasto attivo.
  echo.
  choice /c SN /m "Vuoi chiuderlo e continuare"
  if !errorlevel! equ 1 (
    taskkill /f /pid %%p >nul 2>&1
    echo      Chiuso. Proseguo.
    timeout /t 1 /nobreak >nul
  ) else (
    exit /b 1
  )
)

if not exist "node_modules" (
  echo.
  echo  [i] Dipendenze mancanti. Le installo ^(solo la prima volta^)...
  call pnpm install
  if errorlevel 1 (
    echo  [X] Installazione fallita.
    pause
    exit /b 1
  )
)

rem Il server di signaling gira dal bundle compilato.
if not exist "artifacts\api-server\dist\index.mjs" (
  echo  [i] Compilo il server...
  call pnpm --filter @workspace/api-server run build >nul
)

echo.
echo  Avvio del server ^(partite online^)...
start "Arena Sniper - server" /min cmd /c "cd /d "%~dp0artifacts\api-server" && set PORT=5000 && node dist\index.mjs"

rem Il gioco e' sulla 5173 e il server sulla 5000: due origini diverse,
rem quindi il signaling va indicato esplicitamente.
set "VITE_SIGNAL_URL=ws://localhost:5000/ws"

echo  Avvio del gioco...
start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:5173"

echo.
echo  ================================================
echo    Il gioco si aprira' nel browser tra pochi
echo    secondi su http://localhost:5173
echo.
echo    Per uscire: chiudi questa finestra.
echo  ================================================
echo.

call pnpm --filter @workspace/arena-shooter run dev

rem Se Vite termina, chiudiamo anche il server per non lasciarlo appeso.
echo.
echo  Arresto del server...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":5000 "') do taskkill /f /pid %%p >nul 2>&1
echo  Fatto.
timeout /t 2 /nobreak >nul
exit /b 0

rem ================================================================
rem  :fetch_node - scarica Node portable e lo estrae in %NODE_HOME%
rem ================================================================
rem  Serve curl e tar, che Windows ha dentro dal 2018 (build 1803):
rem  quindi per installare Node non c'e' niente da installare prima.
rem  Il pacchetto e' uno zip, non un installer, e finisce nel profilo
rem  utente: nessuna chiave di registro, nessun elevamento, nessuna
rem  modifica al PATH di sistema. Il PATH allargato qui sotto vive
rem  solo dentro questa finestra.
rem ================================================================
:fetch_node
where curl >nul 2>&1
if errorlevel 1 (
  echo  [X] curl non e' disponibile: serve Windows 10 build 1803 o piu' recente.
  exit /b 1
)
where tar >nul 2>&1
if errorlevel 1 (
  echo  [X] tar non e' disponibile: serve Windows 10 build 1803 o piu' recente.
  exit /b 1
)
if /i not "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
  echo  [X] Questo automatismo copre solo Windows 64 bit su Intel/AMD,
  echo      e qui l'architettura e' %PROCESSOR_ARCHITECTURE%.
  exit /b 1
)

set "NODE_TMP=%TEMP%\%NODE_PKG%.zip"
echo.
echo  [i] Scarico Node %NODE_VER% ^(37 MB^)...
curl -fL --progress-bar -o "%NODE_TMP%" "https://nodejs.org/dist/v%NODE_VER%/%NODE_PKG%.zip"
if errorlevel 1 (
  echo  [X] Download fallito. Sei connesso a Internet?
  del /q "%NODE_TMP%" >nul 2>&1
  exit /b 1
)

rem Un eseguibile scaricato si verifica prima di lanciarlo. HTTPS dice
rem da dove arriva il file, non che sia arrivato integro: questa e'
rem l'impronta che nodejs.org pubblica per questa versione esatta.
echo  [i] Verifico l'impronta...
set "NODE_GOT="
for /f "skip=1 tokens=1" %%h in ('certutil -hashfile "%NODE_TMP%" SHA256') do (
  if not defined NODE_GOT set "NODE_GOT=%%h"
)
if /i not "!NODE_GOT!"=="%NODE_SHA%" (
  echo  [X] L'impronta non corrisponde. Il file e' incompleto o alterato,
  echo      quindi non lo uso.
  echo        attesa:  %NODE_SHA%
  echo        trovata: !NODE_GOT!
  del /q "%NODE_TMP%" >nul 2>&1
  exit /b 1
)

echo  [i] Estraggo...
if not exist "%NODE_ROOT%" mkdir "%NODE_ROOT%"
tar -xf "%NODE_TMP%" -C "%NODE_ROOT%"
if errorlevel 1 (
  echo  [X] Estrazione fallita.
  exit /b 1
)
del /q "%NODE_TMP%" >nul 2>&1

if not exist "%NODE_HOME%\node.exe" (
  echo  [X] Estratto, ma node.exe non e' dove dovrebbe: %NODE_HOME%
  exit /b 1
)
set "PATH=%NODE_HOME%;%PATH%"
echo  [i] Node %NODE_VER% pronto. Al prossimo avvio lo trovo da solo.
echo.
exit /b 0
