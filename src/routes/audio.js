/**
 * @fileoverview Audio routes.
 *
 * GET  /api/audio/:filename   — Serves pre-generated TTS MP3s for Twilio <Play>.
 * POST /api/audio/preview     — Generates and streams a TTS preview (no file saved).
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { createLogger } = require('../middleware/logger');

const router = Router();
const logger = createLogger('AudioRoute');
const AUDIO_DIR = path.join(process.cwd(), 'audio');

/**
 * POST /api/audio/preview
 *
 * Generates a TTS audio preview and streams the MP3 directly to the browser.
 * Nothing is saved to disk — each call generates fresh audio.
 *
 * Body: { text: string, voiceInstructions?: string }
 * Response: audio/mpeg
 */
router.post('/preview', async (req, res) => {
  const { text, voiceInstructions, voice } = req.body ?? {};
  const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  const resolvedVoice = VALID_VOICES.includes(voice) ? voice : 'nova';

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: '"text" is required' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'TTS not configured (OPENAI_API_KEY missing)' });
  }

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
      logger.info('Generating preview audio', {
        chars: text.trim().length,
        model: attempt.model,
        hasInstructions: !!attempt.instructions,
      });

      const params = {
        model: attempt.model,
        voice: attempt.voice,
        input: text.trim(),
        response_format: 'mp3',
      };
      if (attempt.instructions) params.instructions = attempt.instructions;

      const ttsResponse = await openai.audio.speech.create(params);
      const buffer = Buffer.from(await ttsResponse.arrayBuffer());

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(buffer);
    } catch (err) {
      logger.error('Preview attempt failed', { model: attempt.model, error: err.message, status: err.status });
      lastError = err;
    }
  }

  res.status(500).json({ error: lastError?.message ?? 'Failed to generate preview audio' });
});

router.get('/:filename', (req, res) => {
  const { filename } = req.params;

  // Only allow safe filenames: alphanumerics, hyphens, dots — no slashes
  if (!/^[\w-]+\.mp3$/i.test(filename)) {
    return res.status(400).end();
  }

  const filepath = path.join(AUDIO_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).end();
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filepath);
});

module.exports = router;
