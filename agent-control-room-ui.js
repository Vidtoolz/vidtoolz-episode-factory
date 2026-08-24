(function () {
  'use strict';

  var rows = document.getElementById('agentControlRoomRows');
  var summary = document.getElementById('agentControlRoomSummary');
  var roles = document.getElementById('agentControlRoomRoles');
  var queue = document.getElementById('agentDecisionQueue');
  var workflow = document.getElementById('agentWorkflowMap');
  var updated = document.getElementById('agentControlRoomUpdated');
  var refresh = document.getElementById('agentControlRoomRefresh');
  var controlConfig = null;
  if (!rows || !summary || !roles || !queue || !workflow || !refresh) return;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function line(label, value) {
    if (value == null || value === '') return '';
    return '<div class="agent-control-room-line"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  }

  function eventText(event) {
    if (!event) return null;
    if (typeof event === 'string') return event;
    return [event.state, event.detail, event.at].filter(Boolean).join(' · ');
  }

  function controlButtons(agent) {
    var capabilities = agent.control_capabilities || {};
    var target = ' data-run-id="' + esc(agent.run_id) + '" data-agent-id="' + esc(agent.agent_id) + '" data-invocation-id="' + esc(agent.invocation && agent.invocation.invocation_id) + '"';
    var buttons = [];
    if (capabilities.retry) buttons.push('<button type="button" class="agent-control-action" data-action="retry"' + target + '>Preview retry</button>');
    if (capabilities.cancel) buttons.push('<button type="button" class="agent-control-action danger" data-action="cancel"' + target + '>Preview cancel</button>');
    return buttons.length ? '<div class="agent-control-actions">' + buttons.join('') + '</div><div class="agent-control-result" id="agentControlResult-' + esc(agent.agent_id) + '" aria-live="polite"></div>' : '';
  }

  function renderAgent(agent) {
    var attention = agent.attention || 'INFORMATION';
    var badgeClass = attention === 'DECISION' ? 'decision'
      : attention === 'REVIEW' ? 'review'
        : agent.state === 'BLOCKED' || agent.state === 'UNAVAILABLE' ? 'blocked' : 'information';
    var implementation = agent.implementation || {};
    var handoff = agent.handoff || {};
    var onward = handoff.current_implementation_state
      ? (agent.next_owner || 'next owner') + ': ' + handoff.current_implementation_state
        + (handoff.current_implementation_reason ? ' — ' + handoff.current_implementation_reason : '')
      : null;
    var runtime = agent.runtime_source === 'AGENT_RUNNER'
      ? (agent.runtime_status || 'UNKNOWN') + (agent.runtime_active ? ' · active' : ' · inactive')
      : null;
    var lifecycle = agent.lifecycle
      ? [agent.lifecycle.doctrine, agent.lifecycle.proven, 'DISPATCH ' + agent.lifecycle.autonomous_dispatch].join(' · ')
      : null;
    var prerequisites = agent.lifecycle && agent.lifecycle.enablement_prerequisites
      ? agent.lifecycle.enablement_prerequisites.join('; ') : null;
    var rationale = agent.operational_rationale || {};
    var resourceStatus = agent.resource_status || {};
    var executionOwnership = agent.execution_ownership || {};
    return '<article class="agent-control-room-card ' + badgeClass + '" data-agent-id="' + esc(agent.agent_id) + '">' +
      '<div class="agent-control-room-card-heading"><div><h3>' + esc(agent.name) + '</h3><small>' + esc(agent.agent_id) + '</small></div>' +
      '<div class="agent-control-room-badges"><span class="agent-state">' + esc(agent.state) + '</span>' +
      '<span class="agent-attention ' + badgeClass + '">' + esc(attention) + '</span></div></div>' +
      line('Task', agent.current_task || 'No canonical current task') +
      line('Run', agent.run_id) +
      line('Project', agent.project_id) +
      line('Runtime', runtime) +
      line('Execution owner', executionOwnership.owner ? executionOwnership.owner + ' · revision ' + executionOwnership.revision : null) +
      line('Ownership integrity', executionOwnership.valid === false ? executionOwnership.error || 'INVALID' : null) +
      line('Lifecycle', lifecycle) +
      line('Prerequisites', prerequisites) +
      line('Invocation', agent.invocation && agent.invocation.invocation_id) +
      line('Host / lane', [agent.host, agent.lane].filter(Boolean).join(' · ')) +
      line('Model', agent.model) +
      line('Owner → next', (agent.owner || agent.agent_id) + ' → ' + (agent.next_owner || '—')) +
      line('Blocker', agent.blocker) +
      line('Onward handoff', onward) +
      line('Human gate', agent.human_gate ? 'Required' : null) +
      line('Completed', agent.completed_at) +
      line('Disagreement', agent.disagreement) +
      line('Resource', agent.resource_dependency) +
      line('Resource live', [resourceStatus.health || 'UNKNOWN', resourceStatus.job_state || 'UNKNOWN', resourceStatus.worker || 'UNKNOWN'].join(' · ')) +
      line('Resource job', resourceStatus.job_id || 'UNKNOWN') +
      line('Rationale source', rationale.source === 'DERIVED' ? 'DERIVED · projection fallback' : rationale.source) +
      line('Why', rationale.reason) +
      line('Escalation reason', rationale.escalation_reason) +
      line('Confidence', rationale.confidence) +
      line('Artifact', agent.current_artifact && typeof agent.current_artifact === 'object' ? JSON.stringify(agent.current_artifact) : agent.current_artifact) +
      line('Latest event', eventText(agent.latest_event)) +
      controlButtons(agent) +
      '<div class="agent-control-room-implementation">Implementation: ' + esc(implementation.state || 'UNKNOWN') +
      (implementation.module_path ? ' · ' + esc(implementation.module_path) : '') + '</div>' +
      '</article>';
  }

  function renderQueueItem(item) {
    var artifact = item.artifact && typeof item.artifact.value === 'object'
      ? JSON.stringify(item.artifact.value) : item.artifact && item.artifact.value;
    return '<article class="agent-decision-item ' + esc(item.attention.toLowerCase()) + '">' +
      '<div><strong>' + esc(item.attention) + ' · ' + esc(item.role || item.agent_id) + '</strong>' +
      '<small>' + esc(item.task_id || item.invocation_id || 'current') + '</small></div>' +
      '<p>' + esc(item.reason || 'Human attention required') + '</p>' +
      line('Rationale source', item.operational_rationale && item.operational_rationale.source === 'DERIVED' ? 'DERIVED · projection fallback' : item.operational_rationale && item.operational_rationale.source) +
      line('Escalation reason', item.operational_rationale && item.operational_rationale.escalation_reason) +
      line('Confidence', item.operational_rationale && item.operational_rationale.confidence) +
      line('Artifact', artifact) + line('Gate / scope', item.owning_gate + ' / ' + item.approval_scope_required) +
      line('Lifecycle', item.lifecycle_state) +
      '<a href="' + esc(item.workspace) + '">Open relevant workspace</a></article>';
  }

  function renderWorkflow(report) {
    var next = report.nextSafeHumanAction || {};
    workflow.innerHTML = (report.gates || []).map(function (gate) {
      var current = gate.status === 'current-blocked';
      return '<article class="agent-workflow-gate ' + esc(gate.status) + '">' +
        '<strong>' + esc(gate.label) + '</strong><small>' + esc(gate.id) + ' · ' + esc(gate.status) + '</small>' +
        (current ? line('Blocker', report.currentBlocker || (gate.missingArtifacts || []).join('; ')) : '') +
        (current ? line('Approval', next.humanApprovalRequired ? 'Human approval required' : 'No approval claimed') : '') +
        (current ? line('Next safe action', next.label || 'UNKNOWN') : '') + '</article>';
    }).join('');
  }

  function loadWorkflow(payload) {
    var agent = (payload.agents || []).find(function (item) { return item.runtime_active && item.run_id; })
      || (payload.human_decision_queue || []).map(function (item) {
        return (payload.agents || []).find(function (agentRow) { return agentRow.agent_id === item.agent_id && agentRow.run_id; });
      }).find(Boolean)
      || (payload.agents || []).find(function (item) { return item.run_id; });
    if (!agent) { workflow.innerHTML = '<p class="muted">No package run is bound to current agent evidence.</p>'; return; }
    fetch('/api/agent-control-room/workflow-map?runId=' + encodeURIComponent(agent.run_id), { method: 'GET', cache: 'no-store' })
      .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(function (envelope) { renderWorkflow(envelope && envelope.data ? envelope.data : envelope); })
      .catch(function (error) { workflow.innerHTML = '<p class="muted">Workflow map unavailable: ' + esc(error.message) + '</p>'; });
  }

  function render(payload) {
    var agents = payload.agents || [];
    controlConfig = payload.operator_controls || null;
    var counts = payload.summary || {};
    summary.innerHTML = '<strong>' + esc(agents.length) + ' registered specialists</strong>' +
      '<span>Decision ' + esc(counts.decision || 0) + '</span>' +
      '<span>Review ' + esc(counts.review || 0) + '</span>' +
      '<span>Unavailable ' + esc(counts.unavailable || 0) + '</span>' +
      '<span>Runner context ' + esc(counts.runner_context || 0) + '</span>' +
      '<span>No runtime context ' + esc(counts.runtime_state_missing || 0) + '</span>';
    rows.innerHTML = agents.map(renderAgent).join('');
    var decisionItems = payload.human_decision_queue || [];
    queue.innerHTML = decisionItems.length ? decisionItems.map(renderQueueItem).join('')
      : '<p class="muted">No review or decision items require attention.</p>';
    loadWorkflow(payload);

    var planned = (payload.planned_roles || []).map(function (role) {
      return '<span class="agent-planned-role"><strong>' + esc(role.name) + '</strong> · ' + esc(role.runtime_status) + '</span>';
    }).join('');
    var nonAgents = payload.non_agent_roles || {};
    var boundaries = [];
    if (nonAgents.hermes) boundaries.push(esc(nonAgents.hermes.name) + ' — router, not a specialist agent');
    if (nonAgents.knowledge_steward) boundaries.push(esc(nonAgents.knowledge_steward.name) + ' — non-specialist, not a runtime agent');
    roles.innerHTML = (planned ? '<div><strong>Planned roles</strong><div class="agent-planned-list">' + planned + '</div></div>' : '') +
      (boundaries.length ? '<p class="muted">' + boundaries.join(' · ') + '</p>' : '');
    updated.textContent = 'Updated ' + new Date(payload.generated_at).toLocaleTimeString();
  }

  function postControl(path, body) {
    if (!controlConfig || !controlConfig.local_write_nonce) return Promise.reject(new Error('Local operator authorization is unavailable'));
    var headers = { 'Content-Type': 'application/json' };
    headers[controlConfig.nonce_header || 'x-vidtoolz-local-write-nonce'] = controlConfig.local_write_nonce;
    body.localWriteNonce = controlConfig.local_write_nonce;
    return fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(body) }).then(function (response) {
      return response.json().then(function (payload) { if (!response.ok) throw new Error(payload.error || ('HTTP ' + response.status)); return payload.data || payload; });
    });
  }

  function runControl(button) {
    var action = button.getAttribute('data-action');
    var reason = window.prompt('Reason for ' + action.toUpperCase() + ' (recorded in the operator ledger):');
    if (!reason || !reason.trim()) return;
    var body = { run_id: button.getAttribute('data-run-id'), agent_id: button.getAttribute('data-agent-id'), invocation_id: button.getAttribute('data-invocation-id'), reason: reason.trim() };
    button.disabled = true;
    postControl('/api/agent-control-room/' + action + '/preview', Object.assign({}, body)).then(function (preview) {
      if (!preview.eligible) throw new Error(action.toUpperCase() + ' is not supported for this exact invocation; remote work may continue.');
      var consequence = action === 'retry' ? 'Create a new attempt while preserving all prior evidence?'
        : action === 'cancel' ? 'Request cancellation of the exact invocation-bound worker job?'
          : action === 'take-manual-control' ? 'Fence automation for this exact task work unit? This does not grant approval.'
            : 'Return this exact work unit to automation after server-side revalidation?';
      if (!window.confirm(consequence)) return null;
      return postControl('/api/agent-control-room/' + action + '/apply', Object.assign({}, body, { preview_token: preview.preview_token }));
    }).then(function (result) {
      if (!result) return;
      return load().then(function () {
        var output = document.getElementById('agentControlResult-' + body.agent_id);
        if (output) output.textContent = result.result_status + ' · action record ' + result.action_record_id;
      });
    }).catch(function (error) { window.alert(error.message); }).finally(function () { button.disabled = false; });
  }

  function load() {
    refresh.disabled = true;
    updated.textContent = 'Refreshing…';
    return fetch('/api/agent-control-room', { method: 'GET', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (envelope) { render(envelope && envelope.data ? envelope.data : envelope); })
      .catch(function (error) {
        summary.innerHTML = '<strong>Control room unavailable</strong><span>' + esc(error.message) + '</span>';
        rows.innerHTML = '';
        queue.innerHTML = '';
        workflow.innerHTML = '';
        roles.innerHTML = '<p class="muted">Start the Episode Factory cockpit server to inspect registered agents.</p>';
        updated.textContent = '';
      })
      .finally(function () { refresh.disabled = false; });
  }

  refresh.addEventListener('click', load);
  rows.addEventListener('click', function (event) { var button = event.target.closest('.agent-control-action'); if (button) runControl(button); });
  load();
})();
