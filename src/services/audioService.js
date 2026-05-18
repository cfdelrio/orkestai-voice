/**
 * @fileoverview Audio generation service using OpenAI TTS.
 *
 * Generates MP3 files from text using OpenAI's tts-1-hd model (voice: nova).
 * Files are named {recipientId}-{stepId}.mp3 and cached on disk — if the file
 * already exists, generation is skipped.
 *
 * Audio files are served publicly via GET /api/audio/:filename.
 */

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../middleware/logger');

const logger = createLogger('AudioService');

const AUDIO_DIR = path.join(process.cwd(), 'audio');
const VOICE = 'nova';
// gpt-4o-mini-tts supports the `instructions` param for style/accent control
const MODEL_WITH_INSTRUCTIONS = 'gpt-4o-mini-tts';
// tts-1-hd is the fallback when no instructions are provided
const MODEL_DEFAULT = 'tts-1-hd';

function getFilename(recipientId, stepId) {
  return `${recipientId}-${stepId}.mp3`;
}

function getFilepath(recipientId, stepId) {
  return path.join(AUDIO_DIR, getFilename(recipientId, stepId));
}

function audioExists(recipientId, stepId) {
  return fs.existsSync(getFilepath(recipientId, stepId));
}

/**
 * Deletes all pre-generated audio files for every recipient of a campaign.
 * Called when the flow is updated so stale audio doesn't get served.
 *
 * @param {string[]} recipientIds
 * @param {string[]} stepIds
 */
function deleteAudioForCampaign(recipientIds, stepIds) {
  let deleted = 0;
  for (const recipientId of recipientIds) {
    for (const stepId of stepIds) {
      const filepath = getFilepath(recipientId, stepId);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        deleted++;
      }
    }
  }
  if (deleted > 0) {
    logger.info('Deleted stale audio files', { deleted, recipients: recipientIds.length });
  }
}

function getAudioUrl(recipientId, stepId, webhookBase) {
  return `${webhookBase}/api/audio/${getFilename(recipientId, stepId)}`;
}

/**
 * Generates an MP3 for a single step text using OpenAI TTS.
 * Skips generation if the file already exists (idempotent).
 *
 * @param {string} recipientId
 * @param {string} stepId
 * @param {string} text         - Already interpolated plain text
 * @param {string} [instructions] - Voice style instructions (accent, tone, pace)
 */
async function generateAudio(recipientId, stepId, text, instructions) {
  const filepath = getFilepath(recipientId, stepId);

  if (fs.existsSync(filepath)) {
    logger.debug('Audio already exists — skipping', { recipientId, stepId });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — skipping audio generation');
    return;
  }

  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const model = instructions ? MODEL_WITH_INSTRUCTIONS : MODEL_DEFAULT;
  logger.info('Generating audio', { recipientId, stepId, chars: text.length, model, hasInstructions: !!instructions });

  const params = {
    model,
    voice: VOICE,
    input: text,
    response_format: 'mp3',
  };
  if (instructions) params.instructions = instructions;

  const response = await openai.audio.speech.create(params);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filepath, buffer);

  logger.info('Audio saved', { recipientId, stepId, bytes: buffer.length });
}

/**
 * Generates audio for all steps of a recipient's campaign flow.
 *
 * @param {string} recipientId
 * @param {Array<{id: string, text: string, type: string}>} steps
 * @param {Record<string, string>} vars         - Template variables for this contact
 * @param {string}                [instructions] - Voice style instructions
 */
async function generateAudioForRecipient(recipientId, steps, vars, instructions) {
  const { interpolateTemplate } = require('./templateEngine');

  const results = await Promise.allSettled(
    steps.map((step) => {
      const text = interpolateTemplate(step.text || '', vars);
      return generateAudio(recipientId, step.id, text, instructions);
    })
  );

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    logger.warn('Some audio steps failed to generate', {
      recipientId,
      failed: failed.length,
      errors: failed.map((r) => r.reason?.message),
    });
  }
}

module.exports = { audioExists, getAudioUrl, generateAudio, generateAudioForRecipient, deleteAudioForCampaign };
