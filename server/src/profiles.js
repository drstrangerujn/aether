/**
 * Aether Multi-Profile Manager
 *
 * Manages browser profile labels and routing. Profiles are Chrome's built-in
 * user profiles — each has its own cookies, login sessions, extensions, etc.
 *
 * How it works:
 *   1. Extension reports available profiles on connect
 *   2. User labels profiles: "work", "shopping", "personal"
 *   3. AI requests switch_profile("shopping") before a task
 *   4. Server routes commands to the correct profile's extension instance
 *
 * Storage: ~/.aether/profiles.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROFILE_FILE = join(homedir(), '.aether', 'profiles.json');

function ensureDir() {
  const dir = join(homedir(), '.aether');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadProfiles() {
  ensureDir();
  if (!existsSync(PROFILE_FILE)) return {};
  try { return JSON.parse(readFileSync(PROFILE_FILE, 'utf8')); }
  catch { return {}; }
}

function saveProfiles(profiles) {
  ensureDir();
  writeFileSync(PROFILE_FILE, JSON.stringify(profiles, null, 2));
}

// ─── Profile Registry ───────────────────────────────────────────────────────

// Active connections: profileId -> { ws, info }
const connections = new Map();

function registerConnection(profileId, ws, info = {}) {
  const profiles = loadProfiles();

  // Create or update profile entry
  if (!profiles[profileId]) {
    profiles[profileId] = {
      id: profileId,
      label: info.label || profileId,
      domains: [],        // domains this profile is associated with
      createdAt: Date.now(),
    };
  }

  profiles[profileId].lastSeen = Date.now();
  profiles[profileId].userAgent = info.userAgent || null;
  saveProfiles(profiles);

  connections.set(profileId, { ws, info });
  return profiles[profileId];
}

function unregisterConnection(profileId) {
  connections.delete(profileId);
}

function getConnection(profileId) {
  return connections.get(profileId);
}

function getActiveConnections() {
  return Array.from(connections.entries()).map(([id, { info }]) => ({
    id,
    ...info,
    label: loadProfiles()[id]?.label || id,
  }));
}

// ─── Profile Management ─────────────────────────────────────────────────────

function labelProfile(profileId, label) {
  const profiles = loadProfiles();
  if (!profiles[profileId]) return { error: `Profile "${profileId}" not found` };
  profiles[profileId].label = label;
  saveProfiles(profiles);
  return { success: true, id: profileId, label };
}

function addDomain(profileId, domain) {
  const profiles = loadProfiles();
  if (!profiles[profileId]) return { error: `Profile "${profileId}" not found` };
  if (!profiles[profileId].domains.includes(domain)) {
    profiles[profileId].domains.push(domain);
    saveProfiles(profiles);
  }
  return { success: true, id: profileId, domains: profiles[profileId].domains };
}

function removeDomain(profileId, domain) {
  const profiles = loadProfiles();
  if (!profiles[profileId]) return { error: `Profile "${profileId}" not found` };
  profiles[profileId].domains = profiles[profileId].domains.filter(d => d !== domain);
  saveProfiles(profiles);
  return { success: true, id: profileId, domains: profiles[profileId].domains };
}

function findProfileByLabel(label) {
  const profiles = loadProfiles();
  const entry = Object.values(profiles).find(
    p => p.label.toLowerCase() === label.toLowerCase()
  );
  return entry || null;
}

function findProfileByDomain(domain) {
  const profiles = loadProfiles();
  const entry = Object.values(profiles).find(
    p => p.domains.some(d => domain.includes(d) || d.includes(domain))
  );
  return entry || null;
}

function listProfiles() {
  const profiles = loadProfiles();
  const active = new Set(connections.keys());
  return Object.values(profiles).map(p => ({
    ...p,
    online: active.has(p.id),
  }));
}

function deleteProfile(profileId) {
  const profiles = loadProfiles();
  if (!profiles[profileId]) return { error: 'Not found' };
  delete profiles[profileId];
  saveProfiles(profiles);
  return { deleted: true };
}

// ─── Smart Profile Selection ────────────────────────────────────────────────

function suggestProfile(url) {
  if (!url) return null;
  let domain;
  try { domain = new URL(url).hostname; } catch { return null; }

  // 1. Check domain mapping
  const byDomain = findProfileByDomain(domain);
  if (byDomain && connections.has(byDomain.id)) return byDomain;

  // 2. Return first active connection as fallback
  const firstActive = connections.keys().next().value;
  if (firstActive) {
    const profiles = loadProfiles();
    return profiles[firstActive] || { id: firstActive, label: firstActive };
  }

  return null;
}

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  registerConnection, unregisterConnection, getConnection, getActiveConnections,
  labelProfile, addDomain, removeDomain,
  findProfileByLabel, findProfileByDomain, suggestProfile,
  listProfiles, deleteProfile,
};
