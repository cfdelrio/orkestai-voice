/**
 * @fileoverview Public (unauthenticated) API routes.
 *
 * GET /api/public/campaigns/:slug/feed  — Public campaign feed (rate limited, ETag cached)
 * GET /api/public/widget.js             — Embeddable widget script
 */

const { Router } = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../middleware/errorHandler');
const publicFeedService = require('../services/publicFeedService');

const router = Router();

const feedRateLimit = rateLimit({
  windowMs: 60_000,        // 1 minute window
  max: 120,                // 120 req/min per IP — covers ~12 concurrent widgets at 10s intervals
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many requests — try again in a minute' } },
});

/**
 * GET /api/public/campaigns/:slug/feed
 * Returns the public feed for a campaign by slug.
 * Includes ETag for conditional requests and Cache-Control for CDN caching.
 */
router.get('/campaigns/:slug/feed', feedRateLimit, asyncHandler(async (req, res) => {
  const feed = await publicFeedService.getFeedBySlug(req.params.slug);

  const etag = `"${crypto.createHash('sha1').update(JSON.stringify(feed)).digest('hex').slice(0, 16)}"`;

  res.setHeader('Cache-Control', 'public, max-age=5, stale-while-revalidate=10');
  res.setHeader('ETag', etag);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  res.json(feed);
}));

/**
 * GET /api/public/widget.js
 * Serves the embeddable widget script.
 */
router.get('/widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(path.join(process.cwd(), 'public', 'widget.js'));
});

module.exports = router;
