'use strict';

require('dotenv').config();
const express = require('express');
const axios   = require('axios');

const app  = express();
const PORT = process.env.PORT || 3099;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const INTERNAL_KEY  = process.env.VDG_INTERNAL_KEY || 'vdg_internal_2026';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL    || 'claude-sonnet-4-6';

const usage = { total_calls: 0, by_product: {}, last_call: null };
function trackCall(product) {
  usage.total_calls++;
  usage.by_product[product] = (usage.by_product[product] || 0) + 1;
  usage.last_call = new Date().toISOString();
}
function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }

app.use(express.json({ limit: '1mb' }));

function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const key    = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
  if (!key) return res.status(401).json({ error: 'unauthorized' });
  if (key === INTERNAL_KEY) { req.product = req.headers['x-vdg-product'] || 'unknown'; req.isInternal = true; return next(); }
  const paidKeys = (process.env.VDG_PAID_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (paidKeys.includes(key)) { req.product = 'external'; req.isInternal = false; return next(); }
  return res.status(403).json({ error: 'invalid_key' });
}

app.post('/v1/ai/chat', authenticate, async (req, res) => {
  const { messages, system, max_tokens, model } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'bad_request' });
  const resolvedModel = model || DEFAULT_MODEL;
  const resolvedMaxTokens = max_tokens || 1500;
  trackCall(req.product);
  log('AI call | ' + req.product);
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: resolvedModel, max_tokens: resolvedMaxTokens, messages, ...(system && { system }) },
      { headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 60000 }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.get('/v1/health', (req, res) => {
  res.json({ status: 'ok', service: 'VDG Internal AI Gateway', model: DEFAULT_MODEL, timestamp: new Date().toISOString(), uptime_s: Math.floor(process.uptime()), total_calls: usage.total_calls });
});

app.get('/v1/usage', authenticate, (req, res) => {
  if (!req.isInternal) return res.status(403).json({ error: 'forbidden' });
  res.json(usage);
});

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

if (!ANTHROPIC_KEY) { console.error('ERROR: ANTHROPIC_API_KEY not set.'); process.exit(1); }

app.listen(PORT, () => console.log('VDG Gateway ONLINE port ' + PORT));
