// SPDX-License-Identifier: GPL-3.0-or-later
// Snapshot-only controller presentation. No file reads or native probes here.
const terminal = status => ['completed', 'failed', 'cancelled'].includes(status);
export function packageDeckRows(state, view, jobs) {
  const rows = [], row = (label, detail, command = null, args = {}, extra = {}) =>
    rows.push({ label, detail, command, args, enabled: Boolean(command), ...extra });
  if (!view.id) {
    row('From your phone', 'Upload a PKG from Packages. Verification and installation can then be controlled here.');
    for (const item of state.packages || []) row(item.name,
      `${item.status} · ${Math.floor((item.offset || 0) / 1048576)} / ${Math.ceil(item.bytes / 1048576)} MiB`, '$package-open', { id: item.id });
    if (!state.packages?.length) row('No packages staged', 'Uploaded packages appear here automatically.');
    row('Back to games', '', '$package-exit'); return rows;
  }
  const item = state.packages?.find(item => item.id === view.id);
  if (!item) { row('Package no longer available', 'Return to the list of staged packages.'); }
  else {
    const related = jobs.filter(job => job.resources?.includes('package-file:' + item.id));
    const active = related.filter(job => !terminal(job.status));
    const verified = related.findLast(job => job.kind === 'package.verify' && job.status === 'completed');
    const proof = verified?.result, info = proof?.package;
    const evidenced = /^[a-f0-9]{64}$/.test(proof?.sha256 || '') && typeof info?.contentId === 'string';
    row(item.name, `${item.status} · ${Math.ceil(item.bytes / 1048576)} MiB`);
    if (item.offset < item.bytes) row('Transfer incomplete', 'Resume this upload from Packages on your phone.');
    else if (item.status === 'uploading' || (item.status === 'verified' && !evidenced))
      row('Verify package', active.length ? 'An operation already holds this file.' : 'Read the complete file and check its checksum in the background.',
        active.length ? null : 'job.enqueue', { kind: 'package.verify', input: { id: item.id } });
    if (item.status === 'verified' && proof) {
      const capability = state.capabilities.find(item => item.id === 'packages');
      const reason = active.length ? 'An operation already holds this file. Review its result below.' : state.safe || state.recovery?.running
        ? 'Native startup or recovery must finish first.' : !capability?.available ? capability?.reason || 'Package installation is unavailable.' : '';
      if (info?.contentId) row(info.titleId || info.contentId, `${info.platform || ''} · ${info.patch ? 'Update' : 'Application'} · SHA-256 ${proof.sha256?.slice(0, 12)}`);
      row('Install package', reason || (!evidenced ? 'Run package verification again before installing.' : 'Queue background installation. An accepted request is not yet an installed game.'),
        !reason && evidenced ? 'job.enqueue' : null,
        { kind: 'package.install', input: { id: item.id, sha256: proof.sha256, contentId: info?.contentId, bytes: item.bytes } },
        { confirm: true, packageReview: item.id });
    }
    for (const job of active) {
      row(job.kind === 'package.verify' ? 'Package verification' : 'Package installation', `${job.status}: ${job.error?.message || job.progress?.phase || 'Waiting for progress'}`);
      if (job.status === 'held') row('Resume operation', 'Continue this held job through the shared queue.', 'job.resume', { id: job.id }, { confirm: true });
      if (['queued', 'held'].includes(job.status) || job.kind === 'package.verify' && job.status === 'running')
        row('Cancel operation', job.kind === 'package.verify' ? 'Keep uploaded bytes. Stop checksum verification.' : 'Cancel before the installer starts.', 'job.cancel', { id: job.id });
      if (job.status === 'interrupted') row('Check result', 'Read existing evidence. Never submit another installation.', 'job.reconcile', { id: job.id });
    }
    const latest = related.at(-1);
    if (latest && terminal(latest.status)) row('Last operation: ' + latest.status, latest.error?.message || latest.result?.message || 'See Activity for details.');
  }
  row('Back to packages', '', '$packages'); return rows;
}
