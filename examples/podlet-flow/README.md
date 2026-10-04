# podlet-flow

Diagramme de flux Podlet rendu comme overlay SVG sur un terminal filmé (thème LICHEN, variante sombre).

## Ce que montre la pièce (6 beats, 12 s)
1. **0–2.2 s** — le bandeau URL tombe en haut du cadre, l'ID `a1b2c3d4` s'écrit lettre par lettre puis reçoit le tampon feuille (+ halo soleil respirant).
2. **2.2–3.3 s** — le chip d'ID naît, voyage vers l'arborescence et est « absorbé » par le futur nœud racine.
3. **3.3–6.1 s** — l'arborescence `.podlet/Artifacts/<ID>/` se construit en cascade (connecteurs `draw`, nœuds carrés, cartes leaf-wash posées de travers) avec ses 3 feuilles.
4. **6.1–7.6 s** — le dossier `code/` tombe, l'ombre claque à l'impact, onde carrée ink.
5. **7.6–10.2 s** — l'icône agent entre par la droite, la tige leaf pointillée se dessine segment par segment, la prise s'emboîte, tampon ↔ halo répondent.
6. **10.2–12 s** — mini-branche GitHub : bouton PUBLIC plein (clonable) vs branche PRIVÉE dashed, cadenas et barre d'invalidation ; gel final.

## Thème LICHEN
Jetons : paper `#140d05` (panneaux `rgba(20,13,5,0.72)`), ink `#faf5e8` (traits 2px, ombres dures 6/6/0), soft `#bfb39d`, accent unique leaf `#b4dd88`, surfaces leaf-wash `#1d2714`, halo soleil `rgba(255,190,100,…)`. **rx = 0** partout (brutalisme LICHEN), bordures 2px ink pleines, IBM Plex Mono pour ~85 % du texte, Fraunces italique uniquement pour l'ID et la caption. Deux voix : **MUR** (snaps ≤ 0.25 s — bordures, tampons, badges, pops) et **TEMPS** (drifts easeOutCubic 0.5–1.2 s — voyages, settle rotates, halos, motes). Les couleurs n'étant pas animables en SVG, chaque « illumination » est une variante pré-dessinée crossfadée en ≤ 0.08 s.

## Vérification
```bash
node tools/render.mjs examples/podlet-flow --check
```

## Export
Cible : **webm alpha** (superposition Kdenlive) ; fallback mp4 sur fond plein. PNG statique 1920×1080 fond transparent.
