# orkestai-voice

Sistema SaaS multi-tenant para campañas de llamadas telefónicas automatizadas con soporte de flujos IVR (respuesta de voz interactiva) y DTMF.

---

## 1. Descripción general

**orkestai-voice** permite a múltiples organizaciones (tenants) gestionar campañas de llamadas salientes con flujos de voz configurables. El sistema:

- Gestiona múltiples tenants con aislamiento completo de datos
- Define flujos de voz con pasos de texto-a-voz (TTS) y preguntas DTMF
- Inicia llamadas masivas a listas de contactos
- Recibe actualizaciones de estado y respuestas DTMF vía webhooks
- Genera reportes de resultados por campaña

---

## 2. Arquitectura

### Abstracción del proveedor de voz

El sistema está diseñado con una separación estricta entre el dominio de negocio y el proveedor de telefonía. Ningún código fuera de `src/providers/` conoce detalles de Infobip (ni de ningún otro proveedor).

```
┌─────────────────────────────────────────────────────────────┐
│                    Routes / Services                         │
│          (no conocen nada de Infobip ni de ningún            │
│           proveedor concreto)                                │
└────────────────────────┬────────────────────────────────────┘
                         │ usa
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              VoiceProvider (interface)                       │
│         src/providers/VoiceProvider.js                       │
│                                                              │
│  + initiateCall(params)  → { providerCallId, status }        │
│  + getCallStatus(id)     → { status, duration }              │
│  + buildCallPayload(...)  → Object                           │
└────────────────────────┬────────────────────────────────────┘
                         │ implementado por
                         ▼
┌─────────────────────────────────────────────────────────────┐
│       InfobipVoiceProvider                                   │
│  src/providers/infobip/InfobipVoiceProvider.js               │
│                                                              │
│  Traduce VoiceFlow → payload Infobip IVR API                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│       InfobipWebhookAdapter                                  │
│  src/providers/infobip/InfobipWebhookAdapter.js              │
│                                                              │
│  Parsea payload raw de Infobip → evento normalizado          │
│  { providerCallId, status, dtmfDigit, stepId }               │
└─────────────────────────────────────────────────────────────┘
```

### Estructura de directorios

```
orkestai-voice/
├── prisma/
│   ├── schema.prisma          # Modelos de base de datos
│   └── seed.js                # Datos de demo (ProdeCaballito)
├── src/
│   ├── config/
│   │   └── env.js             # Carga y valida variables de entorno
│   ├── providers/
│   │   ├── VoiceProvider.js   # Interface abstracta (JSDoc)
│   │   └── infobip/
│   │       ├── InfobipVoiceProvider.js    # Implementación Infobip
│   │       └── InfobipWebhookAdapter.js  # Parser de webhooks Infobip
│   ├── routes/
│   │   ├── tenants.js         # Gestión de tenants y provider configs
│   │   ├── campaigns.js       # Campañas, flujos, recipientes, inicio
│   │   ├── contacts.js        # Gestión de contactos
│   │   └── webhooks.js        # Receptor de eventos de proveedor
│   ├── services/
│   │   ├── tenantService.js   # Lógica de negocio de tenants
│   │   ├── campaignService.js # Lógica de campañas y flujos
│   │   ├── contactService.js  # Lógica de contactos
│   │   ├── callService.js     # Orquestación de llamadas
│   │   ├── providerFactory.js # Instancia el proveedor correcto
│   │   └── templateEngine.js  # Interpolación {{firstName}}, etc.
│   ├── middleware/
│   │   ├── errorHandler.js    # Manejo centralizado de errores
│   │   └── logger.js          # Logger estructurado por módulo
│   └── app.js                 # Configuración de Express
├── server.js                  # Entry point (bind puerto)
├── .env.example               # Variables de entorno requeridas
└── package.json
```

---

## 3. Requisitos

- **Node.js** >= 18.x
- **npm** >= 9.x
- **PostgreSQL** >= 14
- Cuenta **Infobip** con acceso a la API de Voz (Voice API)

---

## 4. Instalación paso a paso

