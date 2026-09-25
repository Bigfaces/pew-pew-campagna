// ================================================================
// PARTICLES — il pool, non il disegno
// ================================================================
// ParticleSystem è rimasto un modulo mai importato dal giorno del fork
// (docs/ROADMAP.md, voce D2): questi test provano la parte pura — pool
// fisso, emissione, vita, azzeramento — indipendentemente dal canvas.
// Il disegno vero e proprio, e la sua occlusione contro i muri, hanno
// il loro test a parte (render/particlesRender.test.ts), sul modello
// di render/campaignRender.test.ts: un mock di canvas serve solo lì.
// ================================================================

import { describe, expect, it } from 'vitest';

import { ParticleSystem } from './particles';

/** Il pool non cresce mai: 900 posti a costruzione, 900 per sempre —
 *  è la costante MAX_PARTICLES del modulo, ridichiarata qui apposta
 *  (vedi src/render/sprites.test.ts per lo stesso principio: se cambia
 *  di là e non di qua il test lo segnala). */
const MAX_PARTICLES = 900;

/** Avanza il tempo reale di `ms`, un passo di 50ms alla volta:
 *  `ParticleSystem.update` limita ogni chiamata a 50ms di simulazione
 *  (vedi il commento sul metodo), quindi un singolo `update(2000)` non
 *  fa avanzare la vita di una particella di due secondi — ne fa
 *  avanzare solo 50ms, esattamente come un frame lentissimo non deve
 *  far sparire mezzo secondo di gioco in un colpo. Un test che vuole
 *  simulare tempo reale deve ripetere la chiamata come farebbe il
 *  loop vero. */
function advance(ps: ParticleSystem, ms: number): void {
  for (let done = 0; done < ms; done += 50) ps.update(50);
}

describe('ParticleSystem — il pool', () => {
  it('nasce con 900 posti, tutti spenti', () => {
    const ps = new ParticleSystem();
    expect(ps.all.length).toBe(MAX_PARTICLES);
    expect(ps.all.every((p) => !p.active)).toBe(true);
  });

  it('ogni emettitore accende esattamente il numero di particelle che dichiara', () => {
    // Uno per emettitore, per non far dipendere il conteggio da un
    // singolo campione: bulletImpact e sparks(weakSpot) fanno due
    // emit() distinte (scintille + fumo, corpo + punto debole diverso
    // per conteggio), quindi il totale non è un solo `count`.
    const casi: [string, (ps: ParticleSystem) => void, number][] = [
      ['muzzle', (ps) => ps.muzzle(0, 0, 0), 8],
      ['bulletImpact', (ps) => ps.bulletImpact(0, 0, 0), 12 + 5],
      ['sparks (corpo)', (ps) => ps.sparks(0, 0, false), 15],
      ['sparks (punto debole)', (ps) => ps.sparks(0, 0, true), 26],
      ['plateDeflect', (ps) => ps.plateDeflect(0, 0), 7],
      ['shieldShatter', (ps) => ps.shieldShatter(0, 0), 20],
      ['pickup', (ps) => ps.pickup(0, 0, [255, 255, 255]), 16],
      ['spawnBurst', (ps) => ps.spawnBurst(0, 0), 18],
    ];
    for (const [nome, emetti, atteso] of casi) {
      const ps = new ParticleSystem();
      emetti(ps);
      const accese = ps.all.filter((p) => p.active).length;
      expect(accese, nome).toBe(atteso);
    }
  });

  it('il punto debole illumina più particelle del colpo al corpo, non meno', () => {
    // È la lettura che campaignGame.ts chiede a sparks(): il colpo che
    // vale sei volte l'altro (enemyHit in world.ts) deve anche
    // sembrare di più, non identico.
    const corpo = new ParticleSystem();
    corpo.sparks(0, 0, false);
    const debole = new ParticleSystem();
    debole.sparks(0, 0, true);
    expect(debole.all.filter((p) => p.active).length).toBeGreaterThan(
      corpo.all.filter((p) => p.active).length,
    );
  });

  it('una particella nata ha posizione finita e vita piena', () => {
    const ps = new ParticleSystem();
    ps.bulletImpact(123, -45, 1.7);
    const attive = ps.all.filter((p) => p.active);
    expect(attive.length).toBeGreaterThan(0);
    for (const p of attive) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.life).toBe(p.maxLife);
      expect(p.life).toBeGreaterThan(0);
    }
  });

  it('la vita scende col tempo reale e la particella si spegne da sola', () => {
    const ps = new ParticleSystem();
    ps.muzzle(0, 0, 0); // la vita più corta del modulo: 0.06–0.16s
    expect(ps.all.some((p) => p.active)).toBe(true);
    advance(ps, 300); // ben oltre 0.16s
    expect(ps.all.some((p) => p.active)).toBe(false);
  });

  it('nessuna particella resta attiva oltre la propria vita massima, qualunque emettitore', () => {
    const ps = new ParticleSystem();
    ps.muzzle(0, 0, 0);
    ps.bulletImpact(0, 0, 0);
    ps.sparks(0, 0, true);
    ps.sparks(0, 0, false);
    ps.plateDeflect(0, 0);
    ps.shieldShatter(0, 0);
    ps.pickup(0, 0, [255, 255, 255]);
    ps.spawnBurst(0, 0);
    expect(ps.all.some((p) => p.active)).toBe(true);

    // La vita più lunga di tutto il modulo è il fumo di bulletImpact,
    // 0.8s: un secondo abbondante di tempo reale basta e avanza.
    advance(ps, 1000);
    expect(ps.all.some((p) => p.active)).toBe(false);
  });

  it('il pool non cresce oltre il massimo anche spawnando molto più del limite', () => {
    const ps = new ParticleSystem();
    // 400 raffiche di bulletImpact (17 particelle l'una) fanno 6800
    // richieste contro un pool da 900: se il pool crescesse per farle
    // stare tutte, `all.length` lo tradirebbe.
    for (let i = 0; i < 400; i++) ps.bulletImpact(i, i, 0);
    expect(ps.all.length).toBe(MAX_PARTICLES);
    expect(ps.all.filter((p) => p.active).length).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  it('quando il pool è saturo il cursore ricicla la posizione più vecchia, non la scarta', () => {
    const ps = new ParticleSystem();
    // Esattamente il pool pieno, poi una particella in più: la nuova
    // deve prendere il posto della prima (cursore che gira), quindi il
    // conteggio di attive resta 900 — non 899 per lo slot scartato, non
    // 901 perché il pool è cresciuto.
    for (let i = 0; i < MAX_PARTICLES; i++) ps.pickup(i, i, [255, 255, 255]);
    expect(ps.all.filter((p) => p.active).length).toBe(MAX_PARTICLES);
    ps.pickup(9999, 9999, [255, 255, 255]);
    expect(ps.all.length).toBe(MAX_PARTICLES);
    expect(ps.all.filter((p) => p.active).length).toBe(MAX_PARTICLES);
  });

  it('clear() spegne tutto, anche a metà vita', () => {
    const ps = new ParticleSystem();
    ps.shieldShatter(0, 0);
    expect(ps.all.some((p) => p.active)).toBe(true);
    ps.clear();
    expect(ps.all.every((p) => !p.active)).toBe(true);
  });
});
