# Collab Canvas Backend

Backend de sincronización colaborativa en tiempo real para canvas usando Yjs y WebSockets.

## Estructura del proyecto

- `src/config/` — Configuración centralizada (puertos, claves, URLs)
- `src/database/` — Proveedores de persistencia (actualmente solo memoria, fácil de extender)
- `src/http/` — Controladores HTTP (health, rooms, etc.)
- `src/supabase/` — Integración y autenticación con Supabase
- `src/websocket/` — Handler de WebSocket y ciclo de vida de salas
- `src/types.ts` — Tipos e interfaces globales
- `src/server.ts` — Punto de entrada principal
- `tests/` — Pruebas unitarias y de integración

## Principios SOLID aplicados
- **S**: Cada módulo tiene una única responsabilidad clara.
- **O**: Fácil de extender (ej. nuevos proveedores de persistencia).
- **L**: Las interfaces permiten intercambiar implementaciones sin romper dependencias.
- **I**: Las dependencias están bien separadas y desacopladas.
- **D**: Inyección de dependencias posible para testing y escalabilidad.

## Scripts útiles
- `npm run dev` — Desarrollo con recarga
- `npm run build` — Compilar TypeScript
- `npm start` — Ejecutar build

## Endpoints principales
- `GET /health` — Estado del servidor
- `GET /rooms` — Listado de salas activas
- `GET /room-info?room=ID` — Info de una sala

## Notas
- Para producción, implementa un proveedor de persistencia real (Mongo, Redis, etc.) en `src/database/`.
- Configura tus variables de entorno en `.env` o en el sistema.
