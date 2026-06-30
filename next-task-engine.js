/*
 * VIDTOOLZ next-task engine.
 *
 * Pure function: given a resolved project state (project-state-resolver.js),
 * pick the single next task the operator should do, with a reason, the required
 * inputs, the GUI action (project-action-registry.js), blocked state, and the
 * evidence that confirms completion. Deterministic and file/state driven.
 */

const { resolveAction } = require('./project-action-registry.js');

// Stage-driven: the resolver already computes the furthest coherent stage, so
// the next task maps from that stage. This stays consistent even when a real
// package has gaps in earlier artifacts (those become warnings, not the task).
const STAGE_TASK = {
  idea: 'complete_project_setup',
  approved_topic: 'write_script',
  script: 'write_script',
  image_prompts: 'generate_image_prompts',
  image_generation: 'submit_image_generation',
  image_review: 'select_images',
  i2v_prompts: 'generate_i2v_prompts',
  video_generation: 'submit_video_generation',
  video_review: 'prepare_resolve_handoff',
  resolve_handoff: 'edit_in_resolve',
  editing: 'project_done',
  publish_prep: 'project_done',
  published: 'project_done',
};

function chooseNextTask(state) {
  const c = state.counts || {};
  const status = state.status || 'active';

  // Status overrides short-circuit the pipeline.
  if (status === 'parked') return finalize('unpark_project', state, 'Project is parked. Unpark it to resume production.');
  if (status === 'archived') return finalize('project_done', state, 'Project is archived. No production task is pending.', { done: true });
  if (status === 'published') return finalize('project_done', state, 'Project is published. No production task is pending.', { done: true });
  if (status === 'editing') return finalize('project_done', state, 'Project is being edited in Resolve. No cockpit task is pending.', { done: true });

  const taskId = STAGE_TASK[state.stage] || 'complete_project_setup';
  const why = whyFor(state, taskId, c);
  const extra = {};
  if (taskId === 'submit_image_generation') extra.alt = 'import_manual_images';
  if (taskId === 'submit_video_generation') extra.alt = 'import_manual_videos';
  if (taskId === 'prepare_resolve_handoff') extra.alt = 'review_videos';
  if (taskId === 'project_done') extra.done = true;
  return finalize(taskId, state, why, extra);
}

function whyFor(state, taskId, c) {
  switch (taskId) {
    case 'complete_project_setup': return 'No project metadata yet. Complete setup to create the project.';
    case 'write_script': return 'Project metadata exists but there is no approved/final script.';
    case 'generate_image_prompts': return 'The script is approved but no image prompts exist.';
    case 'submit_image_generation': return `${c.image_prompts} image prompt(s) exist but no images yet. Generate locally on vidnux, or import manual GPT images.`;
    case 'select_images': return `${c.total_images} image(s) exist but ${c.selected_images} selected — selection is incomplete.`;
    case 'generate_i2v_prompts': return `${c.selected_images} image(s) selected but no I2V prompts exist.`;
    case 'submit_video_generation': return 'Selected images exist but no videos yet. Generate on PRESTO, or import manual KlingAI videos.';
    case 'prepare_resolve_handoff': return `${c.total_videos} video(s) exist. Review them, then build the Resolve handoff.`;
    case 'edit_in_resolve': return 'The Resolve handoff is built. Edit in Resolve, then mark the project as editing.';
    case 'project_done': return 'No production task is pending.';
    default: return '';
  }
}

function finalize(taskId, state, why, extra = {}) {
  const action = resolveAction(taskId, state.project_id);
  const blocked = Boolean(extra.blocked) || (Array.isArray(state.blockers) && state.blockers.length > 0);
  const task = {
    id: taskId,
    label: action ? action.label : taskId,
    stage: state.stage,
    why,
    requires: action ? action.requires : [],
    primary_action: action,
    can_run_in_gui: Boolean(action && action.can_run_in_gui),
    blocked,
    blocked_reason: blocked && state.blockers && state.blockers.length ? state.blockers[0] : '',
    completion_evidence: action ? action.evidence : [],
    done: Boolean(extra.done),
  };
  if (extra.alt) {
    task.alternate_action = resolveAction(extra.alt, state.project_id);
  }
  return task;
}

module.exports = { chooseNextTask };
