/**
 * Seed script - creates demo data for development and testing.
 * ProdeCaballito is a demo tenant only. It is NOT hardcoded in the application.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  // Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'prodecaballito' },
    update: {},
    create: {
      name: 'Prode Caballito',
      slug: 'prodecaballito',
      metadata: {
        brandName: 'Prode Caballito',
        industry: 'entertainment',
        country: 'AR',
      },
    },
  });

  console.log(`Tenant created: ${tenant.id} (${tenant.slug})`);

  // Create demo provider config
  // TODO: Replace dummy values with real Infobip credentials before testing
  const providerConfig = await prisma.providerConfig.upsert({
    where: { id: 'demo-provider-config-id' },
    update: {},
    create: {
      id: 'demo-provider-config-id',
      tenantId: tenant.id,
      provider: 'infobip',
      apiKey: 'TODO_REPLACE_WITH_REAL_INFOBIP_API_KEY',
      baseUrl: 'https://XXXXX.api.infobip.com', // TODO: Replace with real Infobip base URL
      fromNumber: '+5491100000000', // TODO: Replace with real sender number
      metadata: {
        note: 'Demo config - replace with real credentials',
      },
    },
  });

  console.log(`ProviderConfig created: ${providerConfig.id}`);

  // Create demo contacts
  const contacts = await Promise.all([
    prisma.contact.upsert({
      where: { id: 'demo-contact-1' },
      update: {},
      create: {
        id: 'demo-contact-1',
        tenantId: tenant.id,
        firstName: 'Juan',
        lastName: 'Pérez',
        phone: '+5491122334455',
        email: 'juan.perez@example.com',
        metadata: { source: 'seed' },
      },
    }),
    prisma.contact.upsert({
      where: { id: 'demo-contact-2' },
      update: {},
      create: {
        id: 'demo-contact-2',
        tenantId: tenant.id,
        firstName: 'María',
        lastName: 'González',
        phone: '+5491133445566',
        email: 'maria.gonzalez@example.com',
        metadata: { source: 'seed' },
      },
    }),
    prisma.contact.upsert({
      where: { id: 'demo-contact-3' },
      update: {},
      create: {
        id: 'demo-contact-3',
        tenantId: tenant.id,
        firstName: 'Carlos',
        lastName: 'Rodríguez',
        phone: '+5491144556677',
        email: 'carlos.rodriguez@example.com',
        metadata: { source: 'seed' },
      },
    }),
  ]);

  console.log(`Contacts created: ${contacts.map((c) => c.id).join(', ')}`);

  // Create demo campaign
  const campaign = await prisma.campaign.upsert({
    where: { id: 'demo-campaign-1' },
    update: {},
    create: {
      id: 'demo-campaign-1',
      tenantId: tenant.id,
      name: 'Encuesta Mayo 2025',
      description: 'Encuesta de satisfacción del torneo de mayo 2025',
      status: 'draft',
      metadata: {
        season: '2025',
        type: 'survey',
      },
    },
  });

  console.log(`Campaign created: ${campaign.id}`);

  // Create demo voice flow
  const voiceFlow = await prisma.voiceFlow.upsert({
    where: { campaignId: campaign.id },
    update: {},
    create: {
      campaignId: campaign.id,
      steps: [
        {
          id: 'step-welcome',
          type: 'say',
          text: 'Hola {{firstName}}, te llamamos de {{brandName}}. Gracias por participar en nuestra encuesta.',
        },
        {
          id: 'step-question-1',
          type: 'dtmf_question',
          text: '¿Disfrutaste el último torneo? Presioná 1 para Sí, 2 para No.',
          timeout: 5,
          maxDigits: 1,
          options: {
            '1': 'yes',
            '2': 'no',
          },
        },
        {
          id: 'step-question-2',
          type: 'dtmf_question',
          text: '¿Participarías en el próximo torneo? Presioná 1 para Sí, 2 para No.',
          timeout: 5,
          maxDigits: 1,
          options: {
            '1': 'yes',
            '2': 'no',
          },
        },
        {
          id: 'step-goodbye',
          type: 'goodbye',
          text: 'Muchas gracias por tu tiempo. ¡Hasta pronto!',
        },
      ],
    },
  });

  console.log(`VoiceFlow created: ${voiceFlow.id}`);

  // Add demo contacts as recipients
  const recipients = await Promise.all(
    contacts.map((contact) =>
      prisma.campaignRecipient.upsert({
        where: {
          id: `demo-recipient-${contact.id}`,
        },
        update: {},
        create: {
          id: `demo-recipient-${contact.id}`,
          campaignId: campaign.id,
          contactId: contact.id,
          status: 'pending',
        },
      })
    )
  );

  console.log(`Recipients added: ${recipients.map((r) => r.id).join(', ')}`);

  console.log('Seed completed successfully!');
  console.log('\nDemo data summary:');
  console.log(`  Tenant ID: ${tenant.id}`);
  console.log(`  Tenant slug: ${tenant.slug}`);
  console.log(`  Campaign ID: ${campaign.id}`);
  console.log(`  Contacts: ${contacts.length}`);
  console.log(`  Recipients: ${recipients.length}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
