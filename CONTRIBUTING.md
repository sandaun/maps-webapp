# Contributing

## Git & commit conventions

### Branch flow

```
feat/… ──PR──▶ staging ──PR──▶ main ──▶ release-please PR ──▶ tag + GitHub Release
                  ▲                                                    │
                  └────────────── backmerge (automàtic) ───────────────┘
```

- **`main`** — codi released. Només hi arriba res via pull request.
- **`staging`** — branca d'integració i **base per defecte de totes les PRs de feature**.
- **Branques de feina** — curtes i enfocades, amb prefix segons el tipus de canvi:
  `feat/`, `fix/`, `chore/`, `refactor/`.

El cicle complet:

1. Surts de `staging` amb una branca `feat/…` i obres PR **contra `staging`**.
2. Quan `staging` està a punt, obres PR de `staging` **contra `main`**.
3. Cada push a `main` fa que release-please obri o actualitzi una PR de release
   amb el `CHANGELOG.md` i el bump de versió.
4. Mergejar aquella PR crea el tag i la GitHub Release.
5. Un workflow de backmerge torna `main` cap a `staging` automàticament, perquè
   `staging` no es quedi enrere amb la versió i el changelog.

### Commit format

```
<type>(<scope opcional>): <subject>
```

El `<type>` determina el bump de versió que farà release-please:

| Type | Bump | Quan |
| --- | --- | --- |
| `feat` | **minor** | nova funcionalitat |
| `fix` | **patch** | correcció d'un bug |
| `perf` | **patch** | millora de rendiment |
| `chore` | **patch** | manteniment, dependències, tooling |
| `revert` | **patch** | reverteix un commit anterior |
| `docs` | cap | només documentació |
| `style` | cap | format, espais, sense canvi de codi |
| `refactor` | cap | canvi intern sense canvi de comportament |
| `test` | cap | només tests |
| `ci` | cap | només configuració de CI |
| `build` | cap | sistema de build o dependències |

**Breaking changes** pugen la major independentment del type. Es marquen amb `!`
després del type/scope (`feat!:`, `fix(api)!:`) o amb un footer `BREAKING CHANGE:`
al cos del commit. Mentre la versió sigui `0.x`, un breaking change puja la minor
(`0.1.0` → `0.2.0`) en comptes d'arribar a `1.0.0`.

### Exemples reals d'aquest repo

```
feat(signals): add a compact signals grid with abbreviated headers
fix(signals): fit signal column widths to headers
fix(ui): align typography with v9
refactor(signals): extract column visibility into a hook
chore: set up git workflow tooling
docs: document the knx dpt table
feat(exports)!: drop the legacy esf column order
```

> **Compte amb les majúscules.** La regla `subject-case: lower-case` obliga que
> **tot** el subject vagi en minúscules, acrònims inclosos: escriu `knx`, `v9`,
> `xlsx`, `esf`, no `KNX` ni `V9`. Si això molesta massa, es pot relaxar a la
> regla per defecte de `config-conventional` (que només prohibeix començar en
> majúscula) canviant `subject-case` a
> `[2, "never", ["sentence-case", "start-case", "pascal-case", "upper-case"]]`
> a `commitlint.config.js`.

### Hooks de husky

Els hooks s'instal·len sols en fer `pnpm install` (script `prepare`).

| Hook | Què fa | Si falla |
| --- | --- | --- |
| `pre-commit` | `pnpm test` — tota la suite en single run, mai en watch | el commit no es crea |
| `commit-msg` | `pnpm exec commitlint --edit` sobre el missatge | el commit no es crea |

Tots dos són **bloquejants**. Si necessites saltar-te'ls puntualment (rebase,
commit de rescat) pots fer servir `git commit --no-verify`, però la CI tornarà a
comprovar el mateix a la PR.

### Comprovacions abans d'obrir PR

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Són exactament els quatre passos que executa el job de CI
`Lint · Typecheck · Test · Build` a cada PR contra `staging` i `main`.
