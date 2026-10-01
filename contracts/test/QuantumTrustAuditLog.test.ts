import { expect } from 'chai';
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { Contract, ContractFactory, Signer, keccak256, toUtf8Bytes, ZeroHash } from 'ethers';

// Loaded from the solc-compiled artifact (see scripts/compile.ts) rather
// than Hardhat's own artifact system, since the solc binary CDN isn't
// reachable in this build environment. The deployed bytecode and ABI are
// identical either way — only the compilation *path* differs.
const artifactPath = path.join(__dirname, '..', 'artifacts-solc', 'QuantumTrustAuditLog.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

function recordId(label: string): string {
  return keccak256(toUtf8Bytes(label));
}

describe('QuantumTrustAuditLog', () => {
  let admin: Signer;
  let recorder: Signer;
  let stranger: Signer;
  let adminAddress: string;
  let contract: Contract;

  beforeEach(async () => {
    [admin, recorder, stranger] = await ethers.getSigners();
    adminAddress = await admin.getAddress();

    const factory = new ContractFactory(artifact.abi, artifact.bytecode, admin);
    contract = (await factory.deploy(adminAddress)) as unknown as Contract;
    await contract.waitForDeployment();
  });

  describe('access control', () => {
    it('grants the deployer both DEFAULT_ADMIN_ROLE and RECORDER_ROLE', async () => {
      const DEFAULT_ADMIN_ROLE = await contract.DEFAULT_ADMIN_ROLE();
      const RECORDER_ROLE = await contract.RECORDER_ROLE();
      expect(await contract.hasRole(DEFAULT_ADMIN_ROLE, adminAddress)).to.equal(true);
      expect(await contract.hasRole(RECORDER_ROLE, adminAddress)).to.equal(true);
    });

    it('rejects recording from an address without RECORDER_ROLE', async () => {
      const id = recordId('unauthorized-attempt');
      const hash = recordId('some-data');
      await expect(
        contract.connect(stranger).recordAuditEvent(id, hash),
      ).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
    });

    it('allows the admin to grant RECORDER_ROLE to another address, which can then record', async () => {
      const RECORDER_ROLE = await contract.RECORDER_ROLE();
      const recorderAddress = await recorder.getAddress();
      await contract.connect(admin).grantRole(RECORDER_ROLE, recorderAddress);

      const id = recordId('granted-recorder-event');
      const hash = recordId('data');
      await expect(contract.connect(recorder).recordAuditEvent(id, hash)).to.not.be.reverted;
    });

    it('rejects a non-admin trying to grant RECORDER_ROLE', async () => {
      const RECORDER_ROLE = await contract.RECORDER_ROLE();
      await expect(
        contract.connect(stranger).grantRole(RECORDER_ROLE, await stranger.getAddress()),
      ).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
    });

    it('rejects a revoked recorder from writing further records', async () => {
      const RECORDER_ROLE = await contract.RECORDER_ROLE();
      const recorderAddress = await recorder.getAddress();
      await contract.connect(admin).grantRole(RECORDER_ROLE, recorderAddress);
      await contract.connect(admin).revokeRole(RECORDER_ROLE, recorderAddress);

      await expect(
        contract.connect(recorder).recordAuditEvent(recordId('after-revoke'), recordId('data')),
      ).to.be.revertedWithCustomError(contract, 'AccessControlUnauthorizedAccount');
    });
  });

  describe('input validation', () => {
    it('rejects a zero recordId', async () => {
      await expect(
        contract.connect(admin).recordAuditEvent(ZeroHash, recordId('valid-hash')),
      ).to.be.revertedWithCustomError(contract, 'ZeroRecordId');
    });

    it('rejects a zero dataHash', async () => {
      await expect(
        contract.connect(admin).recordAuditEvent(recordId('valid-id'), ZeroHash),
      ).to.be.revertedWithCustomError(contract, 'ZeroDataHash');
    });

    it('rejects deployment with a zero admin address', async () => {
      const factory = new ContractFactory(artifact.abi, artifact.bytecode, admin);
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        { interface: contract.interface } as any,
        'ZeroAddress',
      );
    });
  });

  describe('duplicate prevention', () => {
    it('rejects recording the same recordId twice, even across different record types', async () => {
      const id = recordId('duplicate-test');
      await contract.connect(admin).recordAuditEvent(id, recordId('first'));

      await expect(
        contract.connect(admin).recordAuditEvent(id, recordId('second')),
      ).to.be.revertedWithCustomError(contract, 'DuplicateRecord');

      await expect(
        contract.connect(admin).recordDocumentHash(id, recordId('third')),
      ).to.be.revertedWithCustomError(contract, 'DuplicateRecord');
    });
  });

  describe('event emission', () => {
    it('emits AuditEventRecorded with the correct fields', async () => {
      const id = recordId('login-event-123');
      const hash = recordId('evidence-blob');
      await expect(contract.connect(admin).recordAuditEvent(id, hash))
        .to.emit(contract, 'AuditEventRecorded')
        .withArgs(id, hash, adminAddress, (ts: bigint) => ts > 0n);
    });

    it('emits DocumentHashRecorded, NotarizationRecorded, and PaymentReferenceRecorded correctly', async () => {
      const docId = recordId('doc-1');
      const notarizeId = recordId('notarize-1');
      const paymentId = recordId('payment-1');
      const hash = recordId('content-hash');

      await expect(contract.connect(admin).recordDocumentHash(docId, hash))
        .to.emit(contract, 'DocumentHashRecorded')
        .withArgs(docId, hash, adminAddress, (ts: bigint) => ts > 0n);

      await expect(contract.connect(admin).recordNotarization(notarizeId, hash))
        .to.emit(contract, 'NotarizationRecorded')
        .withArgs(notarizeId, hash, adminAddress, (ts: bigint) => ts > 0n);

      await expect(contract.connect(admin).recordPaymentReference(paymentId, hash))
        .to.emit(contract, 'PaymentReferenceRecorded')
        .withArgs(paymentId, hash, adminAddress, (ts: bigint) => ts > 0n);
    });
  });

  describe('verification / state consistency', () => {
    it('verifyRecord returns exists=false for an unknown recordId, without reverting', async () => {
      const result = await contract.verifyRecord(recordId('never-recorded'));
      expect(result[0]).to.equal(false); // exists
    });

    it('verifyRecord returns the exact data that was recorded', async () => {
      const id = recordId('verify-me');
      const hash = recordId('the-hash');
      const tx = await contract.connect(admin).recordNotarization(id, hash);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const result = await contract.verifyRecord(id);
      expect(result[0]).to.equal(true); // exists
      expect(result[1]).to.equal(2n); // RecordType.Notarization = index 2
      expect(result[2]).to.equal(hash); // dataHash
      expect(result[3]).to.equal(adminAddress); // recordedBy
      expect(result[4]).to.equal(BigInt(block!.timestamp)); // timestamp
    });

    it('keeps each record type independently verifiable and does not let one write corrupt another', async () => {
      const idA = recordId('record-a');
      const idB = recordId('record-b');
      await contract.connect(admin).recordAuditEvent(idA, recordId('hash-a'));
      await contract.connect(admin).recordPaymentReference(idB, recordId('hash-b'));

      const resultA = await contract.verifyRecord(idA);
      const resultB = await contract.verifyRecord(idB);
      expect(resultA[1]).to.equal(0n); // AuditEvent
      expect(resultB[1]).to.equal(3n); // PaymentReference
    });
  });

  describe('pausability (incident response)', () => {
    it('rejects writes while paused, and allows them again after unpause', async () => {
      await contract.connect(admin).pause();
      await expect(
        contract.connect(admin).recordAuditEvent(recordId('while-paused'), recordId('x')),
      ).to.be.revertedWithCustomError(contract, 'EnforcedPause');

      await contract.connect(admin).unpause();
      await expect(
        contract.connect(admin).recordAuditEvent(recordId('after-unpause'), recordId('x')),
      ).to.not.be.reverted;
    });

    it('rejects a non-admin trying to pause the contract', async () => {
      await expect(contract.connect(stranger).pause()).to.be.revertedWithCustomError(
        contract,
        'AccessControlUnauthorizedAccount',
      );
    });
  });

  describe('gas usage sanity', () => {
    it('reports gas used for a single record write (informational, not a hard assertion)', async () => {
      const tx = await contract.connect(admin).recordAuditEvent(recordId('gas-check'), recordId('x'));
      const receipt = await tx.wait();
      // eslint-disable-next-line no-console
      console.log(`      gas used for recordAuditEvent: ${receipt!.gasUsed.toString()}`);
      expect(receipt!.gasUsed).to.be.lessThan(150_000n);
    });
  });
});
