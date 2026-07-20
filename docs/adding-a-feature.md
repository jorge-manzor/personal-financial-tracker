# Playbook — añadir o cambiar una feature

Pasos canónicos. Ajusta según el dominio (`domain-banking.md` / `domain-investments.md`).

## 0. Antes de codear

1. Leer `AGENTS.md` y el `AGENTS.md` del paquete (`backend/` o `frontend/`).
2. Confirmar si es banking, investments o auth/perfil.
3. Localizar el archivo caliente; planear un diff pequeño.

## 1. Modelo de datos (si aplica)

1. Editar `backend/models.py`.
2. Extender `backend/multiuser_migration.py` (idempotente).
3. Schemas en `backend/schemas.py`.
4. Tipos en `frontend/src/types.ts`.

## 2. Backend API

1. Lógica en el service adecuado (`banking_service.py`, etc.).
2. Ruta con el Depends correcto (`BankingUser` / `InvestmentsUser` / `get_current_user`).
3. Prefijo banking: `/banking/...` vía router existente o uno nuevo + `include_router` en `main.py`.
4. Abrir `/docs` y validar request/response.

## 3. Frontend

1. Llamadas solo con `api.ts` / `auth.ts`.
2. Página o sección; ruta en `App.tsx` con gate de servicio.
3. Sidebar/header si el usuario debe descubrir la feature.
4. Copy en español; reutilizar `format.ts` / patrones UI existentes.

## 4. Verificar

```bash
./scripts/verify.sh
# estricto:
VERIFY_LINT=1 VERIFY_BUILD=1 ./scripts/verify.sh
# o manualmente:
cd backend && python -c "import main"   # o backend/.venv/bin/python
cd frontend && npm run lint && npm run build
curl -s http://127.0.0.1:8000/health   # si el API corre
```

## 5. No hacer

- Refactor masivo de archivos calientes.
- Añadir Alembic / cambiar de ORM.
- Commitear `.env` o DB.
- Activar reset destructivo de catálogo banking.
- Omitir filtro `user_id` o el guard de servicio.
