# Proteger `main` en GitHub (branch protection)

Instrucciones para que **solo entre código vía PR** y el **CI bloquee merges rotos**.

## 1. Comprobar que el workflow exista

En el repo debe existir `.github/workflows/ci.yml` (workflow name: **CI**).

Tras un push o PR, en **Actions** deben aparecer dos jobs:

| Job (nombre a exigir) | Qué valida |
|------------------------|------------|
| `backend-smoke` | Import app + pytest smoke API |
| `frontend` | `npm run lint` + `npm run build` |

En la UI de status checks a veces se ven como:

- `CI / backend-smoke`
- `CI / frontend`

Usa el nombre que muestre el desplegable de GitHub al configurar (suele ser el **nombre del job**).

## 2. Branch protection rules

1. Abre el repo en GitHub → **Settings** → **Branches**.
2. **Add branch protection rule** (o **Add classic branch protection rule**).
3. **Branch name pattern:** `main`
4. Activa:

### Obligatorias

- [x] **Require a pull request before merging**
  - [x] Require approvals: `0` está bien en repo personal (o `1` si quieres auto-revisión consciente)
  - [ ] Dismiss stale PR approvals when new commits are pushed (opcional)
- [x] **Require status checks to pass before merging**
  - [x] **Require branches to be up to date before merging** (recomendado)
  - Busca y marca:
    - `backend-smoke`
    - `frontend`  
    Si aún no aparecen en la lista: abre un PR de prueba, espera a que corra el CI una vez, y vuelve a esta pantalla.
- [x] **Do not allow bypassing the above settings** (si está disponible y eres admin, actívalo para no saltarte la regla por error)

### Recomendadas

- [x] **Restrict force pushes** (o “Do not allow force pushes”)
- [x] **Do not allow deletions** de `main`
- [ ] Require conversation resolution before merging (útil si hay reviews)

### Evitar (por ahora)

- No hace falta “Require signed commits” ni “Require linear history” salvo que lo uses ya.

5. **Save changes**.

## 3. Ajustes del repo (opcional pero útil)

**Settings → General:**

- Default branch: `main`
- Preferir **Allow squash merging** (historial limpio)
- Desactivar merge commit / rebase si quieres un solo estilo (opcional)

**Settings → Actions → General:**

- Actions permissions: Allow all actions (o las que uses)
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

1. Confirma que el último run en **Actions** terminó (éxito o fallo, da igual).
2. El job debe haberse ejecutado en un **pull_request** (no solo push a otra rama sin PR).
3. Vuelve a **Branches** → edita la regla → refresca la lista de status checks.
4. Nombres exactos deben coincidir con los `jobs:` del YAML (`backend-smoke`, `frontend`).

## 6. Qué bloquea un merge (con esto activo)

| Falla… | ¿Bloquea? |
|--------|-----------|
| Smoke API / import backend | Sí |
| ESLint con **errors** | Sí |
| `tsc` / Vite build | Sí |
| Warnings ESLint | No (solo warnings) |
| Bug de UI sin cobertura | No |
| Fintual/SSE real | No |

Ampliar cobertura: `backend/tests/` y el workflow en `.github/workflows/ci.yml`.
