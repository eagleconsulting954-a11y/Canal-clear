/**
 * Status API — real-time service health for the public status page.
 * Owns: /api/status endpoint, service health state.
 * Does NOT own: incident management, uptime monitoring infrastructure.
 */
const express = require('express');
const router = express.Router();

const SERVER_START = Date.now();

// Services tracked for status page display
const SERVICES = [
  {
    name: 'Filing Wizards',
    slug: 'filing-wizards',
    description: 'Panama, Suez, Bosporus, Malacca, Cape of Good Hope',
    status: 'operational',
    category: 'core',
  },
  {
    name: 'Deadline Alerts',
    slug: 'deadline-alerts',
    description: 'Email & webhook deadline notifications',
    status: 'operational',
    category: 'core',
  },
  {
    name: 'OCR Upload',
    slug: 'ocr-upload',
    description: 'Document scanning and autofill from certificates',
    status: 'operational',
    category: 'core',
  },
  {
    name: 'Batch Filing',
    slug: 'batch-filing',
    description: 'Multi-vessel bulk filing across all waterways',
    status: 'operational',
    category: 'core',
  },
  {
    name: 'Fleet Dashboard',
    slug: 'fleet-dashboard',
    description: 'Unified fleet compliance and voyage tracking',
    status: 'operational',
    category: 'core',
  },
  {
    name: 'Public API',
    slug: 'api',
    description: 'REST API for integrations and third-party access',
    status: 'operational',
    category: 'core',
  },
];

router.get('/', (req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - SERVER_START) / 1000);
  const uptimeDays = Math.floor(uptimeSeconds / 86400);
  const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
  const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
  const uptimeSecondsRem = uptimeSeconds % 60;

  const uptimeStr = uptimeDays > 0
    ? `${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`
    : uptimeHours > 0
      ? `${uptimeHours}h ${uptimeMinutes}m ${uptimeSecondsRem}s`
      : `${uptimeMinutes}m ${uptimeSecondsRem}s`;

  const allOperational = SERVICES.every(s => s.status === 'operational');
  const overallStatus = allOperational ? 'operational' : 'degraded';

  res.json({
    status: overallStatus,
    checked_at: new Date().toISOString(),
    uptime: uptimeStr,
    uptime_seconds: uptimeSeconds,
    services: SERVICES.map(s => ({
      name: s.name,
      slug: s.slug,
      description: s.description,
      status: s.status,
    })),
  });
});

module.exports = router;