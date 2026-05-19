/**
 * @fileoverview Audio routes.
 *
 * GET  /api/audio/elevenlabs-voices  — List voices from ElevenLabs account
 * POST /api/audio/preview            — Generate TTS preview (OpenAI or ElevenLabs)
 * GET  /api/audio/:filename          — Serve cached TTS MP3s for Twilio <Play>
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { createLogger } = require('../middleware/logger');
const { getElevenLabsVoices } = require('../services/audioService');

const router = Router();
const logger = createLogger('AudioRoute');
const AUDIO_DIR = path.join(process.cwd(), 'audio');
const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

/**
 * GET /api/audio/elevenlabs-voices
 * Returns voices available on the ElevenLabs account (premade + cloned).
 */
router.get('/elevenlabs-voices', async (req, res) => {
  try {
    const voices = await getElevenLabsVoices();
    res.json({ voices });
  } catch (err) {
    logger.error('Failed to fetch ElevenLabs voices', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/audio/preview
 * Generates a TTS audio preview and streams the MP3 to the browser.
 * Supports OpenAI (default) and ElevenLabs via ttsProvider field.
 *
 * Body: { text, voiceInstructions?, voice?, ttsProvider?, elevenLabsVoiceId? }
 */
router.post('/preview', async (req, res) => {
  const { text, voiceInstructions, voice, ttsProvider, elevenLabsVoiceId } = req.body ?? {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: '"text" is required' });
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');

  // ─── ElevenLabs ─────────────────────────────────────────────────────────────
  if (ttsProvider === 'elevenlabs') {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(503).json({ error: 'ELEVENLABS_API_KEY not configured' });
    }
    if (!elevenLabsVoiceId) {
      return res.status(400).json({ error: 'elevenLabsVoiceId is required for ElevenLabs preview' });
    }
    try {
      logger.info('ElevenLabs preview', { chars: text.trim().length, voiceId: elevenLabsVoiceId });
      const elRes = await fetch(`${ELEVENLABS_API}/text-to-speech/${elevenLabsVoiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
        }),
      });
      if (!elRes.ok) {
        const detail = await elRes.text().catch(() => elRes.statusText);
        return res.status(500).json({ error: `ElevenLabs error ${elRes.status}: ${detail}` });
      }
      const buffer = Buffer.from(await elRes.arrayBuffer());
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      logger.error('ElevenLabs preview failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── OpenAI (default) ───────────────────────────────────────────────────────
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
  }

  const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  const resolvedVoice = VALID_VOICES.includes(voice) ? voice : 'nova';
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const attempts = voiceInstructions
    ? [
        { model: 'gpt-4o-mini-tts', voice: resolvedVoice, instructions: voiceInstructions },
        { model: 'tts-1-hd',        voice: resolvedVoice, instructions: null },
      ]
    : [{ model: 'tts-1-hd', voice: resolvedVoice, instructions: null }];

  let lastError;
  for (const attempt of attempts) {
    try {
      logger.info('OpenAI preview', { chars: text.trim().length, model: attempt.model, voice: attempt.voice });
      const params = { model: attempt.model, voice: attempt.voice, input: text.trim(), response_format: 'mp3' };
      if (attempt.instructions) params.instructions = attempt.instructions;

      const ttsResponse = await openai.audio.speech.create(params);
      const buffer = Buffer.from(await ttsResponse.arrayBuffer());
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      logger.error('OpenAI preview attempt failed', { model: attempt.model, error: err.message });
      lastError = err;
    }
  }

  res.status(500).json({ error: lastError?.message ?? 'Failed to generate preview audio' });
});

router.get('/:filename', (req, res) => {
  const { filename } = req.params;
  if (!/^[\w-]+\.mp3$/i.test(filename)) return res.status(400).end();

  const filepath = path.join(AUDIO_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filepath);
});

module.exports = router;