### 4.1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd orkestai-voice
```

### 4.2. Instalar dependencias

```bash
npm install
```

### 4.3. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con los valores reales (ver sección 5).

### 4.4. Crear la base de datos PostgreSQL

```bash
createdb orkestai_voice
```

O con psql:

```sql
CREATE DATABASE orkestai_voice;
```

### 4.5. Ejecutar migraciones

```bash
npm run db:migrate
```

> Esto crea todas las tablas definidas en `prisma/schema.prisma`.

### 4.6. Cargar datos de demo (opcional)

```bash
npm run db:seed
```

Esto crea el tenant de demo `prodecaballito` con una campaña de ejemplo, 3 contactos y un flujo de voz de muestra. **ProdeCaballito es únicamente un tenant de demo — no está hardcodeado en ninguna lógica de negocio.**

### 4.7. Iniciar el servidor

```bash
# Producción
npm start

# Desarrollo (recarga automática con nodemon)
npm run dev
```

El servidor queda disponible en `http://localhost:3000` (o el PORT configurado).

---

## 5. Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | URL de conexión PostgreSQL. Ej: `postgresql://user:pass@localhost:5432/orkestai_voice` |
| `PORT` | No | Puerto del servidor HTTP. Default: `3000` |
| `WEBHOOK_BASE_URL` | No | URL pública del servidor (para que Infobip envíe callbacks). Ej: `https://mi-servidor.com`. Default: `http://localhost:3000` |
| `NODE_ENV` | No | Entorno. `development` muestra stack traces en errores 500. Default: `development` |

---

## 6. Comandos útiles

```bash
npm start              # Inicia el servidor en producción
npm run dev            # Inicia con hot-reload (nodemon)
npm run db:migrate     # Ejecuta migraciones pendientes de Prisma
npm run db:seed        # Carga datos de demo
npm run db:studio      # Abre Prisma Studio (GUI de base de datos)
```

---

## 7. Endpoints — Ejemplos completos con curl

### Prerequisito: obtener el tenant ID del seed

```bash
curl -s http://localhost:3000/api/tenants | jq '.tenants[] | {id, slug}'
```

Guarda el ID del tenant `prodecaballito`:

```bash
TENANT_ID="<uuid-del-tenant>"
```

---

### 7.1. Crear un tenant

```bash
curl -X POST http://localhost:3000/api/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mi Empresa",
    "slug": "mi-empresa",
    "metadata": {
      "brandName": "Mi Empresa S.A.",
      "country": "AR"
    }
  }'
```

**Respuesta:**
```json
{
  "tenant": {
    "id": "uuid-generado",
    "name": "Mi Empresa",
    "slug": "mi-empresa",
    "metadata": { "brandName": "Mi Empresa S.A.", "country": "AR" },
    "createdAt": "2025-05-10T12:00:00.000Z",
    "updatedAt": "2025-05-10T12:00:00.000Z"
  }
}
```

---

### 7.2. Crear una configuración de proveedor

```bash
curl -X POST http://localhost:3000/api/tenants/$TENANT_ID/provider-configs \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "infobip",
    "apiKey": "tu-api-key-de-infobip",
    "baseUrl": "https://XXXXX.api.infobip.com",
    "fromNumber": "+5491100000000",
    "metadata": {
      "note": "Producción"
    }
  }'
```

**Respuesta:**
```json
{
  "providerConfig": {
    "id": "uuid-generado",
    "tenantId": "...",
    "provider": "infobip",
    "baseUrl": "https://XXXXX.api.infobip.com",
    "fromNumber": "+5491100000000",
    "createdAt": "2025-05-10T12:00:00.000Z"
  }
}
```

---

### 7.3. Crear una campaña

```bash
curl -X POST http://localhost:3000/api/tenants/$TENANT_ID/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Encuesta Junio 2025",
    "description": "Encuesta de satisfacción del mes de junio",
    "metadata": { "season": "2025" }
  }'
```

Guarda el campaign ID:

```bash
CAMPAIGN_ID="<uuid-de-la-campaña>"
```

---

### 7.4. Configurar el flujo de voz (VoiceFlow)

