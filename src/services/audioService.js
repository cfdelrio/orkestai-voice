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
const { PrismaClient } = require('@prisma/client');
const { createLogger } = require('../middleware/logger');

const logger = createLogger('AudioService');
const prisma = new PrismaClient();

const AUDIO_DIR = path.join(process.cwd(), 'audio');
const RECORDINGS_DIR = path.join(process.cwd(), 'recordings');
const VOICE_DEFAULT = 'nova';
const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

function resolveVoice(voice) {
  return VALID_VOICES.includes(voice) ? voice : VOICE_DEFAULT;
}
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
 * @param {string} [voice]        - OpenAI voice ID (alloy, echo, fable, onyx, nova, shimmer)
 */
async function generateAudio(recipientId, stepId, text, instructions, voice) {
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
  const resolvedVoice = resolveVoice(voice);
  logger.info('Generating audio', { recipientId, stepId, chars: text.length, model, voice: resolvedVoice, hasInstructions: !!instructions });

  const params = {
    model,
    voice: resolvedVoice,
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
 * @param {string}                [voice]        - OpenAI voice ID
 */
async function generateAudioForRecipient(recipientId, steps, vars, instructions, voice) {
  const { interpolateTemplate } = require('./templateEngine');

  const results = await Promise.allSettled(
    steps.map((step) => {
      const text = interpolateTemplate(step.text || '', vars);
      return generateAudio(recipientId, step.id, text, instructions, voice);
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

/**
 * Downloads a Twilio voice recording, transcribes it with OpenAI Whisper,
 * and updates the Response record with the transcript text.
 * Saves the MP3 to disk at recordings/{responseId}.mp3.
 *
 * @param {string} recordingUrl - Twilio recording URL (no extension)
 * @param {string} responseId   - Response record ID to update
 * @param {string} accountSid   - Twilio Account SID for Basic Auth download
 * @param {string} authToken    - Twilio Auth Token for Basic Auth download
 */
async function transcribeAndSaveRecording(recordingUrl, responseId, accountSid, authToken) {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — skipping transcription', { responseId });
    return;
  }

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  const mp3Url = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`;
  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const filepath = path.join(RECORDINGS_DIR, `${responseId}.mp3`);

  // Retry download up to 3 times — Twilio sometimes takes a few seconds to make the file available
  const RETRY_DELAYS = [0, 10000, 20000];
  let downloadedOk = false;

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (RETRY_DELAYS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
    try {
      logger.info('Downloading recording', { responseId, attempt: attempt + 1, url: mp3Url });
      const fetchRes = await fetch(mp3Url, { headers: { Authorization: authHeader } });
      if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status} ${fetchRes.statusText}`);

      const buffer = Buffer.from(await fetchRes.arrayBuffer());
      fs.writeFileSync(filepath, buffer);
      logger.info('Recording saved', { responseId, bytes: buffer.length });
      downloadedOk = true;
      break;
    } catch (err) {
      logger.warn('Recording download attempt failed', { responseId, attempt: attempt + 1, error: err.message });
    }
  }

  if (!downloadedOk) {
    logger.error('Recording download failed after all retries', { responseId });
    return;
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filepath),
      model: 'whisper-1',
      language: 'es',
    });

    await prisma.response.update({
      where: { id: responseId },
      data: { value: transcription.text },
    });

    logger.info('Transcription saved', { responseId, text: transcription.text });
  } catch (err) {
    logger.error('Whisper transcription failed', { responseId, error: err.message });
  }
}

module.exports = { audioExists, getAudioUrl, generateAudio, generateAudioForRecipient, deleteAudioForCampaign, transcribeAndSaveRecording };
