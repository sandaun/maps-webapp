## Descripció

<!-- 1-2 frases: què canvia i per què. -->

## Tipus de canvi

<!-- Marca el que correspongui. El tipus del commit determina el bump de versió que farà release-please. -->

- [ ] `feat` — nova funcionalitat (**minor**)
- [ ] `fix` — correcció d'un bug (**patch**)
- [ ] `perf` — millora de rendiment (**patch**)
- [ ] `refactor` — canvi intern sense canvi de comportament (**cap bump**)
- [ ] `chore` — manteniment, dependències, tooling (**patch**)
- [ ] `docs` — només documentació (**cap bump**)
- [ ] `ci` — només configuració de CI (**cap bump**)

## Breaking change

<!-- Esborra aquesta secció si no n'hi ha cap.
     Si n'hi ha, el commit ha de portar `!` (p. ex. `feat!:`) o un footer `BREAKING CHANGE:`. -->

**Què es trenca:**

**Acció requerida al desplegar:**

<!-- Migracions, variables d'entorn noves, dades a regenerar, ordre de desplegament... -->

## Checklist

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Els commits segueixen conventional commits (el hook `commit-msg` ho valida)
- [ ] La branca base és `staging` (només les releases van directes a `main`)