```bash
curl -X POST http://localhost:3000/api/campaigns/$CAMPAIGN_ID/flow \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {
        "id": "step-bienvenida",
        "type": "say",
        "text": "Hola {{firstName}}, te llamamos de {{brandName}}. Gracias por participar."
      },
      {
        "id": "step-pregunta-1",
        "type": "dtmf_question",
        "text": "¿Estás satisfecho con nuestro servicio? Presioná 1 para Sí, 2 para No.",
        "timeout": 5,
        "maxDigits": 1,
        "options": {
          "1": "satisfecho",
          "2": "insatisfecho"
        }
      },
      {
        "id": "step-despedida",
        "type": "goodbye",
        "text": "Muchas gracias por tu tiempo. ¡Hasta pronto!"
      }
    ]
  }'
```

---

### 7.5. Crear un contacto

```bash
curl -X POST http://localhost:3000/api/tenants/$TENANT_ID/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Ana",
    "lastName": "López",
    "phone": "+5491155667788",
    "email": "ana.lopez@example.com"
  }'
```

Guarda el contact ID:

```bash
CONTACT_ID="<uuid-del-contacto>"
```

---

### 7.6. Agregar recipientes a la campaña

```bash
curl -X POST http://localhost:3000/api/campaigns/$CAMPAIGN_ID/recipients \
  -H "Content-Type: application/json" \
  -d '{
    "contactIds": ["'$CONTACT_ID'"]
  }'
```

Con el seed, podés usar los IDs fijos:

```bash
curl -X POST http://localhost:3000/api/campaigns/demo-campaign-1/recipients \
  -H "Content-Type: application/json" \
  -d '{
    "contactIds": ["demo-contact-1", "demo-contact-2", "demo-contact-3"]
  }'
```

---

### 7.7. Iniciar la campaña

```bash
curl -X POST http://localhost:3000/api/campaigns/$CAMPAIGN_ID/start
```

**Respuesta:**
```json
{
  "campaignId": "...",
  "campaignName": "Encuesta Junio 2025",
  "status": "active",
  "results": {
    "initiated": 3,
    "failed": 0,
    "errors": []
  }
}
```

---

### 7.8. Recibir webhook de Infobip (simulación local)

```bash
# Simular actualización de estado de llamada
curl -X POST http://localhost:3000/api/webhooks/infobip/voice \
  -H "Content-Type: application/json" \
  -d '{
    "id": "infobip-call-id-123",
    "callStatus": "ESTABLISHED"
  }'

# Simular respuesta DTMF
curl -X POST http://localhost:3000/api/webhooks/infobip/voice \
  -H "Content-Type: application/json" \
  -d '{
    "id": "infobip-call-id-123",
    "callStatus": "ESTABLISHED",
    "dtmfDigit": "1",
    "userData": "{\"stepId\": \"step-pregunta-1\"}"
  }'
```

---

### 7.9. Ver resultados de la campaña

```bash
curl http://localhost:3000/api/campaigns/$CAMPAIGN_ID/results
```

**Respuesta:**
```json
{
  "campaign": {
    "id": "...",
    "name": "Encuesta Junio 2025",
    "status": "active",
    "createdAt": "..."
  },
  "flow": { ... },
  "stats": {
    "totalRecipients": 3,
    "recipientsByStatus": {
      "pending": 0,
      "called": 2,
      "failed": 1
    },
    "callsByStatus": {
      "initiated": 1,
      "answered": 1,
      "completed": 1
    },
    "responsesByStep": {
      "step-pregunta-1": {
        "satisfecho": 2,
        "insatisfecho": 1
      }
    }
  }
}
```

---

## 8. Formato del VoiceFlow JSON

Un VoiceFlow es un array ordenado de pasos (`steps`). Cada paso tiene:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `id` | string | Sí | Identificador único del paso dentro del flujo |
| `type` | string | Sí | Tipo de paso: `say`, `dtmf_question`, `goodbye` |
| `text` | string | Sí | Texto TTS. Soporta placeholders `{{firstName}}`, `{{lastName}}`, `{{brandName}}` |
| `timeout` | number | Solo `dtmf_question` | Segundos a esperar por input. Default: 5 |
| `maxDigits` | number | Solo `dtmf_question` | Máximo de dígitos a capturar. Default: 1 |
| `options` | object | Solo `dtmf_question` | Mapa dígito → valor semántico. Ej: `{"1": "yes", "2": "no"}` |

