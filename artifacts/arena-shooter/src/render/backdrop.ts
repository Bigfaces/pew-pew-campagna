// ================================================================
// BACKDROP — cielo e pavimento
// ================================================================
// Estratto dal vecchio modulo di scena dell'Arena quando quel file è
// stato rimosso insieme a lei: era l'unica funzione di lì che la
// campagna usava ancora (il resto — muri, billboard, sprite
// dell'Arena — se n'è andato con lui). Vive per conto suo perché non
// ha nulla a che fare con la proiezione dei raggi: disegna solo le
// due strisce sopra e sotto l'orizzonte.
// ================================================================

import type { CameraFx, Viewport } from './camera';
import { horizonY } from './camera';
import { getTextures } from './textures';

/** Ceiling and floor, drawn as two stretched gradient strips. */
export function renderBackdrop(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  fx: CameraFx,
): void {
  const tex = getTextures();
  const hy = horizonY(vp, fx);

  ctx.fillStyle = '#0b0c14';
  ctx.fillRect(0, 0, vp.width, vp.height);

  // The horizon moves with pitch, so the strips are drawn to fill
  // whatever space is above and below it rather than fixed halves.
  if (tex.sky && hy > 0) {
    ctx.drawImage(tex.sky, 0, 0, 1, tex.sky.height, 0, 0, vp.width, hy);
  }
  if (tex.ground && hy < vp.height) {
    ctx.drawImage(
      tex.ground,
      0,
      0,
      1,
      tex.ground.height,
      0,
      hy,
      vp.width,
      vp.height - hy,
    );
  }
}
