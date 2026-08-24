'use strict';

const APPROVAL_SCOPES = Object.freeze([
  'CANDIDATE_SELECTION', 'PLAN_SCRIPT_APPROVAL', 'VISUAL_PLAN_APPROVAL',
  'PRESENTER_PERFORMANCE_APPROVAL', 'FINAL_CUT_APPROVAL', 'FINAL_MUSIC_APPROVAL',
  'TITLE_THUMBNAIL_APPROVAL', 'PUBLICATION_APPROVAL', 'VISUAL_IDENTITY_APPROVAL',
  'RESEARCH_EXCEPTION', 'SOUND_MUSIC_DIRECTOR_PRODUCTION_BASELINE',
]);

const AGENT_APPROVAL_SCOPE = Object.freeze({
  production_operations: 'PUBLICATION_APPROVAL', camera_director: 'CANDIDATE_SELECTION',
  generation_supervisor: 'CANDIDATE_SELECTION', qc_director: 'FINAL_CUT_APPROVAL',
  editor: 'FINAL_CUT_APPROVAL', sound_music_director: 'FINAL_MUSIC_APPROVAL',
  research_director: 'PLAN_SCRIPT_APPROVAL', story_editor: 'PLAN_SCRIPT_APPROVAL',
  visual_planning_director: 'VISUAL_PLAN_APPROVAL', audience_packaging_director: 'TITLE_THUMBNAIL_APPROVAL',
  presenter_director: 'PRESENTER_PERFORMANCE_APPROVAL', creative_director: 'VISUAL_IDENTITY_APPROVAL',
});

function isApprovalScope(value) { return APPROVAL_SCOPES.includes(value); }
function scopeForAgent(agentId) { return AGENT_APPROVAL_SCOPE[agentId] || null; }
function scopeForHumanGate(humanGateType) { return isApprovalScope(humanGateType) ? humanGateType : null; }

module.exports = { APPROVAL_SCOPES, AGENT_APPROVAL_SCOPE, isApprovalScope, scopeForAgent, scopeForHumanGate };
