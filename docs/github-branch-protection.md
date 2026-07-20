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

Si los checks no aparecen en el autocomplete: mergea o abre un PR, espera a que Actions corra una vez, y vuelve a editar el ruleset.

Si pide “source” / app del check: **Any source** o **GitHub Actions**.

5. **Create** / **Save changes**.

## 3. Ajustes del repo (opcional pero útil)

**Settings → General:**

- Default branch: `main`
- Preferir **Allow squash merging**

**Settings → Actions → General:**

- Workflow permissions: **Read repository contents** basta para este CI

## 4. Flujo de trabajo diario

```bash
git checkout main && git pull
git checkout -b feat/mi-cambio
# ... commits ...
git push -u origin HEAD
gh pr create --base main --title "…" --body "…"
# Esperar CI verde → Merge (Squash and merge)
```

Reglas para agentes/devs: ver `AGENTS.md` (§ Pull requests).

## 5. Si el CI no aparece como required check

1. Confirma un run terminado en **Actions** (éxito o fallo).
2. Preferible que haya corrido en un evento **pull_request**.
3. Edita el ruleset → refresca / vuelve a escribir los nombres de job.
4. Nombres deben coincidir con `jobs:` del YAML: `backend-smoke`, `frontend`.

## 6. Qué bloquea un merge (con esto activo)

| Falla… | ¿Bloquea? |
|--------|-----------|
| Smoke/unit API / import backend | Sí |
| ESLint con **errors** | Sí |
| `tsc` / Vite build | Sí |
| Warnings ESLint | No |
| Bug de UI sin cobertura | No |
| Fintual/SSE real | No |

Ampliar cobertura: `backend/tests/` y `.github/workflows/ci.yml`.
