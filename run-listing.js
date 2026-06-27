/*
  Run listing API - provides focused run status for dashboard
*/
window.RunListing = (function () {
  const DEFAULT_ENDPOINT = '/api/package-runs/list';

  async function fetchRunList(endpoint = DEFAULT_ENDPOINT) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      console.warn('RunListing fetch failed:', err);
      return { runs: [] };
    }
  }

  function findRunById(runs, runId) {
    return runs.find(r => r.runId === runId) || null;
  }

  function buildNextActionBlock(run) {
    if (!run) return '';
    
    const status = run.status || '';
    const bucket = run.workflowBucket || '';
    
    // Determine the most actionable thing based on current stage
    let nextAction = run.nextRecommendedCommand || '';
    let actionLabel = 'Next action';
    let isBlocking = false;
    
    // Creator QA blocking
    if (run.creatorQaStatus && run.creatorQaStatus !== 'PASS' && run.creatorQaStatus !== 'not run') {
      nextAction = `node scripts/package-run-creator-qa.js package-runs/${run.runId}`;
      actionLabel = 'Creator QA required';
      isBlocking = true;
    }
    // Research not done
    else if (status.includes('Research') && run.missingExpectedArtifacts?.includes('research-pack.md')) {
      nextAction = run.nextRecommendedCommand || 'Generate research pack';
      actionLabel = 'Research needed';
    }
    // Outline not done
    else if (status.includes('Outline') && run.missingExpectedArtifacts?.includes('final-outline.md')) {
      nextAction = run.nextRecommendedCommand || 'Generate outline';
      actionLabel = 'Outline needed';
    }
    // Script not done
    else if (status.includes('Script') && run.missingExpectedArtifacts?.includes('final-script.md')) {
      nextAction = run.nextRecommendedCommand || 'Generate script';
      actionLabel = 'Script needed';
    }
    // Ready to shoot
    else if (status === 'Ready to shoot') {
      nextAction = 'Run creator QA check, then shoot the video';
      actionLabel = 'Ready to shoot';
    }
    // Has expected file
    else if (run.nextExpectedFile) {
      nextAction = `Add ${run.nextExpectedFile} to move forward`;
      actionLabel = 'Next artifact';
    }
    
    if (!nextAction) {
      nextAction = 'Review project status and artifacts';
      actionLabel = 'Manual review';
    }

    return `
      <div class="next-action-card">
        <div class="next-action-header">
          <span class="action-label">${actionLabel}</span>
          ${isBlocking ? '<span class="blocking-badge">BLOCKING</span>' : ''}
        </div>
        <div class="next-action-content">${nextAction}</div>
      </div>
    `;
  }

  return {
    fetchRunList,
    findRunById,
    buildNextActionBlock,
  };
})();
