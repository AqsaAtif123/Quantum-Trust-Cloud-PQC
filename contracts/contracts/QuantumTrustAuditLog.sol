// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title QuantumTrustAuditLog
 * @notice On-chain audit trail for QuantumTrust Cloud. Only minimal,
 *         non-sensitive verifiable hashes/references are ever stored here —
 *         never file contents, never personal data. The backend calls this
 *         contract on the user's behalf after its own zero-trust
 *         authorization checks have already passed; this contract's own
 *         access control (RECORDER_ROLE) ensures only that authorized
 *         backend service — not arbitrary callers — can write records.
 *
 * @dev No native AVAX/ETH is ever accepted or transferred by this contract,
 *      so classic reentrancy-via-value-transfer is not applicable to its
 *      write paths. Pausable is still included so DEFAULT_ADMIN_ROLE can
 *      halt writes in an incident without needing a full redeploy.
 */
contract QuantumTrustAuditLog is AccessControl, Pausable {
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");

    enum RecordType {
        AuditEvent,
        DocumentHash,
        Notarization,
        PaymentReference
    }

    /// @dev Packed into a single 32-byte storage slot:
    ///      address (20) + uint64 (8) + uint8 (1) + bool (1) = 30 bytes.
    struct AuditRecord {
        address recordedBy;
        uint64 timestamp;
        RecordType recordType;
        bool exists;
        bytes32 dataHash; // occupies its own slot
    }

    mapping(bytes32 => AuditRecord) private _records;

    event AuditEventRecorded(bytes32 indexed recordId, bytes32 dataHash, address indexed recordedBy, uint64 timestamp);
    event DocumentHashRecorded(bytes32 indexed recordId, bytes32 documentHash, address indexed recordedBy, uint64 timestamp);
    event NotarizationRecorded(bytes32 indexed recordId, bytes32 documentHash, address indexed recordedBy, uint64 timestamp);
    event PaymentReferenceRecorded(bytes32 indexed recordId, bytes32 paymentHash, address indexed recordedBy, uint64 timestamp);

    error ZeroRecordId();
    error ZeroDataHash();
    error ZeroAddress();
    error DuplicateRecord(bytes32 recordId);
    error RecordNotFound(bytes32 recordId);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RECORDER_ROLE, admin);
    }

    // ---------- Writes (RECORDER_ROLE only) ----------

    function recordAuditEvent(bytes32 recordId, bytes32 dataHash) external onlyRole(RECORDER_ROLE) whenNotPaused {
        _createRecord(recordId, dataHash, RecordType.AuditEvent);
        emit AuditEventRecorded(recordId, dataHash, msg.sender, uint64(block.timestamp));
    }

    function recordDocumentHash(bytes32 recordId, bytes32 documentHash) external onlyRole(RECORDER_ROLE) whenNotPaused {
        _createRecord(recordId, documentHash, RecordType.DocumentHash);
        emit DocumentHashRecorded(recordId, documentHash, msg.sender, uint64(block.timestamp));
    }

    function recordNotarization(bytes32 recordId, bytes32 documentHash) external onlyRole(RECORDER_ROLE) whenNotPaused {
        _createRecord(recordId, documentHash, RecordType.Notarization);
        emit NotarizationRecorded(recordId, documentHash, msg.sender, uint64(block.timestamp));
    }

    function recordPaymentReference(bytes32 recordId, bytes32 paymentHash) external onlyRole(RECORDER_ROLE) whenNotPaused {
        _createRecord(recordId, paymentHash, RecordType.PaymentReference);
        emit PaymentReferenceRecorded(recordId, paymentHash, msg.sender, uint64(block.timestamp));
    }

    // ---------- Reads (public — verification must be checkable by anyone) ----------

    function verifyRecord(bytes32 recordId)
        external
        view
        returns (bool exists, RecordType recordType, bytes32 dataHash, address recordedBy, uint64 timestamp)
    {
        AuditRecord storage record = _records[recordId];
        return (record.exists, record.recordType, record.dataHash, record.recordedBy, record.timestamp);
    }

    // ---------- Admin ----------

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------- Internal ----------

    function _createRecord(bytes32 recordId, bytes32 dataHash, RecordType recordType) internal {
        if (recordId == bytes32(0)) revert ZeroRecordId();
        if (dataHash == bytes32(0)) revert ZeroDataHash();
        if (_records[recordId].exists) revert DuplicateRecord(recordId);

        // Every field written once, then never mutated — records are
        // append-only by design, matching the audit-log trust model.
        _records[recordId] = AuditRecord({
            recordedBy: msg.sender,
            timestamp: uint64(block.timestamp),
            recordType: recordType,
            exists: true,
            dataHash: dataHash
        });
    }
}
