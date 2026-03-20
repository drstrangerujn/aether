/**
 * Aether Path Cache
 *
 * Records sequences of actions (paths) and replays them when the same
 * task is detected on a matching page. Falls back to AI mode when the
 * page has changed too much.
 *
 * How it works:
 *   1. AI starts a task → cache_start("search taobao for phone cases")
 *   2. AI executes steps → each navigate/click/type is recorded
 *   3. AI finishes → cache_stop() → path saved with a fingerprint
 *   4. Next time same task on same domain → cache_replay()
 *      → steps execute in sequence, verifying each with page fingerprint
 *      → if verification fails at step N, returns remaining steps to AI
 *
 * Fingerprint = domain + page structure hash (heading texts + form count + interactable count)
 * This is intentionally loose — catches major redesigns but tolerates minor changes.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CACHE_DIR = join(homedir(), '.aether', 'cache');
const MAX_PATHS = 200;
const MAX_AGE_DAYS = 30;

// ─── Storage ────────────────────────────────────────────────────────────────

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function loadIndex() {
  ensureDir();
  const file = join(CACHE_DIR, 'index.json');
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return {}; }
}

function saveIndex(index) {
  ensureDir();
  writeFileSync(join(CACHE_DIR, 'index.json'), JSON.stringify(index, null, 2));
}

// ─── Fingerprint ────────────────────────────────────────────────────────────

function domainOf(url) {
  try { return new URL(url).hostname; }
  catch { return url; }
}

function pageFingerprint(hintMap) {
  // Loose fingerprint: domain + structure shape (not exact content)
  const domain = domainOf(hintMap.url || '');
  const headings = (hintMap.content?.headings || []).map(h => h.text.slice(0, 30)).join('|');
  const formCount = (hintMap.content?.forms || []).length;
  const interactCount = (hintMap.interactables || []).length;
  const regions = [...new Set((hintMap.interactables || []).map(h => h.region))].sort().join(',');

  return `${domain}::h=${hash(headings)}::f=${formCount}::i=${bucket(interactCount)}::r=${regions}`;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function bucket(n) {
  // Bucket interactable count to tolerate minor changes
  if (n < 10) return '0-9';
  if (n < 30) return '10-29';
  if (n < 60) return '30-59';
  if (n < 100) return '60-99';
  return '100+';
}

// ─── Recording ──────────────────────────────────────────────────────────────

let recording = null; // { label, steps: [], startFingerprint, startUrl }

function startRecording(label, hintMap) {
  recording = {
    label,
    steps: [],
    startFingerprint: pageFingerprint(hintMap),
    startUrl: hintMap.url,
    startedAt: Date.now(),
  };
  return { recording: true, label };
}

function recordStep(command, params, hintMapBefore) {
  if (!recording) return false;
  recording.steps.push({
    command,
    params: { ...params },
    fingerprint: hintMapBefore ? pageFingerprint(hintMapBefore) : null,
    ts: Date.now(),
  });
  return true;
}

function stopRecording() {
  if (!recording) return { error: 'No active recording' };

  const path = {
    label: recording.label,
    domain: domainOf(recording.startUrl),
    fingerprint: recording.startFingerprint,
    steps: recording.steps,
    createdAt: Date.now(),
    replayCount: 0,
    lastReplayed: null,
  };

  // Save
  const index = loadIndex();
  const key = `${path.domain}::${path.label}`;
  index[key] = path;

  // Prune old entries
  const keys = Object.keys(index);
  if (keys.length > MAX_PATHS) {
    const sorted = keys.sort((a, b) => (index[a].lastReplayed || index[a].createdAt) - (index[b].lastReplayed || index[b].createdAt));
    for (let i = 0; i < keys.length - MAX_PATHS; i++) delete index[sorted[i]];
  }

  // Prune expired
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  for (const k of Object.keys(index)) {
    if ((index[k].lastReplayed || index[k].createdAt) < cutoff) delete index[k];
  }

  saveIndex(index);
  recording = null;

  return { saved: true, key, steps: path.steps.length };
}

function cancelRecording() {
  recording = null;
  return { cancelled: true };
}

function isRecording() {
  return !!recording;
}

// ─── Lookup & Replay ────────────────────────────────────────────────────────

function findPath(label, hintMap) {
  const domain = domainOf(hintMap.url || '');
  const index = loadIndex();

  // Exact match: same domain + label
  const key = `${domain}::${label}`;
  if (index[key]) {
    return { found: true, key, path: index[key] };
  }

  // Fuzzy: same domain, label contains
  for (const [k, v] of Object.entries(index)) {
    if (v.domain === domain && v.label.includes(label)) {
      return { found: true, key: k, path: v };
    }
  }

  return { found: false };
}

function markReplayed(key) {
  const index = loadIndex();
  if (index[key]) {
    index[key].replayCount++;
    index[key].lastReplayed = Date.now();
    saveIndex(index);
  }
}

function listPaths(domain) {
  const index = loadIndex();
  const entries = Object.entries(index)
    .filter(([, v]) => !domain || v.domain.includes(domain))
    .map(([key, v]) => ({
      key,
      label: v.label,
      domain: v.domain,
      steps: v.steps.length,
      replays: v.replayCount,
      age: Math.round((Date.now() - v.createdAt) / 86400000) + 'd',
    }));
  return entries;
}

function deletePath(key) {
  const index = loadIndex();
  if (index[key]) {
    delete index[key];
    saveIndex(index);
    return { deleted: true, key };
  }
  return { error: 'Path not found' };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  startRecording, recordStep, stopRecording, isRecording,
  findPath, markReplayed, listPaths, deletePath,
};
