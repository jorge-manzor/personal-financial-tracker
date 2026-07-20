# Proteger `main` en GitHub (Rulesets)

Instrucciones para que **solo entre código vía PR** y el **CI bloquee merges rotos**.

> La UI actual de GitHub usa **Rulesets** (Settings → Rules → Rulesets). Las “classic branch protection rules” pueden no aparecer; usa Rulesets.

## 1. Comprobar que el workflow exista

En el repo debe existir `.github/workflows/ci.yml` (workflow name: **CI**).

Tras un push o PR, en **Actions** deben aparecer dos jobs:

| Job (nombre a exigir) | Qué valida |
|------------------------|------------|
| `backend-smoke` | Import app + pytest (`tests/`) |
| `frontend` | `npm run lint` + `npm run build` |

En la UI a veces se ven como `CI / backend-smoke` y `CI / frontend`. Al configurar el ruleset, usa el **nombre del job** (`backend-smoke`, `frontend`).

## 2. Crear un branch ruleset

1. Repo → **Settings** → **Rules** → **Rulesets**  
   (o **Settings** → **Branches**, si te redirige a Rulesets).
2. **New ruleset** → **New branch ruleset**.
3. Configura:

| Campo | Valor |
|-------|--------|
| Ruleset name | `Protect main` |
| Enforcement status | **Active** (usa **Evaluate** solo si quieres probar sin bloquear) |
| Target branches | **Include** → `main` (o Default branch) |
| Bypass list | Vacío (recomendado) o solo tu usuario para emergencias |

4. En **Rules** / branch protections, activa:

### Obligatorias

- [x] **Restrict deletions**
- [x] **Block force pushes**
- [x] **Require a pull request before merging**
  - Required approvals: `0` (repo personal) o `1`
- [x] **Require status checks to pass**
  - Añade (con **+** / Add) exactamente:
    - `backend-smoke`
    - `frontend`
  - [x] **Require branches to be up to date before merging** (strict; recomendado)

Si los checks no aparecen en el autocomplete: deja que Actions corra una vez (sección 3–5), y vuelve a editar el ruleset.

Si pide “source” / app del check: **Any source** o **GitHub Actions**.

5. **Create** / **Save changes**.

## 3. Ajustes del repo (obligatorio para que corra el CI)

**Settings → Actions → General:**

1. **Actions permissions:** elige **Allow all actions and reusable workflows** (o Allow GitHub Actions).
2. Si aparece opción de **Disable actions**: no la uses; con Actions off **nunca** se triggeran tests.
3. **Workflow permissions:** Read repository contents basta.
4. Guarda.

Sin este paso, el YAML puede existir y la pestaña **Actions** igual queda vacía (muy común en repos privados nuevos).

Opcional en **Settings → General:** default branch `main`, preferir squash merge.

## 4. Flujo de trabajo diario

```bash
git checkout main && git pull
git checkout -b feat/mi-cambio
# ... commits ...
git push -u origin HEAD
gh pr create --base main --title "…" --body "…"
# Esperar CI verde → Merge (Squash and merge)
```

Tras el push, en **Actions** debe aparecer un run **CI** (también en PRs a `main`).  
El workflow incluye `workflow_dispatch`: **Actions → CI → Run workflow** para disparo manual.

## 5. Si el CI no se triggera (Actions vacío)

1. Revisa la sección 3 (Actions habilitados).
2. **Actions** → ¿aparece el workflow **CI** a la izquierda? Si no, Actions está off o el YAML no está en `main`.
3. **Actions → CI → Run workflow** (manual).
4. Confirma billing/minutos de Actions en la cuenta si aplica.

## 6. Si el CI corre pero no aparece como required check

1. Confirma un run terminado (éxito o fallo).
2. Preferible un run en **pull_request** a `main`.
3. Edita el ruleset y vuelve a añadir `backend-smoke` y `frontend`.

## 7. Qué bloquea un merge (con ruleset + CI activos)

| Falla… | ¿Bloquea? |
|--------|-----------|
| Smoke/unit API / import backend | Sí |
| ESLint con **errors** | Sí |
| `tsc` / Vite build | Sí |
| Warnings ESLint | No |
| Bug de UI sin cobertura | No |
| Fintual/SSE real | No |

Ampliar cobertura: `backend/tests/` y `.github/workflows/ci.yml`.
