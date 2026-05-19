/**
 * @fileoverview Audio generation service — OpenAI TTS and ElevenLabs TTS.
 *
 * Files are named {recipientId}-{stepId}.mp3 and cached on disk.
 * Provider is selected per campaign via metadata.ttsProvider ('openai' | 'elevenlabs').
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

// OpenAI
const OPENAI_VOICE_DEFAULT = 'nova';
const OPENAI_VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const MODEL_WITH_INSTRUCTIONS = 'gpt-4o-mini-tts';
const MODEL_DEFAULT = 'tts-1-hd';

// ElevenLabs
const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

function resolveOpenAIVoice(voice) {
  return OPENAI_VALID_VOICES.includes(voice) ? voice : OPENAI_VOICE_DEFAULT;
}

function getFilename(recipientId, stepId) {
  return `${recipientId}-${stepId}.mp3`;
}

function getFilepath(recipientId, stepId) {
  return path.join(AUDIO_DIR, getFilename(recipientId, stepId));
}

function audioExists(recipientId, stepId) {
  return fs.existsSync(getFilepath(recipientId, stepId));
}

function getAudioUrl(recipientId, stepId, webhookBase) {
  return `${webhookBase}/api/audio/${getFilename(recipientId, stepId)}`;
}

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

// ─── OpenAI TTS ───────────────────────────────────────────────────────────────

async function generateAudioOpenAI(filepath, text, instructions, voice) {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — skipping OpenAI TTS');
    return;
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = instructions ? MODEL_WITH_INSTRUCTIONS : MODEL_DEFAULT;
  const resolvedVoice = resolveOpenAIVoice(voice);

  logger.info('OpenAI TTS', { chars: text.length, model, voice: resolvedVoice });

  const params = { model, voice: resolvedVoice, input: text, response_format: 'mp3' };
  if (instructions) params.instructions = instructions;

  const response = await openai.audio.speech.create(params);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filepath, buffer);
  logger.info('OpenAI TTS saved', { bytes: buffer.length });
}

// ─── ElevenLabs TTS ───────────────────────────────────────────────────────────

async function generateAudioElevenLabs(filepath, text, voiceId) {
  if (!process.env.ELEVENLABS_API_KEY) {
    logger.warn('ELEVENLABS_API_KEY not set — skipping ElevenLabs TTS');
    return;
  }
  if (!voiceId) {
    logger.warn('No ElevenLabs voiceId configured — skipping');
    return;
  }

  logger.info('ElevenLabs TTS', { chars: text.length, voiceId });

  const res = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`ElevenLabs TTS error ${res.status}: ${detail}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filepath, buffer);
  logger.info('ElevenLabs TTS saved', { bytes: buffer.length });
}

/**
 * Returns the list of voices from ElevenLabs (including cloned voices).
 */
async function getElevenLabsVoices() {
  if (!process.env.ELEVENLABS_API_KEY) return [];

  const res = await fetch(`${ELEVENLABS_API}/voices`, {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
  });
  if (!res.ok) throw new Error(`ElevenLabs voices error ${res.status}`);

  const data = await res.json();
  return (data.voices ?? []).map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category, // 'premade' | 'cloned' | 'generated'
    previewUrl: v.preview_url ?? null,
  }));
}

// ─── Unified entry point ──────────────────────────────────────────────────────

/**
 * Generates an MP3 for a single flow step. Skips if already cached.
 * Dispatches to OpenAI or ElevenLabs based on ttsProvider.
 *
 * @param {string} recipientId
 * @param {string} stepId
 * @param {string} text
 * @param {string} [instructions]       - Voice instructions (OpenAI only)
 * @param {string} [voice]              - OpenAI voice ID
 * @param {string} [ttsProvider]        - 'openai' | 'elevenlabs' (default: 'openai')
 * @param {string} [elevenLabsVoiceId]  - ElevenLabs voice ID
 */
async function generateAudio(recipientId, stepId, text, instructions, voice, ttsProvider, elevenLabsVoiceId) {
  const filepath = getFilepath(recipientId, stepId);

  if (fs.existsSync(filepath)) {
    logger.debug('Audio already exists — skipping', { recipientId, stepId });
    return;
  }

  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  if (ttsProvider === 'elevenlabs') {
    await generateAudioElevenLabs(filepath, text, elevenLabsVoiceId);
  } else {
    await generateAudioOpenAI(filepath, text, instructions, voice);
  }
}

/**
 * Generates audio for all steps of a recipient.
 */
async function generateAudioForRecipient(recipientId, steps, vars, instructions, voice, ttsProvider, elevenLabsVoiceId) {
  const { interpolateTemplate } = require('./templateEngine');

  const results = await Promise.allSettled(
    steps.map((step) => {
      const text = interpolateTemplate(step.text || '', vars);
      return generateAudio(recipientId, step.id, text, instructions, voice, ttsProvider, elevenLabsVoiceId);
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

// ─── Whisper transcription (for speech_question steps) ────────────────────────

async function transcribeAndSaveRecording(recordingUrl, responseId, accountSid, authToken) {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — skipping transcription', { responseId });
    return;
  }

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  const mp3Url = recordingUrl.endsWith('.mp3') ? recordingUrl : `${recordingUrl}.mp3`;
  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const filepath = path.join(RECORDINGS_DIR, `${responseId}.mp3`);

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

module.exports = {
  audioExists,
  getAudioUrl,
  generateAudio,
  generateAudioForRecipient,
  deleteAudioForCampaign,
  transcribeAndSaveRecording,
  getElevenLabsVoices,
};
