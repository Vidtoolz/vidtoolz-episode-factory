(function () {
  'use strict';

  var rows = document.getElementById('agentControlRoomRows');
  var summary = document.getElementById('agentControlRoomSummary');
  var roles = document.getElementById('agentControlRoomRoles');
  var queue = document.getElementById('agentDecisionQueue');
  var updated = document.getElementById('agentControlRoomUpdated');
  var refresh = document.getElementById('agentControlRoomRefresh');
  if (!rows || !summary || !roles || !queue || !refresh) return;

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
    return '<article class="agent-control-room-card ' + badgeClass + '" data-agent-id="' + esc(agent.agent_id) + '">' +
      '<div class="agent-control-room-card-heading"><div><h3>' + esc(agent.name) + '</h3><small>' + esc(agent.agent_id) + '</small></div>' +
      '<div class="agent-control-room-badges"><span class="agent-state">' + esc(agent.state) + '</span>' +
      '<span class="agent-attention ' + badgeClass + '">' + esc(attention) + '</span></div></div>' +
      line('Task', agent.current_task || 'No canonical current task') +
      line('Run', agent.run_id) +
      line('Project', agent.project_id) +
      line('Runtime', runtime) +
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
      line('Why', rationale.reason) +
      line('Artifact', agent.current_artifact && typeof agent.current_artifact === 'object' ? JSON.stringify(agent.current_artifact) : agent.current_artifact) +
      line('Latest event', eventText(agent.latest_event)) +
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
      line('Artifact', artifact) + line('Gate / scope', item.owning_gate + ' / ' + item.approval_scope_required) +
      line('Lifecycle', item.lifecycle_state) +
      '<a href="' + esc(item.workspace) + '">Open relevant workspace</a></article>';
  }

  function render(payload) {
    var agents = payload.agents || [];
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

  function load() {
    refresh.disabled = true;
    updated.textContent = 'Refreshing…';
    fetch('/api/agent-control-room', { method: 'GET', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (envelope) { render(envelope && envelope.data ? envelope.data : envelope); })
      .catch(function (error) {
        summary.innerHTML = '<strong>Control room unavailable</strong><span>' + esc(error.message) + '</span>';
        rows.innerHTML = '';
        queue.innerHTML = '';
        roles.innerHTML = '<p class="muted">Start the Episode Factory cockpit server to inspect registered agents.</p>';
        updated.textContent = '';
      })
      .finally(function () { refresh.disabled = false; });
  }

  refresh.addEventListener('click', load);
  load();
})();
