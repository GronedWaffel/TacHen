// SPDX-License-Identifier: GPL-3.0-or-later
import * as fs from 'node:fs/promises';
import { PayloadInbox } from './inbox.mjs';
import { inspectPackage, MAX_PACKAGE } from './package-format.mjs';
import { invariant } from './errors.mjs';
export async function inspectPackageFile(file, bytes) {
  return inspectPackage(async (position, length) => {
    const buffer = Buffer.alloc(length); let offset = 0;
    while (offset < length) {
      const result = await file.read(buffer, offset, length - offset, position + offset);
      invariant(result.bytesRead > 0, 'PACKAGE_TRUNCATED', 'Package header ended early.'); offset += result.bytesRead;
    }
    return buffer;
  }, bytes);
}
export class PackageInbox extends PayloadInbox {
  constructor(root, { id, reservationGroup }) {
    super(root, { id, reservationGroup, policy: { minimum: 0x2000, maximum: MAX_PACKAGE, names: /^[^/\\\x00-\x1f]{1,180}\.pkg$/i,
      nameMessage: 'Choose a complete .pkg file.', sizeMessage: 'Packages must be between 8 KiB and 1 TiB.',
      inspect: (file, _prefix, status) => inspectPackageFile(file, status.bytes) } });
  }
  async describe(id) {
    const status = await this.status(id);
    if (status.status !== 'verified') return status;
    const file = await fs.open(this.file(id, '.payload'), 'r');
    try { return { ...status, package: await inspectPackageFile(file, status.bytes) }; }
    finally { await file.close(); }
  }
}
export async function installPackageInbox(runtime, root) {
  runtime.packageInbox = await new PackageInbox(root, { id: runtime.id, reservationGroup: runtime.inbox?.reservations }).init();
  runtime.packageItems = await runtime.packageInbox.list();
  runtime.jobs.register('package.verify', {
    async validate(input) {
      const file = await runtime.packageInbox.status(input?.id);
      invariant(file.offset === file.bytes, 'UPLOAD_INCOMPLETE', 'Complete the package upload before verification.');
      return { id: file.id, bytes: file.bytes, name: file.name };
    },
    resources: input => ['package-file:' + input.id, 'file-verification'], timeout: 48 * 60 * 60 * 1000, cancellable: true,
    async run(input, context) {
      try {
        const result = await runtime.packageInbox.verify(input.id, context);
        return { completed: true, id: input.id, sha256: result.sha256, package: result,
          message: 'Package uploaded and verified. Installation has not started.' };
      } catch (error) {
        if (error.code === 'UPLOAD_CANCELLED') return { cancelled: true, message: 'Verification cancelled; uploaded bytes retained.' };
        error.noSideEffects = true; throw error;
      } finally { runtime.packageItems = await runtime.packageInbox.list(); runtime.sequence++; }
    },
    async verify(result, input) { return result.id === input.id && (await runtime.packageInbox.status(input.id)).status === 'verified'; },
    async reconcile(job) {
      // A new read-only checksum may establish verification after an interrupted
      // job. It does not submit an installation or touch an installed title.
      const result = await runtime.packageInbox.verify(job.args.id);
      runtime.packageItems = await runtime.packageInbox.list();
      return { completed: true, id: job.args.id, sha256: result.sha256, package: result, message: 'Package verification confirmed; no installation was submitted.' };
    }
  });
  return runtime.packageInbox;
}
