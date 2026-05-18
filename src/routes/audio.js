/**
 * @fileoverview Serves pre-generated TTS audio files for Twilio <Play>.
 *
 * GET /api/audio/:filename
 *   Returns the MP3 file. No auth required — Twilio fetches these during calls.
 *   Filename must match the pattern {uuid}-{stepId}.mp3 to prevent path traversal.
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');

const router = Router();
const AUDIO_DIR = path.join(process.cwd(), 'audio');

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
