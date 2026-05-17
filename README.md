# Orkestai Voice

Multi-tenant SaaS for voice campaigns and IVR surveys using Infobip.

## Features
- Multi-tenant
- Voice campaigns
- IVR flows
- DTMF responses
- Infobip provider
- Webhook processing
- Campaign analytics

## Stack
- Node.js
- Express
- PostgreSQL
- Prisma

## Setup

npm install

cp .env.example .env

npm run prisma:migrate

npm run dev

## Environment variables

INFOBIP_BASE_URL=
INFOBIP_API_KEY=
INFOBIP_FROM_NUMBER=
DATABASE_URL=

## Architecture

tenant
  └── campaigns
       └── flows
       └── recipients
       └── calls
       └── responses

## Providers

/providers
  /infobip

## Endpoints

POST /api/tenants
POST /api/campaigns
POST /api/campaigns/:id/start

## Webhooks

POST /api/webhooks/infobip/voice