### Tipos de paso

**`say`** — Reproduce un mensaje de texto sin esperar input:
```json
{
  "id": "bienvenida",
  "type": "say",
  "text": "Hola {{firstName}}, te llamamos de {{brandName}}."
}
```

**`dtmf_question`** — Reproduce un mensaje y espera un dígito DTMF:
```json
{
  "id": "pregunta-satisfaccion",
  "type": "dtmf_question",
  "text": "¿Estás satisfecho? Presioná 1 para Sí, 2 para No.",
  "timeout": 5,
  "maxDigits": 1,
  "options": {
    "1": "yes",
    "2": "no"
  }
}
```

**`goodbye`** — Reproduce un mensaje de despedida y cuelga la llamada:
```json
{
  "id": "despedida",
  "type": "goodbye",
  "text": "Muchas gracias por tu tiempo. ¡Hasta pronto!"
}
```

### Placeholders disponibles

| Placeholder | Origen |
|---|---|
| `{{firstName}}` | `contact.firstName` |
| `{{lastName}}` | `contact.lastName` (cadena vacía si es null) |
| `{{phone}}` | `contact.phone` |
| `{{brandName}}` | `tenant.metadata.brandName` |

---

## 9. Documentación de eventos webhook

Infobip envía eventos POST a `{WEBHOOK_BASE_URL}/api/webhooks/infobip/voice`.

### Tipos de eventos

#### Cambio de estado de llamada

Infobip notifica cambios en el ciclo de vida de la llamada:

| Estado Infobip | Estado normalizado |
|---|---|
| `INITIATED` | `initiated` |
| `RINGING` | `ringing` |
| `ESTABLISHED` | `answered` |
| `FINISHED` | `completed` |
| `NO_ANSWER` | `no_answer` |
| `BUSY`, `REJECTED`, `FAILED`, `CANCELLED` | `failed` |

#### Evento DTMF

Cuando el usuario presiona un dígito, Infobip envía el payload con los campos de dígito y el `userData` que contiene el `stepId`. El sistema:

1. Identifica la llamada por `providerCallId`
2. Busca el paso en el VoiceFlow por `stepId`
3. Mapea el dígito al valor semántico via `options`
4. Guarda la respuesta en la tabla `Response`

### Configuración del webhook en Infobip

Al iniciar una campaña, el sistema envía automáticamente la URL del webhook a Infobip en el campo `notifyUrl` del payload de la llamada. Asegurate de que `WEBHOOK_BASE_URL` apunte a un servidor con IP pública accesible desde internet.

---

## 10. TODOs / Roadmap

### Pendientes de validación con Infobip

- [ ] **Endpoint exacto**: verificar si es `/calls/1/calls` u otro path
- [ ] **Formato IVR**: confirmar si Infobip acepta escenarios inline o requiere pre-creación
- [ ] **Nombres de campos**: verificar `dtmfDigit`, `callStatus`, `userData` contra payload real
- [ ] **Idioma/voz TTS**: hacer configurable por tenant (`language`, `voice.name`)
- [ ] **Verificación de firma**: implementar HMAC si Infobip lo soporta para autenticar webhooks

### Funcionalidades futuras

- [ ] **Autenticación**: API keys o JWT por tenant para securizar los endpoints
- [ ] **Rate limiting**: limitar llamadas concurrentes por campaña
- [ ] **Reintentos**: reintentar llamadas fallidas con backoff exponencial
- [ ] **Scheduling**: programar el inicio de campañas para una fecha/hora específica
- [ ] **Más proveedores**: Twilio, Amazon Connect, Vonage
- [ ] **Dashboard web**: interfaz de administración
- [ ] **Exportación CSV**: exportar respuestas por campaña
- [ ] **Tests**: suite de unit e integration tests
- [ ] **Docker**: `Dockerfile` y `docker-compose.yml` para despliegue simplificado
- [ ] **Paginación**: paginar listas de tenants, contactos y campañas
- [ ] **Soft deletes**: borrado lógico en lugar de eliminación física
